import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import { requireUser, areRelated, fcmTokenByUserId, jsonError } from "../lib/apiAuth.js";

const FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects/runningapexflow/messages:send";

async function sendFCM(token, title, body) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT no configurada");
  const credentials = typeof raw === "string" ? JSON.parse(raw) : raw;
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  const access = await client.getAccessToken();
  const bearer = access?.token;
  if (!bearer) throw new Error("No se pudo obtener access token de Google");
  const response = await fetch(FCM_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: title ?? "RunningApexFlow", body: body ?? "" },
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("FCM error"), { data });
  return data;
}

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
  const { data: profiles } = await supabase.from("profiles").select("user_id,fcm_token").in("user_id", userIds);
  const tokenMap = Object.fromEntries((profiles || []).filter((p) => p.fcm_token).map((p) => [p.user_id, p.fcm_token]));

  let sent = 0;
  for (const w of workouts) {
    const userId = athleteMap[w.athlete_id];
    const token = tokenMap[userId];
    if (!token) continue;
    const kmText = w.total_km ? ` · ${w.total_km}km` : "";
    const minText = w.duration_min ? ` · ${w.duration_min}min` : "";
    const body = `${w.title || w.type || "Entrenamiento"}${kmText}${minText}`;
    try {
      await sendFCM(token, "🏃 Tienes un entreno hoy", body);
      sent++;
      console.log(`[remind] ✓ ${userId}: ${body}`);
    } catch (e) {
      console.warn(`[remind] ✗ ${userId}:`, e.message);
    }
  }
  return res.status(200).json({ ok: true, date: today, workouts: workouts.length, sent });
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

  const { to_user_id, title, body } = req.body || {};
  if (!to_user_id) return res.status(400).json({ error: "Falta to_user_id" });

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return res.status(500).json({ error: "FIREBASE_SERVICE_ACCOUNT no configurada" });

  // El cliente solo declara A QUIEN notifica. El token NUNCA sale de la
  // base: lo resolvemos aqui con service_role tras validar la relacion
  // coach<->atleta.
  if (!(await areRelated(user.id, to_user_id))) {
    return jsonError(res, 403, "Sin relación con el destinatario");
  }
  const destToken = await fcmTokenByUserId(to_user_id);
  if (!destToken) {
    // No es error: el destinatario simplemente no tiene push activo.
    return res.status(200).json({ ok: true, sent: false, reason: "sin token" });
  }
  try {
    const data = await sendFCM(destToken, title, body);
    return res.status(200).json({ ok: true, sent: true, ...data });
  } catch (err) {
    console.error("send-push:", err);
    const status = err?.data ? 502 : 500;
    return res.status(status).json({ error: err?.message || "Error enviando push", ...(err?.data || {}) });
  }
}
