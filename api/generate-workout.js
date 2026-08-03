export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const body = req.body || {};
  const requested = Number(body.max_tokens);
  const max_tokens = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, 32000)
    : 2000;
  const payload = { ...body, max_tokens };
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
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
    "[generate-workout] anthropic status:",
    response.status,
    "| stop_reason:",
    data?.stop_reason,
    "| types:",
    types,
    "| text_chars:",
    textChars,
    "| usage:",
    data?.usage,
  );
  if (data?.error) {
    console.log("[generate-workout] anthropic error:", JSON.stringify(data.error).slice(0, 500));
  }
  res.status(200).json(data);
}
