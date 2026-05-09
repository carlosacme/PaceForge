import { createClient } from "@supabase/supabase-js";

const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN;
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function metersToKm(m) {
  return m ? Math.round((m / 1000) * 100) / 100 : 0;
}

function secondsToMinutes(s) {
  return s ? Math.round(s / 60) : 0;
}

async function refreshStravaToken(supabase, tokenRow) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error("[strava-webhook] Refresh token failed:", data);
    return null;
  }
  await supabase
    .from("strava_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: new Date(data.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", tokenRow.user_id);
  return data.access_token;
}

export default async function handler(req, res) {

  // ── ADMIN ACTIONS ──────────────────────────────────────────────
  const adminAction = req.query.action;
  if (adminAction && req.method === "GET" && !req.query["hub.mode"]) {
    const CLIENT_ID = STRAVA_CLIENT_ID;
    const CLIENT_SECRET = STRAVA_CLIENT_SECRET;
    const VERIFY_TOKEN = "strava_raf_2026";
    const CALLBACK_URL = "https://www.runningapexflow.com/api/strava-webhook";

    if (adminAction === "list") {
      const r = await fetch(
        `https://www.strava.com/api/v3/push_subscriptions?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
      );
      return res.status(200).json(await r.json());
    }

    if (adminAction === "delete") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const delUrl = `https://www.strava.com/api/v3/push_subscriptions/${id}?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;
      const r = await fetch(delUrl, { method: "DELETE" });
      const txt = await r.text();
      return res.status(200).json({ status: r.status, ok: r.status === 204, body: txt });
    }

    if (adminAction === "create") {
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

  // ── WEBHOOK VERIFICATION (GET from Strava) ─────────────────────
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === STRAVA_VERIFY_TOKEN) {
      console.log("[strava-webhook] Webhook verified OK");
      return res.status(200).json({ "hub.challenge": challenge });
    }
    return res.status(403).json({ error: "Forbidden" });
  }

  // ── RECEIVE EVENTS (POST) ──────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Missing configuration" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const event = req.body;

  console.log("[strava-webhook] Event received:", JSON.stringify(event));

  const objectType = event?.object_type;
  const aspectType = event?.aspect_type;
  const activityId = event?.object_id;
  const stravaAthleteId = event?.owner_id;

  if (objectType !== "activity" || !activityId || !stravaAthleteId) {
    return res.status(200).json({ ok: true, message: "Not an activity event" });
  }

  if (aspectType === "delete") {
    await supabase.from("strava_activities").delete().eq("strava_activity_id", activityId);
    return res.status(200).json({ ok: true, message: "Activity deleted" });
  }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("strava_tokens")
    .select("*")
    .eq("athlete_strava_id", stravaAthleteId)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    console.error("[strava-webhook] Token not found for athlete:", stravaAthleteId);
    return res.status(200).json({ ok: true, message: "Athlete not registered" });
  }

  let accessToken = tokenRow.access_token;
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() >= expiresAt - 60000) {
    accessToken = await refreshStravaToken(supabase, tokenRow);
    if (!accessToken) {
      return res.status(200).json({ ok: true, message: "Token refresh failed" });
    }
  }

  const actRes = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const activity = await actRes.json();

  if (!activity?.id) {
    console.error("[strava-webhook] Activity fetch failed:", activity);
    return res.status(200).json({ ok: true, message: "Activity not found" });
  }

  const activityData = {
    user_id: tokenRow.user_id,
    strava_activity_id: activity.id,
    name: activity.name || "",
    type: activity.type || "",
    sport_type: activity.sport_type || "",
    distance_m: activity.distance || 0,
    moving_time_s: activity.moving_time || 0,
    elapsed_time_s: activity.elapsed_time || 0,
    total_elevation_gain: activity.total_elevation_gain || 0,
    start_date: activity.start_date || null,
    average_speed: activity.average_speed || null,
    max_speed: activity.max_speed || null,
    average_heartrate: activity.average_heartrate || null,
    max_heartrate: activity.max_heartrate || null,
    average_cadence: activity.average_cadence || null,
    suffer_score: activity.suffer_score || null,
    perceived_exertion: activity.perceived_exertion || null,
    map_polyline: activity.map?.summary_polyline || null,
    raw_data: activity,
    synced_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from("strava_activities")
    .upsert(activityData, { onConflict: "user_id,strava_activity_id" });

  if (upsertErr) {
    console.error("[strava-webhook] Upsert error:", upsertErr);
    return res.status(200).json({ ok: true, message: "Upsert failed" });
  }

  const distanceKm = metersToKm(activity.distance);
  console.log(`[strava-webhook] Activity saved: ${activity.name} ${distanceKm}km`);

  return res.status(200).json({ ok: true, synced: true, activity_id: activityId });
}
