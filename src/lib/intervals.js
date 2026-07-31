/**
 * src/lib/intervals.js
 * -----------------------------------------------------------
 * Traduce workouts de RunningApexFlow -> texto de intervals.icu
 * (que a su vez lo empuja a Garmin/COROS como workout guiado).
 *
 * REGLAS VALIDADAS EN PRUEBAS REALES CON GARMIN:
 *  1. El texto va en 'description' EN LA RAIZ del evento.
 *     Dentro de workout_doc NO se parsea (workout_doc es de solo lectura).
 *  2. RANGOS de ritmo siempre ("4:26-4:20/km Pace"). Un valor unico
 *     no se traduce a objetivo en el reloj.
 *  3. Ritmos ABSOLUTOS, nunca porcentajes ni zonas.
 *  4. "m" = MINUTOS. Para 400 metros se escribe 0.4km.
 *  5. Linea en blanco antes y despues de cada seccion.
 *  6. El atleta necesita ritmo umbral configurado en intervals.icu
 *     (Settings > Sport Settings) o no se calcula carga.
 *
 * Los ritmos salen SIEMPRE de vdot.js (fuente unica de verdad).
 * -----------------------------------------------------------
 */

import { pacesForVdot, fmtPace } from "./vdot.js";
import { readStructure } from "./workoutStructure.js";

/**
 * Mapeo de esfuerzos cualitativos -> zona Daniels.
 * Necesario porque la IA genera textos como "5K race effort"
 * en lugar de ritmos numericos (formato B de la columna structure).
 */
export const EFFORT_TO_ZONE = {
  // Facil
  "conversational pace": "E", "easy jog": "E", "relaxed easy pace": "E",
  "easy": "E", "easy pace": "E", "recovery": "E", "recovery jog": "E",
  "trote suave": "E", "suave": "E", "rodaje": "E",
  // Maraton
  "marathon pace": "M", "marathon effort": "M", "moderate": "M",
  "ritmo maraton": "M", "moderada": "M",
  // Medio maraton (entre M y T)
  "half marathon effort": "HM", "half marathon pace": "HM",
  "ritmo medio maraton": "HM",
  // Umbral
  "comfortably hard effort": "T", "comfortably hard": "T",
  "threshold": "T", "tempo": "T", "moderate hard": "T",
  "umbral": "T", "fuerte": "T",
  // 10K (entre T e I)
  "10k race effort": "T10", "10k pace": "T10", "ritmo 10k": "T10",
  // Intervalo / VO2max
  "5k race effort": "I", "5k pace": "I", "3k race effort": "I",
  "hard": "I", "vo2max": "I", "intervalos": "I", "muy fuerte": "I",
  // Repeticion / velocidad
  "mile race effort": "R", "800m race effort": "R", "400m race effort": "R",
  "very hard": "R", "sprint": "R", "repetition": "R", "repeticiones": "R",
};

