/**
 * Tipos de push de chat y filtro de la bandeja nativa.
 *
 * Al tocar UNA notificacion de chat hay que quitar las demas de chat, no
 * cancelAll: los avisos de entreno/racha tienen que seguir en la bandeja.
 * El filtro vive aqui para poder testearlo sin el plugin de Capacitor.
 */
export const CHAT_PUSH_TYPES = ["athlete_chat", "coach_chat"];

export function isChatPushType(type) {
  return CHAT_PUSH_TYPES.includes(String(type || ""));
}

export function notificationPushType(notification) {
  if (!notification || typeof notification !== "object") return "";
  const data = notification.data;
  const fromData = data && typeof data === "object" ? data.type : undefined;
  return String(fromData || notification.type || "");
}

export function filterDeliveredChatNotifications(notifications) {
  return (Array.isArray(notifications) ? notifications : []).filter((n) =>
    isChatPushType(notificationPushType(n)),
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
