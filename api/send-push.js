import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import {
  requireUser,
  areRelated,
  fcmTokenByUserId,
  deviceTokensByUserId,
  deviceTokensByUserIds,
  jsonError,
} from "../lib/apiAuth.js";

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

/** Cliente con service_role para el log y la limpieza de tokens muertos. */
function adminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

/** Ultimos caracteres del token: identifican el dispositivo en el log sin guardar la credencial. */
function tokenTail(token) {
  return token ? String(token).slice(-8) : null;
}

/**
 * Deja constancia del intento, uno por DISPOSITIVO. Nunca puede tumbar el
 * envio: si el log falla, el push ya salio (o ya fallo) y eso es lo que importa.
 */
async function logDelivery({
  fromUserId = null,
  toUserId,
  kind = null,
  title = null,
  status,
  reason = null,
  messageId = null,
  platform = null,
  token = null,
}) {
  if (!toUserId || !status) return;
  try {
    const supabase = adminClient();
    if (!supabase) return;
    const base = {
      from_user_id: fromUserId,
      to_user_id: toUserId,
      kind,
      title: title ? String(title).slice(0, 120) : null,
      status,
      reason: reason ? String(reason).slice(0, 300) : null,
      fcm_message_id: messageId,
    };
    const { error } = await supabase
      .from("push_deliveries")
      .insert({ ...base, platform, token_tail: tokenTail(token) });
    if (!error) return;
    // Con la 0061 sin aplicar, platform y token_tail no existen aun. Quedarse
    // sin saber el dispositivo es mucho menos grave que perder el registro.
    const retry = await supabase.from("push_deliveries").insert(base);
    if (retry.error) console.warn("[push-log] no se pudo registrar el envio:", retry.error.message);
  } catch (e) {
    console.warn("[push-log] no se pudo registrar el envio:", e.message);
  }
}

/** Codigo de error de FCM v1: viene en error.details[].errorCode. */
function fcmErrorCode(err) {
  const error = err?.data?.error;
  if (!error) return null;
  const detail = (error.details || []).find((d) => d.errorCode);
  return detail?.errorCode || error.status || null;
}

/**
 * Un token que FCM ya no reconoce no vuelve a funcionar nunca. Si se deja, TODOS
 * los envios futuros a ese dispositivo fallan igual y el usuario sigue
 * pareciendo notificable.
 *
 * Se retira la FILA del dispositivo, no la cuenta entera: quien tenga movil y
 * navegador conserva el que si funciona. Se limpia tambien profiles.fcm_token
 * porque es la reserva del envio, y dejarlo ahi haria que un token muerto
 * volviera a intentarse por la puerta de atras.
 */
async function forgetDeadToken(token, code) {
  if (!token || !["UNREGISTERED", "NOT_FOUND"].includes(String(code))) return false;
  const supabase = adminClient();
  if (!supabase) return false;
  let removed = false;
  try {
    const { data, error } = await supabase
      .from("device_tokens")
      .delete()
      .eq("token", token)
      .select("id,platform");
    if (error) console.warn("[push] no se pudo borrar el dispositivo muerto:", error.message);
    else if (data?.length) {
      removed = true;
      console.log(`[push] dispositivo muerto (${code}) retirado: ${data.map((d) => d.platform).join(", ")}`);
    }
  } catch (e) {
    console.warn("[push] no se pudo borrar el dispositivo muerto:", e.message);
  }
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ fcm_token: null })
      .eq("fcm_token", token)
      .select("user_id");
    if (error) console.warn("[push] no se pudo limpiar el token muerto del perfil:", error.message);
    else if (data?.length) {
      removed = true;
      console.log(`[push] token muerto (${code}) retirado de ${data.length} perfil(es)`);
    }
  } catch (e) {
    console.warn("[push] no se pudo limpiar el token muerto del perfil:", e.message);
  }
  return removed;
}

/**
 * A que dispositivos hay que mandar el aviso.
 *
 * device_tokens es la fuente de verdad. profiles.fcm_token solo entra en juego
 * cuando el usuario no tiene ninguna fila (todavia no ha vuelto a registrar) o
 * cuando la tabla no responde, para que el envio no se caiga por el orden en que
 * se despliegue el codigo y se aplique la migracion.
 */
async function pushTargets(userId) {
  const rows = await deviceTokensByUserId(userId);
  if (Array.isArray(rows) && rows.length) {
    return rows.map((r) => ({ token: r.token, platform: r.platform || null }));
  }
  const legacy = await fcmTokenByUserId(userId);
  return legacy ? [{ token: legacy, platform: null }] : [];
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

/**
 * Manda el mismo aviso a todos los dispositivos del destinatario y devuelve el
 * recuento. Un dispositivo caido no impide que suene el otro: cada token se
 * intenta, se audita y, si esta muerto, se retira por separado.
 */
async function sendToAllDevices({ targets, toUserId, fromUserId = null, kind, title, body, pushData }) {
  let delivered = 0;
  let dead = 0;
  let lastError = null;
  let lastCode = null;

  for (const target of targets) {
    try {
      const result = await sendFCM(target.token, title, body, pushData);
      delivered += 1;
      await logDelivery({
        fromUserId,
        toUserId,
        kind,
        title,
        status: "sent",
        messageId: result?.name || null,
        platform: target.platform,
        token: target.token,
      });
    } catch (err) {
      const code = fcmErrorCode(err);
      lastError = err;
      lastCode = code;
      if (await forgetDeadToken(target.token, code)) dead += 1;
      await logDelivery({
        fromUserId,
        toUserId,
        kind,
        title,
        status: err?.data ? "rejected" : "error",
        reason: [code, err?.data?.error?.message || err?.message].filter(Boolean).join(" · "),
        platform: target.platform,
        token: target.token,
      });
      console.warn(`[push] ✗ ${toUserId} (${target.platform || "sin plataforma"}):`, err.message);
    }
  }

  return { delivered, dead, lastError, lastCode, devices: targets.length };
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

  // Los dispositivos de toda la tanda en UNA consulta, con profiles de reserva
  // para quien aun no tenga fila en device_tokens.
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

  // El cliente solo declara A QUIEN notifica. Los tokens NUNCA salen de la
  // base: los resolvemos aqui con service_role tras validar la relacion
  // coach<->atleta.
  if (!(await areRelated(user.id, to_user_id))) {
    return jsonError(res, 403, "Sin relación con el destinatario");
  }
  const kind = pushData && pushData.type ? String(pushData.type) : null;
  const targets = await pushTargets(to_user_id);
  if (!targets.length) {
    // No es error de envio, pero el remitente necesita saberlo: su mensaje
    // llego a la app y el destinatario no se va a enterar por notificacion.
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

  // Basta con que suene en un dispositivo para que el aviso haya llegado.
  if (outcome.delivered > 0) {
    return res.status(200).json({
      ok: true,
      sent: true,
      devices: outcome.devices,
      delivered: outcome.delivered,
    });
  }
  if (outcome.dead >= outcome.devices) {
    // Ningun dispositivo valido: para el remitente equivale a no tener push.
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
