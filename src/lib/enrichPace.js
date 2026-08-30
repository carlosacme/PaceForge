/**
 * src/lib/enrichPace.js
 * -----------------------------------------------------------
 * Deriva ritmos numericos (target_pace) desde la senal de FC
 * (target_hr) de un bloque, usando el VDOT del atleta.
 *
 * Motivo: la IA suele codificar el esfuerzo en la zona de FC
 * (target_hr = "Z2", "Z3-Z4") y dejar target_pace vago o vacio.
 * El envio al reloj (isRunWorkout / normalizeBlock) NO usa target_hr
 * como fallback a proposito (una sesion de gym con "target_hr" no debe
 * inventar ritmos), asi que esos workouts se marcan "sin ritmos" y no
 * llegan al reloj. Este helper corre ANTES del insert a `workouts`,
 * cuando ya tenemos el atleta y podemos resolver su VDOT, y escribe un
 * target_pace numerico limpio que el reloj si entiende.
 *
 * Fuente unica de ritmos: vdot.js (misma que qualitativeToPace).
 * -----------------------------------------------------------
 */
// Con extension: este modulo tambien se importa desde api/ (serverless), y ahi
// manda la resolucion de Node, que no adivina la extension como Vite.
import { pacesForVdot, fmtPace, paceToZone, PLAN_CALIBRATION_VDOT } from "./vdot.js";
import { EFFORT_TO_ZONE } from "./intervals.js";

// Zona FC (Z1-Z5) -> zona Daniels de ritmo (E/M/T/I).
// Z3="Aerobico tempo" mapea a M (maraton/steady), NO a T: a 70-80% FCmax
// el estimulo es aerobico, no de umbral. R (repeticiones) no tiene zona FC
// fiable (es neuromuscular), por eso no aparece aqui.
const HR_ZONE_TO_DANIELS = { 1: "E", 2: "E", 3: "M", 4: "T", 5: "I" };

// Deriva zona Daniels desde un string de target_hr. Cubre tres formas:
//   (a) "... - T pace"        -> etiqueta explicita
//   (b) "Z3-Z4 (...)"         -> zona FC (rango: toma el extremo SUPERIOR)
//   (c) "150-160 bpm"         -> bpm crudos: convierte a %fcMax
// Devuelve null si no reconoce nada (para no inventar ritmos en gym).
function zoneFromHrLabel(targetHr, fcMax) {
  const s = String(targetHr || "").toLowerCase();
  if (!s) return null;
  // (a) etiqueta explicita "- t pace" / "- e pace" / "- t10 pace"
  const paceTag = s.match(/-\s*(t10|hm|[emtir])\s*pace/i);
  if (paceTag) return paceTag[1].toUpperCase();
  // (b) zonas Zx: toma la mas alta si es rango "z3-z4"
  const zoneNums = [...s.matchAll(/z\s*([1-5])/g)].map((m) => Number(m[1]));
  if (zoneNums.length) {
    const highest = Math.max(...zoneNums);
    return HR_ZONE_TO_DANIELS[highest] || null;
  }
  // (c) bpm crudos "150-160 bpm" -> %fcMax -> zona
  if (fcMax && /\bbpm\b/.test(s)) {
    const bpms = [...s.matchAll(/(\d{2,3})/g)].map((m) => Number(m[1]));
    if (bpms.length) {
      const hi = Math.max(...bpms);            // extremo superior, coherente con (b)
      const pct = hi / Number(fcMax);
      const z = pct >= 0.9 ? 5 : pct >= 0.8 ? 4 : pct >= 0.7 ? 3 : pct >= 0.6 ? 2 : 1;
      return HR_ZONE_TO_DANIELS[z] || null;
    }
  }
  return null;
}

// Zona Daniels -> pace numerico "m:ss-m:ss" via pacesForVdot (misma fuente
// que usa el envio al reloj en qualitativeToPace). Emite RANGO siempre,
// porque el reloj necesita rango, no valor unico.
function zoneToPaceStr(zone, vdot) {
  const p = pacesForVdot(vdot);
  if (!p) return null;
  const v = p[zone];
  if (v === undefined) return null;
  if (Array.isArray(v)) return `${fmtPace(v[0])}-${fmtPace(v[1])}`;
  return `${fmtPace(v + 3)}-${fmtPace(v - 3)}`; // ±3s, igual que qualitativeToPace
}