// Parsea UN extremo de duracion: "1:30" (reloj mm:ss) o "2" / "8.5" (numero
// plano, interpretado con la unidad del rango: min por defecto, o sec).
// El reloj (mm:ss) SIEMPRE gana: no se le aplica unidad, ya trae segundos.
function parseDurationToken(tok, unit) {
  const clock = tok.match(/^(\d+):(\d{2})$/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  const num = tok.match(/^(\d+(?:\.\d+)?)$/);
  if (num) {
    const val = parseFloat(num[1]);
    return Math.round(unit === "sec" ? val : val * 60); // por defecto minutos
  }
  return null;
}

/**
 * "10 min" | "8 min 30 sec" | "26 sec" | "1:30" -> segundos.
 * Tambien RANGOS ("1:30-2:00 min", "90-120 sec", "2-3 min"): se toma el
 * PUNTO MEDIO. Sin esto, un 400m con duracion "1:30-2:00 min" devolvia 0
 * (el regex de "min" enganchaba el "00" de "2:00") y normalizeBlock lo
 * descartaba -> los intervalos nunca llegaban al reloj.
 */
function durationToSecs(str) {
  if (str == null) return null;
  if (typeof str === "number") return str > 300 ? str : str * 60;
  const s = String(str).toLowerCase().trim();

  // Rango primero: "1:30-2:00 min" | "90-120 sec" | "2-3 min" -> punto medio.
  const range = s.match(/^([\d.:]+)\s*[-–]\s*([\d.:]+)/);
  if (range) {
    const unitMatch = s.match(/(min|sec)\s*$/);
    const unit = unitMatch ? unitMatch[1] : "";
    const a = parseDurationToken(range[1], unit);
    const b = parseDurationToken(range[2], unit);
    if (a != null && b != null) return Math.round((a + b) / 2);
  }

  // Reloj mm:ss con sufijo OPCIONAL ("1:30", "1:30 min", "2:00 min"). DEBE ir
  // antes del regex laxo de "min": sin esto, /(\d+)\s*min/ engancha el "30" de
  // "1:30 min" y devuelve 30 min (1800s) -> el reloj mostraba "30m".
  const clockSuffixed = s.match(/^(\d+):(\d{2})(?:\s*(?:min|sec))?$/);
  if (clockSuffixed) {
    return parseInt(clockSuffixed[1], 10) * 60 + parseInt(clockSuffixed[2], 10);
  }

  const min = s.match(/(\d+)\s*min/);
  const sec = s.match(/(\d+)\s*sec/);
  if (min || sec) {
    return (min ? parseInt(min[1], 10) : 0) * 60 + (sec ? parseInt(sec[1], 10) : 0);
  }
  const clock = s.match(/^(\d+):(\d{2})$/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  const plain = s.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) return Math.round(parseFloat(plain[1]) * 60);
  return null;
}

/** segundos -> "8m30s" | "10m" | "26s"   (m = minutos en intervals.icu) */
function secsToIcuDuration(secs) {
  const total = Math.round(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m && s) return `${m}m${s}s`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** "5:30-6:00 min/km" -> "5:30-6:00" | "4:23 min/km" -> rango +-3s */
function parseNumericPace(str, tolerance = 3) {
  if (!str) return null;
  const s = String(str).trim();
  const range = s.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (range) {
    const a = +range[1] * 60 + +range[2];
    const b = +range[3] * 60 + +range[4];
    return `${fmtPace(a)}-${fmtPace(b)}`;
  }
  const single = s.match(/(\d+):(\d{2})/);
  if (single) {
    const t = +single[1] * 60 + +single[2];
    return `${fmtPace(t + tolerance)}-${fmtPace(t - tolerance)}`;
  }
  return null;
}

/** Esfuerzo cualitativo -> rango de ritmo usando el VDOT del atleta */
function qualitativeToPace(effort, vdot) {
  const key = String(effort || "").toLowerCase().trim();
  const zone = EFFORT_TO_ZONE[key];
  if (!zone) return null;
  const p = pacesForVdot(vdot);
  if (!p) return null;
  const v = p[zone];
  if (v === undefined) return null;
  if (Array.isArray(v)) return `${fmtPace(v[0])}-${fmtPace(v[1])}`;
  return `${fmtPace(v + 3)}-${fmtPace(v - 3)}`;
}

/**
 * Extrae la distancia del NOMBRE del bloque: "400m fuerte" -> 0.4 km,
 * "800m" -> 0.8, "1km"/"1.5 km" -> n. Devuelve null si no hay distancia.
 * Clave: NO confundir "min" con metros. La unidad debe ser exactamente
 * "m" o "km"; el lookahead (?![a-z]) descarta "min" (la "i" tras la "m").
 */
export function distKmFromLabel(label) {
  const s = String(label || "").toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(km|m)(?![a-z])/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] === "km" ? n : n / 1000;
}

// Distancia (km) desde el campo distance_km del bloque. Acepta "0.4", "0.4km",
// "400m" o numero. Devuelve null si vacio/invalido.
function parseDistKm(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "") return null;
  const fromLabel = distKmFromLabel(s);        // "400m" | "0.4km"
  if (fromLabel != null) return fromLabel;
  const num = parseFloat(s);                    // "0.4" | 0.4
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** Normaliza un bloque de cualquier formato a {label, secs, pace, distKm} */
function normalizeBlock(b, vdot) {
  // Formato B (generado por IA): block_type / target_pace / duration_min
  const isB = "block_type" in b || "target_pace" in b || "duration_min" in b;
  if (isB) {
    const label = b.block_type || "";
    const secs = durationToSecs(b.duration_min);
    // Las recuperaciones van SIEMPRE por tiempo, aunque el nombre mencione
    // metros ("Recuperacion (400m trote)"): no son un intervalo de distancia.
    // El dato distance_km manda; el nombre ("400m") queda como red de seguridad.
    const distKm = isRecovery(label)
      ? null
      : (parseDistKm(b.distance_km) ?? distKmFromLabel(label));
    // Un bloque por distancia sobrevive aunque no tenga duracion parseable.
    if (!secs && distKm == null) return null;
    // OJO: no usar target_hr como fallback. Es un descriptor de pulso
    // ("moderada", "baja"), no de ritmo. Usarlo hace que sesiones de
    // gimnasio ("Sentadillas...") obtengan ritmos inventados.
    const pace = parseNumericPace(b.target_pace)
              || qualitativeToPace(b.target_pace, vdot);
    return { label, secs, pace, distKm };
  }
  // Formato A (builder manual): phase / pace / duration
  const label = b.phase || "";
  const secs = durationToSecs(b.duration);
  const distKm = isRecovery(label)
    ? null
    : (parseDistKm(b.distance_km) ?? distKmFromLabel(label));
  if (!secs && distKm == null) return null;
  const pace = parseNumericPace(b.pace) || qualitativeToPace(b.intensity, vdot);
  return { label, secs, pace, distKm };
}

const sectionOf = (label) => {
  const l = String(label).toLowerCase();
  if (/calent|warm/.test(l)) return "Warmup";
  if (/enfri|cool|vuelta a la calma/.test(l)) return "Cooldown";
  return null;
};

function isRecovery(label) {
  return /recovery|recuperaci|descanso|rest|trote|jog/.test(String(label).toLowerCase());
}

// Un bloque con distancia en el nombre ("400m") se exporta POR DISTANCIA
// ("0.4km"): el reloj marca la vuelta al cumplir los metros, como se corren
// los intervalos de verdad. Si no hay distancia, va por tiempo (comportamiento
// previo). Formato ICU de distancia: 400 m -> "0.4km" (ver encabezado, regla 4).
const stepLine = (s) => {
  const amount = s.distKm != null ? `${s.distKm}km` : secsToIcuDuration(s.secs);
  return s.pace ? `- ${amount} ${s.pace}/km Pace` : `- ${amount}`;
};

/**
 * Agrupa pares (trabajo + recuperacion) repetidos en "Main Set Nx".
 * Mejora la lectura y hace que el reloj muestre "Main Set 3/5".
 */
function groupRepeats(steps) {
  const out = [];
  let i = 0;
  while (i < steps.length) {
    if (i + 3 < steps.length) {
      const a = steps[i], b = steps[i + 1];
      if (isRecovery(b.label) && !isRecovery(a.label)) {
        const sig = (x, y) =>
          `${x.secs}|${x.distKm}|${x.pace}|${y.secs}|${y.distKm}|${y.pace}`;
        const base = sig(a, b);
        let reps = 1, j = i + 2;
        while (j + 1 < steps.length && sig(steps[j], steps[j + 1]) === base) {
          reps++; j += 2;
        }
        if (reps > 1) {
          out.push({ type: "repeat", reps, steps: [a, b] });
          i = j;
          continue;
        }
      }
    }
    out.push({ type: "single", step: steps[i] });
    i++;
  }
  return out;
}

/**
 * Expande bloques colapsados "Nx<dist>" ("8x400m", "4x100m", "6 x 800m") en N
 * bloques de trabajo individuales, cada uno por distancia. Si el bloque
 * SIGUIENTE es una recuperacion, la intercala entre repeticiones (N-1 copias) y
 * consume el bloque original, de modo que "8x400m + recuperacion" salga como los
 * intervalos separados que la IA deberia haber generado.
 *
 * Solo actua ante el patron "Nx" explicito (N>=2). Un bloque ya individual
 * ("Repeticion 1 - 400m", sin "Nx") NO se toca -> no duplica lo que ya funciona.
 */
function expandRepeatBlocks(structure) {
  const arr = Array.isArray(structure) ? structure : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i] || {};
    const name = String(b.phase ?? b.block_type ?? "");
    const m = name.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(km|m)(?![a-z])/i);
    const reps = m ? parseInt(m[1], 10) : 0;
    if (!m || reps < 2) { out.push(b); continue; }

    const unit = m[3].toLowerCase();
    const distKmVal = unit === "km" ? parseFloat(m[2]) : parseFloat(m[2]) / 1000;
    const distLabel = `${m[2]}${unit}`; // "400m"
    const isB = "block_type" in b || "target_pace" in b || "duration_min" in b;

    // ¿Recuperacion inmediatamente despues? Se intercala y se consume.
    const next = arr[i + 1];
    const recovery =
      next && isRecovery(String(next.phase ?? next.block_type ?? "")) ? next : null;

    for (let r = 1; r <= reps; r++) {
      const rep = { ...b };
      const repName = `Repetición ${r} - ${distLabel}`;
      if (isB) { rep.block_type = repName; delete rep.duration_min; }
      else { rep.phase = repName; delete rep.duration; }
      rep.distance_km = String(distKmVal); // dato explicito (nombre = respaldo)
      out.push(rep);
      if (recovery && r < reps) out.push({ ...recovery });
    }
    if (recovery) i++; // consumir el bloque de recuperacion original colapsado
  }
  return out;
}

