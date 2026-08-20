/**
 * lib/emailSender.js
 * -----------------------------------------------------------
 * Identidad de remitente unica para TODO el correo transaccional.
 *
 * Va en /lib (raiz), NO en /api: Vercel solo convierte en funcion serverless
 * los archivos de /api, y lo que se importa desde /lib se empaqueta dentro sin
 * consumir cuota.
 *
 * Por que un solo sitio: la reputacion de envio se construye por dominio y por
 * direccion. Cada remitente distinto que aparezca empieza de cero a ojos de
 * Gmail y compañia, asi que dos o tres "from" repartidos por el codigo no son
 * un detalle cosmetico: reparten la reputacion y acaban en spam. Si esto hay
 * que cambiarlo, se cambia AQUI y lo heredan todos los envios.
 *
 * OJO antes de cambiar el dominio del remitente: Resend exige que el dominio
 * del "from" sea EXACTAMENTE uno de los verificados en la cuenta, y los
 * subdominios se verifican por separado. El dominio verificado aqui es
 * runningapexflow.com:
 *
 *   resend._domainkey.runningapexflow.com  -> DKIM (v=DKIM1; p=MIGf...)
 *   send.runningapexflow.com               -> SPF + MX de Amazon SES
 *
 * Ese send. NO es un dominio de envio: es el Return-Path que Resend genera
 * para el dominio verificado, donde rebotan los correos. Mandar desde
 * @send.runningapexflow.com daria 403 "domain is not verified" y tumbaria TODO
 * el correo de la app. Para estrenar subdominio de envio hay que darlo de alta
 * primero en Resend y publicar SU DKIM.
 * -----------------------------------------------------------
 */

/** Remitente unico. Debe pertenecer al dominio verificado en Resend. */
export const EMAIL_FROM = "RunningApexFlow <noreply@runningapexflow.com>";

/**
 * Buzon real al que van las respuestas.
 *
 * El "from" es no-reply porque nadie lee ese buzon; sin reply_to, contestar a
 * un correo nuestro era escribirle a la nada.
 */
export const EMAIL_REPLY_TO = "soporte@runningapexflow.com";

/**
 * Envia un correo por la API REST de Resend.
 *
 * Ojo con el nombre del campo: la API HTTP espera `reply_to` en snake_case. El
 * `replyTo` que sale en los ejemplos es solo del SDK de Node, y aqui se llama a
 * la API a pelo.
 *
 * @param {{to: string|string[], subject: string, html: string, apiKey?: string}} params
 * @returns {Promise<{ok: boolean, status: number, data: any, error?: string}>}
 */
export async function sendEmailViaResend({ to, subject, html, apiKey = process.env.RESEND_API_KEY }) {
  if (!apiKey) {
    return { ok: false, status: 500, data: null, error: "Falta RESEND_API_KEY en el entorno" };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      reply_to: EMAIL_REPLY_TO,
      to,
      subject,
      html,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data,
      error: data?.message || "Error enviando email",
    };
  }
  return { ok: true, status: response.status, data };
}
