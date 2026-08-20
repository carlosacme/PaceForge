import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

/**
 * App Links entrantes en la APK (enlaces de correo de autenticacion).
 *
 * Con server.url apuntando al sitio, la APK es un WebView del dominio: cuando
 * Android abre la app desde un enlace, el WebView carga la RAIZ, no la URL del
 * enlace. Sin este modulo el usuario aterrizaria en la portada y el token del
 * correo se quedaria sin canjear.
 *
 * Sigue el mismo patron que el deep link de push en nativePush.js (guardar el
 * destino pendiente + consumirlo + avisar a quien escuche), porque el problema
 * es el mismo: el destino llega cuando React puede no haber montado nada. Pero
 * vive aparte y con su propio tipo de dato: el push viaja como {type,
 * athlete_id, workout_id} y esto es una ruta, y disfrazar uno de otro solo
 * obligaria a adivinar despues cual de los dos era.
 */

/** Host del sitio en produccion, el unico que este modulo acepta enrutar. */
const SITE_HOST = "www.runningapexflow.com";

/** Rutas que el intent-filter del manifiesto entrega a la app. */
const AUTH_PATH_PREFIX = "/auth/";

/** URL de arranque ya atendida, para no repetirla en cada recarga del WebView. */
const HANDLED_LAUNCH_KEY = "raf_handled_app_link";

let pendingAppLink = null;
const subscribers = new Set();
let initPromise = null;

/**
 * Adaptador: de la URL del intent a un destino navegable.
 *
 * Solo pasan enlaces https de NUESTRO host bajo /auth/. El filtro no es
 * decorativo: cualquier app del telefono puede lanzar un intent a esta
 * actividad, y navegar el WebView a lo que venga seria un redirect abierto
 * dentro de la sesion del usuario.
 *
 * @returns {{path: string, search: string, hash: string, relative: string}|null}
 */
export function toAppLinkTarget(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const currentHost = typeof window !== "undefined" ? window.location.host : "";
  if (url.host !== SITE_HOST && url.host !== currentHost) return null;
  if (!url.pathname.startsWith(AUTH_PATH_PREFIX)) return null;
  return {
    path: url.pathname,
    search: url.search,
    hash: url.hash,
    relative: `${url.pathname}${url.search}${url.hash}`,
  };
}

/** Devuelve el destino pendiente y lo borra, para que no se reprocese. */
export const consumePendingAppLink = () => {
  if (!pendingAppLink) return null;
  const target = pendingAppLink;
  pendingAppLink = null;
  return target;
};

/**
 * Avisa de un enlace abierto con la app YA montada. Sin esto, tocar el enlace
 * con la app en segundo plano no navegaria: el efecto que recoge el destino no
 * se vuelve a ejecutar solo porque el usuario vuelva a la app.
 */
export const subscribeAppLink = (cb) => {
  if (typeof cb !== "function") return () => {};
  subscribers.add(cb);
  return () => subscribers.delete(cb);
};

const publish = (target) => {
  if (!target) return;
  pendingAppLink = target;
  for (const cb of subscribers) {
    try {
      cb(target);
    } catch {
      /* un suscriptor roto no puede tragarse el destino */
    }
  }
};

/**
 * Lleva el WebView al destino. Es una navegacion completa al mismo origen, asi
 * que la sesion de Supabase (localStorage) sigue intacta y la pantalla de la
 * ruta (/auth/confirm y las demas de /auth/) se encarga del resto.
 *
 * @returns {boolean} true si navego; false si ya estabamos en ese destino.
 */
export function applyAppLink(target) {
  if (!target || typeof window === "undefined") return false;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === target.relative) return false;
  console.log("[app-links] navegando a", target.path);
  window.location.assign(target.relative);
  return true;
}

/**
 * Deja el listener puesto y recoge la URL que arranco la app.
 *
 * Los dos caminos hacen falta: "appUrlOpen" cubre el enlace tocado con la app
 * viva, y getLaunchUrl el arranque en frio, donde el evento ya habia pasado
 * antes de que existiera este JavaScript.
 *
 * La URL de arranque se marca como atendida en sessionStorage porque
 * getLaunchUrl sigue devolviendola tras navegar: sin la marca, cada recarga
 * volveria a /auth/confirm con un token ya gastado.
 */
export function initNativeAppLinks() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      console.log("[app-links] appUrlOpen", url);
      publish(toAppLinkTarget(url));
    });

    try {
      const { url } = (await CapacitorApp.getLaunchUrl()) || {};
      if (!url) return;
      let handled = null;
      try {
        handled = sessionStorage.getItem(HANDLED_LAUNCH_KEY);
      } catch {
        /* sin sessionStorage se acepta el riesgo de reprocesar */
      }
      if (handled === url) return;
      try {
        sessionStorage.setItem(HANDLED_LAUNCH_KEY, url);
      } catch {
        /* ignore */
      }
      console.log("[app-links] launchUrl", url);
      publish(toAppLinkTarget(url));
    } catch (e) {
      console.warn("[app-links] getLaunchUrl", e);
    }
  })().catch((e) => {
    initPromise = null;
    console.warn("[app-links] init", e);
  });

  return initPromise;
}
