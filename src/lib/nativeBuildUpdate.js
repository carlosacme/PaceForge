import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { isResumeUiBusy } from "./resumeGuard";

/**
 * Deteccion de deploy nuevo en la APK (WebView remoto).
 *
 * Por que build-id + registration.update(), y no solo uno:
 * - registration.update() solo ayuda cuando el SW nuevo llega a activarse
 *   (controllerchange). En resume el JS viejo sigue en memoria; update() no
 *   recarga la pagina por si solo.
 * - Comparar __RAF_BUILD_ID__ (sellado en el bundle) vs /build-id.txt del
 *   servidor es explicito: sabemos si hay version nueva aunque el SW no
 *   haya cambiado aun o falle en el WebView.
 *
 * Politica no agresiva:
 * - Si la app estuvo en background poco tiempo: no hace nada (salvo pedir
 *   update del SW).
 * - Si hay version nueva y background >= AUTO_RELOAD_MS y la UI no esta
 *   ocupada: reload.
 * - Si hay version nueva pero el usuario esta a mitad de algo (o el
 *   background fue corto pero ya >= CHECK_MS): evento raf:update-available
 *   para un banner con confirmacion.
 */

const LOCAL_BUILD_ID =
  typeof __RAF_BUILD_ID__ !== "undefined" && __RAF_BUILD_ID__
    ? String(__RAF_BUILD_ID__)
    : "dev";

/** Tiempo minimo en background antes de consultar el servidor. */
const CHECK_AFTER_MS = 45_000;
/** Si estuvo tanto tiempo fuera y no hay UI ocupada, recargar sin preguntar. */
const AUTO_RELOAD_MS = 180_000;

let hiddenAt = 0;
let started = false;

function markHidden() {
  hiddenAt = Date.now();
}

function backgroundMs() {
  if (!hiddenAt) return 0;
  return Math.max(0, Date.now() - hiddenAt);
}

async function fetchRemoteBuildId() {
  const res = await fetch(`/build-id.txt?_=${Date.now()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  return text || null;
}

function requestSwUpdate() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistration().then((reg) => {
    try {
      reg?.update?.();
    } catch {
      /* ignore */
    }
  }).catch(() => {});
}

function notifyUpdateAvailable(remoteId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("raf:update-available", {
      detail: { local: LOCAL_BUILD_ID, remote: remoteId },
    }),
  );
}

async function onResumeCheck() {
  requestSwUpdate();

  const bg = backgroundMs();
  hiddenAt = 0;
  if (bg < CHECK_AFTER_MS) return;

  let remote;
  try {
    remote = await fetchRemoteBuildId();
  } catch {
    return;
  }
  if (!remote || remote === LOCAL_BUILD_ID) return;

  const busy = isResumeUiBusy();
  if (!busy && bg >= AUTO_RELOAD_MS) {
    window.location.reload();
    return;
  }
  notifyUpdateAvailable(remote);
}

/**
 * Arranca listeners de pause/resume (nativo) y visibility (respaldo).
 * Idempotente.
 */
export function startNativeBuildUpdateWatcher() {
  if (started || typeof document === "undefined") return;
  started = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") markHidden();
  });

  if (!Capacitor.isNativePlatform()) {
    // En web el SW + controllerchange bastan; no molestamos con banners de APK.
    return;
  }

  CapacitorApp.addListener("pause", () => {
    markHidden();
  }).catch(() => {});

  CapacitorApp.addListener("resume", () => {
    void onResumeCheck();
  }).catch(() => {});
}

export function getLocalBuildId() {
  return LOCAL_BUILD_ID;
}
