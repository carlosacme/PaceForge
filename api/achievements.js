export default async function handler(req, res) {
  const SUPA_URL = process.env.VITE_SUPABASE_URL;
  /** Preferir service role en servidor para leer `athlete_achievements` sin JWT del coach (RLS). */
  const SUPA_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_KEY;
  const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" };

  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({
      error:
        "Faltan variables de Supabase: VITE_SUPABASE_URL y una clave (SUPABASE_SERVICE_ROLE_KEY o VITE_SUPABASE_KEY).",
    });
  }

  if (req.method === "GET") {
    const { athlete_id } = req.query;
    const [r1, r2] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/achievements?select=*`, { headers }),
      fetch(`${SUPA_URL}/rest/v1/athlete_achievements?select=*&athlete_id=eq.${athlete_id}`, { headers }),
    ]);
    const all = await r1.json();
    const earned = await r2.json();
    return res.status(200).json({ all, earned });
  }

  if (req.method === "POST") {
    const { athlete_id, achievement_code, value } = req.body || {};
    const r = await fetch(`${SUPA_URL}/rest/v1/athlete_achievements`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ athlete_id, achievement_code, value }),
    });
    const data = await r.json();
    return res.status(200).json({ data });
  }

  res.status(405).end();
}
