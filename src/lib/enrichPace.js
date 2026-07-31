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
import { pacesForVdot, fmtPace } from "./vdot";

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

// Enriquece un structure con paces numericos derivados de target_hr.
// - Si target_pace ya es numerico (trae digitos), no lo toca.
// - Si no, deriva zona desde target_hr y escribe pace numerico en target_pace,
//   preservando la prosa original en description (para la UI).
// - Si no hay VDOT o no reconoce la zona, deja el bloque igual (no inventa).
export function enrichStructureWithPaces(structure, vdot, fcMax) {
  const arr = Array.isArray(structure) ? structure : [];
  if (!vdot) return arr; // sin VDOT no derivamos ritmos (igual que el envio)
  return arr.map((b) => {
    const rawPace = String(b?.target_pace || "").trim();
    if (/\d/.test(rawPace)) return b; // ya numerico
    const zone = zoneFromHrLabel(b?.target_hr, fcMax);
    if (!zone) return b;
    const paceStr = zoneToPaceStr(zone, vdot);
    if (!paceStr) return b;
    return {
      ...b,
      target_pace: paceStr,
      description: b?.description?.trim() ? b.description : rawPace,
    };
  });
}
