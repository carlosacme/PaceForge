import { Capacitor } from "@capacitor/core";

/**
 * Registro de push justo despues del login.
 *
 * Vive aparte de App para que Firebase / nativePush no entren en el bundle
 * de entrada: AuthLanding lo pide con import() dinamico.
 */
export async function registerPushAfterLogin(notify) {
  try {
    if (Capacitor.isNativePlatform()) {
      const { registerNativePush } = await import("./nativePush");
      await registerNativePush({ notify });
      return;
    }
    const { requestNotificationPermission } = await import("../firebase.js");
    const { registerFcmToken } = await import("./fcmClient");
    const token = await requestNotificationPermission();
    if (!token) return;
    await registerFcmToken(token);
  } catch (e) {
    console.warn("registerPushAfterLogin", e);
  }
}
