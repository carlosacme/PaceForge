import { sendEmailViaResend } from "../lib/emailSender.js";

/**
 * Unico punto de salida de correo transaccional de la app.
 *
 * El remitente y el reply_to NO se aceptan por parametro a proposito: viven en
 * lib/emailSender.js para que invitaciones, planes, workouts y avisos de pago
 * salgan todos con la misma identidad. Un remitente por flujo repartiria la
 * reputacion de envio entre varias direcciones.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
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
    return res.status(200).json(result.data);
  } catch (e) {
    console.error("send-email exception:", e.message);
    return res.status(500).json({ error: "Excepcion enviando email" });
  }
}
