import { requireUser, jsonError } from "../lib/apiAuth.js";
import { sendEmailViaResend } from "../lib/emailSender.js";

/**
 * Unico punto de salida de correo transaccional de la app.
 *
 * Exige sesion. El cliente NO manda HTML libre: solo elige una plantilla
 * conocida y variables tipadas. Asi una cuenta comprometida no puede usarnos
 * como relay de phishing con nuestro remitente verificado.
 *
 * El remitente y el reply_to viven en lib/emailSender.js.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Solo http(s) en enlaces de invitacion; bloquea javascript: y datos raros. */
function safeHttpUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * HTML de listas / estructura ya generado por el servidor de plantillas o
 * por helpers del cliente a partir de datos propios. Solo se admiten tags
 * basicos de formato; se rechaza script/iframe/on*.
 */
function sanitizeBasicHtml(raw) {
  const s = String(raw || "");
  if (/<\s*(script|iframe|object|embed|link|meta|style)\b/i.test(s)) return null;
  if (/\bon\w+\s*=/i.test(s)) return null;
  if (/javascript:/i.test(s)) return null;
  return s;
}

function requireEmail(to) {
  const email = String(to || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

const TEMPLATES = {
  athlete_invite: ({ inviteLink, coachCode }) => {
    const link = safeHttpUrl(inviteLink);
    if (!link) return null;
    const codeHtml = coachCode
      ? `<p style="font-size:14px;color:#64748b">Código de coach: <strong>${escapeHtml(coachCode)}</strong></p>`
      : "";
    return {
      subject: "Invitación para entrenar en RunningApexFlow",
      html: `<div style="font-family:Arial,sans-serif"><h2>¡Tu coach te invitó! 🏃</h2><p>Haz clic aquí para registrarte y vincularte automáticamente:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>${codeHtml}</div>`,
    };
  },

  staff_invite: ({ inviteLink }) => {
    const link = safeHttpUrl(inviteLink);
    if (!link) return null;
    return {
      subject: "Invitacion para unirte como sub-coach en RunningApexFlow",
      html: `<div style="font-family:Arial,sans-serif"><h2>Te invitaron como sub-coach en RunningApexFlow</h2><p>Haz clic para registrarte y unirte al equipo:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p style="font-size:14px;color:#64748b">Una vez registrado, el coach principal podra asignarte atletas para gestionar.</p></div>`,
    };
  },

  payment_confirmed: ({ athleteName, plan, amount, currency }) => {
    const name = escapeHtml(athleteName || "atleta");
    const planSafe = escapeHtml(plan || "plan");
    const amountNum = Number(amount);
    const amountSafe = Number.isFinite(amountNum)
      ? amountNum.toLocaleString("es-CO")
      : escapeHtml(amount || "0");
    const currencySafe = escapeHtml(currency || "COP");
    return {
      subject: "Pago confirmado",
      html: `<div style="font-family:Arial,sans-serif"><h2>Pago recibido ✅</h2><p>Hola ${name}, tu pago del plan <b>${planSafe}</b> por <b>$${amountSafe} ${currencySafe}</b> fue confirmado.</p><p>Gracias por entrenar con RunningApexFlow.</p></div>`,
    };
  },

  workout_assigned: ({ athleteName, title, date, description, totalKm, durationMin, structureHtml }) => {
    const structure = sanitizeBasicHtml(structureHtml);
    if (structure == null) return null;
    return {
      subject: `Nuevo entrenamiento: ${String(title || "entrenamiento").slice(0, 120)}`,
      html: `
      <h2>Hola ${escapeHtml(athleteName || "atleta")} 👋</h2>
      <p>Tu coach te ha asignado un nuevo entrenamiento:</p>
      <h3>${escapeHtml(title || "")}</h3>
      <p><strong>Fecha:</strong> ${escapeHtml(date || "")}</p>
      <p><strong>Descripción:</strong> ${escapeHtml(description || "")}</p>
      <p><strong>Distancia:</strong> ${escapeHtml(totalKm)} km</p>
      <p><strong>Duración:</strong> ${escapeHtml(durationMin)} minutos</p>
      <h4>Estructura:</h4>
      ${structure}
      <br/><p>¡Mucho éxito! 💪</p>
      <p>— Tu coach en RunningApexFlow</p>
    `,
    };
  },

  plan2_assigned: ({
    athleteName,
    competition,
    targetTime,
    startDate,
    planTitle,
    weekSummaryHtml,
    workoutCount,
  }) => {
    const weekSummary = sanitizeBasicHtml(weekSummaryHtml);
    if (weekSummary == null) return null;
    const title = String(planTitle || "Plan personalizado").slice(0, 160);
    return {
      subject: `Tu plan de 2 semanas: ${title}`,
      html: `
                <h2>Hola ${escapeHtml(athleteName || "atleta")} 👋</h2>
                <p>Tu coach te ha asignado un <strong>plan de 2 semanas</strong> en RunningApexFlow.</p>
                <p><strong>Objetivo:</strong> ${escapeHtml(competition || "")} en ${escapeHtml(targetTime || "")}<br/>
                <strong>Inicio de bloque:</strong> ${escapeHtml(startDate || "")}</p>
                <p><strong>${escapeHtml(title)}</strong></p>
                <ul>${weekSummary}</ul>
                <p>Total: <strong>${escapeHtml(workoutCount)}</strong> entrenamientos cargados en tu calendario.</p>
                <p>¡Mucho éxito! 💪</p>
                <p>— RunningApexFlow</p>
              `,
    };
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const { template, to, vars } = req.body || {};
  // Rechazar el contrato antiguo (html libre) de forma explicita.
  if (req.body?.html != null || (req.body?.subject != null && !template)) {
    return jsonError(res, 400, "Usa una plantilla (template + vars); HTML libre no esta permitido");
  }

  const toEmail = requireEmail(to);
  if (!toEmail) return jsonError(res, 400, "Destinatario invalido");

  const builder = TEMPLATES[String(template || "")];
  if (!builder) {
    return jsonError(res, 400, `Plantilla desconocida: ${String(template || "")}`);
  }

  const built = builder(vars && typeof vars === "object" ? vars : {});
  if (!built?.subject || !built?.html) {
    return jsonError(res, 400, "Variables de plantilla incompletas o invalidas");
  }

  try {
    const result = await sendEmailViaResend({
      to: toEmail,
      subject: built.subject,
      html: built.html,
    });
    if (!result.ok) {
      console.error("Resend error:", result.status, JSON.stringify(result.data));
      return res.status(result.status).json({ error: result.error, detail: result.data });
    }
    console.log(`[send-email] ${user.id} template=${template} -> ${toEmail} (${result.data?.id})`);
    return res.status(200).json(result.data);
  } catch (e) {
    console.error("send-email exception:", e.message);
    return res.status(500).json({ error: "Excepcion enviando email" });
  }
}
