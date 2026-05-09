export default async function handler(req, res) {
  const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
  const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
  const VERIFY_TOKEN = "strava_raf_2026";
  const CALLBACK_URL = "https://www.runningapexflow.com/api/strava-webhook";

  const action = req.query.action;

  // List
  if (action === "list") {
    const r = await fetch(
      `https://www.strava.com/api/v3/push_subscriptions?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
    );
    const data = await r.json();
    return res.status(200).json(data);
  }

  // Delete
  if (action === "delete") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const r = await fetch(
      `https://www.strava.com/api/v3/push_subscriptions/${id}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }).toString(),
      }
    );
    return res.status(200).json({ status: r.status, ok: r.status === 204 });
  }

  // Create
  if (action === "create") {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      callback_url: CALLBACK_URL,
      verify_token: VERIFY_TOKEN,
    });
    const r = await fetch("https://www.strava.com/api/v3/push_subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await r.json();
    return res.status(200).json({ status: r.status, data });
  }

  return res.status(400).json({ error: "action must be list|delete|create" });
}
