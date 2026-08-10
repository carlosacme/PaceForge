import { createClient } from "@supabase/supabase-js";
import { requireUser, jsonError } from "../lib/apiAuth.js";

/**
 * Registra el fcm_token de ESTE navegador en el perfil del usuario autenticado.
 *
 * getToken() de Firebase devuelve el MISMO token para un navegador, sin importar
 * que usuario este logueado. Si varios usuarios inician sesion en el mismo
 * navegador, todos terminarian con el mismo token en su perfil y las
 * notificaciones se cruzarian (un usuario recibiria mensajes de otro, con su
 * nombre y contenido). Para evitarlo, este endpoint corre con service_role y,
 * ANTES de asignar el token al usuario actual, lo limpia de cualquier OTRO
 * perfil que lo tuviera.
 *
 * Esa limpieza cruzada NO puede hacerse desde el cliente: la RLS de profiles
 * (0045) solo permite a un usuario actualizar SU propia fila, asi que un update
 * sobre las filas de otros usuarios afectaria 0 filas en silencio.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    return jsonError(res, 400, "Falta token");
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return jsonError(res, 500, "Missing config");
  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) Quitar este token de cualquier otro perfil (dueños anteriores en el
  //    mismo navegador que no lo limpiaron al salir).
  const { error: clearErr } = await supabase
    .from("profiles")
    .update({ fcm_token: null })
    .eq("fcm_token", token)
    .neq("user_id", user.id);
  if (clearErr) {
    console.error("[register-fcm] limpiar otros perfiles:", clearErr.message);
    return jsonError(res, 500, "No se pudo limpiar el token de otros perfiles");
  }

  // 2) Asignarlo al usuario actual. El .select() es imprescindible: un UPDATE
  //    que no encuentra fila responde igual que uno correcto, y el cliente daba
  //    por registrado un token que nunca se guardo.
  const { data: updated, error: setErr } = await supabase
    .from("profiles")
    .update({ fcm_token: token })
    .eq("user_id", user.id)
    .select("user_id");
  if (setErr) {
    console.error("[register-fcm] guardar en perfil propio:", setErr.message);
    return jsonError(res, 500, "No se pudo guardar el token");
  }
  if (!updated?.length) {
    console.error("[register-fcm] sin fila en profiles para", user.id);
    return jsonError(res, 404, "El usuario no tiene perfil donde guardar el token");
  }

  return res.status(200).json({ ok: true, saved: true });
}
