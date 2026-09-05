import { initializeApp } from "firebase/app";
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from "firebase/messaging";
import { readyServiceWorker } from "./readyServiceWorker.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1HwMxCRP-dmmyA89EJ3z22HXXaAVm6jo",
  authDomain: "runningapexflow.firebaseapp.com",
  projectId: "runningapexflow",
  storageBucket: "runningapexflow.firebasestorage.app",
  messagingSenderId: "224127738625",
  appId: "1:224127738625:web:c91f1634b923e3318bf100",
};

const app = initializeApp(firebaseConfig);

/** null hasta que el navegador confirme soporte FCM (llama a {@link initMessaging}). */
export let messaging = null;

/**
 * Inicializa Messaging de forma segura (HTTPS, ventana, soporte del navegador).
 * Debe llamarse una vez en el cliente antes de getToken / onMessage.
 */
export async function initMessaging() {
  if (typeof window === "undefined") return null;
  if (messaging) return messaging;
  if (!(await isSupported())) return null;
  messaging = getMessaging(app);
  return messaging;
}

const VAPID_KEY = "BNqJM5D8RqCSeSXTcnU3dkye1fjPvAYcb7P4R1erlQpscPuU4VFmeJ0LSJL0jTh-POI7byyPPxDevIaWFt23DLM";

export const requestNotificationPermission = async () => {
  const m = await initMessaging();
  if (!m) return null;
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    const reg = await readyServiceWorker();
    if (!reg) return null;
    const token = await getToken(m, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    return token;
  }
  return null;
};

/** Sin modal: obtiene token si el permiso ya está concedido (p. ej. al recargar). */
export async function refreshFcmTokenIfGranted() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return null;
  if (Notification.permission !== "granted") return null;
  const m = await initMessaging();
  if (!m) return null;
  const reg = await readyServiceWorker();
  if (!reg) return null;
  return getToken(m, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg,
  });
}

/**
 * Borra el token FCM de este navegador en Firebase. Se usa al cerrar sesion
 * para que el proximo usuario que entre en el mismo navegador obtenga un token
 * NUEVO y no herede el del anterior. Nunca debe romper el logout: si falla,
 * se ignora.
 */
export async function clearFcmToken() {
  try {
    const m = await initMessaging();
    if (!m) return false;
    return await deleteToken(m);
  } catch (e) {
    console.warn("clearFcmToken", e);
    return false;
  }
}

/** Mensajes en primer plano: `const m = await initMessaging(); if (m) onMessage(m, (payload) => { ... });` */
export { onMessage };
