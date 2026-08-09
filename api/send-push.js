import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import { requireUser, areRelated, fcmTokenByUserId, jsonError } from "../lib/apiAuth.js";

const FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects/runningapexflow/messages:send";

const APP_URL = process.env.APP_URL || "https://www.runningapexflow.com";

// Canal de notificaciones de Android. La app NO declara ninguno todavia (ni por
// manifest ni con PushNotifications.createChannel), asi que hasta que lo haga
// el SDK de Firebase cae en su canal de reserva. Mandarlo igual no rompe nada y
// deja el envio listo para cuando el canal exista, sin tocar el APK.
const ANDROID_CHANNEL_ID = "fcm_default_channel";

// Traduce el `data` de la notificacion a una URL de la app. El SW/navegador
// abre esta URL al tocar la notificacion (via webpush.fcm_options.link).
function buildDeepLink(data) {
  if (!data || !data.type) return `${APP_URL}/`;
  const p = new URLSearchParams();
  p.set("open", String(data.type));
  if (data.athlete_id) p.set("athlete_id", String(data.athlete_id));
  if (data.workout_id) p.set("workout_id", String(data.workout_id));
  return `${APP_URL}/?${p.toString()}`;
}

// Agrupa en Android las notificaciones de la misma conversacion: con el mismo
// tag, el mensaje nuevo REEMPLAZA al anterior en vez de apilar diez avisos del
// mismo chat, que es justo el comportamiento de cualquier app de mensajeria.
//
// Solo se etiquetan los chats. Los avisos de eventos (workout completado, no
// llego al 100%, solicitud de entrenador) comparten type y athlete_id, asi que
// un tag comun haria que el ultimo tapara a los anteriores y el coach perderia
// avisos distintos. Esos se apilan a proposito.
function androidNotificationTag(data) {
  const type = data && data.type ? String(data.type) : "";
  if (!type.includes("chat")) return null;
  const scope = data.athlete_id ?? data.workout_id;
  return scope != null ? `${type}-${scope}` : type;
}

async function sendFCM(token, title, body, data) {
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

  // FCM respeta webpush.fcm_options.link de forma nativa: al tocar la
  // notificacion abre esa URL sin depender de onBackgroundMessage, que
  // no se dispara de forma fiable cuando el mensaje trae bloque `notification`.
  const link = buildDeepLink(data);

  const message = {
    token,
    notification: { title: title ?? "RunningApexFlow", body: body ?? "" },
  };
  // FCM exige que todos los valores de `data` sean strings.
  if (data && typeof data === "object") {
    message.data = Object.fromEntries(
      Object.entries(data)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)])
    );
  }
  // Android nativo (APK) ignora el bloque webpush. priority "high" evita que
  // Doze retrase la entrega, y el deep link viaja en `data`, que es de donde lo
  // lee pushNotificationActionPerformed en el cliente Capacitor.
  message.android = {
    priority: "high",
    notification: {
      channel_id: ANDROID_CHANNEL_ID,
      default_sound: true,
    },
  };
  const tag = androidNotificationTag(data);
  if (tag) message.android.notification.tag = tag;
  if (link) {
    message.webpush = {
      notification: { icon: "/pwa-192.png", badge: "/pwa-192.png" },
      fcm_options: { link },
    };
  }

  const response = await fetch(FCM_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("FCM error"), { data: result });
  return result;
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

  const { to_user_id, title, body, data: pushData } = req.body || {};
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
    const result = await sendFCM(destToken, title, body, pushData);
    return res.status(200).json({ ok: true, sent: true, ...result });
  } catch (err) {
    console.error("send-push:", err);
    const status = err?.data ? 502 : 500;
    return res.status(status).json({ error: err?.message || "Error enviando push", ...(err?.data || {}) });
  }
}