// Enriquece un structure con paces numericos. Orden de resolucion:
//   0) Si target_pace ya es un pace numerico REAL (m:ss), no lo toca. Ojo:
//      NO basta con "trae digitos" -> "5k pace" / "10k pace" son etiquetas de
//      ritmo legitimas con digito incidental y deben pasar al enriquecido.
//   1) Etiqueta cualitativa conocida en target_pace ("5k pace", "tempo") via
//      EFFORT_TO_ZONE (misma fuente que qualitativeToPace en el envio al reloj).
//   2) Si no, deriva la zona desde target_hr (zona FC, "- X pace", o bpm crudos).
// Preserva la prosa original en description (para la UI). Si no hay VDOT o no
// reconoce la zona, deja el bloque igual (no inventa ritmos en gym).
export function enrichStructureWithPaces(structure, vdot, fcMax) {
  const arr = Array.isArray(structure) ? structure : [];
  if (!vdot) return arr; // sin VDOT no derivamos ritmos (igual que el envio)
  return arr.map((b) => {
    // Detectar formato: A usa pace/intensity, B usa target_pace/target_hr.
    const bPace = String(b?.target_pace ?? "").trim();
    const aPace = String(b?.pace ?? "").trim();
    const rawPace = bPace || aPace;
    const hrLabel = String(b?.target_hr ?? b?.intensity ?? "").trim();
    // Escribir de vuelta en el mismo campo que trae el pace (preserva formato).
    const paceField = bPace ? "target_pace" : aPace ? "pace" : "target_pace";

    if (/\d+:\d{2}/.test(rawPace)) return b; // ya es pace numerico real
    // 1) etiqueta cualitativa conocida en el pace ("5k pace", "tempo")
    let zone = EFFORT_TO_ZONE[rawPace.toLowerCase()] || null;
    // 2) si no, derivar de la zona de FC (target_hr o intensity)
    if (!zone) zone = zoneFromHrLabel(hrLabel, fcMax);
    if (!zone) return b; // no reconocido: no inventar
    const paceStr = zoneToPaceStr(zone, vdot);
    if (!paceStr) return b;
    return {
      ...b,
      [paceField]: paceStr,
      description: b?.description?.trim() ? b.description : rawPace,
    };
  });
}

/** Ritmo de carrera en prosa: "5:38-6:08/km", "3:43/km", "3:43 min/km", opcional "@ ". */
const EMBEDDED_PACE_RE =
  /(?:@\s*)?\d{1,2}:[0-5]\d(?:\s*[-–—]\s*\d{1,2}:[0-5]\d)?\s*(?:min\s*)?\/\s*km/gi;

const TEST_TITLE_RE = /TEST\s*\d*K/i;
const TEST_OBJETIVO_VDOT_RE =
  /Objetivo:\s*\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s*\(VDOT\s*\d+(?:\s*[-–—]\s*\d+)?\)/gi;
const TEST_OBJETIVO_TIME_RE =
  /\bobjetivo\s+\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?/gi;
const TEST_EFFORT_COPY = "corre a tu máximo esfuerzo sostenible";

export function isTestWorkoutTitle(title) {
  return TEST_TITLE_RE.test(String(title || ""));
}

/** Bloque de MEDICIÓN del TEST. WU, activación, rec y CD no calzan. */
const TEST_MEASUREMENT_RE = /all[\s-]?out/i;
const TEST_PRESCRIPTION_RE = /calent|warm|enfri|cool|recuper|descanso|rest|trote|jog/i;

