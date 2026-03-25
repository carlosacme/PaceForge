export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const payload = { ...(req.body || {}), max_tokens: 2000 };
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
