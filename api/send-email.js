export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: "Faltan campos: to, subject, html" });
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "RunningApexFlow <noreply@runningapexflow.com>",
        to,
        subject,
        html,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Resend error:", JSON.stringify(data));
      return res.status(response.status).json({ error: data?.message || "Error enviando email", detail: data });
    }
    return res.status(200).json(data);
  } catch (e) {
    console.error("send-email exception:", e.message);
    return res.status(500).json({ error: "Excepcion enviando email" });
  }
}
