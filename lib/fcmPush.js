/**
 * lib/fcmPush.js
 * Envío FCM + log en push_deliveries. Compartido por api/send-push.js y
 * notificaciones server-side (webhook intervals.icu, etc.).
 */
import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import { fcmTokenByUserId, deviceTokensByUserId, deviceTokensByUserIds } from "./apiAuth.js";

const FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects/runningapexflow/messages:send";
const APP_URL = process.env.APP_URL || "https://www.runningapexflow.com";

export const ANDROID_CHANNEL_ID = "fcm_default_channel";
export const ANDROID_CHAT_CHANNEL_ID = "chat_messages";

/** Kind / data.type para aviso al coach de workout completado. */
export const COACH_WORKOUT_COMPLETED_TYPE = "coach_workout_completed";
export const COACH_WORKOUT_COMPLETED_KIND = "workout_completed";

export function androidChannelId(data) {
  const type = data && data.type ? String(data.type) : "";
  return type.includes("chat") ? ANDROID_CHAT_CHANNEL_ID : ANDROID_CHANNEL_ID;
}

export function buildDeepLink(data) {
  if (!data || !data.type) return `${APP_URL}/`;
  const p = new URLSearchParams();
  p.set("open", String(data.type));
  if (data.athlete_id) p.set("athlete_id", String(data.athlete_id));
  if (data.workout_id) p.set("workout_id", String(data.workout_id));
  return `${APP_URL}/?${p.toString()}`;
}

export function adminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

function tokenTail(token) {
  return token ? String(token).slice(-8) : null;
}

export async function logDelivery({
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
    const retry = await supabase.from("push_deliveries").insert(base);
    if (retry.error) console.warn("[push-log] no se pudo registrar el envio:", retry.error.message);
  } catch (e) {
    console.warn("[push-log] no se pudo registrar el envio:", e.message);
  }
}

export function fcmErrorCode(err) {
  const error = err?.data?.error;
  if (!error) return null;
  const detail = (error.details || []).find((d) => d.errorCode);
  return detail?.errorCode || error.status || null;
}

export async function forgetDeadToken(token, code) {
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

export async function pushTargets(userId) {
  const rows = await deviceTokensByUserId(userId);
  if (Array.isArray(rows) && rows.length) {
    return rows.map((r) => ({ token: r.token, platform: r.platform || null }));
  }
  const legacy = await fcmTokenByUserId(userId);
  return legacy ? [{ token: legacy, platform: null }] : [];
}

export async function sendFCM(token, title, body, data) {
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

  const link = buildDeepLink(data);
  const message = {
    token,
    notification: { title: title ?? "RunningApexFlow", body: body ?? "" },
  };
  if (data && typeof data === "object") {
    message.data = Object.fromEntries(
      Object.entries(data)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    );
  }
  // Sin android.notification.tag: el mismo tag reemplaza la anterior en
  // la bandeja. En chat cada mensaje debe aparecer aparte.
  message.android = {
    priority: "high",
    notification: {
      channel_id: androidChannelId(data),
      default_sound: true,
    },
  };
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

export async function sendToAllDevices({ targets, toUserId, fromUserId = null, kind, title, body, pushData }) {
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

export { deviceTokensByUserIds };