/**
 * Convierte una fila de la tabla workouts al texto de intervals.icu.
 *
 * @param {object} workout - fila de workouts (usa structure o workout_structure)
 * @param {number} vdot    - VDOT del atleta (de athlete_evaluations.vdot)
 * @returns {string} texto para el campo 'description' del evento
 */
export function toIntervalsText(workout, vdot = 42.5) {
  const structure = expandRepeatBlocks(readStructure(workout));

  // Sin estructura: sesion simple desde duration_min
  if (!Array.isArray(structure) || structure.length === 0) {
    const mins = workout?.duration_min || 30;
    const p = pacesForVdot(vdot);
    const pace = p ? ` ${fmtPace(p.E[0])}-${fmtPace(p.E[1])}/km Pace` : "";
    return `Sesion\n- ${mins}m${pace}`;
  }

  const norm = structure.map((b) => normalizeBlock(b, vdot)).filter(Boolean);
  if (norm.length === 0) return `Sesion\n- ${workout?.duration_min || 30}m`;

  // Separar warmup y cooldown del cuerpo principal
  let start = 0, end = norm.length;
  const head = [], tail = [];
  if (sectionOf(norm[0].label) === "Warmup") { head.push(norm[0]); start = 1; }
  if (end > start && sectionOf(norm[end - 1].label) === "Cooldown") {
    tail.push(norm[end - 1]); end--;
  }
  const body = norm.slice(start, end);

  const lines = [];
  if (head.length) lines.push("", "Warmup", stepLine(head[0]));

  for (const g of groupRepeats(body)) {
    if (g.type === "repeat") {
      lines.push("", `Main Set ${g.reps}x`);
      for (const s of g.steps) lines.push(stepLine(s));
    } else {
      lines.push("", g.step.label || "Step", stepLine(g.step));
    }
  }

  if (tail.length) lines.push("", "Cooldown", stepLine(tail[0]));

  return lines.join("\n").trim();
}

