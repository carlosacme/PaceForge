import { createClient } from "@supabase/supabase-js";
import { requireUser, jsonError } from "../lib/apiAuth.js";

function normalizeOptionalCoachId(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "" || s === "undefined" || s === "null") return null;
  return s;
}

/**
 * Crea o actualiza profiles (+ athletes si aplica).
 *
 * El user_id NUNCA viene del body: se toma del JWT verificado. Asi nadie
 * puede crear/alterar el perfil de otro usuario pasando un UUID ajeno.
 *
 * El nombre es obligatorio: sin el, la home acaba mostrando el correo o
 * "Usuario"/"Atleta" genericos.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const { name, role, coach_id } = req.body || {};
  // Ignorar cualquier user_id/email del body: la identidad sale de la sesion.
  const uid = String(user.id);
  const emailNorm = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (!emailNorm) {
    return res.status(400).json({ error: "La sesion no tiene email" });
  }

  const roleNorm = role === "coach" ? "coach" : role === "athlete" ? "athlete" : null;
  if (!roleNorm) {
    return res.status(400).json({ error: "role debe ser coach o athlete" });
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

  /** Atleta: solo UUID de coach válido; nunca el propio user_id. Coach: coach_id = su user_id. */
  let profileCoachId;
  if (roleNorm === "coach") {
    profileCoachId = uid;
  } else {
    const fromBody = normalizeOptionalCoachId(coach_id);
    profileCoachId = fromBody && String(fromBody) === uid ? null : fromBody;
  }

  const { error } = await supabase.rpc("upsert_profile", {
    p_user_id: uid,
    p_email: emailNorm,
    p_name: nameTrim,
    p_role: roleNorm,
    p_coach_id: profileCoachId ?? null,
  });

  if (error) {
    console.error("[create-profile] upsert_profile:", error.message, error);
    return res.status(500).json({ error: error.message });
  }

  if (roleNorm === "athlete") {
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

  return res.status(200).json({ success: true, name: nameTrim, user_id: uid });
}
