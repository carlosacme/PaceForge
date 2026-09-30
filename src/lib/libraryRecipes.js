/**
 * Expande recetas compactas de biblioteca al JSON real de workout_library.
 * Los ritmos salen de vdot.js a PLAN_CALIBRATION_VDOT (47.2), la misma fuente
 * que rescaleStructureToVdot / enrichPace.
 */
import { durationToSecs } from "./intervals.js";
import { pacesForVdot, paceRangeForZone, PLAN_CALIBRATION_VDOT } from "./vdot.js";

export const RECIPE_ZONES = ["E", "M", "HM", "T", "T10", "I", "R"];
export const RECIPE_TYPES = ["easy", "tempo", "interval", "long", "recovery", "race"];

const asDurationMin = (value) => {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 1) return `${Math.round(value * 60)} sec`;
    return String(value);
  }
  return String(value).trim();
};

function structureBlock({
  block_type,
  duration_min,
  distance_km,
  zone,
  description,
  phase,
  block_label,
}) {
  const o = {
    block_type,
    phase: phase || block_type,
  };
  if (block_label) o.block_label = block_label;
  const dur = asDurationMin(duration_min);
  if (dur) {
    o.duration_min = dur;
    o.duration = dur;
  }
  if (distance_km != null && String(distance_km).trim() !== "") {
    o.distance_km = String(distance_km);
  }
  if (zone) {
    const pace = paceRangeForZone(zone, PLAN_CALIBRATION_VDOT);
    if (!pace) throw new Error(`Zona desconocida o VDOT inválido: ${zone}`);
    o.target_pace = pace;
    o.pace = pace;
  }
  if (description) o.description = description;
  return o;
}

function expandOneBlock(block) {
  if (!block || typeof block !== "object") {
    throw new Error("Cada bloque de la receta debe ser un objeto");
  }
  const block_type = String(block.block_type || "").trim() || "Intervalo";
  const reps = Math.max(1, Math.round(Number(block.reps) || 1));
  const distLabel = String(block.name || "").trim();
  const zone = block.zone ? String(block.zone).trim().toUpperCase() : "";
  if (zone && !RECIPE_ZONES.includes(zone)) {
    throw new Error(`Zona inválida "${block.zone}" (usa ${RECIPE_ZONES.join("/")})`);
  }

  if (reps === 1) {
    const phase = distLabel || block_type;
    return [
      structureBlock({
        block_type,
        duration_min: block.duration_min ?? block.duration,
        distance_km: block.distance_km,
        zone,
        description: block.description || block.text,
        phase,
        block_label: distLabel && distLabel !== block_type ? distLabel : "",
      }),
    ];
  }

  const out = [];
  const recover = block.recover && typeof block.recover === "object" ? block.recover : null;
  for (let i = 1; i <= reps; i++) {
    const label = distLabel ? `Repetition ${i} - ${distLabel}` : `Repetition ${i}`;
    out.push(
      structureBlock({
        block_type: "Intervalo",
        duration_min: block.duration_min ?? block.duration,
        distance_km: block.distance_km,
        zone,
        description: block.description || block.text,
        phase: label,
        block_label: label,
      }),
    );
    if (recover && i < reps) {
      const recZone = recover.zone ? String(recover.zone).trim().toUpperCase() : "";
      out.push(
        structureBlock({
          block_type: "Recuperación",
          duration_min: recover.duration_min ?? recover.duration,
          distance_km: recover.distance_km,
          zone: recZone,
          description: recover.description || recover.text,
          phase: "Recuperación",
        }),
      );
    }
  }
  return out;
}

function blockMin(block) {
  const secs = durationToSecs(block?.duration_min ?? block?.duration);
  if (secs != null && secs > 0) return secs / 60;
  const km = Number(String(block?.distance_km ?? "").replace(",", "."));
  if (!(Number.isFinite(km) && km > 0)) return 0;
  const pace = String(block?.target_pace || block?.pace || "");
  const p = pacesForVdot(PLAN_CALIBRATION_VDOT);
  // Si hay ritmo numérico, durationToSecs no aplica; usar el centro del rango.
  const range = pace.match(/(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)/);
  const one = pace.match(/(\d{1,2}):([0-5]\d)/);
  let secsPerKm = null;
  if (range) {
    const a = +range[1] * 60 + +range[2];
    const b = +range[3] * 60 + +range[4];
    secsPerKm = (a + b) / 2;
  } else if (one) {
    secsPerKm = +one[1] * 60 + +one[2];
  }
  if (secsPerKm == null && p) secsPerKm = (p.E[0] + p.E[1]) / 2;
  if (secsPerKm == null) return 0;
  return (km * secsPerKm) / 60;
}

function inferredKm(block) {
  const explicit = Number(String(block?.distance_km ?? "").replace(",", "."));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const mins = durationToSecs(block?.duration_min ?? block?.duration);
  if (mins == null || mins <= 0) return 0;
  const pace = String(block?.target_pace || block?.pace || "");
  const range = pace.match(/(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)/);
  const one = pace.match(/(\d{1,2}):([0-5]\d)/);
  let secsPerKm = null;
  if (range) {
    const a = +range[1] * 60 + +range[2];
    const b = +range[3] * 60 + +range[4];
    secsPerKm = (a + b) / 2;
  } else if (one) {
    secsPerKm = +one[1] * 60 + +one[2];
  }
  if (secsPerKm == null) return 0;
  return mins / secsPerKm;
}

export function expandLibraryRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") throw new Error("Receta vacía");
  const seed_key = String(recipe.seed_key || "").trim();
  if (!seed_key) throw new Error("Falta seed_key");
  const type = String(recipe.type || "easy").trim();
  if (!RECIPE_TYPES.includes(type)) throw new Error(`type inválido: ${type}`);
  const title = String(recipe.title || "").trim();
  if (!title) throw new Error(`Falta title en ${seed_key}`);
  const is_fitness_test = recipe.is_fitness_test === true;
  const blocks = Array.isArray(recipe.blocks) ? recipe.blocks : [];
  if (!blocks.length) throw new Error(`Falta blocks en ${seed_key}`);

  const structure = blocks.flatMap(expandOneBlock);
  const computedKm = Math.round(structure.reduce((s, b) => s + inferredKm(b), 0) * 10) / 10;
  const computedMin = Math.round(structure.reduce((s, b) => s + blockMin(b), 0));
  const total_km =
    recipe.total_km != null && Number.isFinite(Number(recipe.total_km))
      ? Number(recipe.total_km)
      : computedKm;
  const duration_min =
    recipe.duration_min != null && Number.isFinite(Number(recipe.duration_min))
      ? Math.round(Number(recipe.duration_min))
      : computedMin;

  return {
    seed_key,
    title,
    type,
    workout_type: type,
    category: String(recipe.category || "").trim() || null,
    is_fitness_test,
    is_system: true,
    description: recipe.description != null ? String(recipe.description) : "",
    total_km,
    distance_km: total_km,
    duration_min,
    structure,
  };
}

export function expandLibraryRecipes(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  const keys = new Set();
  return list.map((r) => {
    const row = expandLibraryRecipe(r);
    if (keys.has(row.seed_key)) throw new Error(`seed_key duplicada: ${row.seed_key}`);
    keys.add(row.seed_key);
    return row;
  });
}
