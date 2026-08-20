import { requireUser, jsonError } from "../lib/apiAuth.js";
import { sendEmailViaResend } from "../lib/emailSender.js";

/**
 * Unico punto de salida de correo transaccional de la app.
 *
 * Exige sesion. Sin ella esto era un relay abierto: cualquiera podia mandar
 * HTML arbitrario a cualquier direccion CON NUESTRO REMITENTE verificado, que
 * es la forma mas rapida de quemar la reputacion del dominio y de acabar
 * repartiendo phishing con nuestra marca.
 *
 * No se restringe por rol a proposito: los sub-coaches tambien invitan, y los
 * destinatarios de una invitacion son direcciones cualesquiera por definicion.
 * A cambio queda registrado QUIEN envia cada correo, para poder rastrear un
 * abuso hasta una cuenta concreta.
 *
 * El remitente y el reply_to NO se aceptan por parametro: viven en
 * lib/emailSender.js para que todos los flujos salgan con la misma identidad.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: "Faltan campos: to, subject, html" });
  }

  try {
    const result = await sendEmailViaResend({ to, subject, html });
    if (!result.ok) {
      console.error("Resend error:", result.status, JSON.stringify(result.data));
      return res.status(result.status).json({ error: result.error, detail: result.data });
    }
    console.log(`[send-email] ${user.id} -> ${Array.isArray(to) ? to.join(",") : to} (${result.data?.id})`);
    return res.status(200).json(result.data);
  } catch (e) {
    console.error("send-email exception:", e.message);
    return res.status(500).json({ error: "Excepcion enviando email" });
  }
}
