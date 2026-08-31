import { createClient } from "@supabase/supabase-js";
import {
  requireUser,
  areRelated,
  jsonError,
} from "../lib/apiAuth.js";
import {
  pushTargets,
  sendToAllDevices,
  logDelivery,
} from "../lib/fcmPush.js";
import { addDaysYmd, colombiaMidnightIso, colombiaTodayYmd } from "../lib/cotDate.js";
import {
  planDailyPushes,
  streakRiskCopy,
  streaksByAthlete,
} from "../lib/streakRisk.js";
import {
  athleteWeekSummary,
  closedAndPreviousWeekRanges,
  rowsInRange,
  weeklySummaryCopy,
} from "../lib/weekStats.js";
import {
  fetchWorkoutsInRange,
  loadAthleteUserMap,
  loadPushTargetsByUser,
  sentKindUserIds,
} from "../lib/pushCronQuery.js";

const STREAK_KIND = "streak_risk";
const WEEKLY_KIND = "weekly_summary";
const REMIND_KIND = "athlete_calendar";
const STREAK_WINDOW_DAYS = 60;

function userForAthlete(map, athleteId) {
  if (!map) return null;
  return map[athleteId] || map[Number(athleteId)] || map[String(athleteId)] || null;
}

function workoutYmd(w) {
  return String(w?.scheduled_date || "").slice(0, 10);
}

function adminClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { error: "Missing config" };
  return { supabase: createClient(supabaseUrl, serviceKey) };
}

function cronDate(req) {
  const asOf = typeof req.query?.as_of === "string" ? req.query.as_of.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return asOf;
  return colombiaTodayYmd();
}

function isDryRun(req) {
  const v = req.query?.dry;
  return v === "1" || v === "true";
}

function requireCron(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    jsonError(res, 500, "CRON_SECRET no configurada");
    return false;
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    jsonError(res, 401, "Unauthorized");
    return false;
  }
  return true;
}

async function deliverOrDry({ dry, targets, toUserId, kind, title, body, pushData }) {
  if (dry) {
    return { delivered: targets.length ? 1 : 0, devices: targets.length, dry: true };
  }
  return sendToAllDevices({ targets, toUserId, kind, title, body, pushData });
}

