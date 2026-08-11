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
 * de la cadena (permiso -> token -> guardado -> verificado contra la BD) avisa
 * en pantalla y deja rastro en un diagnostico que la app puede enseñar.
 */

/** Los listeners se registran una sola vez por sesion de app. */
let listenersPromise = null;

/** Toast in-app para mensajes en primer plano; lo inyecta quien llama. */
let notifyHandler = null;

/**
 * Avisar tambien de los pasos que SALEN BIEN, no solo de los fallos.
 *
 * En false (lo normal) solo se avisa de lo que falla: un usuario corriente no
 * tiene por que ver cuatro toasts en cada arranque para enterarse de algo que
 * funciona. Ponerlo en true los reactiva, que es como se diagnostico en remoto
 * el registro del token cuando un tester no podia darnos una consola.
 */
const NOTIFY_EVERY_STEP = false;

/**
 * Canales de notificacion de Android.
 *
 * Sin canal declarado, el channel_id que manda el backend no apunta a nada y
 * Android mete todo en su canal de reserva: mismo sonido y misma prioridad para
 * un mensaje del coach que para un recordatorio de entreno.
 *
 * Estos ids tienen que coincidir EXACTAMENTE con los que pone
 * api/send-push.js en message.android.notification.channel_id. Viven duplicados
 * porque uno es cliente y el otro servidor: si cambias uno, cambia el otro.
 *
 * Un canal es INMUTABLE una vez creado. Android ignora cualquier cambio de
 * importancia, sonido o vibracion en los dispositivos que ya lo tengan, asi que
 * cambiar el comportamiento mas adelante obliga a estrenar id.
 */
const CHAT_CHANNEL_ID = "chat_messages";
const DEFAULT_CHANNEL_ID = "fcm_default_channel";

const CHANNELS = [
  {
    id: CHAT_CHANNEL_ID,
    name: "Mensajes de chat",
    description: "Mensajes de tu coach o de tus atletas.",
    importance: 4, // HIGH: suena y aparece como heads-up sobre lo que estes viendo.
    vibration: true,
    // `sound` se omite a proposito. El plugin solo llama a setSound() si le
    // pasas un nombre, y ese nombre tiene que existir en res/raw, carpeta que
    // este proyecto no tiene: un nombre inventado dejaria el canal MUDO para
    // siempre. Sin sound, el canal usa el sonido de notificacion del sistema.
  },
  {
    id: DEFAULT_CHANNEL_ID,
    name: "Entrenamientos y avisos",
    description: "Recordatorios de tus entrenos y avisos de la app.",
    importance: 3, // DEFAULT: suena sin interrumpir, que es como se comportan hoy.
    vibration: true,
  },
];

/** Los canales se crean una sola vez por sesion de app. */
let channelsPromise = null;

/**
 * Destino de la ultima notificacion que el usuario toco.
 *
 * El tap puede llegar con la app CERRADA: Android la arranca, el listener se
 * dispara y React todavia no ha montado nada, asi que navegar en ese momento no
 * lleva a ninguna parte. El destino espera aqui hasta que la vista pregunte.
 *
 * En la APK esto sustituye al deep link de la web: alli el destino viaja en la
 * URL, pero dentro del WebView la URL nunca cambia al tocar una notificacion.
 */
let pendingDeepLink = null;
const deepLinkSubscribers = new Set();

/**
 * Devuelve el destino pendiente y lo borra, para que no se reprocese.
 *
 * `prefix` acota por tipo ("coach_" | "athlete_"): la vista del coach no puede
 * tragarse un destino del atleta ni al reves, porque quien lo consume lo
 * descarta para siempre.
 */
export const consumePendingDeepLink = (prefix = "") => {
  if (!pendingDeepLink) return null;
  if (prefix && !String(pendingDeepLink.type || "").startsWith(prefix)) return null;
  const data = pendingDeepLink;
  pendingDeepLink = null;
  return data;
};

/**
 * Avisa de un tap con la app YA montada. Sin esto, tocar la notificacion con la
 * app en segundo plano no navegaria a ningun sitio: el efecto que recoge el
 * destino no se vuelve a ejecutar solo porque el usuario vuelva a la app.
 */
export const subscribeDeepLink = (cb) => {
  if (typeof cb !== "function") return () => {};
  deepLinkSubscribers.add(cb);
  return () => deepLinkSubscribers.delete(cb);
};

const DIAG_STORAGE_KEY = "raf_push_diag";

/** Ultimos 8 caracteres del token: suficiente para comparar, sin exponerlo. */
const tokenTail = (t) => (t ? `…${String(t).slice(-8)}` : null);

const emptyDiag = () => ({
  platform: null,
  channelsAt: null,
  permission: null,
  registerAt: null,
  tokenAt: null,
  tokenTail: null,
  savedAt: null,
  serverStatus: null,
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
    `canales creados: ${d.channelsAt ? when(d.channelsAt) : "no"}`,
    `permiso: ${d.permission || "?"}`,
    `register(): ${when(d.registerAt)}`,
    `token recibido: ${d.tokenAt ? `${when(d.tokenAt)} (${d.tokenTail})` : "nunca"}`,
    `respuesta del servidor: ${d.serverStatus || "?"}`,
    `guardado: ${d.savedAt ? when(d.savedAt) : "no"}`,
    `verificado en la BD: ${d.verified === true ? "si" : d.verified === false ? "no" : "?"}`,
    `ultimo error: ${d.lastError || "ninguno"}`,
  ].join("\n");
};

const notify = (msg) => {
  if (notifyHandler) notifyHandler(`Notificaciones: ${msg}`);
};

