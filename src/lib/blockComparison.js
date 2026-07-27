/**
 * src/lib/blockComparison.js
 * -----------------------------------------------------------
 * Comparacion por bloque: PLAN (structure con duracion + target
 * cualitativo) vs EJECUTADO (laps de intervals.icu con moving_time,
 * distance y average_speed).
 *
 * - El ritmo objetivo por step se deriva del VDOT del atleta via
 *   vdot.js (fuente unica de verdad de ritmos).
 * - Los laps ejecutados se alinean a los steps del plan por TIEMPO
 *   ACUMULADO usando el punto medio del lap (opcion A).
 *
 * NO toca UI. Solo logica pura y testeable.
 * -----------------------------------------------------------
 */

import { pacesForVdot } from "./vdot.js";

/**
 * Mapeo de esfuerzo cualitativo -> zona Daniels (E/M/T/I/R).
 * Nota: aqui HM y 10K se colapsan a T a proposito (comparacion
 * gruesa por bloque); vdot.js si distingue HM/T10 para el push.
 */
export const EFFORT_TO_ZONE = {
  "conversational": "E", "easy jog": "E", "relaxed easy": "E",
  "recovery": "E", "easy": "E",
  "marathon": "M", "hm effort": "T", "half marathon": "T",
  "threshold": "T", "tempo": "T",
  "10k effort": "T", "10k": "T",
  "5k effort": "I", "5k": "I", "comfortably hard": "I",
  "3k effort": "I", "vo2": "I",
  "mile effort": "R", "800m effort": "R", "400m effort": "R",
  "mile": "R", "sprint": "R",
};

/**
 * Texto de esfuerzo -> zona. Busca coincidencia exacta y luego por
 * inclusion. Fallback conservador: "E".
 */
export function zoneForEffort(text) {
  const t = String(text || "").toLowerCase().trim();
  // busca coincidencia exacta, luego por inclusion
  if (EFFORT_TO_ZONE[t]) return EFFORT_TO_ZONE[t];
  for (const k of Object.keys(EFFORT_TO_ZONE))
    if (t.includes(k)) return EFFORT_TO_ZONE[k];
  return "E"; // fallback conservador
}

/**
 * "10 min" | "8 min 30 sec" | "26 sec" | "90 sec" | "1:30" | 600 -> segundos.
 * (Misma logica que src/lib/intervals.js, replicada para no acoplar.)
 */
function durationToSecs(str) {
  if (str == null || str === "") return 0;
  if (typeof str === "number") return str > 300 ? str : str * 60;
  const s = String(str).toLowerCase().trim();

  const min = s.match(/(\d+)\s*min/);
  const sec = s.match(/(\d+)\s*sec/);
  if (min || sec) {
    return (min ? parseInt(min[1], 10) : 0) * 60 + (sec ? parseInt(sec[1], 10) : 0);
  }
  const clock = s.match(/^(\d+):(\d{2})$/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  const plain = s.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) return Math.round(parseFloat(plain[1]) * 60);
  return 0;
}

