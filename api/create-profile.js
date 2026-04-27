import { createClient } from "@supabase/supabase-js";

function normalizeOptionalCoachId(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "" || s === "undefined" || s === "null") return null;
  return s;
}

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
  const uid = String(user_id).trim();
  /** Atleta: solo UUID de coach válido; nunca el propio user_id. Coach: coach_id = su user_id. */
  let profileCoachId;
  if (role === "coach") {
    profileCoachId = uid;
  } else {
    const fromBody = normalizeOptionalCoachId(coach_id);
    profileCoachId = fromBody && String(fromBody) === uid ? null : fromBody;
  }

  const row = {
    user_id,
    email,
    name: typeof name === "string" ? name : "",
    role,
    coach_id: profileCoachId,
  };
  if (role === "coach") {
    row.plan_status = "trial";
    row.trial_started_at = nowIso;
  }

  const { error } = await supabase.from("profiles").upsert(row, { onConflict: "user_id" });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
