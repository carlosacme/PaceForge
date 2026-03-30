import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: "VITE_SUPABASE_URL o VITE_SUPABASE_KEY no configuradas" });
  }
  const supabase = createClient(url, key);

  if (req.method === "GET") {
    const { athlete_id } = req.query;
    const [{ data: all, error: errAll }, { data: earned, error: errEarned }] = await Promise.all([
      supabase.from("achievements").select("*").order("created_at", { ascending: true }),
      athlete_id
        ? supabase
            .from("athlete_achievements")
            .select("*")
            .eq("athlete_id", athlete_id)
            .order("earned_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (errAll) return res.status(500).json({ error: errAll });
    if (errEarned) return res.status(500).json({ error: errEarned });
    return res.status(200).json({ all: all || [], earned: earned || [] });
  }

  if (req.method === "POST") {
    const { athlete_id, achievement_code, value } = req.body || {};
    const { data, error } = await supabase.from("athlete_achievements").insert({ athlete_id, achievement_code, value });
    return res.status(200).json({ data, error });
  }

  res.status(405).end();
}
