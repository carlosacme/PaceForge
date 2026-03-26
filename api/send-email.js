export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, html } = req.body;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "PaceForge <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  const data = await response.json();
  console.log("Resend response:", JSON.stringify(data));
  res.status(200).json(data);
}

