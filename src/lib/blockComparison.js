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
  // Facil
  "conversational": "E", "easy jog": "E", "relaxed easy": "E",
  "recovery": "E", "easy": "E",
  // Maraton
  "marathon": "M",
  // Medio maraton -> lo tratamos como umbral (T). OJO: "half marathon" debe
  // ganarle a "marathon"; se resuelve iterando por clave mas larga primero.
  "half marathon": "T", "hm effort": "T",
  "threshold": "T", "tempo": "T", "10k": "T",
  // Umbral: "comfortably hard" = umbral (Daniels), igual que intervals.js.
  "comfortably hard": "T",
  // Intervalo / VO2max
  "5k": "I", "3k": "I", "vo2": "I",
  // Repeticion / velocidad
  "mile": "R", "1500": "R", "800m": "R", "400m": "R", "sprint": "R",
};

/**
 * Texto de esfuerzo -> zona. Busca coincidencia exacta y luego por inclusion,
 * priorizando la clave MAS LARGA/especifica (asi "half marathon" gana sobre
 * "marathon", y "800m" cubre "800m race effort"). Fallback conservador: "E".
 */
export function zoneForEffort(text) {
  const t = String(text || "").toLowerCase().trim();
  if (EFFORT_TO_ZONE[t]) return EFFORT_TO_ZONE[t];
  const keys = Object.keys(EFFORT_TO_ZONE).sort((a, b) => b.length - a.length);
  for (const k of keys) if (t.includes(k)) return EFFORT_TO_ZONE[k];
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
 * Ritmo numerico ya explicito -> secs/km. Acepta rango "5:00-5:10" (punto
 * medio) o valor unico "5:00". Devuelve null si no es un pace numerico
 * (etiqueta cualitativa "tempo", zona "Z4", vacio). Es la fuente PRIORITARIA:
 * desde que enrichStructureWithPaces hornea target_pace numerico, la zona ya
 * no se puede inferir del texto (zoneForEffort caeria a "E" para todos).
 */
function numericPaceToSecs(str) {
  if (str == null) return null;
  const s = String(str).trim();
  const range = s.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (range) {
    const a = +range[1] * 60 + +range[2];
    const b = +range[3] * 60 + +range[4];
    return (a + b) / 2;
  }
  const single = s.match(/(\d+):(\d{2})/);
  if (single) return +single[1] * 60 + +single[2];
  return null;
}

/**
 * Compara plan vs ejecutado por step.
 *
 * Estrategia de alineacion: CONSUMO SECUENCIAL por duracion. Los laps se
 * gastan en orden para "llenar" cada step hasta cubrir su duracion planeada.
 * Un step puede componerse de VARIOS laps (util cuando el Auto Lap del reloj
 * parte un step en trozos, p.ej. el warm-up de 600s salio como 345s + 265s),
 * y un lap puede repartirse entre dos steps si cruza el limite (se asigna la
 * fraccion por tiempo, y la distancia proporcional). Esto es robusto al numero
 * de laps: da igual que el reloj marque 13, 14 o 20.
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

  // 1) Steps del plan con su duracion en segundos.
  const planSteps = steps.map((s) => {
    const effort = s.target_pace ?? s.pace ?? s.intensity ?? "";
    const zone = zoneForEffort(effort);
    const dur = durationToSecs(s.duration_min ?? s.duration);
    // Prioriza el pace numerico ya explicito (enriquecido) sobre la zona: si
    // effort es "5:00-5:10" usa 305s; solo si es cualitativo ("tempo", "Z4")
    // deriva desde la zona + vdot (compatibilidad con structures viejos).
    const numericPace = numericPaceToSecs(effort);
    return {
      step_name: s.block_type || s.phase || s.name || "",
      target_effort: effort,
      target_zone: zone,
      planned_pace_s: numericPace != null ? numericPace : centerPaceForZone(vdot, zone),
      planned_dur_s: dur,
      actual_dur_s: 0,
      actual_dist_m: 0,
    };
  });

  // 2) Cola de laps con tiempo/distancia RESTANTES (para fraccionar).
  const queue = lapList.map((lp) => {
    const t = Number(lp.moving_time) || 0;
    const d = Number(lp.distance) || 0;
    return { remT: t, remD: d, rate: t > 0 ? d / t : 0 }; // rate = m/s dentro del lap
  });

  // 3) Consumo secuencial: cada step toma laps (o fracciones) hasta cubrir
  //    su planned_dur_s.
  let qi = 0;
  for (let si = 0; si < planSteps.length; si++) {
    const st = planSteps[si];
    let need = st.planned_dur_s;
    while (need > 0 && qi < queue.length) {
      const lap = queue[qi];
      if (lap.remT <= 0) { qi++; continue; }
      const take = Math.min(need, lap.remT);
      st.actual_dur_s += take;
      st.actual_dist_m += take * lap.rate;   // distancia proporcional al tiempo
      lap.remT -= take;
      lap.remD -= take * lap.rate;
      need -= take;
      if (lap.remT <= 1e-9) qi++;            // lap agotado -> siguiente
    }
    // Si es el ULTIMO step y quedan laps sin consumir (ejecutado mas largo
    // que lo planeado), volcamos el resto aqui para no perder datos.
    if (si === planSteps.length - 1) {
      while (qi < queue.length) {
        const lap = queue[qi];
        if (lap.remT > 0) {
          st.actual_dur_s += lap.remT;
          st.actual_dist_m += lap.remD;
        }
        qi++;
      }
    }
  }

  // 4) Metricas por step.
  return planSteps.map((st) => {
    const actual_pace_s =
      st.actual_dist_m > 0 ? st.actual_dur_s / (st.actual_dist_m / 1000) : null;

    const delta_s =
      actual_pace_s != null && st.planned_pace_s != null
        ? actual_pace_s - st.planned_pace_s
        : null;

    const dur_mismatch =
      st.planned_dur_s > 0
        ? Math.abs(st.actual_dur_s - st.planned_dur_s) > 0.30 * st.planned_dur_s
        : false;

    const incomplete =
      st.planned_dur_s > 0 && st.actual_dur_s < 0.5 * st.planned_dur_s;

    return {
      step_name: st.step_name,
      target_effort: st.target_effort,
      target_zone: st.target_zone,
      planned_pace_s: st.planned_pace_s,
      actual_pace_s,
      delta_s,
      planned_dur_s: st.planned_dur_s,
      actual_dur_s: Math.round(st.actual_dur_s),
      actual_dist_m: Math.round(st.actual_dist_m),
      dur_mismatch,
      incomplete,
    };
  });
}

export default compareBlocks;

/* ============================================================
 * TEST RAPIDO (verificable mentalmente) - CONSUMO SECUENCIAL
 * ------------------------------------------------------------
 * structure:
 *   [ { block_type: "Warm-up",  target_pace: "Easy jog",  duration_min: "10 min" },  // E, 600s
 *     { block_type: "Interval", target_pace: "5K effort", duration_min: "5 min"  } ] // I, 300s
 *
 * Caso clave: el warm-up (600s) sale PARTIDO en 2 laps por el Auto Lap del
 * reloj, y el interval en 1 lap:
 *   laps = [ { moving_time: 350, distance: 1000, average_speed: ~2.857 },  // parte 1 warm-up
 *            { moving_time: 250, distance:  800, average_speed: ~3.200 },  // parte 2 warm-up
 *            { moving_time: 300, distance: 1200, average_speed: 4.000 } ]  // interval
 *
 * Consumo secuencial:
 *   step0 (need 600): toma lap0 completo (350s,1000m) + lap1 completo
 *                     (250s,800m) = 600s, 1800m  -> queda need 0.
 *     actual_dur_s  = 600            -> dur_mismatch = false, incomplete = false
 *     actual_dist_m = 1800
 *     actual_pace_s = 600 / (1800/1000) = 333.3 s/km (5:33/km)
 *   step1 (need 300): toma lap2 completo (300s,1200m).
 *     actual_dur_s  = 300
 *     actual_dist_m = 1200
 *     actual_pace_s = 300 / 1.2 = 250 s/km (4:10/km)
 *
 * Fraccionamiento: si lap0 fuera 700s/2000m y el step0 solo necesita 600s,
 * se asigna 600/700 del lap -> 600s y 2000*(600/700)=1714m al step0, y el
 * resto (100s, 286m) queda para el step1.
 *
 * Los ritmos reales (333 y 250 s/km) son verificables sin vdot; los
 * planned_pace_s dependen del vdot pasado.
 * ============================================================ */