/** Paso que va bien. Solo se enseña si la build lleva los avisos completos. */
const reportStep = (msg) => {
  console.log("[push-nativo]", msg);
  if (NOTIFY_EVERY_STEP) notify(msg);
};

/** Paso que falla. Se enseña SIEMPRE: es lo que el tester tiene que reportar. */
const reportError = (reason) => {
  patchDiag({ lastError: reason });
  console.warn("[push-nativo]", reason);
  notify(reason);
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
  if (attempt === 1) reportStep("enviando token al servidor…");
  const res = await registerFcmTokenDetailed(value);
  const serverStatus = res.status ? String(res.status) : res.ok ? "OK" : "sin respuesta";
  if (res.ok) {
    patchDiag({
      savedAt: new Date().toISOString(),
      serverStatus,
      verified: res.verified === true,
      lastError: res.reason || null,
    });
    reportStep(
      res.verified === true
        ? `servidor OK (${serverStatus}), token guardado y verificado`
        : `servidor OK (${serverStatus}), guardado sin verificar${res.reason ? `: ${res.reason}` : ""}`
    );
    return true;
  }
  patchDiag({ serverStatus });
  if (attempt >= maxAttempts) {
    reportError(`el servidor no guardo el token (${res.reason})`);
    return false;
  }
  // Cada reintento se anuncia: si no, el tester pasa hasta nueve segundos sin
  // saber si la app sigue intentandolo o ya se rindio.
  reportError(`fallo al guardar (${res.reason}). Reintento ${attempt + 1} de ${maxAttempts}…`);
  await new Promise((r) => setTimeout(r, attempt * 3000));
  return saveToken(value, { attempt: attempt + 1, maxAttempts });
};

/**
 * Declara los canales una sola vez. Solo en Android: en iOS el plugin responde
 * "unavailable" y en web no hay plugin.
 *
 * Volver a crear un canal que ya existe no es un error para Android, asi que
 * llamarlo en cada arranque es inofensivo y cubre a quien actualiza la app.
 *
 * Nunca tumba el registro: si esto falla, las notificaciones siguen llegando
 * por el canal de reserva, que es exactamente lo que pasa hoy.
 */
const ensureChannels = () => {
  if (Capacitor.getPlatform() !== "android") return Promise.resolve();
  if (!channelsPromise) {
    channelsPromise = Promise.all(CHANNELS.map((channel) => PushNotifications.createChannel(channel)))
      .then(() => {
        patchDiag({ channelsAt: new Date().toISOString() });
        console.log("[push-nativo] canales declarados:", CHANNELS.map((c) => c.id).join(", "));
      })
      .catch((e) => {
        channelsPromise = null;
        reportError(`no se pudieron crear los canales: ${String(e?.message || e)}`);
      });
  }
  return channelsPromise;
};

const attachListeners = async () => {
  await PushNotifications.addListener("registration", async (token) => {
    const value = token?.value;
    if (!value) {
      reportError("el sistema respondio SIN token");
      return;
    }
    patchDiag({ tokenAt: new Date().toISOString(), tokenTail: tokenTail(value), lastError: null });
    reportStep(`token recibido del sistema (${tokenTail(value)})`);
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

  // El usuario toco la notificacion. El destino viaja en `data` (type,
  // athlete_id, workout_id) tal como lo mando send-push; se guarda y lo recoge
  // la vista, que es la unica que sabe navegar y puede no existir todavia.
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action?.notification?.data;
    console.log("[push-nativo] notificacion abierta", data);
    if (!data || !data.type) return;
    pendingDeepLink = { ...data };
    for (const cb of deepLinkSubscribers) {
      try { cb(pendingDeepLink); } catch { /* un suscriptor roto no puede tragarse el destino */ }
    }
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
export async function registerNativePush({ notify: notifyFn } = {}) {
  if (!isNativePush()) return false;
  if (notifyFn) setNativePushNotifier(notifyFn);
  patchDiag({ platform: Capacitor.getPlatform() });
  try {
    // Los canales, antes que nada: una notificacion que llegue con la app
    // cerrada se pinta con el canal que exista en ese momento, asi que tienen
    // que estar declarados desde el arranque anterior.
    await ensureChannels();

    // Los listeners van ANTES de pedir permiso: si el usuario concede desde los
    // ajustes de Android y la app reintenta, ya estan puestos.
    await ensureListeners();

    let status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") {
      status = await PushNotifications.requestPermissions();
    }
    patchDiag({ permission: status.receive || null });
    if (status.receive !== "granted") {
      reportError(`permiso denegado (${status.receive})`);
      return false;
    }
    reportStep("permiso concedido");

    await PushNotifications.register();
    patchDiag({ registerAt: new Date().toISOString() });
    // Si el tester no ve ningun aviso despues de este, el sistema nunca entrego
    // el token y el problema esta antes de la app.
    reportStep("registro pedido al sistema, esperando token…");
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
 * del mismo dispositivo no herede los del anterior. El token del dispositivo se
 * retira fuera de aqui, igual que en web. Nunca debe romper el logout.
 */
export async function clearNativePush() {
  if (!isNativePush()) return;
  try {
    await PushNotifications.removeAllListeners();
    listenersPromise = null;
    notifyHandler = null;
    // Un destino sin consumir no puede sobrevivir al logout: llevaria al
    // siguiente usuario del dispositivo al chat del anterior.
    pendingDeepLink = null;
    // Los canales sobreviven al logout (viven en los ajustes de Android, no en
    // la sesion), asi que su fecha no se borra: channelsPromise tampoco.
    patchDiag({ ...emptyDiag(), platform: Capacitor.getPlatform(), channelsAt: loadDiag().channelsAt });
  } catch (e) {
    console.warn("[push-nativo] clearNativePush", e);
  }
}
