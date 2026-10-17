/**
 * src/lib/blockComparison.js
 * -----------------------------------------------------------
 * Comparacion por bloque: PLAN vs vueltas reales (icu_intervals).
 *
 * Ritmo previsto: el que el atleta recibio (VDOT del push /
 * generated_with_vdot). Sin objetivo prescrito -> null, nunca Easy.
 * Emparejamiento por similitud (tipo, duracion, distancia), no por
 * posicion ni por rebanar un unico blob de tiempo.
 *
 * NO toca UI. Solo logica pura y testeable.
 * -----------------------------------------------------------
 */

import { pacesForVdot } from "./vdot.js";

export const UNGUIDED_MESSAGE = "no se lanzó el entreno guiado";

/** Texto para la IA: no inventar comparacion por bloque. */
export function unguidedBlocksPrompt(summary) {
  const sum = summary || {};
  const dist = sum.actual_dist_m != null ? `${sum.actual_dist_m} m` : "N/R";
  const dur = sum.actual_dur_s != null ? `${sum.actual_dur_s} s` : "N/R";
  return (
    `\nPASOS: ${UNGUIDED_MESSAGE}. ` +
    `NO analices por bloque ni inventes ritmos o resultados por intervalo; ` +
    `el reloj no lanzó el entreno guiado. Resumen: ${dist}, ${dur}.\n`
  );
}

/**
 * Mapeo de esfuerzo cualitativo -> zona Daniels (E/M/T/I/R).
 * Nota: aqui HM y 10K se colapsan a T a proposito (comparacion
 * gruesa por bloque); intervals.js SI distingue HM/T10 para el push
 * al reloj. No unificar: mismos textos de esfuerzo, zonas distintas
 * segun el consumidor (reloj vs score de ejecucion).
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
 * "marathon", y "800m" cubre "800m race effort").
 * Cadena vacia / desconocida -> null (nunca inventar Easy).
 */
