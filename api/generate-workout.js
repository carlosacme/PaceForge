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
  res.status(200).json(data);
}
