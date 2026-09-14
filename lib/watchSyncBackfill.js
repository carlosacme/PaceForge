/**
 * Cron diario: pull de intervals.icu para entrenos de ayer sin reloj, y aviso
 * al coach si ICU sigue vacio (caso Julio: COROS no llego hasta visitar el sitio).
 *
 * Nunca llama autoCompleteFromWebhook sin actividad: esa funcion, sin payload,
 * pide ayer+hoy segun Date.now(), no segun as_of.
 */
import { addDaysYmd } from "./cotDate.js";
import {
  COACH_WATCH_SYNC_MISS_KIND,
  COACH_WATCH_SYNC_MISS_TYPE,
  pushTargets,
  sendToAllDevices,
  logDelivery,
} from "./fcmPush.js";
import { icuFetch } from "./icuClient.js";
import { autoCompleteFromWebhook, pickBestActivity } from "./icuAutoComplete.js";
import { isRunWorkout } from "../src/lib/intervals.js";

const WORKOUT_COLS = "id,athlete_id,title,type,structure,total_km,duration_min,done,watch_sync_miss_notified_at";

export function watchSyncYesterday(todayYmd) {
  return addDaysYmd(todayYmd, -1);
}

export function watchSyncMissCopy(athleteName, workoutTitle) {
  const name = (athleteName && String(athleteName).trim()) || "Atleta";
  const title = (workoutTitle && String(workoutTitle).trim()) || "Entreno";
  return {
    title: "⌚ Sin datos de reloj",
    body: `${name} — ${title}`,
  };
}

function outcomeOf(pr) {
  if (pr?.marked || pr?.would_mark) return "marked";
  if (pr?.reason === "ya procesada") return "already";
  return "miss";
}

export async function runWatchSyncBackfill({ supabase, todayYmd, dry = false }) {
  const yesterday = watchSyncYesterday(todayYmd);
  const preview = [];
  const silentErrors = [];
  let marked = 0;
  let notified = 0;
  let icuCalls = 0;

  const { data: pending, error: wErr } = await supabase
    .from("workouts")
    .select(WORKOUT_COLS)
    .eq("scheduled_date", yesterday)
    .not("done", "is", true)
    .order("athlete_id", { ascending: true })
    .order("id", { ascending: true });
  if (wErr) throw wErr;

  const rows = (pending || []).filter((w) => isRunWorkout(w));
  const athleteIds = [...new Set(rows.map((w) => w.athlete_id).filter(Boolean))];
  if (!athleteIds.length) {
    return {
      ok: true, date: todayYmd, yesterday, dry,
      candidates: 0, icuCalls: 0, marked: 0, notified: 0, preview, silentErrors,
    };
  }

  const { data: conns, error: cErr } = await supabase
    .from("device_connections")
    .select("*")
    .eq("provider", "intervals_icu")
    .eq("status", "active")
    .in("athlete_id", athleteIds);
  if (cErr) throw cErr;

  const connByAthlete = new Map();
  for (const c of conns || []) connByAthlete.set(c.athlete_id, c);

  const connected = rows.filter((w) => connByAthlete.has(w.athlete_id));
  const connectedIds = [...new Set(connected.map((w) => w.athlete_id))];

  const athletesById = new Map();
  if (connectedIds.length) {
    const { data: athletes, error: aErr } = await supabase
      .from("athletes")
      .select("id,name,coach_id,user_id")
      .in("id", connectedIds);
    if (aErr) throw aErr;
    for (const a of athletes || []) athletesById.set(a.id, a);
  }

  const byAthlete = new Map();
  for (const w of connected) {
    if (!byAthlete.has(w.athlete_id)) byAthlete.set(w.athlete_id, []);
    byAthlete.get(w.athlete_id).push(w);
  }

  for (const [athleteId, workouts] of byAthlete) {
    const conn = connByAthlete.get(athleteId);
    const athlete = athletesById.get(athleteId) || { id: athleteId, name: null, coach_id: null };
    const icuAth = conn.provider_athlete_id || "0";
    icuCalls += 1;
    const r = await icuFetch(
      conn,
      `/athlete/${encodeURIComponent(icuAth)}/activities?oldest=${yesterday}&newest=${yesterday}`,
    );
    if (!r.ok) {
      silentErrors.push({ athleteId, status: r.status, reason: `icu ${r.status}` });
      for (const w of workouts) {
        preview.push({
          action: "icu_error",
          athleteId,
          athleteName: athlete.name || null,
          workoutId: w.id,
          title: w.title,
          reason: `icu ${r.status}`,
        });
      }
      continue;
    }

    const activities = Array.isArray(r.data) ? r.data : [];
    const best = pickBestActivity(activities);
    const skipMissIds = new Set();

    // Una actividad del dia, si existe, se ofrece via autoComplete (match por
    // fecha + done=false). El resto, o si no hay actividad, cae a aviso miss.
    if (best) {
      try {
        const pr = await autoCompleteFromWebhook(conn, best, { dry });
        const action = outcomeOf(pr);
        if (action === "marked" || action === "already") {
          if (pr.workout_id != null) skipMissIds.add(String(pr.workout_id));
          if (action === "marked") marked += 1;
          preview.push({
            action: action === "already" ? "already" : (dry ? "would_mark" : "marked"),
            athleteId,
            athleteName: athlete.name || null,
            workoutId: pr.workout_id,
            title: workouts.find((w) => String(w.id) === String(pr.workout_id))?.title
              || workouts[0]?.title,
            activityId: pr.activity_id ?? null,
            reason: pr.reason || null,
          });
        }
      } catch (e) {
        silentErrors.push({ athleteId, reason: String(e?.message || e) });
        preview.push({
          action: "icu_error",
          athleteId,
          athleteName: athlete.name || null,
          workoutId: workouts[0]?.id,
          title: workouts[0]?.title,
          reason: String(e?.message || e),
        });
        continue;
      }
    }

    for (const w of workouts) {
      if (skipMissIds.has(String(w.id))) continue;
      const miss = await notifyWatchSyncMiss({
        supabase, athlete, workout: w, dry,
      });
      if (miss.sent || miss.dry) notified += 1;
      preview.push({
        action: dry ? "would_notify_miss" : (miss.sent ? "notified_miss" : (miss.skipped || "miss_skipped")),
        athleteId,
        athleteName: athlete.name || null,
        workoutId: w.id,
        title: w.title,
        reason: miss.reason || miss.skipped || "sin actividad en intervals.icu",
      });
    }
  }

  return {
    ok: true,
    date: todayYmd,
    yesterday,
    dry,
    candidates: connected.length,
    icuCalls,
    marked,
    notified,
    preview,
    silentErrors,
  };
}

