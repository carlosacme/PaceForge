/**
 * Push / FCM del cliente (registro de token, chat push, aviso de workout).
 *
 * Antes vivia en components/shared/appShared.js y src/lib/nativePush.js
 * lo importaba de alli (lib -> components). Este modulo endereza esa capa.
 * No es lib/fcmPush.js (envio server-side).
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

const pushBodySnippet = (text, max = 400) => {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
};

/**
 * Registra el token de push de este dispositivo en el backend (service_role).
 * El endpoint lo retira de cualquier otro dueño antes de asignarlo al usuario
 * actual, evitando que varios usuarios del mismo navegador compartan token.
 */
export async function registerFcmToken(token) {
  const r = await registerFcmTokenDetailed(token);
  if (!r.ok) console.warn("[fcm] no se registro el token:", r.reason);
  return r.ok;
}

/** Que dispositivo es este, para distinguir las filas de device_tokens. */
export function currentPushPlatform() {
  try {
    if (Capacitor?.isNativePlatform?.()) {
      const platform = String(Capacitor.getPlatform?.() || "").toLowerCase();
      if (platform === "android" || platform === "ios") return platform;
    }
  } catch {
    /* fuera de Capacitor: es un navegador */
  }
  return "web";
}

// El token de ESTE dispositivo, para poder retirar su fila al cerrar sesion sin
// tocar los demas dispositivos del usuario. En web se podria volver a pedir a
// Firebase, pero en nativo el plugin solo lo entrega en el evento de registro.
const PUSH_TOKEN_STORAGE_KEY = "raf_push_token";

const rememberPushToken = (token) => {
  try {
    if (token) localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  } catch {
    /* almacenamiento no disponible */
  }
};

/**
 * Tokens de push del usuario, uno por dispositivo. La RLS de device_tokens deja
 * a cada uno leer los suyos, asi que sirve para comprobar de verdad si el token
 * quedo guardado en vez de fiarse del 200 del endpoint.
 */
export async function readOwnDeviceTokens() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return { ok: false, reason: "sin usuario autenticado" };
    const { data, error } = await supabase
      .from("device_tokens")
      .select("token, platform, last_seen_at")
      .eq("user_id", user.id);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, tokens: data || [] };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Retira el token de ESTE dispositivo al cerrar sesion, para que el siguiente
 * usuario del mismo navegador no herede las notificaciones del anterior.
 *
 * Borra solo la fila de este token, nunca todas las del usuario: quien cierra
 * sesion en el portatil debe seguir recibiendo en el movil. La RLS ya limita el
 * borrado a las filas propias.
 */
