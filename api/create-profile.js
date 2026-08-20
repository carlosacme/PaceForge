import { createClient } from "@supabase/supabase-js";

function normalizeOptionalCoachId(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "" || s === "undefined" || s === "null") return null;
  return s;
}

/**
 * Crea o actualiza profiles (+ athletes si aplica).
 *
 * El nombre es obligatorio: sin el, la home acaba mostrando el correo o
 * "Usuario"/"Atleta" genericos. Antes se silenciaba con un fallback; ahora
 * devolvemos 400 para que el cliente lo note.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { user_id, email, name, role, coach_id } = req.body || {};

  if (!user_id || !email || !role) {
    return res.status(400).json({ error: "Missing required fields: user_id, email, role" });
  }

  const nameTrim = typeof name === "string" ? name.trim() : "";
  if (!nameTrim) {
    return res.status(400).json({ error: "Missing required field: name" });
  }
  // Evitar guardar el correo como "nombre" (causa el saludo Hola, user@...).
  if (nameTrim.includes("@")) {
    return res.status(400).json({ error: "name no puede ser un correo; indica tu nombre real" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("[create-profile] missing SUPABASE_URL or SERVICE_ROLE_KEY");
    return res.status(500).json({ error: "Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const uid = String(user_id).trim();
  /** Atleta: solo UUID de coach válido; nunca el propio user_id. Coach: coach_id = su user_id. */
  let profileCoachId;
  if (role === "coach") {
    profileCoachId = uid;
  } else {
    const fromBody = normalizeOptionalCoachId(coach_id);
    profileCoachId = fromBody && String(fromBody) === uid ? null : fromBody;
  }

  const emailNorm = typeof email === "string" ? email.trim().toLowerCase() : "";

  const { error } = await supabase.rpc("upsert_profile", {
    p_user_id: uid,
    p_email: emailNorm,
    p_name: nameTrim,
    p_role: role || "coach",
    p_coach_id: profileCoachId ?? null,
  });

  if (error) {
    console.error("[create-profile] upsert_profile:", error.message, error);
    return res.status(500).json({ error: error.message });
  }

  if (role === "athlete") {
    const athleteRow = {
      user_id: uid,
      name: nameTrim,
      email: emailNorm,
      goal: "Objetivo pendiente",
      pace: "Pendiente",
      weekly_km: 0,
      coach_id: profileCoachId ?? null,
    };
    const { error: athleteErr } = await supabase
      .from("athletes")
      .upsert(athleteRow, { onConflict: "user_id", ignoreDuplicates: false });
    if (athleteErr) {
      console.error("[create-profile] athletes upsert:", athleteErr.message, athleteErr);
      return res.status(500).json({ error: athleteErr.message });
    }
  }

  return res.status(200).json({ success: true, name: nameTrim });
}
