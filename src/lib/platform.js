import { Capacitor } from "@capacitor/core";

/**
 * True solo dentro del shell de Capacitor en iOS.
 * En web, Android, SSR y tests sin el bridge devuelve false y no lanza.
 */
export function isIosApp() {
  try {
    if (typeof Capacitor?.getPlatform !== "function") return false;
    return Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

export const IOS_FEATURE_UNAVAILABLE =
  "Esta función no está disponible en tu cuenta. Escríbenos a soporte@runningapexflow.com.";

export const IOS_ACCOUNT_NO_ACCESS =
  "Tu cuenta no tiene acceso activo. Escríbenos a soporte@runningapexflow.com";

/**
 * Atleta independiente sin plan, o con la suscripción solo ya vencida.
 * Si el coach_id es de otra persona, el acceso va con el coach y no se bloquea.
 */
export function soloAthleteIosLocked({ userId, coachId, athletePlan, expiresAt, now = Date.now() } = {}) {
  const cid = coachId == null ? "" : String(coachId).trim();
  const uid = userId == null ? "" : String(userId).trim();
  if (cid && cid !== uid) return false;
  const plan = String(athletePlan ?? "").trim().toLowerCase();
  if (plan !== "premium") return true;
  if (expiresAt == null || String(expiresAt).trim() === "") return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= now;
}

/** Viewport del shell iOS. index.html no se toca; se asigna al arrancar. */
export const IOS_VIEWPORT_CONTENT = "width=device-width, initial-scale=1.0, viewport-fit=cover";

/**
 * Añade la clase ios-app y el viewport-fit solo si isIosApp().
 * En web y Android no modifica el documento.
 */
export function applyIosDocumentShell(doc) {
  const target = doc ?? (typeof document !== "undefined" ? document : null);
  if (!target?.documentElement?.classList) return false;
  if (!isIosApp()) return false;
  target.documentElement.classList.add("ios-app");
  const meta = target.querySelector?.('meta[name="viewport"]');
  if (meta) meta.setAttribute("content", IOS_VIEWPORT_CONTENT);
  return true;
}
