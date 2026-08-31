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
  const authHeader = String(req.headers.authorization ?? "");
  const bearerMatch = authHeader.match(/^Bearer\s(.*)$/i);
  const receivedToken = bearerMatch ? bearerMatch[1] : "";
  // TEMP: diagnostic 401 — lengths and whitespace only; never log the values.
  console.warn("[cron-auth]", {
    receivedTokenLen: receivedToken.length,
    envLen: cronSecret == null ? 0 : String(cronSecret).length,
    envConfigured: Boolean(cronSecret),
    receivedHasOuterWs: receivedToken !== receivedToken.trim(),
    envHasOuterWs: cronSecret == null ? false : String(cronSecret) !== String(cronSecret).trim(),
    headerStartsWithBearer: /^Bearer\s/i.test(authHeader),
  });
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

function uniqueIds(values, limit = 80) {
  const ids = [...new Set((values || []).filter((v) => v != null && v !== "").map(String))];
  return ids.slice(0, limit);
}

function cronRuntimeDebug() {
  return {
    serverNowIso: new Date().toISOString(),
    vercelEnv: process.env.VERCEL_ENV || null,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
  };
}

function writeJson(res, status, payload) {
  const json = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-RAF-Cron", String(payload?.debug?.handler || "cron"));
  res.end(json);
}

function remindDryBody({
  ok = true,
  date = null,
  workoutsToday = 0,
  streak = 0,
  reminded = 0,
  sent = 0,
  devices = 0,
  preview = [],
  debug = {},
}) {
  return {
    ok,
    dry: true,
    date,
    workoutsToday,
    streak,
    reminded,
    sent,
    devices,
    preview,
    debug: {
      handler: "remind",
      ...cronRuntimeDebug(),
      ...debug,
    },
  };
}

async function deliverOrDry({ dry, targets, toUserId, kind, title, body, pushData }) {
  if (dry) {
    return { delivered: targets.length ? 1 : 0, devices: targets.length, dry: true };
  }
  return sendToAllDevices({ targets, toUserId, kind, title, body, pushData });
}