function testDistanceKmFromTitle(title) {
  const m = String(title || "").match(/TEST\s*(\d+)\s*K/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isTestMeasurementBlock(block, title = "") {
  const label = String(block?.block_type || block?.phase || "");
  if (TEST_PRESCRIPTION_RE.test(label)) return false;
  const haystack = [block?.description, block?.block_type, block?.phase, block?.block_label]
    .filter(Boolean)
    .join(" ");
  if (TEST_MEASUREMENT_RE.test(haystack)) return true;
  const testKm = testDistanceKmFromTitle(title);
  const blockKm = Number(String(block?.distance_km ?? "").replace(",", "."));
  return testKm != null && Number.isFinite(blockKm) && Math.abs(blockKm - testKm) < 0.05;
}

function clearPrescribedPace(block) {
  const next = { ...block, target_pace: "" };
  if ("pace" in next) next.pace = "";
  if ("target_zone" in next) delete next.target_zone;
  return next;
}

/**
 * En TEST (título tipo "TEST 10K"): quita el reloj-objetivo del plan importado
 * ("Objetivo: 40:00-41:00 (VDOT 46-47)") y el "objetivo mm:ss" suelto.
 * Misma función para la descripción del workout y la de cada paso.
 * Un TEST 3K sin objetivo queda igual. No-TEST no se toca.
 */
export function stripTestTimeGoalFromDescription(title, description) {
  const raw = String(description ?? "");
  if (!isTestWorkoutTitle(title) || !raw) return raw;
  let out = raw.replace(TEST_OBJETIVO_VDOT_RE, TEST_EFFORT_COPY);
  out = out.replace(TEST_OBJETIVO_TIME_RE, "");
  out = out.replace(/[ \t]+$/gm, "");
  out = out.replace(/[ \t]*[-–—]\s*$/gm, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * En TEST: limpia el reloj-objetivo de cada paso y deja el bloque all-out
 * sin ritmo prescrito. WU, activaciones y enfriamiento conservan el suyo:
 * esos sí son prescripción. Vaciar el all-out evita que el reloj ancle el
 * esfuerzo al VDOT que el test viene a re-medir.
 */
export function stripTestTimeGoalsFromStructure(title, structure) {
  const arr = Array.isArray(structure) ? structure : [];
  if (!isTestWorkoutTitle(title)) return arr;
  const out = arr.map((b) => {
    if (!b) return b;
    const description = b.description
      ? stripTestTimeGoalFromDescription(title, b.description)
      : b.description;
    const next = description !== b.description ? { ...b, description } : b;
    const match = isTestMeasurementBlock(next, title);
    const cleared = match ? clearPrescribedPace(next) : next;
    return { next: cleared, match, before: next };
  });
  const clearedAPace = out.some(({ match, before }) => {
    const pace = String(before?.target_pace ?? before?.pace ?? "").trim();
    return match && pace !== "";
  });
  if (clearedAPace) {
    console.log("[test-open-pace]", JSON.stringify({
      title,
      blocks: out.map(({ next, match, before }) => ({
        block_type: before?.block_type || "",
        phase: before?.phase || "",
        description: before?.description || "",
        distance_km: before?.distance_km ?? "",
        match,
        paceBefore: before?.target_pace ?? before?.pace ?? "",
        paceAfter: next?.target_pace ?? "",
      })),
    }));
  }
  return out.map(({ next }) => next);
}

/** Quita "m:ss/km" o "m:ss-m:ss/km" de un texto libre. Deja el resto. */
export function stripEmbeddedPaceFromText(text) {
  const raw = String(text ?? "");
  if (!raw) return raw;
  let out = raw.replace(EMBEDDED_PACE_RE, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/^(?:[@·|,;:\-–—]\s*)+|(?:\s*[@·|,;:\-–—])+$/g, "").trim();
  out = out.replace(/\s+(?:[@·|,;:\-–—])\s+/g, " — ");
  return out;
}

/**
 * Reescala los ritmos ABSOLUTOS de una estructura al VDOT objetivo del atleta.
 *
 * Los workouts importados a la biblioteca traen ritmos fijos, escritos a un VDOT
 * concreto (PLAN_CALIBRATION_VDOT). Asignados tal cual, un atleta mas rapido
 * entrena por debajo de lo que le toca y uno mas lento por encima, porque nadie
 * los recalcula: enrichStructureWithPaces se salta los bloques que ya traen un
 * ritmo numerico (es un relleno, no un recalculador) y normalizeBlock prioriza
 * el ritmo guardado sobre el VDOT al enviar al reloj.
 *
 * Va en dos pasos: del ritmo se deduce la zona con el VDOT de calibracion, y la
 * zona se vuelve a escribir con el VDOT objetivo. Un bloque cuyo ritmo no
 * corresponda a ninguna zona se deja INTACTO: es el caso de los trotes de
 * recuperacion, deliberadamente mas lentos que E, y de cualquier ritmo escrito a
 * mano que no encaje. Preferimos dejarlo como estaba a inventar una zona.
 *
 * La zona deducida se guarda en target_zone para poder auditar la conversion.
 *
 * Si la description trae un ritmo embebido con /km (tipico del JSON Garmin:
 * "WU @ 5:38-6:08/km — 15' calentamiento E"), se QUITA ese fragmento. El ritmo
 * vigente queda solo en target_pace. No se reemplaza: los Garmin varían y un
 * swap a ciegas rompería "MARATON 3:15" o splits "4:40→4:37" (no llevan /km).
 * Un bloque que no se reescala se deja intacto, description incluida.
 */
export function rescaleStructureToVdot(structure, targetVdot, calibrationVdot = PLAN_CALIBRATION_VDOT) {
  const arr = Array.isArray(structure) ? structure : [];
  if (!pacesForVdot(targetVdot)) return arr; // sin VDOT objetivo no se toca nada
  return arr.map((b) => {
    const bPace = String(b?.target_pace ?? "").trim();
    const aPace = String(b?.pace ?? "").trim();
    const rawPace = bPace || aPace;
    if (!rawPace) return b;
    const zone = paceToZone(rawPace, calibrationVdot);
    if (!zone) return b;
    const paceStr = zoneToPaceStr(zone, targetVdot);
    if (!paceStr) return b;
    const next = { ...b, [bPace ? "target_pace" : "pace"]: paceStr, target_zone: zone };
    if (next.description) {
      next.description = stripEmbeddedPaceFromText(next.description);
    }
    return next;
  });
}
