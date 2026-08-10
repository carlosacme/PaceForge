import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerFcmTokenDetailed, readOwnFcmToken, readOwnDeviceTokens } from "../components/shared/appShared";

/**
 * Push nativo para la APK.
 *
 * El push web (src/lib/firebaseMessaging.js) usa la Notification API y un
 * service worker, y ninguno de los dos existe dentro del WebView de Android:
 * por eso los usuarios de la APK nunca llegaban a registrar fcm_token. Este
 * modulo hace lo mismo con @capacitor/push-notifications y entrega el token a
 * la MISMA tuberia de registro, asi que el backend y la tabla no cambian.
 *
 * Dentro de la APK no hay consola donde leer un console.warn, asi que cada paso
 * de la cadena (permiso -> token -> guardado -> verificado contra la BD) deja
 * rastro en un diagnostico que la app puede enseñar en pantalla.
 */

/** Los listeners se registran una sola vez por sesion de app. */
let listenersPromise = null;

/** Toast in-app para mensajes en primer plano; lo inyecta quien llama. */
let notifyHandler = null;

const DIAG_STORAGE_KEY = "raf_push_diag";

/** Ultimos 8 caracteres del token: suficiente para comparar, sin exponerlo. */
const tokenTail = (t) => (t ? `…${String(t).slice(-8)}` : null);

const emptyDiag = () => ({
  platform: null,
  permission: null,
  registerAt: null,
  tokenAt: null,
  tokenTail: null,
  savedAt: null,
  verified: null,
  lastError: null,
  updatedAt: null,
});

let diag = emptyDiag();
let diagLoaded = false;
const diagSubscribers = new Set();

const loadDiag = () => {
  if (diagLoaded) return diag;
  diagLoaded = true;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIAG_STORAGE_KEY) : null;
    if (raw) diag = { ...emptyDiag(), ...JSON.parse(raw) };
  } catch {
    diag = emptyDiag();
  }
  return diag;
};

const patchDiag = (patch) => {
  loadDiag();
  diag = { ...diag, ...patch, updatedAt: new Date().toISOString() };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(DIAG_STORAGE_KEY, JSON.stringify(diag));
  } catch {
    // Sin localStorage el diagnostico vive solo en memoria; no es critico.
  }
  for (const cb of diagSubscribers) {
    try { cb(diag); } catch { /* un suscriptor roto no puede tumbar el registro */ }
  }
  return diag;
};

/** Estado del ultimo intento de registro, para pintarlo en la app. */
export const readPushDiagnostics = () => ({ ...loadDiag() });

/** Avisa cuando cambia el diagnostico. Devuelve la funcion para desuscribirse. */
export const subscribePushDiagnostics = (cb) => {
  if (typeof cb !== "function") return () => {};
  diagSubscribers.add(cb);
  return () => diagSubscribers.delete(cb);
};

/** Texto plano del diagnostico, para que el tester pueda copiarlo y mandarlo. */
export const formatPushDiagnostics = () => {
  const d = loadDiag();
  const when = (iso) => (iso ? new Date(iso).toLocaleString("es-CO") : "nunca");
  return [
    `plataforma: ${d.platform || "?"}`,
    `permiso: ${d.permission || "?"}`,
    `register(): ${when(d.registerAt)}`,
    `token recibido: ${d.tokenAt ? `${when(d.tokenAt)} (${d.tokenTail})` : "nunca"}`,
    `guardado en el perfil: ${d.savedAt ? when(d.savedAt) : "no"}`,
    `verificado en la BD: ${d.verified === true ? "si" : d.verified === false ? "no" : "?"}`,
    `ultimo error: ${d.lastError || "ninguno"}`,
  ].join("\n");
};

const reportError = (reason) => {
  patchDiag({ lastError: reason });
  console.warn("[push-nativo]", reason);
  if (notifyHandler) notifyHandler(`Notificaciones: ${reason}`);
};

/** Conecta el toast de la app (el mismo notify que usa onMessage en web). */
export function setNativePushNotifier(fn) {
  notifyHandler = typeof fn === "function" ? fn : null;
}

export const isNativePush = () => Capacitor.isNativePlatform();