export async function unregisterOwnDeviceToken() {
  if (typeof window === "undefined") return false;
  let token = null;
  try {
    token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
  if (!token) return false;
  try {
    const { error } = await supabase.from("device_tokens").delete().eq("token", token);
    if (error) console.warn("[fcm] no se pudo retirar este dispositivo:", error.message);
  } catch (e) {
    console.warn("[fcm] no se pudo retirar este dispositivo:", String(e?.message || e));
  }
  try {
    localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
  return true;
}

/**
 * Lee el fcm_token que tiene AHORA el perfil del usuario. La RLS de profiles
 * deja a cada uno leer su propia fila, asi que sirve para comprobar de verdad
 * si el token quedo guardado en vez de fiarse del 200 del endpoint.
 */
export async function readOwnFcmToken() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return { ok: false, reason: "sin usuario autenticado" };
    const { data, error } = await supabase
      .from("profiles")
      .select("fcm_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!data) return { ok: false, reason: "el usuario no tiene fila en profiles" };
    return { ok: true, token: data.fcm_token ?? null };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Igual que registerFcmToken pero contando QUE fallo. Cada eslabon de la
 * cadena (sesion, red, respuesta del endpoint, fila realmente escrita) devuelve
 * su propio motivo, para poder enseñarlo en pantalla: dentro de la APK no hay
 * consola donde leer un console.warn.
 *
 * @returns {Promise<{ok: boolean, reason?: string, status?: number, verified?: boolean}>}
 */
export async function registerFcmTokenDetailed(token) {
  if (!token) return { ok: false, reason: "el plugin no entrego ningun token" };
  if (typeof window === "undefined") return { ok: false, reason: "sin window" };

  let session = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch (e) {
    return { ok: false, reason: `no se pudo leer la sesion: ${String(e?.message || e)}` };
  }
  if (!session?.access_token) return { ok: false, reason: "todavia no hay sesion iniciada" };

  let res;
  try {
    res = await fetch("/api/register-fcm-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ token, platform: currentPushPlatform() }),
    });
  } catch (e) {
    return { ok: false, reason: `la peticion no salio: ${String(e?.message || e)}` };
  }
  if (!res.ok) {
    let body = "";
    try { body = pushBodySnippet(await res.text(), 140); } catch { /* respuesta sin cuerpo */ }
    return { ok: false, status: res.status, reason: `el endpoint respondio ${res.status}${body ? `: ${body}` : ""}` };
  }

  // Releer la fila convierte en error visible el falso exito de un endpoint que
  // responde 200 sin haber escrito nada. Se comprueba device_tokens, que es la
  // fuente de verdad del envio; profiles solo se consulta si esa tabla no
  // responde (migracion 0061 todavia sin aplicar).
  const devices = await readOwnDeviceTokens();
  if (devices.ok) {
    if (devices.tokens.some((t) => t.token === token)) {
      rememberPushToken(token);
      return { ok: true, status: 200, verified: true };
    }
    return { ok: false, status: 200, verified: false, reason: "el endpoint respondio OK pero device_tokens sigue sin el token" };
  }

  const saved = await readOwnFcmToken();
  if (!saved.ok) {
    rememberPushToken(token);
    return { ok: true, status: 200, verified: false, reason: `guardado sin verificar: ${saved.reason}` };
  }
  if (saved.token !== token) {
    return { ok: false, status: 200, verified: false, reason: "el endpoint respondio OK pero el perfil sigue sin el token" };
  }
  rememberPushToken(token);
  return { ok: true, status: 200, verified: true };
}

/**
 * Manda una push al otro lado de la conversacion.
 *
 * Devuelve el resultado en vez de tragarselo: un 200 con sent=false (el
 * destinatario no tiene push activo, o su token ya caduco) no es un error de
 * red, pero quien escribe merece saber que su mensaje no va a sonar en el otro
 * telefono. El envio nunca debe romper el flujo que lo llama.
 *
 * @returns {Promise<{sent: boolean, reason?: string, error?: string}>}
 */
export async function sendChatPushNotification({ toUserId, title, body, data = null, logLabel = "chat push" }) {
  if (!toUserId || typeof window === "undefined") return { sent: false, reason: "sin destinatario" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { sent: false, reason: "sin sesion" };
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        to_user_id: toUserId,
        title,
        body: pushBodySnippet(body),
        data: data && typeof data === "object" ? data : undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[${logLabel}] /api/send-push respuesta no OK`, text);
      return { sent: false, error: `HTTP ${res.status}`, reason: pushBodySnippet(text, 160) };
    }
    const json = await res.json().catch(() => ({}));
    if (json.sent === false) console.warn(`[${logLabel}] no se envio: ${json.reason || "sin motivo"}`);
    return { sent: json.sent !== false, reason: json.reason };
  } catch (e) {
    console.warn(`[${logLabel}] /api/send-push error`, e);
    return { sent: false, error: String(e?.message || e) };
  }
}

/** Deep-link / data.type al avisar al coach que el atleta terminó un entreno. */
export const COACH_WORKOUT_COMPLETED_TYPE = "coach_workout_completed";

/**
 * Notifica al coach (best effort) tras marcar un workout done.
 * Claim atómico en coach_completion_notified_at para no duplicar con el webhook.
 */
export async function notifyCoachWorkoutCompletedFromClient({ workout, athlete }) {
  if (!workout?.id || !athlete?.coach_id || typeof window === "undefined") {
    return { sent: false, reason: "sin datos" };
  }
  try {
    const claimedAt = new Date().toISOString();
    // Sin maybeSingle/single: 0 filas (ya notificado) es 200 + [] , no 406.
    const { data: claimedRows, error: claimErr } = await supabase
      .from("workouts")
      .update({ coach_completion_notified_at: claimedAt })
      .eq("id", workout.id)
      .is("coach_completion_notified_at", null)
      .eq("done", true)
      .select("id");
    if (claimErr) {
      // Columna aún no migrada u otro error: no tumbar el flujo del atleta.
      console.warn("[workout-completed client] claim:", claimErr.message);
      return { sent: false, reason: claimErr.message };
    }
    const claimed = Array.isArray(claimedRows) ? claimedRows[0] : null;
    if (!claimed) return { sent: false, skipped: "ya notificado" };

    const titleName = (athlete.name && String(athlete.name).trim()) || "Atleta";
    const wTitle = (workout.title && String(workout.title).trim()) || workout.type || "Entreno";
    const distRaw = workout.actual_distance_km ?? workout.manual_distance_km ?? workout.total_km;
    const dist = Number(distRaw);
    const body =
      Number.isFinite(dist) && dist > 0
        ? `${wTitle} · ${Math.round(dist * 10) / 10} km`
        : String(wTitle);

    return sendChatPushNotification({
      toUserId: athlete.coach_id,
      title: `✅ ${titleName} completó un entreno`,
      body,
      data: {
        type: COACH_WORKOUT_COMPLETED_TYPE,
        athlete_id: athlete.id,
        workout_id: workout.id,
      },
      logLabel: "workout completed athlete→coach",
    });
  } catch (e) {
    console.warn("[workout-completed client]", e);
    return { sent: false, error: String(e?.message || e) };
  }
}

/** Motivos por los que el destinatario no tiene notificaciones funcionando. */
export const PUSH_INACTIVE_REASONS = new Set(["sin token", "token caducado"]);
