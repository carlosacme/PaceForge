/**
 * Tipos de push de chat y filtro de la bandeja nativa.
 *
 * Al tocar UNA notificacion de chat hay que quitar las demas de chat, no
 * cancelAll: los avisos de entreno/racha tienen que seguir en la bandeja.
 * data.type NO llega en getDeliveredNotifications (confirmado en debug_log);
 * el tag `chat:…` si: FCM lo deja en notification.tag.
 */
export { CHAT_TRAY_TAG_PREFIX, isChatPushType, isChatTrayTag } from "../../lib/chatNotificationTag.js";
import { isChatTrayTag } from "../../lib/chatNotificationTag.js";

export function notificationPushType(notification) {
  if (!notification || typeof notification !== "object") return "";
  const data = notification.data;
  const fromData = data && typeof data === "object" ? data.type : undefined;
  return String(fromData || notification.type || "");
}

export function filterDeliveredChatNotifications(notifications) {
  return (Array.isArray(notifications) ? notifications : []).filter((n) =>
    isChatTrayTag(n?.tag),
  );
}

/** Resumen para logs: el tap trae data.type; la bandeja de FCM suele no. */
export function describeDeliveredNotifications(notifications) {
  const list = Array.isArray(notifications) ? notifications : [];
  return list.map((n, i) => {
    const data = n?.data && typeof n.data === "object" ? n.data : {};
    const keys = Object.keys(data);
    return {
      i,
      id: n?.id ?? null,
      tag: n?.tag ?? null,
      type: notificationPushType(n) || "",
      dataKeys: keys,
    };
  });
}
