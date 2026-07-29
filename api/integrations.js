/**
 * api/integrations.js
 * -----------------------------------------------------------
 * Endpoint CONSOLIDADO de integraciones con relojes.
 * Una sola funcion serverless (Vercel Hobby: 12/12 usadas).
 * Todas las operaciones se enrutan por body.action.
 *
 * Puente actual: intervals.icu -> Garmin/COROS.
 * (Mientras Garmin y COROS aprueban el acceso directo a sus APIs.)
 *
 * ACCIONES:
 *   connect        { athlete_id, api_key }   guarda y valida la key
 *   disconnect     { athlete_id }
 *   status         { athlete_id }            ¿conectado?
 *   push-workout   { athlete_id, workout_id }
 *   push-range     { athlete_id, from, to }  empuja un rango de fechas
 *   pull-activity  { athlete_id, workout_id } trae lo ejecutado del reloj
 *   activity-intervals { athlete_id, activity_id } laps crudos (comparacion por bloque)
 *   oauth-start    { athlete_id }            inicia OAuth (JWT); devuelve authorize_url
 *   oauth-callback (GET ?action=oauth-callback&code&state)  SIN JWT; verificado por state
 *
 * SEGURIDAD: casi todas exigen JWT de Supabase (Authorization: Bearer <token>)
 * y validan que el usuario sea el atleta o su coach. Excepcion: oauth-callback
 * llega como GET desde el navegador (redirigido por intervals.icu) sin sesion;
 * se asegura con el 'state' anti-CSRF guardado en oauth_states.
 * -----------------------------------------------------------
 */

import crypto from "crypto";
import { requireUser, canAccessAthlete, jsonError } from "../lib/apiAuth.js";
import { buildIntervalsEvent, isRunWorkout } from "../src/lib/intervals.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ICU_BASE     = "https://intervals.icu/api/v1";

/* ---------- OAuth intervals.icu (client 605) ---------- */
const ICU_CLIENT_ID     = process.env.INTERVALS_CLIENT_ID;
const ICU_CLIENT_SECRET = process.env.INTERVALS_CLIENT_SECRET;
const ICU_OAUTH_AUTH    = "https://intervals.icu/oauth/authorize";
const ICU_OAUTH_TOKEN   = "https://intervals.icu/api/oauth/token";
const APP_URL           = process.env.APP_URL || "https://www.runningapexflow.com";
const REDIRECT_URI      = `${APP_URL}/oauth/intervals/callback`;

// Permisos que pedimos: leer actividades (para traer lo ejecutado)
// y escribir calendario (para empujar los workouts planificados).
const ICU_SCOPES = "ACTIVITY:READ,CALENDAR:WRITE";

// Webhook de intervals.icu (fase 4). Aun no se verifica; solo descubrimos payload.
const ICU_WEBHOOK_SECRET = process.env.INTERVALS_WEBHOOK_SECRET;

/* ---------- Supabase REST (el cliente JS cuelga en serverless) ---------- */
function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: sbHeaders(prefer ? { Prefer: prefer } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path} -> ${r.status}: ${text}`);
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

/* ---------- intervals.icu ---------- */
// Basic con API key, o Bearer con access_token si la conexion es OAuth.
function icuAuthHeader(conn) {
  if (conn?.auth_type === "oauth" && conn.access_token) {
    return `Bearer ${conn.access_token}`;
  }
  if (conn?.api_key) {
    return `Basic ${Buffer.from(`API_KEY:${conn.api_key}`).toString("base64")}`;
  }
  return null;
}

// Recibe la CONEXION completa y resuelve el header segun auth_type.
// athlete id "0" = auto-resolver desde las credenciales (validado en pruebas).
async function icuFetch(conn, path, { method = "GET", body } = {}) {
  const auth = icuAuthHeader(conn);
  if (!auth) {
    return { ok: false, status: 401, data: null, text: "Conexion sin credenciales" };
  }
  const r = await fetch(`${ICU_BASE}${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data, text };
}