/**
 * Construye el payload completo del evento para POST a
 * /api/v1/athlete/{id}/events?upsertOnUid=true
 *
 * external_id evita duplicados al reenviar el mismo workout.
 */
export function buildIntervalsEvent(workout, vdot = 42.5) {
  return {
    category: "WORKOUT",
    start_date_local: `${workout.scheduled_date}T06:00:00`,
    type: "Run",
    name: workout.title || "Entrenamiento",
    external_id: `raf-${workout.id}`,
    description: toIntervalsText(workout, vdot),
  };
}

/**
 * ¿Es un entrenamiento de CARRERA?
 *
 * No se puede confiar en workout.type: las sesiones de gimnasio se
 * catalogan como 'recovery', igual que los trotes suaves. Y no existe
 * un tipo 'strength' en la base.
 *
 * Regla: si ningun bloque produce un ritmo valido, no es carrera.
 * Una sesion de pesas tiene target_pace descriptivo ("Sentadillas,
 * peso muerto, 3 series x 12") que no mapea a ninguna zona.
 *
 * Estructura vacia -> se asume carrera simple (solo hay duracion).
 */
export function isRunWorkout(workout, vdot = 42.5) {
  const structure = readStructure(workout);
  if (!Array.isArray(structure) || structure.length === 0) return true;

  const withPace = structure
    .map((b) => normalizeBlock(b, vdot))
    .filter((s) => s && s.pace);

  return withPace.length > 0;
}
