/**
 * Rutas de la SPA que atienden enlaces de correo.
 *
 * No hay router: el catch-all de vercel.json sirve index.html en cualquier ruta
 * y App decide la pantalla mirando el pathname. Estos helpers viven fuera de los
 * componentes para no romper el fast refresh.
 */

/** Pagina que canjea el token_hash de confirmacion de correo. */
export const CONFIRM_EMAIL_PATH = "/auth/confirm";

/** Correo pendiente de confirmar (query, sessionStorage y localStorage). */
export const PENDING_CONFIRM_EMAIL_KEY = "raf_pending_confirm_email";

/** ¿La URL actual es /auth/confirm (con o sin barra final)? */
export function isConfirmEmailRoute() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/+$/, "") === CONFIRM_EMAIL_PATH;
}

export function stashPendingConfirmEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  try { sessionStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, e); } catch { /* ignore */ }
  try { localStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, e); } catch { /* ignore */ }
}

export function clearPendingConfirmEmail() {
  try { sessionStorage.removeItem(PENDING_CONFIRM_EMAIL_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(PENDING_CONFIRM_EMAIL_KEY); } catch { /* ignore */ }
}

/**
 * Correo para el formulario de código: query `email`, hash, o el stash
 * del registro reciente.
 */
export function readStashedConfirmEmail() {
  if (typeof window === "undefined") return "";
  try {
    const q = new URLSearchParams(window.location.search).get("email");
    if (q && q.includes("@")) return q.trim().toLowerCase();
  } catch { /* ignore */ }
  try {
    const hash = window.location.hash?.startsWith("#") ? window.location.hash.slice(1) : "";
    const q = new URLSearchParams(hash).get("email");
    if (q && q.includes("@")) return q.trim().toLowerCase();
  } catch { /* ignore */ }
  try {
    const s = sessionStorage.getItem(PENDING_CONFIRM_EMAIL_KEY);
    if (s && s.includes("@")) return s;
  } catch { /* ignore */ }
  try {
    const l = localStorage.getItem(PENDING_CONFIRM_EMAIL_KEY);
    if (l && l.includes("@")) return l;
  } catch { /* ignore */ }
  return "";
}

/**
 * App.jsx decide ConfirmEmailScreen con el pathname al cargar el modulo:
 * hace falta navegacion completa, no un replaceState en la landing.
 */
export function goToSignupConfirmScreen(email) {
  stashPendingConfirmEmail(email);
  const e = String(email || "").trim().toLowerCase();
  const q = e ? `?email=${encodeURIComponent(e)}` : "";
  window.location.assign(`${CONFIRM_EMAIL_PATH}${q}`);
}
