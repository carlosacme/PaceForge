import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const appUrl = process.env.APP_URL || "https://pace-forge-eta.vercel.app";

  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    return res.status(500).send("Missing configuration");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const code = req.query.code;
  const state = req.query.state; // user_id del atleta
  const error = req.query.error;

  if (error || !code) {
    console.error("[strava-callback] OAuth error:", error);
    return res.redirect(`${appUrl}?strava_error=${error || "no_code"}`);
  }

  if (!state) {
    return res.redirect(`${appUrl}?strava_error=missing_state`);
  }

  // Intercambiar código por tokens
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error("[strava-callback] Token exchange failed:", tokenData);
    return res.redirect(`${appUrl}?strava_error=token_exchange_failed`);
  }

  const athlete = tokenData.athlete;
  const stravaAthleteId = athlete?.id;

  if (!stravaAthleteId) {
    return res.redirect(`${appUrl}?strava_error=no_athlete_id`);
  }

  // Guardar tokens en BD
  const { error: upsertErr } = await supabase
    .from("strava_tokens")
    .upsert(
      {
        user_id: state,
        athlete_strava_id: stravaAthleteId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
        scope: tokenData.scope || "read,activity:read",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertErr) {
    console.error("[strava-callback] Upsert error:", upsertErr);
    return res.redirect(`${appUrl}?strava_error=db_error`);
  }

  // También guardar el strava_athlete_id en profiles
  await supabase
    .from("profiles")
    .update({ strava_athlete_id: stravaAthleteId })
    .eq("user_id", state);

  console.log(`[strava-callback] ✅ Strava connected for user ${state}, athlete ${stravaAthleteId}`);

  return res.redirect(`${appUrl}?strava_connected=true`);
}
