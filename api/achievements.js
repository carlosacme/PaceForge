import { requireUser, canAccessAthlete, jsonError, adminHeaders } from "../lib/apiAuth.js";
import { parseAchievementYmd } from "../lib/athleteAchievements.js";

/**
 * Catalogo de logros + awards por atleta.
 *
 * Exige sesion y que el athlete_id pertenezca al usuario (atleta dueño) o a
 * un atleta suyo (coach/staff). Sin eso cualquiera podia leer/otorgar logros
 * ajenos via service_role (IDOR).
 *
 * POST es idempotente: si ya existe (athlete_id, achievement_code) responde
 * 409 already_awarded y no inserta. El cliente trata 409 como "ya lo tenía"
 * (sin toast). El unique index de prod llega DESPUÉS de limpiar duplicados.
 */
export default async function handler(req, res) {
  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return jsonError(
      res,
      500,
      "Faltan variables de Supabase: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const headers = adminHeaders();

  if (req.method === "GET") {
    const athlete_id = req.query?.athlete_id;
    if (!athlete_id) return jsonError(res, 400, "Falta athlete_id");
    if (!(await canAccessAthlete(user.id, athlete_id))) {
      return jsonError(res, 403, "Sin acceso a este atleta");
    }

    const [r1, r2] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/achievements?select=*`, { headers }),
      fetch(
        `${SUPA_URL}/rest/v1/athlete_achievements?select=id,athlete_id,achievement_code,value,earned_at,achieved_on` +
          `&athlete_id=eq.${encodeURIComponent(String(athlete_id))}` +
          `&order=id.asc&limit=10000`,
        { headers },
      ),
    ]);
    const all = await r1.json();
    let earned = await r2.json();
    if (!Array.isArray(earned) && r2.status >= 400) {
      const r2b = await fetch(
        `${SUPA_URL}/rest/v1/athlete_achievements?select=id,athlete_id,achievement_code,value,earned_at` +
          `&athlete_id=eq.${encodeURIComponent(String(athlete_id))}` +
          `&order=id.asc&limit=10000`,
        { headers },
      );
      earned = await r2b.json();
    }
    return res.status(200).json({ all, earned });
  }

  if (req.method === "POST") {
    const { athlete_id, achievement_code, value, achieved_on } = req.body || {};
    if (!athlete_id || !achievement_code) {
      return jsonError(res, 400, "Faltan athlete_id o achievement_code");
    }
    if (!(await canAccessAthlete(user.id, athlete_id))) {
      return jsonError(res, 403, "Sin acceso a este atleta");
    }

    const existingUrl =
      `${SUPA_URL}/rest/v1/athlete_achievements` +
      `?select=id&athlete_id=eq.${encodeURIComponent(String(athlete_id))}` +
      `&achievement_code=eq.${encodeURIComponent(String(achievement_code))}` +
      `&limit=1`;
    const existingRes = await fetch(existingUrl, { headers });
    const existing = await existingRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(409).json({ error: "already_awarded", code: "23505" });
    }

    const payload = { athlete_id, achievement_code, value };
    const ymd = parseAchievementYmd(achieved_on);
    if (ymd) payload.achieved_on = ymd;

    const insertOnce = (body) => fetch(`${SUPA_URL}/rest/v1/athlete_achievements`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });

    let r = await insertOnce(payload);
    let data = await r.json();
    if (!r.ok && payload.achieved_on && (data?.code === "42703" || /achieved_on/i.test(String(data?.message || "")))) {
      const { achieved_on: _drop, ...withoutDate } = payload;
      r = await insertOnce(withoutDate);
      data = await r.json();
    }
    if (!r.ok) {
      const duplicate = r.status === 409 || data?.code === "23505"
        || /duplicate|unique constraint|already exists/i.test(String(data?.message || data?.error || ""));
      if (duplicate) {
        return res.status(409).json({ error: "already_awarded", code: "23505", data });
      }
      return res.status(r.status).json({ error: data?.message || data?.error || "No se pudo guardar el logro", data });
    }
    return res.status(200).json({ data });
  }

  return jsonError(res, 405, "Method not allowed");
}
