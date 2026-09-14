/**
 * Autocompletado de workouts desde una actividad de intervals.icu.
 *
 * Extraido de api/integrations.js para reutilizarlo en el webhook y en el
 * cron de watch-sync. Umbrales y candados identicos al webhook original.
 */
import { adminHeaders } from "./apiAuth.js";
import { icuFetch } from "./icuClient.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

async function sb(path, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: adminHeaders(prefer ? { Prefer: prefer } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path} -> ${r.status}: ${text}`);
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

// --- helper: extrae los campos actual_* de una actividad de intervals.icu ---
export function mapActivityToActual(act) {
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
export function pickBestActivity(activities) {
  const runs = activities.filter((a) => {
    const t = String(a.type || "").toLowerCase();
    return t === "run" || t.includes("run");
  });
  const pool = runs.length ? runs : activities;
  if (!pool.length) return null;
  return pool.reduce((best, a) =>
    (a.distance ?? 0) > (best.distance ?? 0) ? a : best, pool[0]);
}

// Fecha (YYYY-MM-DD) en que ocurrio la actividad de intervals.icu.
// start_date_local ya viene en la hora local del atleta, asi que basta cortar.
export function activityDate(act) {
  const s = act?.start_date_local || act?.start_date || null;
  return s ? String(s).slice(0, 10) : null;
}

// Fecha YYYY-MM-DD en la zona del atleta (UTC-5). Los scheduled_date del plan
// estan en local; si usaramos toISOString() (UTC) de noche se correria el dia.
export function localDateStr(offsetHours = -5, base = Date.now()) {
  return new Date(base + offsetHours * 3600000).toISOString().slice(0, 10);
}

// Tiempo en movimiento (segundos) y distancia (metros) en CRUDO de una actividad.
export function activityRaw(act) {
  return {
    movS:  Number(act?.moving_time ?? act?.elapsed_time ?? 0) || 0,
    distM: Number(act?.distance ?? act?.icu_distance ?? 0) || 0,
  };
}

// Flujo AUTOMATICO del webhook: valida la actividad ejecutada, la empareja con
// el workout PLANEADO y PENDIENTE del dia y lo marca hecho con los actual_*.
// Devuelve un objeto describiendo el resultado (para logs). No usa res; el
// caller responde 200 igualmente.
//
// `activity` es la del payload del webhook. Si no llega (o llega en esqueleto),
// se consulta a intervals.icu, y para eso hace falta la conexion COMPLETA
// (access_token/api_key). `source` en el resultado dice cual de las dos fue.
//
// `dry`: solo inspecciona. No PATCH, no push. El camino de candados es el mismo.
export async function autoCompleteFromWebhook(conn, activity = null, { dry = false } = {}) {
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

  if (dry) {
    return {
      ok: true, source, marked: false, would_mark: true,
      workout_id: w.id, activity_id: act.id ?? null, fecha,
    };
  }

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
    const { notifyCoachWorkoutCompleted } = await import("./notifyCoachWorkoutCompleted.js");
    await notifyCoachWorkoutCompleted({ workoutId: w.id });
  } catch (e) {
    console.warn("[webhook] notify coach workout completed:", e?.message || e);
  }

  return { ok: true, source, marked: true, workout_id: w.id, activity_id: act.id ?? null, fecha };
}
