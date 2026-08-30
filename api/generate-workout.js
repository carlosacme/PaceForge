import { requireUser, jsonError } from "../lib/apiAuth.js";
import { assertGenerateBudget } from "../lib/aiBudget.js";

/**
 * Proxy autenticado a Anthropic Messages API.
 * Sin sesion esto era un relay abierto que quemaba ANTHROPIC_API_KEY.
 * Coach/admin + techos mes/día (lib/aiBudget) ANTES de llamar a Anthropic.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const blocked = await assertGenerateBudget(res, user);
  if (blocked) return blocked;

  const body = req.body || {};
  const requested = Number(body.max_tokens);
  const max_tokens = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, 32000)
    : 2000;

  // thinking es opcional: el call site puede enviar
  //   { type: "disabled" }  o  { type: "enabled", budget_tokens: N }
  // Si no viene, no se incluye (comportamiento por defecto del modelo).
  const { thinking, ...rest } = body;
  let payload = { ...rest, max_tokens };
  if (thinking != null && typeof thinking === "object") {
    payload.thinking = thinking;
  }

  async function callAnthropic(p) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(p),
    });
    const data = await response.json();
    return { response, data };
  }

  let { response, data } = await callAnthropic(payload);

  // Compatibilidad: si "disabled" no es aceptado (400), reintenta con un
  // budget minimo de extended thinking. En claude-sonnet-5 "disabled" SI
  // funciona (thinking ON por defecto); este fallback cubre otros modelos.
  const errMsg = String(data?.error?.message || data?.error?.type || "");
  if (
    response.status === 400 &&
    payload.thinking?.type === "disabled" &&
    /thinking|disabled/i.test(errMsg)
  ) {
    console.log(
      "[generate-workout] thinking.disabled rechazado (",
      errMsg.slice(0, 200),
      ") -> reintento con enabled budget_tokens:1024",
    );
    payload = { ...payload, thinking: { type: "enabled", budget_tokens: 1024 } };
    ({ response, data } = await callAnthropic(payload));
  }

  // Diagnostico: status, stop_reason, tipos de bloque y chars de texto.
  // claude-sonnet-5 puede devolver "thinking" antes de "text"; si se trunca
  // (stop_reason=max_tokens) el cliente recibe content sin texto usable.
  const types = Array.isArray(data.content) ? data.content.map((b) => b?.type) : [];
  const textChars = Array.isArray(data.content)
    ? data.content
        .filter((b) => b && b.type === "text")
        .reduce((n, b) => n + String(b.text || "").length, 0)
    : 0;
  console.log(
    "[generate-workout]",
    user.id,
    "anthropic status:",
    response.status,
    "| stop_reason:",
    data?.stop_reason,
    "| types:",
    types,
    "| text_chars:",
    textChars,
    "| thinking:",
    payload.thinking?.type || "(default)",
    "| usage:",
    data?.usage,
  );
  if (data?.error) {
    console.log("[generate-workout] anthropic error:", JSON.stringify(data.error).slice(0, 500));
  }
  res.status(response.status || 200).json(data);
}