/* ---------- Datos ---------- */
async function getConnection(athleteId) {
  const rows = await sb(
    `device_connections?athlete_id=eq.${athleteId}&provider=eq.intervals_icu&select=*`
  );
  return rows?.[0] || null;
}

/** VDOT mas reciente del atleta; null si nunca se evaluo */
async function getLatestVdot(athleteId) {
  const rows = await sb(
    `athlete_evaluations?athlete_id=eq.${athleteId}&select=vdot,test_date` +
    `&order=test_date.desc&limit=1`
  );
  const v = Number(rows?.[0]?.vdot);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// --- helper: extrae los campos actual_* de una actividad de intervals.icu ---
function mapActivityToActual(act) {
  const distM = act.distance ?? act.icu_distance ?? null;
  const movS  = act.moving_time ?? act.elapsed_time ?? null;
  const spd   = act.average_speed ?? null;   // m/s

  // Ritmo en seg/km calculado desde velocidad (mas fiable que act.pace).
  let avgPaceS = null;
  if (spd && spd > 0) avgPaceS = Math.round(1000 / spd);
  else if (distM && movS && distM > 0) avgPaceS = Math.round(movS / (distM / 1000));

  return {
    actual_distance_km:  distM != null ? Math.round((distM / 1000) * 100) / 100 : null,
    actual_duration_min: movS != null ? Math.round(movS / 60) : null,
    actual_avg_pace_s:   avgPaceS,
    actual_avg_hr:       act.average_heartrate ?? null,
    actual_max_hr:       act.max_heartrate ?? null,
    actual_elevation_m:  act.total_elevation_gain != null ? Math.round(act.total_elevation_gain) : null,
    intervals_activity_id: act.id ?? null,
    actual_synced_at:    new Date().toISOString(),
  };
}

// --- elige la mejor actividad de un dia: Run con mayor distancia ---
function pickBestActivity(activities) {
  const runs = activities.filter((a) => {
    const t = String(a.type || "").toLowerCase();
    return t === "run" || t.includes("run");
  });
  const pool = runs.length ? runs : activities;
  if (!pool.length) return null;
  return pool.reduce((best, a) =>
    (a.distance ?? 0) > (best.distance ?? 0) ? a : best, pool[0]);
}

/* ---------- Acciones ---------- */

async function actionConnect(res, athleteId, apiKey) {
  if (!apiKey || String(apiKey).trim().length < 8) {
    return jsonError(res, 400, "API key inválida");
  }
  const key = String(apiKey).trim();

  // Validar la key contra intervals.icu antes de guardarla.
  // Aun no existe conexion: se pasa un objeto temporal con la key.
  const probe = await icuFetch({ auth_type: "api_key", api_key: key }, "/athlete/0/profile");
  if (probe.status === 401 || probe.status === 403) {
    return jsonError(res, 401, "La API key no es válida en intervals.icu");
  }
  // Otros estados (404, etc.) no invalidan la key: el endpoint de perfil
  // puede variar. Si no fue 401/403, la aceptamos.

  const providerAthleteId = probe.data?.id || probe.data?.athlete?.id || null;

  const existing = await getConnection(athleteId);
  const payload = {
    athlete_id: athleteId,
    provider: "intervals_icu",
    api_key: key,
    provider_athlete_id: providerAthleteId,
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await sb(`device_connections?id=eq.${existing.id}`, {
      method: "PATCH", body: payload, prefer: "return=minimal",
    });
  } else {
    await sb("device_connections", {
      method: "POST", body: payload, prefer: "return=minimal",
    });
  }

  return res.status(200).json({
    ok: true,
    connected: true,
    provider_athlete_id: providerAthleteId,
  });
}

async function actionDisconnect(res, athleteId) {
  const c = await getConnection(athleteId);
  if (c) {
    await sb(`device_connections?id=eq.${c.id}`, {
      method: "DELETE", prefer: "return=minimal",
    });
  }
  return res.status(200).json({ ok: true, connected: false });
}

async function actionStatus(res, athleteId) {
  const c = await getConnection(athleteId);
  if (!c) return res.status(200).json({ ok: true, connected: false });
  return res.status(200).json({
    ok: true,
    connected: c.status === "active",
    provider: c.provider,
    auth_type: c.auth_type,
    last_push_at: c.last_push_at,
    last_error: c.last_error,
    // Nunca devolvemos la api_key al cliente.
  });
}

/** Empuja una lista de workouts a intervals.icu */
async function pushWorkouts(conn, workouts, vdot) {
  const results = [];
  for (const w of workouts) {
    if (!w.scheduled_date) {
      results.push({ id: w.id, ok: false, error: "sin scheduled_date" });
      continue;
    }
    const event = buildIntervalsEvent(w, vdot);
    // upsertOnUid + external_id 'raf-<id>' evita duplicados al reenviar.
    const r = await icuFetch(
      conn,
      "/athlete/0/events?upsertOnUid=true",
      { method: "POST", body: event }
    );
    results.push({
      id: w.id,
      title: w.title,
      ok: r.ok,
      steps: r.data?.workout_doc?.steps?.length ?? 0,
      moving_time: r.data?.moving_time ?? null,
      error: r.ok ? null : (r.text || "").slice(0, 200),
    });
  }
  return results;
}

async function finishPush(athleteId, connId, results) {
  const failed = results.filter((r) => !r.ok);
  await sb(`device_connections?id=eq.${connId}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      last_push_at: new Date().toISOString(),
      last_error: failed.length ? failed[0].error : null,
      updated_at: new Date().toISOString(),
    },
  });
}

async function actionPushWorkout(res, athleteId, workoutId) {
  const conn = await getConnection(athleteId);
  if (!conn) return jsonError(res, 400, "El atleta no tiene intervals.icu conectado");

  const rows = await sb(`workouts?id=eq.${workoutId}&select=*`);
  const w = rows?.[0];
  if (!w) return jsonError(res, 404, "Workout no encontrado");
  if (String(w.athlete_id) !== String(athleteId)) {
    return jsonError(res, 403, "Ese workout no pertenece al atleta");
  }

  // Sin evaluacion no hay ritmos reales: mandar un VDOT inventado
  // al reloj de un atleta es peor que no mandar nada.
  const vdot = await getLatestVdot(athleteId);
  if (!vdot) {
    return jsonError(res, 400,
      "El atleta no tiene evaluación VDOT. Evalúalo antes de enviar entrenamientos al reloj.");
  }

  if (!isRunWorkout(w, vdot)) {
    return jsonError(res, 400,
      `"${w.title}" no es un entrenamiento de carrera (no tiene ritmos). No se envía al reloj.`);
  }

  // Empujar al pasado no sirve: intervals.icu solo envia al reloj
  // los planificados de hoy/manana. Un workout viejo se crea en el
  // calendario pero nunca llega al dispositivo.
  const hoy = new Date().toISOString().slice(0, 10);
  if (w.scheduled_date < hoy) {
    return jsonError(res, 400,
      `"${w.title}" está programado para ${w.scheduled_date}, en el pasado. No se envía al reloj.`);
  }

  const results = await pushWorkouts(conn, [w], vdot);
  await finishPush(athleteId, conn.id, results);

  const r = results[0];
  if (!r.ok) return jsonError(res, 502, `intervals.icu rechazó el envío: ${r.error}`);
  return res.status(200).json({ ok: true, vdot_used: vdot, result: r });
}

async function actionPushRange(res, athleteId, from, to) {
  if (!from || !to) return jsonError(res, 400, "Faltan 'from' y 'to' (YYYY-MM-DD)");

  const conn = await getConnection(athleteId);
  if (!conn) return jsonError(res, 400, "El atleta no tiene intervals.icu conectado");

  const workouts = await sb(
    `workouts?athlete_id=eq.${athleteId}` +
    `&scheduled_date=gte.${from}&scheduled_date=lte.${to}` +
    `&select=*&order=scheduled_date.asc`
  );
  if (!workouts?.length) {
    return res.status(200).json({ ok: true, pushed: 0, results: [] });
  }

  // Sin evaluacion no hay ritmos reales: mandar un VDOT inventado
  // al reloj de un atleta es peor que no mandar nada.
  const vdot = await getLatestVdot(athleteId);
  if (!vdot) {
    return jsonError(res, 400,
      "El atleta no tiene evaluación VDOT. Evalúalo antes de enviar entrenamientos al reloj.");
  }

  // Omitir sesiones que no son de carrera (gimnasio, fuerza, etc.) y
  // las que estan en el pasado: no tienen ritmos o nunca llegan al reloj.
  const hoy = new Date().toISOString().slice(0, 10);
  const runnable = workouts.filter(
    (w) => isRunWorkout(w, vdot) && w.scheduled_date >= hoy
  );
  const skipped = workouts.length - runnable.length;

  const results = await pushWorkouts(conn, runnable, vdot);
  await finishPush(athleteId, conn.id, results);

  return res.status(200).json({
    ok: true,
    vdot_used: vdot,
    pushed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped,
    results,
  });
}

// Logica PURA del pull: no depende de res, devuelve un objeto con el resultado.
// La usan tanto la ruta HTTP (actionPullActivity) como el webhook.
async function pullActivityCore(athleteId, workoutId) {
  const conn = await getConnection(athleteId);
  if (!conn) return { ok: false, reason: "sin conexion" };

  const rows = await sb(`workouts?id=eq.${workoutId}&select=*`);
  const w = rows?.[0];
  if (!w || String(w.athlete_id) !== String(athleteId)) {
    return { ok: false, reason: "workout no valido" };
  }
  if (!w.scheduled_date) return { ok: false, reason: "sin fecha" };

  // Trae actividades del dia del workout (intervals usa oldest/newest por fecha).
  const day = w.scheduled_date;
  const r = await icuFetch(conn, `/athlete/0/activities?oldest=${day}&newest=${day}`);
  if (!r.ok) return { ok: false, reason: `icu ${r.status}` };

  const activities = Array.isArray(r.data) ? r.data : [];
  if (!activities.length) return { ok: true, found: false };

  const best = pickBestActivity(activities);
  if (!best) return { ok: true, found: false };

  const patch = mapActivityToActual(best);
  await sb(`workouts?id=eq.${workoutId}`, {
    method: "PATCH", body: patch, prefer: "return=minimal",
  });

  return { ok: true, found: true, activity_name: best.name, actual: patch };
}

// Ruta HTTP: envuelve pullActivityCore y traduce el resultado a res.
async function actionPullActivity(res, athleteId, workoutId) {
  const result = await pullActivityCore(athleteId, workoutId);
  if (!result.ok) return jsonError(res, 400, result.reason);
  return res.status(200).json(result);
}

// Fecha (YYYY-MM-DD) en que ocurrio la actividad de intervals.icu.
function activityDate(act) {
  const s = act?.start_date_local || act?.start_date || null;
  return s ? String(s).slice(0, 10) : null;
}

// Flujo AUTOMATICO del webhook: trae la actividad reciente del atleta, la valida,
// la empareja con el workout PLANEADO y PENDIENTE del dia y lo marca hecho con
// los actual_*. Devuelve un objeto describiendo el resultado (para logs). No usa
// res; el caller responde 200 igualmente.
//
// Requiere la conexion COMPLETA (con access_token/api_key) para icuFetch.
async function autoCompleteFromWebhook(conn) {
  const athleteId = conn.athlete_id;
  const hoy   = new Date().toISOString().slice(0, 10);
  const ayer  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Paso 1: traer actividades del rango [ayer, hoy] y tomar la mas reciente.
  const r = await icuFetch(conn, `/athlete/0/activities?oldest=${ayer}&newest=${hoy}`);
  if (!r.ok) return { ok: false, reason: `icu ${r.status}` };
  const activities = Array.isArray(r.data) ? r.data : [];
  if (!activities.length) return { ok: true, reason: "sin actividades" };

  const act = activities.reduce((best, a) => {
    const ka = String(a.start_date_local || a.start_date || "");
    const kb = String(best.start_date_local || best.start_date || "");
    return ka > kb ? a : best;
  }, activities[0]);

  // Paso 2: guard de validez. Descarta pruebas cortas (evita el falso
  // positivo de los 47s que contaminaba los actual_* / marcaba hecho).
  const movS  = Number(act.moving_time ?? act.elapsed_time ?? 0);
  const distM = Number(act.distance ?? act.icu_distance ?? 0);
  if (movS < 300 || distM < 500) {
    return { ok: true, discarded: true, activity_id: act.id ?? null,
      reason: `muy corta (${movS}s / ${Math.round(distM)}m)` };
  }

  // Paso 3: emparejar por FECHA de la actividad y solo si esta PENDIENTE
  // (done=false). Esto da idempotencia: si el webhook llega dos veces, la
  // segunda ya no encuentra pendiente y no re-marca.
  const fecha = activityDate(act) || hoy;
  const ws = await sb(
    `workouts?athlete_id=eq.${athleteId}&scheduled_date=eq.${fecha}` +
    `&done=is.false&select=id&order=id.asc&limit=1`
  );
  const w = ws?.[0];
  if (!w) return { ok: true, activity_id: act.id ?? null,
    reason: `sin workout planeado pendiente para ${fecha}` };

  // Paso 4: marcar hecho + llenar actual_* (mismos campos que el flujo manual).
  const patch = {
    ...mapActivityToActual(act),
    done: true,
    completed_at: new Date().toISOString(),
  };
  await sb(`workouts?id=eq.${w.id}`, {
    method: "PATCH", body: patch, prefer: "return=minimal",
  });

  return { ok: true, marked: true, workout_id: w.id, activity_id: act.id ?? null, fecha };
}

// Trae los intervalos/laps crudos de una actividad para la comparacion por
// bloque del coach (plan vs ejecutado). No escribe nada; solo lee.
async function actionActivityIntervals(res, athleteId, activityId) {
  if (!activityId) return jsonError(res, 400, "Falta 'activity_id'");

  const conn = await getConnection(athleteId);
  if (!conn) return jsonError(res, 400, "El atleta no tiene intervals.icu conectado");

  const r = await icuFetch(conn, `/activity/${activityId}/intervals`);
  if (!r.ok) {
    return jsonError(res, 502, `intervals.icu no respondio (${r.status})`);
  }

  const raw = Array.isArray(r.data?.icu_intervals) ? r.data.icu_intervals : [];
  const laps = raw.map((it) => ({
    moving_time: it.moving_time,
    distance: it.distance,
    average_speed: it.average_speed,
    average_heartrate: it.average_heartrate,
  }));

  return res.status(200).json({ ok: true, count: laps.length, icu_intervals: laps });
}

/* ---------- OAuth: autorizacion + callback ---------- */

// El frontend llama a esto con JWT; devolvemos la URL a la que
// hay que redirigir al atleta.
async function actionOauthStart(res, athleteId, userId) {
  if (!ICU_CLIENT_ID) return jsonError(res, 500, "Falta INTERVALS_CLIENT_ID");

  const state = crypto.randomBytes(32).toString("hex");

  await sb("oauth_states", {
    method: "POST",
    prefer: "return=minimal",
    body: { state, athlete_id: athleteId, user_id: userId },
  });

  const url = new URL(ICU_OAUTH_AUTH);
  url.searchParams.set("client_id", ICU_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ICU_SCOPES);
  url.searchParams.set("state", state);

  return res.status(200).json({ ok: true, authorize_url: url.toString() });
}

// Callback: SIN JWT, verificado por 'state' anti-CSRF.
function redirectToApp(res, params) {
  const url = new URL(`${APP_URL}/`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.writeHead(302, { Location: url.toString() });
  return res.end();
}

async function handleOauthCallback(req, res) {
  const { code, state, error } = req.query || {};

  // El atleta cancelo en intervals.icu
  if (error) return redirectToApp(res, { intervals: "cancelled" });
  if (!code || !state) return redirectToApp(res, { intervals: "error" });

  // 1) Validar el state (anti-CSRF) y que no haya expirado
  const rows = await sb(
    `oauth_states?state=eq.${encodeURIComponent(state)}&select=*`
  );
  const st = rows?.[0];
  if (!st) return redirectToApp(res, { intervals: "invalid_state" });

  // Consumir el state siempre (un solo uso)
  await sb(`oauth_states?state=eq.${encodeURIComponent(state)}`, {
    method: "DELETE", prefer: "return=minimal",
  });

  if (new Date(st.expires_at) < new Date()) {
    return redirectToApp(res, { intervals: "expired" });
  }

  // 2) Canjear el code por tokens (form-encoded, sin redirect_uri)
  let tok;
  try {
    const form = new URLSearchParams();
    form.set("client_id", ICU_CLIENT_ID);
    form.set("client_secret", ICU_CLIENT_SECRET);
    form.set("code", code);

    const r = await fetch(ICU_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    tok = await r.json();
    if (!r.ok || !tok.access_token) {
      console.error("[oauth] token exchange fallo:", r.status, JSON.stringify(tok));
      return redirectToApp(res, { intervals: "token_error" });
    }
  } catch (e) {
    console.error("[oauth] token exchange error:", e.message);
    return redirectToApp(res, { intervals: "token_error" });
  }

  // 3) La respuesta trae el athlete directamente: { token_type, access_token, scope, athlete: { id, name } }
  const providerAthleteId = tok.athlete?.id || null;

  // 4) Guardar la conexion (upsert por athlete_id + provider).
  // intervals.icu no emite refresh tokens ni expiracion (confirmado por David).
  const payload = {
    athlete_id: st.athlete_id,
    provider: "intervals_icu",
    auth_type: "oauth",
    access_token: tok.access_token,
    refresh_token: null,
    expires_at: null,
    scope: tok.scope || ICU_SCOPES,
    provider_athlete_id: providerAthleteId,
    api_key: null,              // en OAuth no hay api_key
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  const existing = await getConnection(st.athlete_id);
  if (existing) {
    await sb(`device_connections?id=eq.${existing.id}`, {
      method: "PATCH", body: payload, prefer: "return=minimal",
    });
  } else {
    await sb("device_connections", {
      method: "POST", body: payload, prefer: "return=minimal",
    });
  }

  // Limpieza oportunista de states caducados
  try {
    await sb(`oauth_states?expires_at=lt.${new Date().toISOString()}`, {
      method: "DELETE", prefer: "return=minimal",
    });
  } catch { /* no critico */ }

  return redirectToApp(res, { intervals: "connected" });
}

/* ---------- Webhook intervals.icu (fase 4: logica) ---------- */
async function handleIcuWebhook(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

  console.log("[icu-webhook] recibido:", JSON.stringify(body?.events?.map(e => ({ type: e.type, athlete_id: e.athlete_id }))));

  // 1) Verificar el secret (viene en el body, no en headers)
  if (!ICU_WEBHOOK_SECRET || body.secret !== ICU_WEBHOOK_SECRET) {
    console.warn("[icu-webhook] secret invalido");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  console.log("[icu-webhook] secret OK, eventos:", events.length);

  // 2) Responder 200 YA: intervals.icu reintenta si tardamos o fallamos.
  //    El procesamiento va despues, sin bloquear la respuesta.
  res.status(200).json({ ok: true, received: events.length });

  // 3) Procesar los eventos de actividad
  for (const ev of events) {
    // ACTIVITY_UPLOADED llega enseguida pero a veces sin datos procesados;
    // ACTIVITY_ANALYZED llega ~60s despues con los datos completos. Aceptamos
    // ambos para que el pull no falle por llegar demasiado pronto.
    if (ev.type !== "ACTIVITY_UPLOADED" && ev.type !== "ACTIVITY_ANALYZED") continue;   // TEST y otros: ignorar
    console.log("[icu-webhook] procesando", ev.type, "athlete", ev.athlete_id);
    try {
      // El evento NO trae activity_id, solo el atleta. Buscamos su conexion
      // COMPLETA por provider_athlete_id (necesitamos el token para icuFetch).
      const rows = await sb(
        `device_connections?provider_athlete_id=eq.${encodeURIComponent(ev.athlete_id)}` +
        `&provider=eq.intervals_icu&select=*`
      );
      const conn = rows?.[0];
      if (!conn) {
        console.warn("[icu-webhook] sin conexion para", ev.athlete_id);
        continue;
      }
      console.log("[icu-webhook] conexion athlete_id", conn.athlete_id);

      // Trae la actividad reciente, valida, empareja y marca hecho.
      const pr = await autoCompleteFromWebhook(conn);
      console.log("[icu-webhook] resultado:", JSON.stringify(pr));
      if (pr.marked) {
        console.log(`[icu-webhook] workout ${pr.workout_id} marcado hecho athlete ${conn.athlete_id}`);
      }
    } catch (e) {
      console.error("[icu-webhook] error evento:", e.message);
    }
  }
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonError(res, 500, "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  const qAction = req.query?.action;

  // Ruta SIN JWT: viene de intervals.icu redirigiendo al navegador.
  // Se asegura con el 'state' anti-CSRF, no con sesion.
  if (qAction === "oauth-callback") {
    return handleOauthCallback(req, res);
  }

  // Webhook de intervals.icu (servidores de David, sin sesion).
  // TEMPORAL: aun NO verifica el secret; solo descubrimos el payload.
  if (qAction === "icu-webhook") {
    return handleIcuWebhook(req, res);
  }

  // A partir de aqui, todo exige POST + JWT (como hoy)
  if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");

  // 1) Identidad verificada (JWT de Supabase)
  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const { action, athlete_id } = body;

  if (!action) return jsonError(res, 400, "Falta 'action'");
  if (!athlete_id) return jsonError(res, 400, "Falta 'athlete_id'");

  // 2) Autorizacion: el atleta o su coach/staff. Evita IDOR.
  const allowed = await canAccessAthlete(user.id, athlete_id);
  if (!allowed) return jsonError(res, 403, "Sin acceso a ese atleta");

  try {
    switch (action) {
      case "connect":       return await actionConnect(res, athlete_id, body.api_key);
      case "disconnect":    return await actionDisconnect(res, athlete_id);
      case "status":        return await actionStatus(res, athlete_id);
      case "push-workout":  return await actionPushWorkout(res, athlete_id, body.workout_id);
      case "push-range":    return await actionPushRange(res, athlete_id, body.from, body.to);
      case "pull-activity": return await actionPullActivity(res, athlete_id, body.workout_id);
      case "activity-intervals": return await actionActivityIntervals(res, athlete_id, body.activity_id);
      case "oauth-start":   return await actionOauthStart(res, athlete_id, user.id);
      default:              return jsonError(res, 400, `Acción no soportada: ${action}`);
    }
  } catch (err) {
    console.error("[integrations]", err);
    return jsonError(res, 500, err.message || "Error interno");
  }
}