async function handleDailyReminders(req, res) {
  const { supabase, error: cfgError } = adminClient();
  if (!supabase) return res.status(500).json({ error: cfgError });

  const today = cronDate(req);
  const dry = isDryRun(req);
  const windowFrom = addDaysYmd(today, -STREAK_WINDOW_DAYS);
  console.log("[remind] date:", today, dry ? "(dry)" : "");

  let windowRows;
  try {
    windowRows = await fetchWorkoutsInRange(supabase, {
      from: windowFrom,
      to: today,
      columns: "id,title,type,total_km,duration_min,athlete_id,scheduled_date,done",
    });
  } catch (e) {
    console.error("[remind] workouts:", e.message);
    return res.status(500).json({ error: "No se pudieron leer los workouts" });
  }

  const todayUndone = windowRows.filter((w) => workoutYmd(w) === today && !w.done);
  const streakByAthleteId = streaksByAthlete(windowRows, today);
  const { streakAthleteIds, genericWorkouts } = planDailyPushes(todayUndone, streakByAthleteId);

  const athleteIds = [
    ...new Set([
      ...[...streakAthleteIds],
      ...genericWorkouts.map((w) => w.athlete_id).filter(Boolean),
    ]),
  ];
  if (!athleteIds.length) {
    return res.status(200).json({ ok: true, sent: 0, date: today, dry, streak: 0, reminded: 0 });
  }

  let athleteMap;
  try {
    athleteMap = await loadAthleteUserMap(supabase, athleteIds);
  } catch (e) {
    console.error("[remind] athletes:", e.message);
    return res.status(500).json({ error: "No se pudieron leer los atletas" });
  }
  const userIds = Object.values(athleteMap).filter(Boolean);
  const { targetsFor } = await loadPushTargetsByUser(supabase, userIds);

  let alreadyStreak = new Set();
  try {
    alreadyStreak = await sentKindUserIds(supabase, {
      kind: STREAK_KIND,
      userIds,
      sinceIso: colombiaMidnightIso(today),
    });
  } catch (e) {
    console.warn("[remind] dedup streak:", e.message);
  }

  let streakSent = 0;
  let remindSent = 0;
  let devices = 0;
  const dryLog = [];

  for (const athleteId of streakAthleteIds) {
    const userId = userForAthlete(athleteMap, athleteId);
    if (!userId || alreadyStreak.has(userId)) continue;
    const targets = targetsFor(userId);
    if (!targets.length) continue;
    const { x, y } = streakByAthleteId[athleteId] || streakByAthleteId[String(athleteId)] || {};
    const { title, body } = streakRiskCopy(x, y);
    const outcome = await deliverOrDry({
      dry,
      targets,
      toUserId: userId,
      kind: STREAK_KIND,
      title,
      body,
      pushData: { type: REMIND_KIND },
    });
    devices += outcome.delivered;
    if (outcome.delivered > 0) {
      streakSent += 1;
      dryLog.push({ kind: STREAK_KIND, userId, athleteId, x, y, title, body });
      console.log(`[remind] streak ${userId}: ${body}`);
    }
  }

  for (const w of genericWorkouts) {
    const userId = userForAthlete(athleteMap, w.athlete_id);
    const targets = targetsFor(userId);
    if (!targets.length) continue;
    const kmText = w.total_km ? ` · ${w.total_km}km` : "";
    const minText = w.duration_min ? ` · ${w.duration_min}min` : "";
    const body = `${w.title || w.type || "Entrenamiento"}${kmText}${minText}`;
    const outcome = await deliverOrDry({
      dry,
      targets,
      toUserId: userId,
      kind: REMIND_KIND,
      title: "🏃 Tienes un entreno hoy",
      body,
      pushData: { type: REMIND_KIND, workout_id: w.id },
    });
    devices += outcome.delivered;
    if (outcome.delivered > 0) {
      remindSent += 1;
      dryLog.push({ kind: REMIND_KIND, userId, athleteId: w.athlete_id, workoutId: w.id, body });
      console.log(`[remind] ✓ ${userId} (${outcome.delivered}/${outcome.devices} disp.): ${body}`);
    }
  }

  return res.status(200).json({
    ok: true,
    date: today,
    dry,
    workoutsToday: todayUndone.length,
    streak: streakSent,
    reminded: remindSent,
    sent: streakSent + remindSent,
    devices,
    ...(dry ? { preview: dryLog } : {}),
  });
}

