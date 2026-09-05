/**
 * Tag Android de chat: unico por mensaje, prefijo estable para limpiar la bandeja.
 *
 * FCM, si no mandas tag, pone uno auto `FCM-Notification:<n>` (eso vimos en
 * debug_log). Con tag explicito, Capacitor `notification.tag` es el string
 * que enviamos. Un tag FIJO (el de antes) sustituye la anterior en la bandeja;
 * por eso el sufijo es siempre distinto.
 */
export const CHAT_TRAY_TAG_PREFIX = "chat:";

export function isChatPushType(type) {
  const t = String(type || "");
  return t === "athlete_chat" || t === "coach_chat";
}

export function isChatTrayTag(tag) {
  return String(tag || "").startsWith(CHAT_TRAY_TAG_PREFIX);
}

export function androidChatNotificationTag(data, now = Date.now, random = Math.random) {
  if (!isChatPushType(data?.type)) return null;
  const party = data.athlete_id || data.coach_id || "x";
  const uniq = data.message_id || `${now().toString(36)}-${random().toString(36).slice(2, 8)}`;
  return `${CHAT_TRAY_TAG_PREFIX}${party}:${uniq}`;
}
