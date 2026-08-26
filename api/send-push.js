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
  deviceTokensByUserIds,
} from "../lib/fcmPush.js";

async function handleDailyReminders(res) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Missing config" });
  const supabase = createClient(supabaseUrl, serviceKey);

  // Colombia = UTC-5
  const now = new Date();
  const col = new Date(now.getTime() + (-5 * 60 - now.getTimezoneOffset()) * 60000);
  const today = col.toISOString().split("T")[0];
  console.log("[remind] date:", today);

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id,title,type,total_km,duration_min,athlete_id")
    .eq("scheduled_date", today)
    .eq("done", false);

  if (!workouts?.length) return res.status(200).json({ ok: true, sent: 0, date: today });

  const athleteIds = [...new Set(workouts.map((w) => w.athlete_id))].filter(Boolean);
  const { data: athletes } = await supabase.from("athletes").select("id,user_id").in("id", athleteIds);
  const athleteMap = Object.fromEntries((athletes || []).map((a) => [a.id, a.user_id]));
  const userIds = Object.values(athleteMap).filter(Boolean);

  const devicesByUser = await deviceTokensByUserIds(userIds);
  const { data: profiles } = await supabase.from("profiles").select("user_id,fcm_token").in("user_id", userIds);
  const tokenMap = Object.fromEntries((profiles || []).filter((p) => p.fcm_token).map((p) => [p.user_id, p.fcm_token]));
  const targetsFor = (userId) => {
    const rows = devicesByUser?.[userId];
    if (rows?.length) return rows.map((r) => ({ token: r.token, platform: r.platform || null }));
    const legacy = tokenMap[userId];
    return legacy ? [{ token: legacy, platform: null }] : [];
  };

  let sent = 0;
  let devices = 0;
  for (const w of workouts) {
    const userId = athleteMap[w.athlete_id];
    const targets = targetsFor(userId);
    if (!targets.length) continue;
    const kmText = w.total_km ? ` · ${w.total_km}km` : "";
    const minText = w.duration_min ? ` · ${w.duration_min}min` : "";
    const body = `${w.title || w.type || "Entrenamiento"}${kmText}${minText}`;
    const outcome = await sendToAllDevices({
      targets,
      toUserId: userId,
      kind: "athlete_calendar",
      title: "🏃 Tienes un entreno hoy",
      body,
      pushData: { type: "athlete_calendar", workout_id: w.id },
    });
    devices += outcome.delivered;
    if (outcome.delivered > 0) {
      sent += 1;
      console.log(`[remind] ✓ ${userId} (${outcome.delivered}/${outcome.devices} disp.): ${body}`);
    }
  }
  return res.status(200).json({ ok: true, date: today, workouts: workouts.length, sent, devices });
}

export default async function handler(req, res) {
  // ── CRON: Daily workout reminders ──────────────────────────────
  if (req.method === "GET" && req.query.action === "remind") {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return jsonError(res, 500, "CRON_SECRET no configurada");
    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
      return jsonError(res, 401, "Unauthorized");
    }
    return handleDailyReminders(res);
  }

  // ── PUSH: Send single push notification ────────────────────────
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