async function handleWeeklySummary(req, res) {
  // Cron: lunes 13:00 UTC = 08:00 COT, una hora después del remind diario
  // (12:00 UTC) para no disparar dos FCM al mismo atleta en el mismo segundo.
  const { supabase, error: cfgError } = adminClient();
  if (!supabase) return res.status(500).json({ error: cfgError });

  const today = cronDate(req);
  const dry = isDryRun(req);
  const range = closedAndPreviousWeekRanges(today);
  console.log("[weekly] date:", today, range.closedFrom, "→", range.closedTo, dry ? "(dry)" : "");

  let rows;
  try {
    rows = await fetchWorkoutsInRange(supabase, {
      from: range.prevFrom,
      to: range.closedTo,
      columns: "athlete_id,scheduled_date,done,total_km,actual_distance_km,manual_distance_km",
    });
  } catch (e) {
    console.error("[weekly] workouts:", e.message);
    return res.status(500).json({ error: "No se pudieron leer los workouts" });
  }

  const byAthlete = new Map();
  for (const w of rows) {
    if (w?.athlete_id == null) continue;
    const key = String(w.athlete_id);
    if (!byAthlete.has(key)) byAthlete.set(key, []);
    byAthlete.get(key).push(w);
  }

  const summaries = [];
  for (const [athleteId, athleteRows] of byAthlete) {
    const closedRows = rowsInRange(athleteRows, range.closedFrom, range.closedTo);
    if (!closedRows.length) continue;
    const prevRows = rowsInRange(athleteRows, range.prevFrom, range.prevTo);
    summaries.push({ athleteId, summary: athleteWeekSummary(closedRows, prevRows) });
  }

  if (!summaries.length) {
    return res.status(200).json({ ok: true, sent: 0, date: today, dry, range });
  }

  let athleteMap;
  try {
    athleteMap = await loadAthleteUserMap(supabase, summaries.map((s) => s.athleteId));
  } catch (e) {
    console.error("[weekly] athletes:", e.message);
    return res.status(500).json({ error: "No se pudieron leer los atletas" });
  }
  const userIds = Object.values(athleteMap).filter(Boolean);
  const { targetsFor } = await loadPushTargetsByUser(supabase, userIds);

  let already = new Set();
  try {
    already = await sentKindUserIds(supabase, {
      kind: WEEKLY_KIND,
      userIds,
      sinceIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (e) {
    console.warn("[weekly] dedup:", e.message);
  }

  let sent = 0;
  let devices = 0;
  const dryLog = [];

  for (const { athleteId, summary } of summaries) {
    const userId = userForAthlete(athleteMap, athleteId);
    if (!userId || already.has(userId)) continue;
    const targets = targetsFor(userId);
    if (!targets.length) continue;
    const { title, body } = weeklySummaryCopy(summary);
    const outcome = await deliverOrDry({
      dry,
      targets,
      toUserId: userId,
      kind: WEEKLY_KIND,
      title,
      body,
      pushData: { type: REMIND_KIND },
    });
    devices += outcome.delivered;
    if (outcome.delivered > 0) {
      sent += 1;
      dryLog.push({ kind: WEEKLY_KIND, userId, athleteId, summary, title, body });
      console.log(`[weekly] ${userId}: ${body}`);
    }
  }

  return res.status(200).json({
    ok: true,
    date: today,
    dry,
    range,
    candidates: summaries.length,
    sent,
    devices,
    ...(dry ? { preview: dryLog } : {}),
  });
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query.action === "remind") {
    if (!requireCron(req, res)) return;
    return handleDailyReminders(req, res);
  }

  if (req.method === "GET" && req.query.action === "weekly-summary") {
    if (!requireCron(req, res)) return;
    return handleWeeklySummary(req, res);
  }

  if (req.method !== "POST") return res.status(405).end();

  const { to_user_id, title, body, data: pushData } = req.body || {};
  if (!to_user_id) return res.status(400).json({ error: "Falta to_user_id" });

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return res.status(500).json({ error: "FIREBASE_SERVICE_ACCOUNT no configurada" });

  if (!(await areRelated(user.id, to_user_id))) {
    return jsonError(res, 403, "Sin relación con el destinatario");
  }
  const kind = pushData && pushData.type ? String(pushData.type) : null;
  const targets = await pushTargets(to_user_id);
  if (!targets.length) {
    await logDelivery({ fromUserId: user.id, toUserId: to_user_id, kind, title, status: "no_token" });
    return res.status(200).json({ ok: true, sent: false, reason: "sin token" });
  }

  const outcome = await sendToAllDevices({
    targets,
    toUserId: to_user_id,
    fromUserId: user.id,
    kind,
    title,
    body,
    pushData,
  });

  if (outcome.delivered > 0) {
    return res.status(200).json({
      ok: true,
      sent: true,
      devices: outcome.devices,
      delivered: outcome.delivered,
    });
  }
  if (outcome.dead >= outcome.devices) {
    return res.status(200).json({ ok: true, sent: false, reason: "token caducado", code: outcome.lastCode });
  }
  console.error("send-push:", outcome.lastError);
  const status = outcome.lastError?.data ? 502 : 500;
  return res.status(status).json({
    error: outcome.lastError?.message || "Error enviando push",
    code: outcome.lastCode,
    devices: outcome.devices,
  });
}
