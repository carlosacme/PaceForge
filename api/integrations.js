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
 *   push-range     { athlete_id, from?, to? }  empuja workouts pendientes
 *                  (rango por defecto: hoy -> workout mas lejano, tope 90d)
 *   delete-workout { athlete_id, workout_id | workout_ids[] }
 *                  borra en intervals.icu los eventos de esos workouts
 *   pull-activity  { athlete_id, workout_id } trae lo ejecutado del reloj
 *   activity-intervals { athlete_id, activity_id } laps crudos (comparacion por bloque)
 *   activity-map { athlete_id, workout_id } coords GPS bajo demanda (no se guardan)
 *   vdot-resync    { athlete_id }            reescribe los ritmos de los workouts
 *                  futuros al VDOT de la ultima evaluacion y los reenvia al reloj
 *   oauth-start    { athlete_id }            inicia OAuth (JWT); devuelve authorize_url
 *   oauth-callback (GET ?action=oauth-callback&code&state)  SIN JWT; verificado por state
 *   icu-webhook    (POST ?action=icu-webhook) SIN JWT; verificado por 'secret'
 *                  avisos de intervals.icu: marca hechos los workouts ejecutados
 *                  y resincroniza los futuros cuando cambian las zonas del atleta
 *
 * SEGURIDAD: casi todas exigen JWT de Supabase (Authorization: Bearer <token>)
 * y validan que el usuario sea el atleta o su coach. Dos excepciones, ambas
 * llamadas desde fuera y sin sesion posible:
 *   - oauth-callback: GET del navegador redirigido por intervals.icu; se asegura
 *     con el 'state' anti-CSRF guardado en oauth_states.
 *   - icu-webhook: POST de los servidores de intervals.icu; se asegura con el
 *     'secret' compartido que viaja en el body. Falla cerrado.
 * -----------------------------------------------------------
 */

import crypto from "crypto";
import { requireUser, canAccessAthlete, jsonError } from "../lib/apiAuth.js";
import {
  buildIntervalsEvent,
  buildIntervalsDeletePayload,
  intervalsExternalId,
  isRunWorkout,
} from "../src/lib/intervals.js";
import { rescaleStructureToVdot } from "../src/lib/enrichPace.js";
import { readStructure } from "../src/lib/workoutStructure.js";
import { resolveTargetVdotAfterTest } from "../src/lib/vdot.js";

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

// Secreto del webhook de intervals.icu. Llega en el body de cada entrega y se
// verifica en handleIcuWebhook: si esta variable falta, se rechaza todo (401).
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

/**
 * Empareja la respuesta del bulk con los eventos que se enviaron.
 *
 * intervals.icu devuelve la representacion completa de cada evento creado o
 * actualizado, asi que el emparejamiento va por `external_id` (raf-<workout.id>),
 * la unica correspondencia que tenemos con la tabla `workouts`. Si algun evento
 * viniera sin external_id se cae al orden del array, que respeta el del envio.
 *
 * @returns {Map<string, {ok: boolean, event: object|null, error: string|null}>}
 *          indexado por external_id del evento enviado
 */
function matchBulkResponse(events, r) {
  const out = new Map();

  // El lote entero fallo (401, 429, 5xx...): ningun evento se guardo.
  if (!r.ok) {
    const error = (r.text || `intervals.icu respondió ${r.status}`).slice(0, 200);
    for (const ev of events) out.set(ev.external_id, { ok: false, event: null, error });
    return out;
  }

  const list = Array.isArray(r.data) ? r.data : [];
  const byExternalId = new Map();
  for (const ev of list) {
    if (ev?.external_id) byExternalId.set(String(ev.external_id), ev);
  }
  const echoesExternalId = byExternalId.size > 0;

  events.forEach((sent, i) => {
    // Solo se recurre a la posicion si NINGUN evento trae external_id: con la
    // respuesta a medias, emparejar por indice mezclaria entrenos distintos.
    const got = echoesExternalId
      ? byExternalId.get(String(sent.external_id)) || null
      : (list.length === events.length ? list[i] : null);

    if (!got) {
      out.set(sent.external_id, {
        ok: false, event: null,
        error: `intervals.icu no devolvió el evento ${sent.external_id}`,
      });
      return;
    }
    // Si la respuesta trae detalle por evento, manda ese error.
    const perEvent = got.error || got.errors;
    if (perEvent) {
      out.set(sent.external_id, {
        ok: false, event: got,
        error: String(Array.isArray(perEvent) ? perEvent.join("; ") : perEvent).slice(0, 200),
      });
      return;
    }
    out.set(sent.external_id, { ok: true, event: got, error: null });
  });

  return out;
}