/**
 * Guarda el token que entrego el plugin. Si falla, reintenta: el evento
 * "registration" se consume una sola vez, y sin reintento un fallo pasajero
 * (arranque sin red, sesion aun sin restaurar) dejaba el perfil sin token hasta
 * el siguiente arranque de la app.
 */
const saveToken = async (value, { attempt = 1, maxAttempts = 3 } = {}) => {
  const res = await registerFcmTokenDetailed(value);
  if (res.ok) {
    patchDiag({ savedAt: new Date().toISOString(), verified: res.verified === true, lastError: res.reason || null });
    return true;
  }
  if (attempt >= maxAttempts) {
    reportError(`no se pudo guardar el token (${res.reason})`);
    return false;
  }
  await new Promise((r) => setTimeout(r, attempt * 3000));
  return saveToken(value, { attempt: attempt + 1, maxAttempts });
};

const attachListeners = async () => {
  await PushNotifications.addListener("registration", async (token) => {
    const value = token?.value;
    if (!value) {
      reportError("el evento registration llego sin token");
      return;
    }
    patchDiag({ tokenAt: new Date().toISOString(), tokenTail: tokenTail(value), lastError: null });
    await saveToken(value);
  });

  await PushNotifications.addListener("registrationError", (err) => {
    reportError(`Firebase rechazo el registro: ${err?.error || JSON.stringify(err)}`);
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
 * Deja los listeners puestos una sola vez. Se guarda la PROMESA, no una
 * bandera: con una bandera, una segunda llamada concurrente seguia adelante y
 * podia llamar a register() con los listeners aun a medio enganchar.
 */
const ensureListeners = () => {
  if (!listenersPromise) {
    listenersPromise = attachListeners().catch((e) => {
      listenersPromise = null;
      throw e;
    });
  }
  return listenersPromise;
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
 * valor de retorno: register() solo dispara el proceso y vuelve enseguida.
 *
 * @param {{ notify?: (msg: string) => void }} options
 * @returns {Promise<boolean>} true si el dispositivo quedo registrado.
 */
export async function registerNativePush({ notify } = {}) {
  if (!isNativePush()) return false;
  if (notify) setNativePushNotifier(notify);
  patchDiag({ platform: Capacitor.getPlatform() });
  try {
    // Los listeners van ANTES de pedir permiso: si el usuario concede desde los
    // ajustes de Android y la app reintenta, ya estan puestos.
    await ensureListeners();

    let status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") {
      status = await PushNotifications.requestPermissions();
    }
    patchDiag({ permission: status.receive || null });
    if (status.receive !== "granted") {
      reportError(`permiso no concedido (${status.receive})`);
      return false;
    }

    await PushNotifications.register();
    patchDiag({ registerAt: new Date().toISOString() });
    return true;
  } catch (e) {
    reportError(`register() fallo: ${String(e?.message || e)}`);
    return false;
  }
}

/**
 * Contrasta el diagnostico con la realidad: mira si la base tiene AHORA un token
 * guardado. Sirve para que el panel no dependa solo de lo que recuerda esta
 * sesion de la app.
 *
 * Se consulta device_tokens, que es a donde mira el envio, y de paso dice
 * CUANTOS dispositivos estan registrados: con navegador y APK deben salir dos.
 * profiles solo se usa de reserva si esa tabla no responde.
 */
export async function checkFcmTokenInProfile() {
  const devices = await readOwnDeviceTokens();
  if (devices.ok) {
    const hasToken = devices.tokens.length > 0;
    patchDiag({ verified: hasToken });
    return {
      ok: true,
      hasToken,
      tokenTail: tokenTail(devices.tokens[0]?.token),
      devices: devices.tokens.length,
    };
  }
  const res = await readOwnFcmToken();
  if (!res.ok) return { ok: false, reason: res.reason };
  const hasToken = Boolean(res.token);
  patchDiag({ verified: hasToken });
  return { ok: true, hasToken, tokenTail: tokenTail(res.token) };
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
    listenersPromise = null;
    notifyHandler = null;
    patchDiag({ ...emptyDiag(), platform: Capacitor.getPlatform() });
  } catch (e) {
    console.warn("[push-nativo] clearNativePush", e);
  }
}
