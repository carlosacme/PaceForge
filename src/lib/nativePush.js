import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerFcmToken } from "../components/shared/appShared";

/**
 * Push nativo para la APK.
 *
 * El push web (src/lib/firebaseMessaging.js) usa la Notification API y un
 * service worker, y ninguno de los dos existe dentro del WebView de Android:
 * por eso los usuarios de la APK nunca llegaban a registrar fcm_token. Este
 * modulo hace lo mismo con @capacitor/push-notifications y entrega el token a
 * la MISMA registerFcmToken(), asi que el backend y la tabla no cambian.
 */

/** Los listeners se registran una sola vez por sesion de app. */
let listenersReady = false;

/** Toast in-app para mensajes en primer plano; lo inyecta quien llama. */
let notifyHandler = null;

/** Conecta el toast de la app (el mismo notify que usa onMessage en web). */
export function setNativePushNotifier(fn) {
  notifyHandler = typeof fn === "function" ? fn : null;
}

export const isNativePush = () => Capacitor.isNativePlatform();

const ensureListeners = async () => {
  if (listenersReady) return;
  listenersReady = true;

  await PushNotifications.addListener("registration", async (token) => {
    const value = token?.value;
    if (!value) return;
    // Misma tuberia que el web: el endpoint corre con service_role y limpia el
    // token de otros perfiles antes de asignarlo al usuario actual.
    const ok = await registerFcmToken(value);
    if (!ok) console.warn("[push-nativo] no se pudo registrar el token en el backend");
  });

  await PushNotifications.addListener("registrationError", (err) => {
    console.warn("[push-nativo] error de registro:", err?.error || err);
  });

  // App en primer plano: Android no pinta la notificacion, la entrega aqui.
  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    const title = notification?.title || notification?.data?.title;
    const body = notification?.body || notification?.data?.body;
    const text = [title, body].filter(Boolean).join(" · ");
    if (notifyHandler) notifyHandler(text || "Nueva notificación");
  });

  // El usuario toco la notificacion. De momento solo se registra: navegar al
  // chat o al calendario segun data.type queda para el siguiente paso.
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    console.log("[push-nativo] notificacion abierta", action?.notification?.data);
  });
};

/**
 * Estado del permiso en nativo: "granted" | "denied" | "prompt" |
 * "prompt-with-rationale". Devuelve null fuera de la APK o si falla.
 */
export async function nativePushPermissionState() {
  if (!isNativePush()) return null;
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return receive || null;
  } catch (e) {
    console.warn("[push-nativo] checkPermissions", e);
    return null;
  }
}

/**
 * Pide permiso si hace falta, registra el dispositivo en FCM y deja los
 * listeners puestos. El token llega por el listener "registration", no por el
 * valor de retorno: register() solo dispara el proceso.
 *
 * @param {{ notify?: (msg: string) => void }} options
 * @returns {Promise<boolean>} true si el dispositivo quedo registrado.
 */
export async function registerNativePush({ notify } = {}) {
  if (!isNativePush()) return false;
  if (notify) setNativePushNotifier(notify);
  try {
    let status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") {
      console.warn("[push-nativo] permiso no concedido:", status.receive);
      return false;
    }
    await ensureListeners();
    await PushNotifications.register();
    return true;
  } catch (e) {
    console.warn("[push-nativo] registerNativePush", e);
    return false;
  }
}

/**
 * Limpieza al cerrar sesion: quita los listeners para que el proximo usuario
 * del mismo dispositivo no herede los del anterior. El fcm_token del perfil se
 * pone a null fuera de aqui, igual que en web. Nunca debe romper el logout.
 */
export async function clearNativePush() {
  if (!isNativePush()) return;
  try {
    await PushNotifications.removeAllListeners();
    listenersReady = false;
    notifyHandler = null;
  } catch (e) {
    console.warn("[push-nativo] clearNativePush", e);
  }
}
