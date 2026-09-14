/**
 * Cliente HTTP de intervals.icu. Compartido por api/integrations.js y el
 * cron de watch-sync: misma base URL, mismo header Basic/Bearer.
 */

export const ICU_BASE = "https://intervals.icu/api/v1";

// Basic con API key, o Bearer con access_token si la conexion es OAuth.
export function icuAuthHeader(conn) {
  if (conn?.auth_type === "oauth" && conn.access_token) {
    return `Bearer ${conn.access_token}`;
  }
  if (conn?.api_key) {
    return `Basic ${Buffer.from(`API_KEY:${conn.api_key}`).toString("base64")}`;
  }
  return null;
}

// Recibe la CONEXION completa y resuelve el header segun auth_type.
// athlete id "0" = auto-resolver desde las credenciales (validado en pruebas).
export async function icuFetch(conn, path, { method = "GET", body } = {}) {
  const auth = icuAuthHeader(conn);
  if (!auth) {
    return { ok: false, status: 401, data: null, text: "Conexion sin credenciales" };
  }
  const r = await fetch(`${ICU_BASE}${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data, text };
}
