import { createClient } from "@supabase/supabase-js";
import { requireUser, jsonError } from "../lib/apiAuth.js";

/**
 * Registra el token de push de ESTE dispositivo para el usuario autenticado.
 *
 * FUENTE DE VERDAD: device_tokens, una fila por dispositivo. profiles.fcm_token
 * se sigue escribiendo por compatibilidad (y como reserva del envio mientras la
 * gente no vuelva a registrar), pero era el origen del bug de fondo: al ser una
 * sola columna, quien usa navegador Y app solo recibia en el ultimo que se
 * registro, porque el segundo registro pisaba el token del primero.
 *
 * getToken() de Firebase devuelve el MISMO token para un navegador, sin importar
 * que usuario este logueado. Si varios usuarios inician sesion en el mismo
 * navegador, todos terminarian con el mismo token y las notificaciones se
 * cruzarian (un usuario recibiria mensajes de otro, con su nombre y contenido).
 * Para evitarlo, este endpoint corre con service_role y, ANTES de asignar el
 * token al usuario actual, lo retira de cualquier OTRO dueño.
 *
 * Esa limpieza cruzada NO puede hacerse desde el cliente: tanto la RLS de
 * profiles (0045) como la de device_tokens (0061) solo dejan a cada usuario
 * tocar SUS filas, asi que un borrado sobre las de otro afectaria 0 filas en
 * silencio.
 */

const PLATFORMS = new Set(["web", "android", "ios"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const { token, platform: rawPlatform } = req.body || {};
  if (!token || typeof token !== "string") {
    return jsonError(res, 400, "Falta token");
  }
  // Un valor desconocido no debe tumbar el registro: el token sirve igual y la
  // plataforma es solo informativa para el diagnostico.
  const platform = PLATFORMS.has(String(rawPlatform)) ? String(rawPlatform) : "web";

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return jsonError(res, 500, "Missing config");
  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) Retirar este token de cualquier otro dueño: mismo navegador con otra
  //    sesion, o telefono reasignado a otra persona.
  const { error: clearDeviceErr } = await supabase
    .from("device_tokens")
    .delete()
    .eq("token", token)
    .neq("user_id", user.id);
  if (clearDeviceErr) {
    // Con la 0061 sin aplicar la tabla no existe todavia. No es motivo para
    // rechazar el registro: profiles sigue cubriendo el envio.
    console.warn("[register-fcm] limpiar device_tokens ajenos:", clearDeviceErr.message);
  }

  const { error: clearErr } = await supabase
    .from("profiles")
    .update({ fcm_token: null })
    .eq("fcm_token", token)
    .neq("user_id", user.id);
  if (clearErr) {
    console.error("[register-fcm] limpiar otros perfiles:", clearErr.message);
    return jsonError(res, 500, "No se pudo limpiar el token de otros perfiles");
  }

  // 2) Guardar el dispositivo. El UNIQUE(token) hace que reabrir la app
  //    actualice la fila en vez de crear una nueva, y que el mismo dispositivo
  //    no pueda quedar duplicado.
  const now = new Date().toISOString();
  const { data: device, error: deviceErr } = await supabase
    .from("device_tokens")
    .upsert(
      { user_id: user.id, token, platform, updated_at: now, last_seen_at: now },
      { onConflict: "token" }
    )
    .select("id");
  if (deviceErr) console.error("[register-fcm] guardar device_tokens:", deviceErr.message);
  const deviceSaved = !deviceErr && Boolean(device?.length);

  // 3) profiles por compatibilidad. El .select() es imprescindible: un UPDATE
  //    que no encuentra fila responde igual que uno correcto, y el cliente daba
  //    por registrado un token que nunca se guardo.
  const { data: updated, error: setErr } = await supabase
    .from("profiles")
    .update({ fcm_token: token })
    .eq("user_id", user.id)
    .select("user_id");
  if (setErr) console.error("[register-fcm] guardar en perfil propio:", setErr.message);
  const profileSaved = !setErr && Boolean(updated?.length);

  // Solo es un fallo real si NINGUNA de las dos escrituras dejo rastro: con
  // device_tokens guardado, el envio ya sabe a donde ir.
  if (!deviceSaved && !profileSaved) {
    const reason = setErr?.message || deviceErr?.message || "el usuario no tiene perfil donde guardar el token";
    console.error("[register-fcm] token no guardado para", user.id, "→", reason);
    return jsonError(res, setErr || deviceErr ? 500 : 404, `No se pudo guardar el token: ${reason}`);
  }

  return res.status(200).json({
    ok: true,
    saved: true,
    platform,
    device_saved: deviceSaved,
    profile_saved: profileSaved,
  });
}
