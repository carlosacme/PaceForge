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
  // LOGGING TEMPORAL: ver el error real de Anthropic en los logs de Vercel
  // (invalid model, auth, etc.). El handler responde 200 igual, asi que sin
  // esto el error queda tragado (data.error nunca se leia).
  console.log("[generate-workout] anthropic status:", response.status);
  console.log("[generate-workout] anthropic body:", JSON.stringify(data).slice(0, 1500));
  res.status(200).json(data);
}
