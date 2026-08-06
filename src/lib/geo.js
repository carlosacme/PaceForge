import { Capacitor } from "@capacitor/core";

/**
 * Coordenadas de respaldo (centro de Bogota). Solo se usan cuando NO hay
 * ubicacion real: quien las reciba debe avisar al usuario de que el dato es
 * aproximado, nunca presentarlo como su ubicacion.
 */
export const FALLBACK_COORDS = { lat: 4.711, lon: -74.0721 };

/** Motivos por los que no hay ubicacion real. */
export const GEO_REASONS = {
  denied: "denied",
  unsupported: "unsupported",
  unavailable: "unavailable",
  timeout: "timeout",
  error: "error",
};

const DEFAULT_TIMEOUT_MS = 10000;

const fallbackResult = (reason) => ({
  lat: FALLBACK_COORDS.lat,
  lon: FALLBACK_COORDS.lon,
  accuracy: null,
  approximate: true,
  reason,
});

const okResult = (lat, lon, accuracy) => ({
  lat: Number(lat),
  lon: Number(lon),
  accuracy: Number.isFinite(accuracy) ? Number(accuracy) : null,
  approximate: false,
  reason: null,
});

/** navigator.geolocation envuelto en promesa (navegador). */
function getWebCoords(timeout) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(fallbackResult(GEO_REASONS.unsupported));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(okResult(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)),
      (err) => {
        const code = err?.code;
        if (code === 1) resolve(fallbackResult(GEO_REASONS.denied));
        else if (code === 3) resolve(fallbackResult(GEO_REASONS.timeout));
        else resolve(fallbackResult(GEO_REASONS.unavailable));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

/**
 * En Android/iOS el WebView no propaga navigator.geolocation al sistema, asi
 * que la app nunca pedia el permiso y siempre caia al respaldo. El plugin
 * nativo si gestiona el permiso en runtime.
 */
async function getNativeCoords(timeout) {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    let status = await Geolocation.checkPermissions();
    const granted = (s) => s?.location === "granted" || s?.coarseLocation === "granted";
    if (!granted(status)) {
      status = await Geolocation.requestPermissions({ permissions: ["location", "coarseLocation"] });
    }
    if (!granted(status)) {
      return fallbackResult(GEO_REASONS.denied);
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout,
      maximumAge: 0,
    });
    return okResult(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
  } catch (e) {
    const msg = String(e?.message || e || "").toLowerCase();
    if (msg.includes("denied") || msg.includes("permission")) return fallbackResult(GEO_REASONS.denied);
    if (msg.includes("timeout") || msg.includes("timed out")) return fallbackResult(GEO_REASONS.timeout);
    console.warn("[geo] plugin nativo fallo:", e?.message || e);
    return fallbackResult(GEO_REASONS.error);
  }
}

const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// El clima se monta en varios sitios a la vez; sin compartir la peticion el
// usuario veria dos dialogos de permiso seguidos.
const CACHE_MS = 5 * 60 * 1000;
let inflight = null;
let cached = null;

async function resolveCoords(timeout) {
  const result = isNativePlatform() ? await getNativeCoords(timeout) : await getWebCoords(timeout);
  if (!result.approximate && result.accuracy != null && result.accuracy > 1000) {
    console.warn(`[geo] Ubicacion de baja precision (${Math.round(result.accuracy)} m): por red, no GPS.`);
  }
  return result;
}

/**
 * Ubicacion actual del usuario. Nunca rechaza: si no se puede obtener,
 * devuelve las coordenadas de respaldo con approximate: true y el motivo.
 * force = true reintenta (vuelve a pedir el permiso) ignorando la cache.
 */
export async function getCurrentCoords({ timeout = DEFAULT_TIMEOUT_MS, force = false } = {}) {
  if (inflight) return inflight;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  inflight = resolveCoords(timeout)
    .then((result) => {
      cached = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Mensaje para el usuario cuando la ubicacion mostrada no es la real. */
export function geoNoticeText(reason) {
  if (reason === GEO_REASONS.denied) return "Activa el permiso de ubicación para ver el clima de tu zona.";
  if (reason === GEO_REASONS.timeout) return "No pudimos obtener tu ubicación (sin señal GPS). Mostrando datos aproximados.";
  if (reason === GEO_REASONS.unsupported) return "Este dispositivo no permite obtener tu ubicación. Mostrando datos aproximados.";
  return "No pudimos obtener tu ubicación. Mostrando datos aproximados.";
}

/** true si el usuario puede reintentar concediendo el permiso. */
export function geoCanRetry(reason) {
  return reason === GEO_REASONS.denied || reason === GEO_REASONS.timeout || reason === GEO_REASONS.error;
}