async function handleDailyReminders(req, res) {
  const dry = isDryRun(req);
  const today = cronDate(req);
  const windowFrom = addDaysYmd(today, -STREAK_WINDOW_DAYS);
  const silentErrors = [];
  const query = {
    action: req.query?.action ?? null,
    dry: req.query?.dry ?? null,
    as_of: req.query?.as_of ?? null,
  };

  const finishDry = (fields) => {
    return writeJson(res, 200, remindDryBody({
      date: today,
      ...fields,
      debug: {
        query,
        cotDate: today,
        windowFrom,
        ...fields.debug,
        silentErrors,
      },
    }));
  };

  try {
    const { supabase, error: cfgError } = adminClient();
    if (!supabase) {
      if (dry) {
        silentErrors.push(cfgError || "Missing config");
        return finishDry({ ok: false, debug: { windowRowCount: 0, athleteIds: [], coachIds: [] } });
      }
      return res.status(500).json({ error: cfgError });
    }

    console.log("[remind] date:", today, dry ? "(dry)" : "");

    let windowRows;
    try {
      windowRows = await fetchWorkoutsInRange(supabase, {
        from: windowFrom,
        to: today,
        columns: "id,title,type,total_km,duration_min,athlete_id,scheduled_date,done",
      });
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("[remind] workouts:", msg);
      if (dry) {
        silentErrors.push(`workouts: ${msg}`);
        return finishDry({ ok: false, debug: { windowRowCount: 0, athleteIds: [], coachIds: [] } });
      }
      return res.status(500).json({ error: "No se pudieron leer los workouts" });
    }

    const todayUndone = windowRows.filter((w) => workoutYmd(w) === today && !w.done);
    const streakByAthleteId = streaksByAthlete(windowRows, today);
    const { streakAthleteIds, genericWorkouts } = planDailyPushes(todayUndone, streakByAthleteId);
    const streakIds = [...streakAthleteIds];
    const athleteIds = [...new Set([...streakIds, ...genericWorkouts.map((w) => w.athlete_id).filter(Boolean)])];

    const debugBase = {
      windowRowCount: windowRows.length,
      streakCandidateCount: streakIds.length,
      genericWorkoutCount: genericWorkouts.length,
      athleteIds: uniqueIds(athleteIds),
      coachIds: [],
    };

    if (!athleteIds.length) {
      if (dry) return finishDry({ workoutsToday: todayUndone.length, debug: debugBase });
      return res.status(200).json({
        ok: true,
        sent: 0,
        date: today,
        dry: false,
        streak: 0,
        reminded: 0,
        workoutsToday: todayUndone.length,
      });
    }

    let users = {};
    let coaches = {};
    try {
      const loaded = await loadAthleteUserMap(supabase, athleteIds);
      users = loaded.users || {};
      coaches = loaded.coaches || {};
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("[remind] athletes:", msg);
      if (dry) {
        silentErrors.push(`athletes: ${msg}`);
        return finishDry({ ok: false, workoutsToday: todayUndone.length, debug: debugBase });
      }
      return res.status(500).json({ error: "No se pudieron leer los atletas" });
    }

    const userIds = Object.values(users).filter(Boolean);
    debugBase.coachIds = uniqueIds([...debugBase.coachIds, ...Object.values(coaches)]);

    let targetsFor = () => [];
    try {
      const loadedTargets = await loadPushTargetsByUser(supabase, userIds);
      targetsFor = loadedTargets.targetsFor;
    } catch (e) {
      const msg = e?.message || String(e);
      console.warn("[remind] tokens:", msg);
      silentErrors.push(`tokens: ${msg}`);
      if (!dry) throw e;
    }

    let alreadyStreak = new Set();
    try {
      alreadyStreak = await sentKindUserIds(supabase, {
        kind: STREAK_KIND,
        userIds,
        sinceIso: colombiaMidnightIso(today),
      });
    } catch (e) {
      const msg = e?.message || String(e);
      console.warn("[remind] dedup streak:", msg);
      silentErrors.push(`dedup: ${msg}`);
    }

    let streakSent = 0;
    let remindSent = 0;
    let devices = 0;
    const dryLog = [];
    let skippedNoUser = 0;
    let skippedNoToken = 0;
    let skippedAlreadySent = 0;

    for (const athleteId of streakAthleteIds) {
      const userId = userForAthlete(users, athleteId);
      if (!userId) {
        skippedNoUser += 1;
        continue;
      }
      if (alreadyStreak.has(userId)) {
        skippedAlreadySent += 1;
        continue;
      }
      const targets = targetsFor(userId);
      if (!targets.length) {
        skippedNoToken += 1;
        if (dry) {
          const { x, y } = streakByAthleteId[athleteId] || streakByAthleteId[String(athleteId)] || {};
          const copy = streakRiskCopy(x, y);
          dryLog.push({ kind: STREAK_KIND, skipped: "no_token", athleteId, x, y, title: copy.title, body: copy.body });
        }
        continue;
      }
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
      const userId = userForAthlete(users, w.athlete_id);
      if (!userId) {
        skippedNoUser += 1;
        continue;
      }
      const targets = targetsFor(userId);
      const kmText = w.total_km ? ` · ${w.total_km}km` : "";
      const minText = w.duration_min ? ` · ${w.duration_min}min` : "";
      const body = `${w.title || w.type || "Entrenamiento"}${kmText}${minText}`;
      if (!targets.length) {
        skippedNoToken += 1;
        if (dry) dryLog.push({ kind: REMIND_KIND, skipped: "no_token", athleteId: w.athlete_id, workoutId: w.id, body });
        continue;
      }
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

    const counts = {
      workoutsToday: todayUndone.length,
      streak: streakSent,
      reminded: remindSent,
      sent: streakSent + remindSent,
      devices,
      preview: dry ? dryLog : undefined,
      debug: {
        ...debugBase,
        skippedNoUser,
        skippedNoToken,
        skippedAlreadySent,
      },
    };

    if (dry) return finishDry(counts);
    return res.status(200).json({
      ok: true,
      date: today,
      dry: false,
      workoutsToday: counts.workoutsToday,
      streak: counts.streak,
      reminded: counts.reminded,
      sent: counts.sent,
      devices: counts.devices,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[remind] uncaught:", msg);
    if (dry) {
      silentErrors.push(`uncaught: ${msg}`);
      return finishDry({ ok: false, debug: { windowRowCount: 0, athleteIds: [], coachIds: [] } });
    }
    return res.status(500).json({ error: "Error interno del cron de remind" });
  }
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

  let users = {};
  try {
    const loaded = await loadAthleteUserMap(supabase, summaries.map((s) => s.athleteId));
    users = loaded.users || {};
  } catch (e) {
    console.error("[weekly] athletes:", e.message);
    return res.status(500).json({ error: "No se pudieron leer los atletas" });
  }
  const userIds = Object.values(users).filter(Boolean);
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
    const userId = userForAthlete(users, athleteId);
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
