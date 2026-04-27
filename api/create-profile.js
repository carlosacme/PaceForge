import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { user_id, email, name, role, coach_id } = req.body || {};

  if (!user_id || !email || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const nowIso = new Date().toISOString();
  const resolvedCoachId = role === "coach" ? user_id : coach_id || null;

  const row = {
    user_id,
    email,
    name: typeof name === "string" ? name : "",
    role,
    coach_id: resolvedCoachId,
  };
  if (role === "coach") {
    row.plan_status = "trial";
    row.trial_started_at = nowIso;
  }

  const { error } = await supabase.from("profiles").upsert(row, { onConflict: "user_id" });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
