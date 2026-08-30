import { requireUser, canAccessAthlete, jsonError, adminHeaders } from "../lib/apiAuth.js";

/**
 * Catalogo de logros + awards por atleta.
 *
 * Exige sesion y que el athlete_id pertenezca al usuario (atleta dueño) o a
 * un atleta suyo (coach/staff). Sin eso cualquiera podia leer/otorgar logros
 * ajenos via service_role (IDOR).
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
        `${SUPA_URL}/rest/v1/athlete_achievements?select=*&athlete_id=eq.${encodeURIComponent(String(athlete_id))}`,
        { headers },
      ),
    ]);
    const all = await r1.json();
    const earned = await r2.json();
    return res.status(200).json({ all, earned });
  }

  if (req.method === "POST") {
    const { athlete_id, achievement_code, value } = req.body || {};
    if (!athlete_id || !achievement_code) {
      return jsonError(res, 400, "Faltan athlete_id o achievement_code");
    }
    if (!(await canAccessAthlete(user.id, athlete_id))) {
      return jsonError(res, 403, "Sin acceso a este atleta");
    }

    const r = await fetch(`${SUPA_URL}/rest/v1/athlete_achievements`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ athlete_id, achievement_code, value }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.message || data?.error || "No se pudo guardar el logro", data });
    }
    return res.status(200).json({ data });
  }

  return jsonError(res, 405, "Method not allowed");
}