/**
 * Empuja una lista de workouts a intervals.icu en UNA sola llamada.
 *
 * events/bulk?upsert=true crea los que no existen y ACTUALIZA los que ya
 * estan, emparejando por external_id. Al resolverlo el servidor sobran las dos
 * cosas que hacia esto antes: la consulta previa del calendario para decidir
 * POST vs PUT, y una llamada por entreno. Un plan de dos semanas pasa de ~15
 * llamadas a 1, que es lo que pide David para no chocar con los rate limits.
 *
 * Contrapartida: la respuesta no dice si cada evento se creo o se actualizo,
 * asi que la accion reportada es "upserted" para todos.
 */
async function pushWorkouts(conn, workouts, vdot) {
  if (!workouts?.length) return [];

  // Sin fecha no hay sitio en el calendario: no ocupan hueco en el lote.
  const sendable = workouts.filter((w) => w.scheduled_date);
  const events = sendable.map((w) => buildIntervalsEvent(w, vdot));

  let byExternalId = new Map();
  if (events.length) {
    const r = await icuFetch(conn, "/athlete/0/events/bulk?upsert=true", {
      method: "POST",
      body: events,
    });
    byExternalId = matchBulkResponse(events, r);
    const ok = [...byExternalId.values()].filter((v) => v.ok).length;
    console.log(
      `[pushWorkouts] bulk upsert enviados=${events.length} ok=${ok} status=${r.status}`,
    );
  }

  return workouts.map((w) => {
    if (!w.scheduled_date) {
      return {
        id: w.id, title: w.title, ok: false, action: null,
        steps: 0, moving_time: null, error: "sin scheduled_date",
      };
    }
    const out = byExternalId.get(intervalsExternalId(w.id)) || {
      ok: false, event: null, error: "sin respuesta de intervals.icu",
    };
    return {
      id: w.id,
      title: w.title,
      ok: out.ok,
      action: "upserted",
      steps: out.event?.workout_doc?.steps?.length ?? 0,
      moving_time: out.event?.moving_time ?? null,
      error: out.error,
    };
  });
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
  const conn = await getConnection(athleteId);
  if (!conn) return jsonError(res, 400, "El atleta no tiene intervals.icu conectado");

  // Rango: hoy -> workout pendiente mas lejano del atleta (tope 90 dias).
  // from/to del cliente son opcionales y solo se usan como pista; nunca
  // acortamos por debajo del plan real (el bug de "solo 14 dias" venia del
  // boton del cliente hardcodeado a days=14).
  const hoy = new Date().toISOString().slice(0, 10);
  const farRows = await sb(
    `workouts?athlete_id=eq.${athleteId}&scheduled_date=gte.${hoy}` +
    `&select=scheduled_date&order=scheduled_date.desc&limit=1`,
  );
  const farthest = farRows?.[0]?.scheduled_date || hoy;
  const cap = (() => {
    const d = new Date(`${hoy}T12:00:00`);
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  })();
  const fromDate = hoy;
  let toDate = farthest > cap ? cap : farthest;
  // Si el cliente pide un "to" mas amplio (dentro del tope), lo respetamos.
  if (to && String(to) > toDate && String(to) <= cap) toDate = String(to);

  const workouts = await sb(
    `workouts?athlete_id=eq.${athleteId}` +
    `&scheduled_date=gte.${fromDate}&scheduled_date=lte.${toDate}` +
    `&select=*&order=scheduled_date.asc`,
  );
  if (!workouts?.length) {
    return res.status(200).json({
      ok: true, pushed: 0, upserted: 0, results: [],
      from: fromDate, to: toDate,
    });
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
  const runnable = workouts.filter(
    (w) => isRunWorkout(w, vdot) && w.scheduled_date >= hoy,
  );
  const skipped = workouts.length - runnable.length;

  const results = await pushWorkouts(conn, runnable, vdot);
  await finishPush(athleteId, conn.id, results);

  // Ya no se distingue creado de actualizado: el bulk con upsert=true lo
  // resuelve el servidor y no dice cual de las dos cosas hizo con cada evento.
  const pushed = results.filter((r) => r.ok).length;

  return res.status(200).json({
    ok: true,
    vdot_used: vdot,
    from: fromDate,
    to: toDate,
    pushed,
    upserted: pushed,
    failed: results.filter((r) => !r.ok).length,
    skipped,
    results,
  });
}

/**
 * Borra en intervals.icu los eventos de estos workouts.
 *
 * Se usa bulk-delete porque acepta `external_id`, y ese es el unico dato que
 * tenemos: el id numerico del evento nunca se guardo. Ademas resuelve el borrado
 * por rango en UNA llamada en vez de una por entreno.
 */
async function deleteWorkoutEvents(conn, workoutIds) {
  const payload = buildIntervalsDeletePayload(workoutIds);
  if (!payload.length) return { ok: true, requested: 0, deleted: 0, status: 200, error: null };
  const r = await icuFetch(conn, "/athlete/0/events/bulk-delete", {
    method: "PUT",
    body: payload,
  });
  // intervals.icu devuelve cuantos borro de verdad: los external_id que ya no
  // existian no cuentan, y eso no es un fallo (el evento ya no molestaba).
  const deleted = Number(r.data?.deleted);
  console.log(`[deleteWorkoutEvents] pedidos=${payload.length} borrados=${Number.isFinite(deleted) ? deleted : "?"} status=${r.status}`);
  return {
    ok: r.ok,
    requested: payload.length,
    deleted: Number.isFinite(deleted) ? deleted : null,
    status: r.status,
    error: r.ok ? null : (r.text || "").slice(0, 200),
  };
}

/**
 * Acepta un workout (workout_id) o varios (workout_ids), para que el borrado
 * individual y el borrado por rango usen la misma accion.
 *
 * NO comprueba que los workouts existan: cuando esto se llama, ya se borraron de
 * la tabla. Lo que autoriza es `canAccessAthlete`, en el handler.
 */
async function actionDeleteWorkoutEvents(res, athleteId, workoutIds) {
  const ids = (Array.isArray(workoutIds) ? workoutIds : [workoutIds])
    .filter((v) => v != null && String(v).trim() !== "");
  if (!ids.length) return jsonError(res, 400, "Falta workout_id o workout_ids");

  // Un atleta sin reloj conectado no es un error: no hay nada que borrar alla.
  // Devolver 400 llenaria de ruido rojo un borrado que fue perfecto. Con la
  // conexion caida tampoco se intenta: sin credenciales validas solo saldria un
  // 401 y un aviso inutil para el coach.
  const conn = await getConnection(athleteId);
  if (!conn || conn.status !== "active") {
    return res.status(200).json({ ok: true, requested: ids.length, skipped: "sin conexión activa a intervals.icu" });
  }

  const out = await deleteWorkoutEvents(conn, ids);
  if (!out.ok) return jsonError(res, 502, `intervals.icu rechazó el borrado: ${out.error}`);
  return res.status(200).json({ ok: true, requested: out.requested, deleted: out.deleted });
}

// Logica PURA del pull: no depende de res, devuelve un objeto con el resultado.
// La usa la ruta HTTP (actionPullActivity), que la pide para UN workout concreto.
// El webhook NO pasa por aqui: tiene su propio flujo (autoCompleteFromWebhook).
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
// start_date_local ya viene en la hora local del atleta, asi que basta cortar.
function activityDate(act) {
  const s = act?.start_date_local || act?.start_date || null;
  return s ? String(s).slice(0, 10) : null;
}

// Fecha YYYY-MM-DD en la zona del atleta (UTC-5). Los scheduled_date del plan
// estan en local; si usaramos toISOString() (UTC) de noche se correria el dia.
function localDateStr(offsetHours = -5, base = Date.now()) {
  return new Date(base + offsetHours * 3600000).toISOString().slice(0, 10);
}

// Tiempo en movimiento (segundos) y distancia (metros) en CRUDO de una actividad.
function activityRaw(act) {
  return {
    movS:  Number(act?.moving_time ?? act?.elapsed_time ?? 0) || 0,
    distM: Number(act?.distance ?? act?.icu_distance ?? 0) || 0,
  };
}

/**
 * La actividad que viene DENTRO del evento del webhook.
 *
 * Los webhooks ACTIVITY_UPLOADED y ACTIVITY_ANALYZED incluyen el objeto
 * `activity` completo (documentado en el cookbook de intervals.icu), con los
 * mismos campos que devuelve la lista de actividades. Se exige `id` porque sin
 * el no hay candado de idempotencia: en ese caso es mejor ir a preguntar.
 */
function webhookActivity(ev) {
  const act = ev?.activity;
  return act && typeof act === "object" && act.id != null ? act : null;
}

/**
 * Un mismo webhook puede traer VARIOS eventos de la misma actividad:
 * ACTIVITY_ANALYZED se envia con 60s de retraso justamente para consolidar en
 * una entrega lo que ya se aviso con ACTIVITY_UPLOADED. Procesar los dos
 * repetia la pasada completa; la idempotencia evitaba marcar el workout dos
 * veces, pero las llamadas ya se habian gastado.
 *
 * Clave de deduplicacion: el id de la actividad. Cuando el evento no la trae,
 * la clave es el atleta, porque entonces el procesamiento es "la mas reciente
 * del rango" y dos eventos del mismo atleta hacen exactamente el mismo trabajo.
 * NO se deduplica por atleta si hay actividad: dos actividades distintas del
 * mismo atleta son dos entrenos distintos que marcar.
 *
 * Gana ACTIVITY_ANALYZED, que llega con los datos ya calculados.
 */
function dedupeActivityEvents(events) {
  const byKey = new Map();
  for (const ev of events) {
    if (ev?.type !== "ACTIVITY_UPLOADED" && ev?.type !== "ACTIVITY_ANALYZED") continue;
    const act = webhookActivity(ev);
    const key = act ? `activity:${act.id}` : `athlete:${ev.athlete_id}`;
    const prev = byKey.get(key);
    if (!prev || (ev.type === "ACTIVITY_ANALYZED" && prev.type !== "ACTIVITY_ANALYZED")) {
      byKey.set(key, ev);
    }
  }
  return [...byKey.values()];
}

/**
 * Un cambio de ajustes puede llegar repetido en la misma entrega: el atleta
 * toca las zonas de varios deportes de una vez y sale un aviso por cada uno.
 * Todos provocarian exactamente el mismo reenvio, asi que se queda uno por
 * atleta.
 */
function dedupeSettingsEvents(events) {
  const byAthlete = new Map();
  for (const ev of events) {
    if (ev?.type !== "SPORT_SETTINGS_UPDATED") continue;
    const key = `athlete:${ev.athlete_id}`;
    if (!byAthlete.has(key)) byAthlete.set(key, ev);
  }
  return [...byAthlete.values()];
}

// Flujo AUTOMATICO del webhook: valida la actividad ejecutada, la empareja con
// el workout PLANEADO y PENDIENTE del dia y lo marca hecho con los actual_*.
// Devuelve un objeto describiendo el resultado (para logs). No usa res; el
// caller responde 200 igualmente.
//
// `activity` es la del payload del webhook. Si no llega (o llega en esqueleto),
// se consulta a intervals.icu, y para eso hace falta la conexion COMPLETA
// (access_token/api_key). `source` en el resultado dice cual de las dos fue.
async function autoCompleteFromWebhook(conn, activity = null) {
  const athleteId = conn.athlete_id;
  // Fechas en la zona del atleta (UTC-5), no en UTC.
  const hoy  = localDateStr(-5);
  const ayer = localDateStr(-5, Date.now() - 86400000);

  // Paso 1: la actividad. El webhook ya la trae, asi que lo normal es no
  // preguntar nada. El GET queda como FALLBACK en dos casos: eventos sin
  // `activity`, y actividades que llegan en esqueleto. ACTIVITY_UPLOADED puede
  // avisar antes de que intervals.icu procese el fichero, sin distancia ni
  // tiempo todavia; confiar en ese esqueleto lo descartaria como "muy corta".
  const enPayload = activityRaw(activity);
  let act = activity && (enPayload.movS > 0 || enPayload.distM > 0) ? activity : null;
  const source = act ? "payload" : "fetch";
  if (!act) {
    // athlete id explicito (i473586) en vez de "0": el token es per-atleta y "0"
    // ya resuelve al dueno, pero el id evita ambiguedad si el scope fuera amplio.
    const icuAth = conn.provider_athlete_id || "0";
    const r = await icuFetch(conn, `/athlete/${icuAth}/activities?oldest=${ayer}&newest=${hoy}`);
    if (!r.ok) return { ok: false, reason: `icu ${r.status}` };
    const activities = Array.isArray(r.data) ? r.data : [];
    if (!activities.length) return { ok: true, reason: "sin actividades" };

    // Sin la actividad en el payload solo queda adivinar: la mas reciente del
    // rango. De ahi que sea preferible la del evento, que no se equivoca cuando
    // el atleta sube dos seguidas. Guard + idempotencia + fecha acotan el error.
    act = activities.reduce((best, a) => {
      const ka = String(a.start_date_local || a.start_date || "");
      const kb = String(best.start_date_local || best.start_date || "");
      return ka > kb ? a : best;
    }, activities[0]);
  }

  // Paso 2 (candado 1): guard de validez sobre CRUDOS (metros/segundos), antes
  // de mapear. Descarta pruebas cortas (el falso positivo de los 47s).
  const { movS, distM } = activityRaw(act);
  if (movS < 300 || distM < 500) {
    return { ok: true, source, discarded: true, activity_id: act.id ?? null,
      reason: `muy corta (${movS}s / ${Math.round(distM)}m)` };
  }

  // Candado 2a: idempotencia por actividad. Si CUALQUIER workout ya tiene este
  // intervals_activity_id, la actividad ya se proceso. Esto cierra el caso de
  // reintento con dos workouts pendientes el mismo dia (evita marcar dos).
  if (act.id != null) {
    const dup = await sb(
      `workouts?intervals_activity_id=eq.${encodeURIComponent(act.id)}&select=id&limit=1`
    );
    if (dup?.[0]) {
      return { ok: true, source, activity_id: act.id, workout_id: dup[0].id, reason: "ya procesada" };
    }
  }

  // Paso 3 (candado 2b): emparejar por FECHA de la actividad y solo si esta
  // PENDIENTE (done=false). No confiar en el nombre, solo la fecha.
  const fecha = activityDate(act) || hoy;
  const ws = await sb(
    `workouts?athlete_id=eq.${athleteId}&scheduled_date=eq.${fecha}` +
    `&done=is.false&select=id&order=id.asc&limit=1`
  );
  const w = ws?.[0];
  if (!w) return { ok: true, source, activity_id: act.id ?? null,
    reason: `sin workout planeado pendiente para ${fecha}` };

  // Paso 4: marcar hecho + llenar actual_* (mapActivityToActual ya incluye
  // intervals_activity_id, que persistimos para el candado de idempotencia).
  const patch = {
    ...mapActivityToActual(act),
    done: true,
    completed_at: new Date().toISOString(),
  };
  await sb(`workouts?id=eq.${w.id}`, {
    method: "PATCH", body: patch, prefer: "return=minimal",
  });

  // Aviso al coach (best effort; dedupe vía coach_completion_notified_at).
  try {
    const { notifyCoachWorkoutCompleted } = await import("../lib/notifyCoachWorkoutCompleted.js");
    await notifyCoachWorkoutCompleted({ workoutId: w.id });
  } catch (e) {
    console.warn("[webhook] notify coach workout completed:", e?.message || e);
  }

  return { ok: true, source, marked: true, workout_id: w.id, activity_id: act.id ?? null, fecha };
}

// Ventana de reenvio cuando cambian las zonas del atleta. Un plan puede ocupar
// meses, y reenviarlo entero en cada cambio gastaria rate limit en entrenos que
// aun pueden cambiar de sitio o desaparecer. Cuatro semanas cubre lo que el
// atleta va a correr de verdad antes del siguiente ajuste.
const RESYNC_WINDOW_DAYS = 28;

/**
 * Reenvia los workouts futuros pendientes del atleta para que sus ritmos se
 * recalculen con el VDOT actual.
 *
 * Se dispara con SPORT_SETTINGS_UPDATED: si el atleta cambia su umbral o sus
 * zonas en intervals.icu, todo lo que ya le enviamos quedo con ritmos calculados
 * sobre los valores viejos.
 *
 * No duplica nada porque pushWorkouts va por events/bulk?upsert=true: empareja
 * por external_id (raf-<id>) y ACTUALIZA el evento en su sitio.
 *
 * OJO: los ritmos se regeneran desde NUESTRO VDOT, no desde las zonas nuevas de
 * intervals.icu. Lo que arregla esto es que el reloj vuelva a tener los ritmos
 * que el coach planifico, no adoptar el criterio del atleta.
 */
async function resyncFutureWorkouts(conn) {
  const athleteId = conn.athlete_id;
  const hoy = localDateStr(-5);
  const hasta = localDateStr(-5, Date.now() + RESYNC_WINDOW_DAYS * 86400000);

  // Sin evaluacion no hay ritmos que recalcular, y mandar un VDOT inventado al
  // reloj es peor que no mandar nada (mismo criterio que el envio manual).
  const vdot = await getLatestVdot(athleteId);
  if (!vdot) return { ok: true, resynced: 0, reason: "el atleta no tiene VDOT" };

  const rows = await sb(
    `workouts?athlete_id=eq.${athleteId}` +
    `&scheduled_date=gte.${hoy}&scheduled_date=lte.${hasta}` +
    // not.is.true y no is.false: si `done` viniera en NULL, ese entreno tampoco
    // esta hecho y dejarlo fuera seria dejarlo con los ritmos viejos.
    `&done=not.is.true&select=*&order=scheduled_date.asc`
  );
  // Lo que no es de carrera (gimnasio, fuerza) no lleva ritmos que recalcular.
  const runnable = (rows || []).filter((w) => isRunWorkout(w, vdot));
  if (!runnable.length) {
    return { ok: true, resynced: 0, reason: "sin workouts futuros pendientes en la ventana" };
  }

  const results = await pushWorkouts(conn, runnable, vdot);
  const resynced = results.filter((r) => r.ok).length;
  try {
    await finishPush(athleteId, conn.id, results);
  } catch (e) {
    // El sello en device_connections es informativo: no vale perder por el el
    // resultado de un reenvio que si ocurrio.
    console.warn("[icu-webhook] no se pudo sellar last_push_at:", e.message);
  }
  return {
    ok: true,
    resynced,
    failed: results.length - resynced,
    vdot_used: vdot,
    window: `${hoy}..${hasta}`,
  };
}

/* ---------- Recalculo de ritmos tras una evaluacion nueva ---------- */

// Ventana maxima del recalculo. Mas alla de 6 semanas el plan se reescribe
// igual, asi que los ritmos de dentro de tres meses no son un problema de hoy.
const VDOT_RESYNC_WINDOW_DAYS = 42;

// Un workout de prueba cierra la ventana: lo que venga despues se planificara
// con el VDOT que mida ESE test, no con el de ahora.
// "marat[oó]n" ya cubre "MEDIA MARATON", que lo contiene.
const TEST_WORKOUT_RE = /(test|marat[oó]n)/i;

/**
 * Reescribe los ritmos de los workouts futuros del atleta al VDOT de su ultima
 * evaluacion y los reenvia al reloj.
 *
 * Los ritmos se guardan absolutos ("4:23-4:31"), y un ritmo absoluto es opaco:
 * para llevarlo al VDOT nuevo hay que deducir primero su zona Daniels, y eso
 * solo sale bien sabiendo con que VDOT se escribio. De ahi la columna
 * generated_with_vdot. Cuando falta, la fila se SALTA a proposito: con el origen
 * equivocado el mapeo se desplaza de zona entera y en silencio (a VDOT 42.5 la
 * zona R son 4:03, que en un plan escrito a 47.2 es la zona I), y un workout con
 * los ritmos viejos es mucho menos dano que uno con los ritmos de otra zona.
 *
 * Idempotente: cada fila recalculada guarda el target como nuevo origen, asi que
 * repetir la operacion no vuelve a desplazar nada.
 */
async function resyncPacesAfterEvaluation(athleteId) {
  // Toda la serie de tests: hace falta el primero (tope), el anterior (guardas)
  // y el ultimo (lo medido). Orden unificado con el resto de la app: manda la
  // fecha real del test y created_at solo desempata entre tests del mismo dia.
  const evals = await sb(
    `athlete_evaluations?athlete_id=eq.${athleteId}&select=vdot,test_date,created_at` +
    `&order=test_date.asc,created_at.asc`
  );
  const vdots = (evals || [])
    .map((e) => Number(e.vdot))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!vdots.length) {
    return { ok: true, recalculated: 0, reason: "el atleta no tiene evaluaciones con VDOT" };
  }

  const measured = vdots[vdots.length - 1];
  const previous = vdots.length > 1 ? vdots[vdots.length - 2] : null;
  const first = vdots[0];
  const { target, delta, reason } = resolveTargetVdotAfterTest({ measured, previous, first });

  const hoy   = localDateStr(-5);
  const limite = localDateStr(-5, Date.now() + VDOT_RESYNC_WINDOW_DAYS * 86400000);
  const rows = await sb(
    `workouts?athlete_id=eq.${athleteId}` +
    `&scheduled_date=gte.${hoy}&scheduled_date=lte.${limite}` +
    // not.is.true y no is.false: un `done` en NULL tampoco esta hecho.
    `&done=not.is.true&select=*&order=scheduled_date.asc`
  );

  // El corte es el proximo test ESTRICTAMENTE futuro. Si el test que se acaba de
  // hacer sigue en el calendario sin marcar, cortar en el dejaria la ventana en
  // un solo dia y el recalculo no tocaria nada.
  const nextTest = (rows || []).find(
    (w) => w.scheduled_date > hoy && TEST_WORKOUT_RE.test(String(w.title || ""))
  );
  // El propio test entra en la ventana: su ritmo objetivo tambien sale del VDOT.
  const hasta = nextTest?.scheduled_date || limite;
  const enVentana = (rows || []).filter((w) => w.scheduled_date <= hasta);

  const actualizados = [];
  let sinOrigen = 0;
  let sinCambio = 0;

  for (const w of enVentana) {
    const origen = Number(w.generated_with_vdot);
    if (!Number.isFinite(origen) || origen <= 0) { sinOrigen += 1; continue; }

    const antes = readStructure(w);
    if (!antes.length) { sinCambio += 1; continue; }

    const despues = rescaleStructureToVdot(antes, target, origen);
    if (JSON.stringify(antes) === JSON.stringify(despues)) { sinCambio += 1; continue; }

    await sb(`workouts?id=eq.${w.id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { structure: despues, generated_with_vdot: target },
    });
    actualizados.push({ ...w, structure: despues, generated_with_vdot: target });
  }

  // Reenvio al reloj: bulk con upsert por external_id, actualiza en su sitio.
  let pushed = 0;
  let pushFailed = 0;
  let pushSkipped = null;
  if (!actualizados.length) {
    pushSkipped = "sin workouts recalculados";
  } else {
    // Desconectar BORRA la fila, asi que "existe conexion" ya significa activa.
    const conn = await getConnection(athleteId);
    if (!conn) {
      pushSkipped = "el atleta no tiene intervals.icu conectado";
    } else {
      // Lo que no es de carrera (fuerza, gimnasio) no lleva ritmos al reloj.
      const runnable = actualizados.filter((w) => isRunWorkout(w, target));
      if (!runnable.length) {
        pushSkipped = "nada de carrera que enviar";
      } else {
        const results = await pushWorkouts(conn, runnable, target);
        pushed = results.filter((r) => r.ok).length;
        pushFailed = results.length - pushed;
        try {
          await finishPush(athleteId, conn.id, results);
        } catch (e) {
          // El sello es informativo: no vale perder por el un reenvio que ocurrio.
          console.warn("[vdot-resync] no se pudo sellar last_push_at:", e.message);
        }
      }
    }
  }

  console.log(
    `[vdot-resync] atleta ${athleteId}: test VDOT ${measured} → target ${target} ` +
    `(${reason}), ${actualizados.length} workouts recalculados hasta ${hasta}` +
    ` · sin VDOT de origen ${sinOrigen} · sin cambio ${sinCambio}` +
    ` · reenviados al reloj ${pushed}${pushFailed ? ` (fallaron ${pushFailed})` : ""}` +
    `${pushSkipped ? ` · sin reenviar: ${pushSkipped}` : ""}`
  );

  return {
    ok: true,
    measured,
    previous,
    first,
    target,
    delta,
    reason,
    until: hasta,
    capped_by_test: nextTest ? { title: nextTest.title, date: nextTest.scheduled_date } : null,
    scanned: enVentana.length,
    recalculated: actualizados.length,
    without_origin: sinOrigen,
    unchanged: sinCambio,
    pushed,
    push_failed: pushFailed,
    push_skipped: pushSkipped,
  };
}

async function actionVdotResync(res, athleteId) {
  const out = await resyncPacesAfterEvaluation(athleteId);
  return res.status(200).json(out);
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

/**
 * Coordenadas GPS de una actividad (bajo demanda, no se guardan en workouts).
 * streams?types=latlng → data = latitudes, data2 = longitudes.
 */
async function actionActivityMap(res, athleteId, workoutId) {
  if (!workoutId) return jsonError(res, 400, "Falta 'workout_id'");

  const rows = await sb(
    `workouts?id=eq.${encodeURIComponent(workoutId)}&select=id,athlete_id,intervals_activity_id`
  );
  const w = rows?.[0];
  if (!w) return jsonError(res, 404, "Workout no encontrado");
  if (String(w.athlete_id) !== String(athleteId)) {
    return jsonError(res, 403, "Ese workout no pertenece al atleta");
  }
  if (!w.intervals_activity_id) {
    return res.status(200).json({
      ok: true,
      coords: [],
      reason: "no_activity",
      message: "Esta actividad no tiene datos de ruta",
    });
  }

  const conn = await getConnection(athleteId);
  if (!conn) return jsonError(res, 400, "El atleta no tiene intervals.icu conectado");

  const r = await icuFetch(
    conn,
    `/activity/${encodeURIComponent(w.intervals_activity_id)}/streams?types=latlng`
  );
  if (!r.ok) {
    return jsonError(res, 502, `intervals.icu no respondio (${r.status})`);
  }

  // La API puede devolver un array de streams o un objeto mapa por tipo.
  let stream = null;
  if (Array.isArray(r.data)) {
    stream = r.data.find((s) => String(s?.type || "").toLowerCase() === "latlng") || r.data[0];
  } else if (r.data && typeof r.data === "object") {
    stream = r.data.latlng || r.data;
  }

  const lats = Array.isArray(stream?.data) ? stream.data : null;
  const lngs = Array.isArray(stream?.data2) ? stream.data2 : null;

  // Fallback: data ya viene como [[lat,lng], ...]
  let coords = [];
  if (lats && lngs && lats.length && lngs.length) {
    const n = Math.min(lats.length, lngs.length);
    for (let i = 0; i < n; i += 1) {
      const lat = Number(lats[i]);
      const lng = Number(lngs[i]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        // Filtrar (0,0) típico de indoor / GPS perdido
        if (lat === 0 && lng === 0) continue;
        coords.push([lat, lng]);
      }
    }
  } else if (Array.isArray(lats) && lats.length && Array.isArray(lats[0])) {
    for (const pt of lats) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const lat = Number(pt[0]);
      const lng = Number(pt[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
        coords.push([lat, lng]);
      }
    }
  }

  if (!coords.length) {
    return res.status(200).json({
      ok: true,
      coords: [],
      reason: "no_gps",
      message: "Esta actividad no tiene datos de ruta",
      activity_id: w.intervals_activity_id,
    });
  }

  return res.status(200).json({
    ok: true,
    coords,
    count: coords.length,
    activity_id: w.intervals_activity_id,
  });
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
// Siempre aterriza en Perfil → Config del atleta para que IntervalsConnect
// (aviso de conexion + "falta conectar el reloj") quede a la vista.
function redirectToApp(res, params) {
  const url = new URL(`${APP_URL}/`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("tab", "profile");
  url.searchParams.set("profile_tab", "config");
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

/* ---------- Webhook intervals.icu ---------- */
/**
 * Recibe los avisos de intervals.icu y hace dos cosas:
 * - ACTIVITY_UPLOADED / ACTIVITY_ANALYZED: marcan hecho el workout ejecutado.
 * - SPORT_SETTINGS_UPDATED: el atleta cambio su umbral o sus zonas, asi que se
 *   reenvian sus workouts futuros para que el reloj recupere los ritmos que el
 *   coach planifico.
 *
 * Los de calendario (CALENDAR_UPDATED y los legacy CALENDAR_EVENT_*) se cuentan
 * y se ignoran, porque el puente con el reloj es de ida: lo que el atleta cambie
 * en su calendario de intervals.icu no vuelve a la app.
 *
 * Se autentica con el `secret` del body y responde SIEMPRE 200 con cuerpo
 * cuando el secret es valido: intervals.icu reintenta con backoff exponencial
 * ante cualquier respuesta que no sea 2xx (y hay reportes de que un 204 tambien
 * le dispara reintentos), asi que nada que ya se haya procesado debe salir de
 * aqui con otro codigo.
 */
async function handleIcuWebhook(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  console.log("[icu-webhook] recibido:", JSON.stringify(body?.events?.map(e => ({
    type: e.type, athlete_id: e.athlete_id, activity_id: e.activity?.id ?? null,
  }))));

  // 1) Verificar el secret (viene en el body, no en headers)
  if (!ICU_WEBHOOK_SECRET || body.secret !== ICU_WEBHOOK_SECRET) {
    console.warn("[icu-webhook] secret invalido");
    return res.status(401).json({ error: "Unauthorized" });
  }
  const events = Array.isArray(body.events) ? body.events : [];

  // 2) Deduplicar: de los dos avisos de una misma actividad sale UNA pasada, y
  //    de varios cambios de ajustes del mismo atleta, un solo reenvio.
  const pending = [...dedupeActivityEvents(events), ...dedupeSettingsEvents(events)];
  console.log(
    `[icu-webhook] secret OK eventos=${events.length} a_procesar=${pending.length}`,
  );

  // 3) Procesar ANTES de responder. En serverless, el trabajo que queda pendiente
  //    despues de enviar la respuesta puede quedar congelado por el runtime. El
  //    procesamiento es corto y la idempotencia (intervals_activity_id) cubre los
  //    reintentos si tardamos, asi que es seguro procesar y luego responder 200.
  const results = [];
  for (const ev of pending) {
    const esAjustes = ev.type === "SPORT_SETTINGS_UPDATED";
    const activity = esAjustes ? null : webhookActivity(ev);
    console.log("[icu-webhook] procesando", ev.type, "athlete", ev.athlete_id,
      esAjustes ? "(cambio de zonas)" : `activity ${activity?.id ?? "(no viene en el payload)"}`);
    try {
      // El evento identifica al atleta por su id de intervals.icu. Buscamos su
      // conexion COMPLETA por provider_athlete_id: hace falta el token para
      // icuFetch si toca recurrir al fallback.
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
      const pr = esAjustes
        ? await resyncFutureWorkouts(conn)
        : await autoCompleteFromWebhook(conn, activity);
      console.log("[icu-webhook] resultado:", JSON.stringify(pr));
      if (esAjustes) {
        console.log(
          `[icu-webhook] SPORT_SETTINGS_UPDATED athlete ${conn.athlete_id}: ` +
          `resincronizados ${pr.resynced} workouts` +
          (pr.reason ? ` (${pr.reason})` : ""),
        );
      }
      if (pr.marked) {
        console.log(`[icu-webhook] workout ${pr.workout_id} marcado hecho athlete ${conn.athlete_id}`);
      }
      results.push(pr);
    } catch (e) {
      // Best effort: un fallo nuestro de resync no debe provocar reintentos de
      // intervals.icu, asi que se loguea y la respuesta sigue siendo 200.
      console.error("[icu-webhook] error evento:", e.message);
    }
  }

  // 4) Responder 200 una vez terminado TODO el procesamiento.
  return res.status(200).json({
    ok: true, received: events.length, processed: pending.length, results,
  });
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

  // Webhook de intervals.icu (servidores de David, sin sesion). Se autentica
  // con el 'secret' que viene en el body, verificado dentro del handler.
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
      case "delete-workout": return await actionDeleteWorkoutEvents(res, athlete_id, body.workout_ids ?? body.workout_id);
      case "pull-activity": return await actionPullActivity(res, athlete_id, body.workout_id);
      case "activity-intervals": return await actionActivityIntervals(res, athlete_id, body.activity_id);
      case "activity-map":  return await actionActivityMap(res, athlete_id, body.workout_id);
      case "vdot-resync":   return await actionVdotResync(res, athlete_id);
      case "oauth-start":   return await actionOauthStart(res, athlete_id, user.id);
      default:              return jsonError(res, 400, `Acción no soportada: ${action}`);
    }
  } catch (err) {
    console.error("[integrations]", err);
    return jsonError(res, 500, err.message || "Error interno");
  }
}
