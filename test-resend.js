/**
 * Prueba manual de envio con Resend.
 *
 *   node --env-file=.env test-resend.js destino@ejemplo.com
 *
 * Usa el MISMO remitente que la app (lib/emailSender.js): un script de prueba
 * que envie desde otra direccion no prueba nada sobre la entregabilidad real.
 *
 * La clave se lee de RESEND_API_KEY. Antes estaba escrita aqui dentro y acabo
 * en el historial de git, que es como se queman las claves.
 */
import { sendEmailViaResend, EMAIL_FROM, EMAIL_REPLY_TO } from "./lib/emailSender.js";

const to = process.argv[2];
if (!to) {
  console.error("Uso: node --env-file=.env test-resend.js destino@ejemplo.com");
  process.exit(1);
}

const result = await sendEmailViaResend({
  to,
  subject: "Test RunningApexFlow",
  html: "<p>Test desde RunningApexFlow</p>",
});

console.log(`from:     ${EMAIL_FROM}`);
console.log(`reply_to: ${EMAIL_REPLY_TO}`);
console.log(`to:       ${to}`);
console.log(result.ok ? `enviado (id ${result.data?.id})` : `fallo ${result.status}: ${result.error}`);
if (!result.ok) process.exit(1);
