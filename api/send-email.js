export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, html } = req.body;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // TODO: revert — temporal para prueba; usar process.env.RESEND_API_KEY
      "Authorization": "Bearer re_3CLu9n3j_LpDi3Hq9vXrC42tv6ycmMagz",
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

