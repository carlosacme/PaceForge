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
 * ¿El usuario es el COACH de ese atleta? (directo o via staff)
 *
 * Verificado contra el esquema real:
 *  - athletes.coach_id      = user_id del coach (sin FK, pero es user_id)
 *  - staff_athletes.staff_id = user_id del staff (NO el id de coach_staff)
 *  - coach_staff.staff_id    = user_id del staff
 *  - coach_staff NO tiene columna status: revocar = borrar la fila.
 *
 * Para el staff exigimos AMBAS cosas: la asignacion al atleta
 * (staff_athletes) Y la membresia vigente en el equipo (coach_staff).
 * Asi, borre lo que borre la revocacion, el acceso se corta.
 */
export async function isCoachOf(userId, athleteId) {
  const rows = await sbGet(`athletes?id=eq.${athleteId}&select=id,coach_id`);
  const a = rows?.[0];
  if (!a) return false;

  // Coach directo
  if (a.coach_id === userId) return true;

  try {
    // 1) ¿Tiene asignado este atleta?
    const assigned = await sbGet(
      `staff_athletes?athlete_id=eq.${athleteId}&staff_id=eq.${userId}&select=coach_id`
    );
    if (!assigned?.length) return false;

    // 2) ¿Sigue siendo staff del coach dueño del atleta?
    const member = await sbGet(
      `coach_staff?staff_id=eq.${userId}&coach_id=eq.${a.coach_id}&select=id`
    );
    return Array.isArray(member) && member.length > 0;
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

/**
 * ¿Estos dos usuarios estan relacionados (coach <-> atleta)?
 *
 * Se usa para autorizar notificaciones push: solo puedes notificar
 * a alguien con quien tienes relacion. Refleja la misma logica que
 * las RLS de profiles (0008_fcm_token_profiles.sql).
 */
export async function areRelated(userA, userB) {
  if (!userA || !userB) return false;
  if (userA === userB) return true;   // a si mismo

  // A es coach de un atleta cuyo user_id es B
  const asCoach = await sbGet(
    `athletes?coach_id=eq.${userA}&user_id=eq.${userB}&select=id&limit=1`
  );
  if (asCoach?.length) return true;

  // B es coach de un atleta cuyo user_id es A
  const asAthlete = await sbGet(
    `athletes?coach_id=eq.${userB}&user_id=eq.${userA}&select=id&limit=1`
  );
  if (asAthlete?.length) return true;

  // Solicitud de entrenador entre ambos: todavia no son coach y atleta, pero
  // el aviso de "fulano quiere entrenar contigo" tiene que poder salir.
  const viaRequest = await sbGet(
    `coach_requests?select=id&limit=1&or=(and(athlete_user_id.eq.${userA},coach_id.eq.${userB}),and(athlete_user_id.eq.${userB},coach_id.eq.${userA}))`
  );
  if (viaRequest?.length) return true;

  // Staff: A es staff asignado a un atleta cuyo user_id es B
  const viaStaff = await sbGet(
    `staff_athletes?staff_id=eq.${userA}&select=athlete_id`
  );
  if (viaStaff?.length) {
    const ids = viaStaff.map((s) => s.athlete_id).join(",");
    const hit = await sbGet(`athletes?id=in.(${ids})&user_id=eq.${userB}&select=id&limit=1`);
    if (hit?.length) return true;
  }

  return false;
}

/**
 * Resuelve el user_id dueño de un token FCM.
 * Permite validar que el destinatario de una push es alguien
 * con quien el emisor tiene relacion, sin que el cliente tenga
 * que declarar a quien notifica.
 */
export async function userIdByFcmToken(token) {
  if (!token) return null;
  const rows = await sbGet(
    `profiles?fcm_token=eq.${encodeURIComponent(token)}&select=user_id&limit=1`
  );
  return rows?.[0]?.user_id || null;
}

/**
 * Resuelve el token FCM de un user_id con service_role.
 * Permite que el token nunca salga de la base: el cliente solo declara
 * a QUIEN notifica (to_user_id) y el backend busca su token aqui, tras
 * validar la relacion con areRelated().
 *
 * OJO: profiles.fcm_token guarda UN token por usuario, asi que solo apunta al
 * ultimo dispositivo registrado. La fuente de verdad es device_tokens; esto
 * queda como reserva para los usuarios que aun no han vuelto a registrar.
 */
export async function fcmTokenByUserId(userId) {
  if (!userId) return null;
  const rows = await sbGet(
    `profiles?user_id=eq.${encodeURIComponent(userId)}&select=fcm_token&limit=1`
  );
  return rows?.[0]?.fcm_token || null;
}

/**
 * Todos los tokens de push de un usuario, uno por dispositivo.
 *
 * Devuelve null (no array vacio) cuando la tabla no responde, para que quien
 * llama distinga "este usuario no tiene dispositivos" de "device_tokens no esta
 * disponible todavia" y pueda caer en profiles.fcm_token. Importa mientras la
 * migracion 0061 no este aplicada: sin esa distincion, un despliegue adelantado
 * dejaria a todo el mundo sin notificaciones.
 */
export async function deviceTokensByUserId(userId) {
  if (!userId) return [];
  try {
    const rows = await sbGet(
      `device_tokens?user_id=eq.${encodeURIComponent(userId)}&select=id,token,platform&order=last_seen_at.desc`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn("[push] device_tokens no disponible:", e.message);
    return null;
  }
}

/** Igual que {@link deviceTokensByUserId} para varios usuarios, agrupado por user_id. */
export async function deviceTokensByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const rows = await sbGet(
      `device_tokens?user_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,token,platform,user_id`
    );
    const byUser = {};
    for (const row of rows || []) {
      if (!byUser[row.user_id]) byUser[row.user_id] = [];
      byUser[row.user_id].push(row);
    }
    return byUser;
  } catch (e) {
    console.warn("[push] device_tokens no disponible:", e.message);
    return null;
  }
}
