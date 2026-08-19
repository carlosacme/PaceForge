/**
 * Rutas de la SPA que atienden enlaces de correo.
 *
 * No hay router: el catch-all de vercel.json sirve index.html en cualquier ruta
 * y App decide la pantalla mirando el pathname. Estos helpers viven fuera de los
 * componentes para no romper el fast refresh.
 */

/** Pagina que canjea el token_hash de confirmacion de correo. */
export const CONFIRM_EMAIL_PATH = "/auth/confirm";

/** ¿La URL actual es /auth/confirm (con o sin barra final)? */
export function isConfirmEmailRoute() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/+$/, "") === CONFIRM_EMAIL_PATH;
}