/** Centro del ritmo objetivo (secs/km) para una zona, dado el vdot. */
function centerPaceForZone(vdot, zone) {
  const p = pacesForVdot(vdot);
  if (!p) return null;
  const v = p[zone];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

/**
 * Compara plan vs ejecutado por step.
 *
 * @param {Object}   args
 * @param {Array}    args.structure  steps del plan (formato B: block_type /
 *                                    target_pace / duration_min; tambien
 *                                    acepta phase / pace / duration).
 * @param {Array}    args.laps        laps de intervals.icu (icu_intervals):
 *                                    { moving_time, distance, average_speed }.
 * @param {number}   args.vdot        VDOT del atleta (athlete_evaluations).
 * @returns {Array} un objeto por step (ver campos abajo).
 */
export function compareBlocks({ structure, laps, vdot }) {
  const steps = Array.isArray(structure) ? structure : [];
  const lapList = Array.isArray(laps) ? laps : [];

  // 1) Steps del plan con duracion en segundos + rango de tiempo acumulado.
  let accPlan = 0;
  const planSteps = steps.map((s) => {
    const effort = s.target_pace ?? s.pace ?? s.intensity ?? "";
    const zone = zoneForEffort(effort);
    const dur = durationToSecs(s.duration_min ?? s.duration);
    const start = accPlan;
    accPlan += dur;
    return {
      step_name: s.block_type || s.phase || s.name || "",
      target_effort: effort,
      target_zone: zone,
      planned_pace_s: centerPaceForZone(vdot, zone),
      planned_dur_s: dur,
      _start: start,
      _end: accPlan,
      _laps: [],
    };
  });
  const plannedTotal = accPlan;

  // 2) Laps con tiempo acumulado y punto medio.
  let accLap = 0;
  const lapsMid = lapList.map((lp) => {
    const mt = Number(lp.moving_time) || 0;
    const start = accLap;
    accLap += mt;
    return {
      moving_time: mt,
      distance: Number(lp.distance) || 0,
      average_speed: Number(lp.average_speed) || 0,
      mid: start + mt / 2,
    };
  });

  // 3) Asignar cada lap al step cuyo rango de tiempo acumulado contiene
  //    el PUNTO MEDIO del lap (opcion A). Si el mid cae mas alla del plan
  //    (ejecutado mas largo que lo planeado), va al ultimo step.
  const assignIndex = (mid) => {
    for (let i = 0; i < planSteps.length; i++) {
      if (mid >= planSteps[i]._start && mid < planSteps[i]._end) return i;
    }
    return planSteps.length ? planSteps.length - 1 : -1;
  };
  for (const lp of lapsMid) {
    const idx = assignIndex(lp.mid);
    if (idx >= 0) planSteps[idx]._laps.push(lp);
  }

  // 4) Resultado por step.
  return planSteps.map((st) => {
    const stLaps = st._laps;
    const actual_dur_s = stLaps.reduce((a, l) => a + l.moving_time, 0);

    // Ritmo real: promedio de (1000 / avg_speed) ponderado por distancia.
    let wSum = 0, distSum = 0;
    for (const l of stLaps) {
      if (l.average_speed > 0 && l.distance > 0) {
        wSum += (1000 / l.average_speed) * l.distance;
        distSum += l.distance;
      }
    }
    const actual_pace_s = distSum > 0 ? wSum / distSum : null;

    const delta_s =
      actual_pace_s != null && st.planned_pace_s != null
        ? actual_pace_s - st.planned_pace_s
        : null;

    const dur_mismatch =
      st.planned_dur_s > 0
        ? Math.abs(actual_dur_s - st.planned_dur_s) > 0.30 * st.planned_dur_s
        : false;

    return {
      step_name: st.step_name,
      target_effort: st.target_effort,
      target_zone: st.target_zone,
      planned_pace_s: st.planned_pace_s,
      actual_pace_s,
      delta_s,
      planned_dur_s: st.planned_dur_s,
      actual_dur_s,
      dur_mismatch,
    };
  });
}

export default compareBlocks;

/* ============================================================
 * TEST RAPIDO (verificable mentalmente)
 * ------------------------------------------------------------
 * structure:
 *   [ { block_type: "Warm-up",  target_pace: "Easy jog",  duration_min: "10 min" },  // E, 600s  [0..600)
 *     { block_type: "Interval", target_pace: "5K effort", duration_min: "5 min"  } ] // I, 300s  [600..900)
 *
 * laps (intervals.icu, average_speed en m/s):
 *   [ { moving_time: 600, distance: 2000, average_speed: 3.333 },   // mid = 300  -> step0
 *     { moving_time: 300, distance: 1200, average_speed: 4.000 } ]  // mid = 750  -> step1
 *
 * compareBlocks({ structure, laps, vdot: 45 }) =>
 *
 *  step0 "Warm-up":
 *    target_zone   = "E"
 *    planned_dur_s = 600
 *    actual_dur_s  = 600            -> dur_mismatch = false (|600-600|=0)
 *    actual_pace_s = 1000/3.333 = 300  (5:00/km)   // un solo lap, ponderado = 300
 *    planned_pace_s = centro del rango E para vdot 45 (~5:40/km aprox)
 *    delta_s = 300 - planned_E  (negativo: corrio mas rapido que E)
 *
 *  step1 "Interval":
 *    target_zone   = "I"
 *    planned_dur_s = 300
 *    actual_dur_s  = 300            -> dur_mismatch = false
 *    actual_pace_s = 1000/4.000 = 250  (4:10/km)
 *    planned_pace_s = centro I para vdot 45 (~4:15/km aprox)
 *    delta_s = 250 - planned_I  (~ -5s, casi en objetivo)
 *
 * Los tiempos y ritmos reales (300 y 250 s/km) son verificables sin vdot;
 * los planned_pace_s dependen del vdot pasado.
 * ============================================================ */