export function zoneForEffort(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;
  if (EFFORT_TO_ZONE[t]) return EFFORT_TO_ZONE[t];
  const keys = Object.keys(EFFORT_TO_ZONE).sort((a, b) => b.length - a.length);
  for (const k of keys) if (t.includes(k)) return EFFORT_TO_ZONE[k];
  return null;
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

function parseDistKm(val) {
  if (val == null || val === "") return 0;
  const n = Number(String(val).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function distKmFromLabel(label) {
  const s = String(label || "").toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(km|m)(?![a-z])/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return m[2] === "km" ? n : n / 1000;
}

/** Centro del ritmo objetivo (secs/km) para una zona, dado el vdot. */
function centerPaceForZone(vdot, zone) {
  const p = pacesForVdot(vdot);
  if (!p || !zone) return null;
  const v = p[zone];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

/**
 * Ritmo numerico ya explicito -> secs/km. Acepta rango "5:00-5:10" (punto
 * medio) o valor unico "5:00". Devuelve null si no es un pace numerico
 * (etiqueta cualitativa "tempo", zona "Z4", vacio).
 */
function numericPaceToSecs(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
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

/** Doble clic / glitch GPS: vueltas de fracciones de segundo, no un rest. */
const GLITCH_MAX_DUR_S = 5;

function isWatchGlitchSplit(sp) {
  const dur = Number(sp?.dur_s ?? sp?.moving_time) || 0;
  return dur > 0 && dur < GLITCH_MAX_DUR_S;
}

function haystackOf(s) {
  return [s?.block_type, s?.phase, s?.name, s?.description, s?.block_label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * warmup | cooldown | rest | recovery | work
 * "Descanso" es rest (sin Δ de ritmo). "Recuperación" con trote es recovery.
 */
export function classifyPlanKind(step) {
  const h = haystackOf(step);
  if (/calent|\bwarm/.test(h)) return "warmup";
  if (/enfri|\bcool|vuelta a la calma/.test(h)) return "cooldown";
  if (/descanso|\brest\b/.test(h)) return "rest";
  if (/recovery|recuperaci|trote|\bjog\b/.test(h)) return "recovery";
  return "work";
}

function ratio(a, b) {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  if (x <= 0 || y <= 0) return 0;
  return Math.min(x, y) / Math.max(x, y);
}

function vdotsDiffer(generated, current) {
  const g = Number(generated);
  const c = Number(current);
  if (!Number.isFinite(g) || !Number.isFinite(c) || g <= 0 || c <= 0) return false;
  return Math.abs(g - c) >= 0.05;
}

function plannedPaceForEffort(effort, vdot) {
  const numeric = numericPaceToSecs(effort);
  if (numeric != null) {
    return { planned_pace_s: numeric, target_zone: zoneForEffort(effort), has_objective: true };
  }
  const zone = zoneForEffort(effort);
  if (!zone) {
    return { planned_pace_s: null, target_zone: null, has_objective: false };
  }
  return {
    planned_pace_s: centerPaceForZone(vdot, zone),
    target_zone: zone,
    has_objective: true,
  };
}

function fillKeyFor(step) {
  if (step.kind === "rest" || step.kind === "recovery" || step.kind === "warmup" || step.kind === "cooldown") {
    return step.planned_dur_s > 0 ? "dur_s" : "dist_m";
  }
  if (step.planned_dist_m > 0) return "dist_m";
  return "dur_s";
}

function kindBonus(kind, lap) {
  const t = String(lap.type || lap.label || "").toUpperCase();
  if (kind === "rest" || kind === "recovery") {
    if (t.includes("RECOVERY") || t.includes("REST")) return 0.08;
    if (t.includes("WORK") || t.includes("INTERVAL")) return -0.08;
  }
  if (kind === "work") {
    if (t.includes("WORK") || t.includes("INTERVAL")) return 0.08;
    if (t.includes("RECOVERY") || t.includes("REST")) return -0.08;
  }
  if (kind === "warmup" && t.includes("WARM")) return 0.08;
  if (kind === "cooldown" && t.includes("COOL")) return 0.08;
  return 0;
}

const MIN_MATCH_RATIO = 0.55;

/**
 * Ventana consecutiva de laps sin usar cuya suma (dur o dist) mejor
 * se acerca al objetivo. Prefiere monotone (desde minIndex) y, si no
 * hay match, busca en todo lo no usado. Nunca "vuelca el resto".
 */
function bestWindow(laps, used, target, key, minIndex, kind) {
  if (!(target > 0)) return null;

  const search = (pool) => {
    let best = null;
    for (let a = 0; a < pool.length; a++) {
      let sum = 0;
      for (let b = a; b < pool.length; b++) {
        sum += Number(laps[pool[b]][key]) || 0;
        const n = b - a + 1;
        const r = ratio(sum, target) + kindBonus(kind, laps[pool[a]]);
        const cand = { indices: pool.slice(a, b + 1), sum, n, ratio: r };
        if (
          !best
          || r > best.ratio + 1e-9
          || (Math.abs(r - best.ratio) < 1e-9 && n < best.n)
        ) {
          best = cand;
        }
        if (sum >= target * 1.6 && n > 1) break;
      }
    }
    return best;
  };

  const unusedFrom = [];
  for (let i = 0; i < laps.length; i++) {
    if (!used[i] && i >= minIndex) unusedFrom.push(i);
  }
  let best = search(unusedFrom);
  if (!best || best.ratio < MIN_MATCH_RATIO) {
    const allUnused = [];
    for (let i = 0; i < laps.length; i++) if (!used[i]) allUnused.push(i);
    const alt = search(allUnused);
    if (alt && (!best || alt.ratio > best.ratio)) best = alt;
  }
  if (!best || best.ratio < MIN_MATCH_RATIO) return null;
  return best;
}

function lapPaceS(dur, distM) {
  return distM > 0 && dur > 0 ? dur / (distM / 1000) : null;
}

function weightedHr(parts) {
  let num = 0;
  let den = 0;
  for (const p of parts) {
    const hr = Number(p.hr);
    const w = Number(p.dur_s) || 0;
    if (Number.isFinite(hr) && hr > 0 && w > 0) {
      num += hr * w;
      den += w;
    }
  }
  return den > 0 ? Math.round(num / den) : null;
}

function emptyBlock(st) {
  const durMismatch =
    st.planned_dur_s > 0
      ? Math.abs(0 - st.planned_dur_s) > 0.30 * st.planned_dur_s
      : st.planned_dist_m > 0;
  const incomplete =
    (st.planned_dur_s > 0 && 0 < 0.5 * st.planned_dur_s)
    || (st.planned_dist_m > 0 && 0 < 0.5 * st.planned_dist_m);
  return {
    step_name: st.step_name,
    kind: st.kind,
    target_effort: st.target_effort,
    target_zone: st.target_zone,
    has_objective: st.has_objective,
    planned_pace_s: st.planned_pace_s,
    actual_pace_s: null,
    delta_s: null,
    planned_dur_s: st.planned_dur_s,
    planned_dist_m: Math.round(st.planned_dist_m),
    actual_dur_s: 0,
    actual_dist_m: 0,
    actual_hr: null,
    dur_mismatch: durMismatch,
    incomplete,
    no_data: true,
    fused: false,
    fused_label: null,
    splits: [],
  };
}

function finalizeBlock(st, assigned) {
  if (!assigned.length) return emptyBlock(st);

  const actual_dur_s = assigned.reduce((a, p) => a + p.dur_s, 0);
  const actual_dist_m = assigned.reduce((a, p) => a + p.dist_m, 0);
  const actual_pace_s = lapPaceS(actual_dur_s, actual_dist_m);
  const restNoDelta = st.kind === "rest";
  const delta_s =
    !restNoDelta
    && st.has_objective
    && actual_pace_s != null
    && st.planned_pace_s != null
      ? actual_pace_s - st.planned_pace_s
      : null;

  const dur_mismatch = st.planned_dur_s > 0
    ? Math.abs(actual_dur_s - st.planned_dur_s) > 0.30 * st.planned_dur_s
    : (st.planned_dist_m > 0
      ? Math.abs(actual_dist_m - st.planned_dist_m) > 0.30 * st.planned_dist_m
      : false);

  const incomplete = st.planned_dur_s > 0
    ? actual_dur_s < 0.5 * st.planned_dur_s
    : (st.planned_dist_m > 0 ? actual_dist_m < 0.5 * st.planned_dist_m : false);

  const realSplits = assigned.filter((sp) => !isWatchGlitchSplit(sp));
  const fused = realSplits.length >= 2;
  const splits = realSplits.map((sp, i) => ({
    name: `Vuelta ${i + 1}`,
    dur_s: Math.round(sp.dur_s),
    dist_m: Math.round(sp.dist_m),
    pace_s: lapPaceS(sp.dur_s, sp.dist_m),
    hr: sp.hr ?? null,
    lap_index: sp.lap_index,
  }));

  return {
    step_name: st.step_name,
    kind: st.kind,
    target_effort: st.target_effort,
    target_zone: st.target_zone,
    has_objective: st.has_objective,
    planned_pace_s: st.planned_pace_s,
    actual_pace_s,
    delta_s,
    planned_dur_s: st.planned_dur_s,
    planned_dist_m: Math.round(st.planned_dist_m),
    actual_dur_s: Math.round(actual_dur_s),
    actual_dist_m: Math.round(actual_dist_m),
    actual_hr: weightedHr(assigned),
    dur_mismatch,
    incomplete,
    no_data: false,
    fused,
    fused_label: fused ? `${realSplits.length} vueltas` : null,
    splits,
  };
}

function summarizeLaps(laps) {
  const dur = laps.reduce((a, l) => a + (Number(l.dur_s) || 0), 0);
  const dist = laps.reduce((a, l) => a + (Number(l.dist_m) || 0), 0);
  return {
    actual_dur_s: Math.round(dur),
    actual_dist_m: Math.round(dist),
    actual_pace_s: lapPaceS(dur, dist),
    actual_hr: weightedHr(laps.map((l) => ({ dur_s: l.dur_s, hr: l.hr }))),
  };
}

function parseKmSplits(kmSplits) {
  if (!Array.isArray(kmSplits) || !kmSplits.length) return [];
  return kmSplits.map((k, i) => {
    const dur = Number(k.dur_s ?? k.moving_time) || 0;
    const dist = Number(k.dist_m ?? k.distance) || 0;
    return {
      name: k.name || `km ${i + 1}`,
      dur_s: Math.round(dur),
      dist_m: Math.round(dist),
      pace_s: lapPaceS(dur, dist),
      hr: k.hr ?? k.average_heartrate ?? null,
    };
  });
}

function looksLikeKmLaps(laps) {
  if (laps.length < 2) return false;
  return laps.every((l) => l.dist_m >= 800 && l.dist_m <= 1200);
}

function hasShortPlanBlocks(planSteps) {
  return planSteps.some((s) =>
    (s.planned_dur_s > 0 && s.planned_dur_s < 120)
    || (s.planned_dist_m > 0 && s.planned_dist_m < 1000)
  );
}

/** Rodaje / 3K suelto: 1-2 bloques largos, sin series cortas. */
function isSimpleEndurancePlan(planSteps) {
  if (planSteps.length === 0 || planSteps.length > 2) return false;
  if (hasShortPlanBlocks(planSteps)) return false;
  return planSteps.every((s) =>
    s.kind === "warmup" || s.kind === "cooldown" || s.kind === "work"
  );
}

/**
 * Auto-lap de ~1 km cubre bloques por distancia (p.ej. 3 vueltas = 3 km)
 * y no hay series de <1 km / <120 s que hayan quedado sin vuelta propia.
 */
function kmLapsClearlyMatchDistanceSteps(planSteps, usable) {
  if (hasShortPlanBlocks(planSteps)) return false;
  const distSteps = planSteps.filter((s) => s.planned_dist_m >= 800);
  if (!distSteps.length) return false;
  const otherLong = planSteps.filter((s) =>
    s.planned_dist_m < 800 && s.planned_dur_s >= 120
  );
  if (otherLong.length) return false;
  const plannedM = distSteps.reduce((a, s) => a + s.planned_dist_m, 0);
  const lapM = usable.reduce((a, l) => a + l.dist_m, 0);
  return ratio(plannedM, lapM) >= 0.7;
}

/**
 * Auto-lap por km (todas las vueltas ~1 km) no se puede alinear a un plan
 * con series por tiempo o bloques cortos. Excepcion: plan simple de
 * resistencia, o las vueltas cubren solo bloques por distancia.
 */
function isKmAutoLapUnguided(planSteps, usable) {
  if (!looksLikeKmLaps(usable)) return false;
  if (isSimpleEndurancePlan(planSteps)) return false;
  if (kmLapsClearlyMatchDistanceSteps(planSteps, usable)) return false;
  const timeOnly = planSteps.some((s) => s.planned_dur_s > 0 && s.planned_dist_m <= 0);
  const countsDiffer = usable.length !== planSteps.length;
  return hasShortPlanBlocks(planSteps) || timeOnly || countsDiffer;
}

function isUnguidedSession(planSteps, usable) {
  // Una sola vuelta (o menos de la mitad de los bloques) en un plan con
  // varios pasos: el reloj no lanzo el entreno guiado. Un plan de 1-2
  // bloques con 1 vuelta (rodaje, 3 km suelto) SI se empareja.
  if (planSteps.length >= 3 && (
    usable.length <= 1 || usable.length < planSteps.length / 2
  )) {
    return true;
  }
  return isKmAutoLapUnguided(planSteps, usable);
}

/**
 * Compara plan vs ejecutado.
 *
 * @param {Object} args
 * @param {Array}  args.structure
 * @param {Array}  args.laps
 * @param {number} args.vdot         VDOT del push (generated_with_vdot)
 * @param {number} [args.currentVdot] VDOT vigente (aviso si difiere)
 * @param {Array}  [args.kmSplits]    parciales por km (unguided / rodaje)
 * @returns {{ mode, message, vdot_warning, summary, km_splits, blocks, extra }}
 */
export function compareBlocks({ structure, laps, vdot, currentVdot, kmSplits } = {}) {
  const stepsIn = Array.isArray(structure) ? structure : [];
  const rawLaps = Array.isArray(laps) ? laps : [];

  const vdot_warning = vdotsDiffer(vdot, currentVdot)
    ? { generated_vdot: Number(vdot), current_vdot: Number(currentVdot) }
    : null;

  const planSteps = stepsIn.map((s) => {
    const effort = s.target_pace ?? s.pace ?? s.intensity ?? "";
    const kind = classifyPlanKind(s);
    const dur = durationToSecs(s.duration_min ?? s.duration);
    let distKm = parseDistKm(s.distance_km);
    if (!distKm && kind === "work") {
      distKm = distKmFromLabel(s.block_type || s.phase || s.name || "");
    }
    const pace = plannedPaceForEffort(effort, vdot);
    return {
      step_name: s.block_type || s.phase || s.name || "",
      kind,
      target_effort: effort,
      ...pace,
      planned_dur_s: dur,
      planned_dist_m: distKm * 1000,
    };
  });

  const extra = [];
  const usable = [];
  rawLaps.forEach((lp, i) => {
    const dur = Number(lp.moving_time) || 0;
    const dist = Number(lp.distance) || 0;
    const hr = lp.average_heartrate ?? lp.hr ?? null;
    const row = {
      lap_index: i,
      dur_s: dur,
      dist_m: dist,
      hr,
      type: lp.type || "",
      label: lp.label || "",
      pace_s: lapPaceS(dur, dist),
    };
    if (dur <= 0 && dist <= 0) return;
    if (isWatchGlitchSplit(row)) {
      extra.push({
        reason: "glitch",
        name: `Vuelta ${i + 1}`,
        dur_s: Math.round(dur),
        dist_m: Math.round(dist),
        pace_s: row.pace_s,
        hr,
        lap_index: i,
      });
      return;
    }
    usable.push(row);
  });

  const summary = summarizeLaps(
    usable.length ? usable : rawLaps.map((lp, i) => ({
      dur_s: Number(lp.moving_time) || 0,
      dist_m: Number(lp.distance) || 0,
      hr: lp.average_heartrate ?? lp.hr ?? null,
    })),
  );

  const kmFromArg = parseKmSplits(kmSplits);
  const km_splits = kmFromArg.length
    ? kmFromArg
    : (looksLikeKmLaps(usable)
      ? usable.map((l, i) => ({
        name: `km ${i + 1}`,
        dur_s: Math.round(l.dur_s),
        dist_m: Math.round(l.dist_m),
        pace_s: l.pace_s,
        hr: l.hr,
      }))
      : []);

  const unguided = isUnguidedSession(planSteps, usable);

  if (!planSteps.length) {
    return {
      mode: "matched",
      message: null,
      vdot_warning,
      summary,
      km_splits,
      blocks: [],
      extra,
    };
  }

  if (unguided) {
    for (const lap of usable) {
      extra.push({
        reason: "unmatched",
        name: `Vuelta ${lap.lap_index + 1}`,
        dur_s: Math.round(lap.dur_s),
        dist_m: Math.round(lap.dist_m),
        pace_s: lap.pace_s,
        hr: lap.hr,
        lap_index: lap.lap_index,
      });
    }
    return {
      mode: "unguided",
      message: UNGUIDED_MESSAGE,
      vdot_warning,
      summary,
      km_splits,
      blocks: [],
      extra,
    };
  }

  const used = new Array(usable.length).fill(false);
  let minIndex = 0;
  const blocks = planSteps.map((st) => {
    const key = fillKeyFor(st);
    const target = key === "dist_m" ? st.planned_dist_m : st.planned_dur_s;
    const win = bestWindow(usable, used, target, key, minIndex, st.kind);
    if (!win) return emptyBlock(st);
    const assigned = win.indices.map((idx) => {
      used[idx] = true;
      return usable[idx];
    });
    minIndex = Math.max(minIndex, win.indices[win.indices.length - 1] + 1);
    return finalizeBlock(st, assigned);
  });

  usable.forEach((lap, i) => {
    if (used[i]) return;
    extra.push({
      reason: "unmatched",
      name: `Vuelta ${lap.lap_index + 1}`,
      dur_s: Math.round(lap.dur_s),
      dist_m: Math.round(lap.dist_m),
      pace_s: lap.pace_s,
      hr: lap.hr,
      lap_index: lap.lap_index,
    });
  });

  return {
    mode: "matched",
    message: null,
    vdot_warning,
    summary,
    km_splits,
    blocks,
    extra,
  };
}

/** Chevron solo si, tras tirar glitches, quedan 2+ vueltas reales. */
export function blockHasWatchSplits(block) {
  return Array.isArray(block?.splits) && block.splits.length >= 2;
}

export function compareBlockRows(args) {
  const result = compareBlocks(args);
  return Array.isArray(result) ? result : (result.blocks || []);
}

export default compareBlocks;
