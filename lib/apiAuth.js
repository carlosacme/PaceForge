/**
 * lib/apiAuth.js
 * -----------------------------------------------------------
 * Verificacion de identidad para las funciones de api/.
 *
 * IMPORTANTE: este archivo va en /lib (raiz del proyecto), NO en /api.
 * Vercel solo convierte en funcion serverless los archivos de /api;
 * lo que se importa desde /lib se empaqueta dentro de esas funciones
 * y NO consume cuota. Con el plan Hobby en 12/12, esto importa.
 *
 * Uso en un handler:
 *
 *   import { requireUser, getAthleteForUser, jsonError } from "../lib/apiAuth.js";
 *
 *   const user = await requireUser(req);
 *   if (!user) return jsonError(res, 401, "No autenticado");
 *
 * Y en el frontend hay que mandar el token:
 *
 *   const { data: { session } } = await supabase.auth.getSession();
 *   fetch("/api/...", {
 *     headers: {
 *       "Content-Type": "application/json",
 *       Authorization: `Bearer ${session.access_token}`,
 *     },
 *     ...
 *   });
 * -----------------------------------------------------------
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY;

/** Respuesta de error uniforme */
export function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

/** Headers para consultas con service_role (bypassa RLS) */
function serviceHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** GET a la REST API de Supabase con service_role */
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: serviceHeaders(),
  });
  if (!r.ok) throw new Error(`Supabase GET ${path} -> ${r.status}`);
  return r.json();
}

/**
 * Verifica el JWT de Supabase que viene en Authorization: Bearer <token>.
 * Devuelve { id, email } del usuario, o null si no es valido.
 *
 * Se valida contra /auth/v1/user, que es la fuente de verdad: comprueba
 * firma, expiracion y que el usuario siga existiendo. No basta con
 * decodificar el JWT en el cliente.
 */
export async function requireUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user?.id ? { id: user.id, email: user.email } : null;
  } catch {
    return null;
  }
}

/**
 * ¿El usuario es el ATLETA indicado?  (athletes.user_id === user.id)
 */
export async function isAthleteOwner(userId, athleteId) {
  const rows = await sbGet(
    `athletes?id=eq.${athleteId}&select=id,user_id,coach_id`
  );
  const a = rows?.[0];
  return !!a && a.user_id === userId;
}

/**
 * ¿El usuario es el COACH de ese atleta?  (directo o via staff)
 */
export async function isCoachOf(userId, athleteId) {
  const rows = await sbGet(`athletes?id=eq.${athleteId}&select=id,coach_id`);
  const a = rows?.[0];
  if (!a) return false;
  if (a.coach_id === userId) return true;

  // Staff: coach_staff + staff_athletes
  try {
    const staff = await sbGet(
      `staff_athletes?athlete_id=eq.${athleteId}&select=staff_id`
    );
    if (!staff?.length) return false;
    const ids = staff.map((s) => s.staff_id).join(",");
    const members = await sbGet(
      `coach_staff?id=in.(${ids})&select=id,user_id,status`
    );
    return (members || []).some(
      (m) => m.user_id === userId && m.status !== "revoked"
    );
  } catch {
    return false;
  }
}

/**
 * Acceso al atleta: es el propio atleta, su coach, o staff autorizado.
 * Usar SIEMPRE antes de leer/escribir datos de un athlete_id que venga
 * del body: si no, cualquiera puede pasar el id de otro (IDOR).
 */
export async function canAccessAthlete(userId, athleteId) {
  if (!userId || !athleteId) return false;
  if (await isAthleteOwner(userId, athleteId)) return true;
  return isCoachOf(userId, athleteId);
}

/**
 * Acceso a un workout concreto: resuelve su athlete_id y valida.
 * Devuelve el workout si hay acceso, o null.
 */
export async function getWorkoutIfAllowed(userId, workoutId) {
  const rows = await sbGet(`workouts?id=eq.${workoutId}&select=*`);
  const w = rows?.[0];
  if (!w) return null;
  if (w.coach_id === userId) return w;
  if (w.athlete_id && (await canAccessAthlete(userId, w.athlete_id))) return w;
  return null;
}