async function notifyWatchSyncMiss({ supabase, athlete, workout, dry }) {
  const coachUserId = athlete?.coach_id;
  const { title, body } = watchSyncMissCopy(athlete?.name, workout?.title);
  if (dry) {
    return { sent: false, dry: true, reason: "dry" };
  }
  if (!coachUserId) return { sent: false, skipped: "sin coach" };
  if (workout.watch_sync_miss_notified_at) {
    return { sent: false, skipped: "ya notificado" };
  }

  const claimedAt = new Date().toISOString();
  // También exige done distinto de true: si el webhook gana la carrera
  // entre el SELECT de candidatos y este claim, no avisamos "sin reloj".
  const { data: claimed, error: claimErr } = await supabase
    .from("workouts")
    .update({ watch_sync_miss_notified_at: claimedAt })
    .eq("id", workout.id)
    .is("watch_sync_miss_notified_at", null)
    .not("done", "is", true)
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.warn("[watch-sync] claim:", claimErr.message);
    return { sent: false, reason: claimErr.message };
  }
  if (!claimed) return { sent: false, skipped: "ya notificado o ya done" };

  const pushData = {
    type: COACH_WATCH_SYNC_MISS_TYPE,
    athlete_id: String(athlete.id),
    workout_id: String(workout.id),
  };
  const kind = COACH_WATCH_SYNC_MISS_KIND;
  const targets = await pushTargets(coachUserId);
  if (!targets.length) {
    await logDelivery({
      fromUserId: athlete.user_id || null,
      toUserId: coachUserId,
      kind,
      title,
      status: "no_token",
      reason: "sin token",
    });
    return { sent: false, reason: "sin token" };
  }
  const outcome = await sendToAllDevices({
    targets,
    toUserId: coachUserId,
    fromUserId: athlete.user_id || null,
    kind,
    title,
    body,
    pushData,
  });
  if (outcome.delivered > 0) return { sent: true };
  return { sent: false, reason: outcome.lastCode || "envio fallido" };
}
