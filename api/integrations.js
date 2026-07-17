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
 *
 * SEGURIDAD: todas exigen JWT de Supabase (Authorization: Bearer <token>)
 * y validan que el usuario sea el atleta o su coach. Sin esto, cualquiera
 * podria leerse las API keys de todos los atletas pasando otro athlete_id.
 * -----------------------------------------------------------
 */

import { requireUser, canAccessAthlete, jsonError } from "../lib/apiAuth.js";
import { buildIntervalsEvent, isRunWorkout } from "../src/lib/intervals.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ICU_BASE     = "https://intervals.icu/api/v1";

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
// Auth basica: usuario literal "API_KEY", password = la key del atleta.
function icuAuth(apiKey) {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
}

// athlete id "0" = auto-resolver desde la API key (validado en pruebas).
async function icuFetch(apiKey, path, { method = "GET", body } = {}) {
  const r = await fetch(`${ICU_BASE}${path}`, {
    method,
    headers: {
      Authorization: icuAuth(apiKey),
      "Content-Type": "application/json",
    },
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

/* ---------- Acciones ---------- */

async function actionConnect(res, athleteId, apiKey) {
  if (!apiKey || String(apiKey).trim().length < 8) {
    return jsonError(res, 400, "API key invalida");
  }
  const key = String(apiKey).trim();

  // Validar la key contra intervals.icu antes de guardarla.
  const probe = await icuFetch(key, "/athlete/0/profile");
  if (probe.status === 401 || probe.status === 403) {
    return jsonError(res, 401, "La API key no es valida en intervals.icu");
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
      conn.api_key,
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
      "El atleta no tiene evaluacion VDOT. Evaluelo antes de enviar entrenamientos al reloj.");
  }

  if (!isRunWorkout(w, vdot)) {
    return jsonError(res, 400,
      `"${w.title}" no es un entrenamiento de carrera (no tiene ritmos). No se envia al reloj.`);
  }

  const results = await pushWorkouts(conn, [w], vdot);
  await finishPush(athleteId, conn.id, results);

  const r = results[0];
  if (!r.ok) return jsonError(res, 502, `intervals.icu rechazo el envio: ${r.error}`);
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
      "El atleta no tiene evaluacion VDOT. Evaluelo antes de enviar entrenamientos al reloj.");
  }

  // Omitir sesiones que no son de carrera (gimnasio, fuerza, etc.):
  // no tienen ritmos y no deben ir al reloj.
  const runnable = workouts.filter((w) => isRunWorkout(w, vdot));
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

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonError(res, 500, "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

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
      case "connect":      return await actionConnect(res, athlete_id, body.api_key);
      case "disconnect":   return await actionDisconnect(res, athlete_id);
      case "status":       return await actionStatus(res, athlete_id);
      case "push-workout": return await actionPushWorkout(res, athlete_id, body.workout_id);
      case "push-range":   return await actionPushRange(res, athlete_id, body.from, body.to);
      default:             return jsonError(res, 400, `Accion no soportada: ${action}`);
    }
  } catch (err) {
    console.error("[integrations]", err);
    return jsonError(res, 500, err.message || "Error interno");
  }
}
