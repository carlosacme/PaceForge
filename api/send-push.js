import { GoogleAuth } from "google-auth-library";

const FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects/runningapexflow/messages:send";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { token, title, body } = req.body || {};
  if (!token) return res.status(400).json({ error: "No token" });

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return res.status(500).json({ error: "FIREBASE_SERVICE_ACCOUNT no configurada" });
  }

  let credentials;
  try {
    credentials = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return res.status(500).json({ error: "FIREBASE_SERVICE_ACCOUNT no es JSON válido" });
  }

  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const access = await client.getAccessToken();
    const bearer = access?.token;
    if (!bearer) {
      return res.status(500).json({ error: "No se pudo obtener access token de Google" });
    }

    const response = await fetch(FCM_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: title ?? "RunningApexFlow",
            body: body ?? "",
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status >= 400 && response.status < 600 ? response.status : 502).json(data);
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error("send-push:", err);
    return res.status(500).json({ error: err?.message || "Error enviando push" });
  }
}
