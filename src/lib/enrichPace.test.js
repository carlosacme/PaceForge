import { test } from "node:test";
import assert from "node:assert/strict";
import {
  athleteVisibleWorkoutDescription,
  rescaleStructureToVdot,
  stripEmbeddedPaceFromText,
  USE_LEGACY_PACE_TO_ZONE_RESCALE,
} from "./enrichPace.js";
import { paceRangeForZone, PLAN_CALIBRATION_VDOT } from "./vdot.js";

/** Ritmos de biblioteca / Garmin que Carlos midió en las 133 filas (~VDOT 47.2). */
const E_PACE = "5:38-6:08/km";
const M_PACE = "4:39/km";
const T_PACE = "4:23/km";

const EMBEDDED_PACE_LEFT = /(?:@\s*)?\d{1,2}:[0-5]\d(?:\s*[-–—]\s*\d{1,2}:[0-5]\d)?\s*(?:min\s*)?\/\s*km/i;

const REAL = {
  longProgresivo:
    `WU @ ${E_PACE} — 15' calentamiento E\n` +
    `45' E pace @ ${E_PACE}\n` +
    `15' M pace @ ${M_PACE}`,
  longProgresivoInline: `45' E pace @ ${E_PACE} + 15' M pace @ ${M_PACE}`,
  test3k:
    `TEST 3K - all-out\n` +
    `WU @ ${E_PACE} — 15' calentamiento E\n` +
    `3km all-out\n` +
    `CD @ ${E_PACE}`,
  cruise: `WU @ ${E_PACE}\n4x(1' @ ${T_PACE} + 1' @ ${E_PACE})\nCD @ ${E_PACE}`,
  fartlek: `Fartlek 4x(1' @ ${T_PACE} + 1' @ ${E_PACE})`,
  cuestas: `8x(45s @ ${T_PACE} + 90s @ ${E_PACE})`,
};

const WITHOUT_PACES = {
  longProgresivo: "Primera mitad en E, segunda mitad a ritmo M.",
  test3k: "Test de esfuerzo 3K. El bloque de medición va sin ritmo objetivo.",
  cruise: "Bloque continuo de umbral entre calentamiento y enfriamiento.",
  fartlek: "Diez cambios de ritmo de 1 minuto a I con 1 minuto trote suave.",
  cuestas: "Repeticiones en cuesta a R con trote de bajada.",
};

function assertNoEmbeddedPace(label, text) {
  assert.equal(EMBEDDED_PACE_LEFT.test(text), false, `${label} still has /km: ${text}`);
  assert.equal(/@\s*\d{1,2}:[0-5]\d/.test(text), false, `${label} still has @ m:ss: ${text}`);
}

test("Long Progresivo: quita @ m:ss/km y deja 45' E + 15' M pace", () => {
  const stripped = stripEmbeddedPaceFromText(REAL.longProgresivoInline);
  assertNoEmbeddedPace("Long Progresivo inline", stripped);
  assert.match(stripped, /45' E pace/);
  assert.match(stripped, /15' M pace/);
  assert.equal(stripped, "45' E pace + 15' M pace");

  const multiline = stripEmbeddedPaceFromText(REAL.longProgresivo);
  assertNoEmbeddedPace("Long Progresivo multiline", multiline);
  assert.match(multiline, /45' E pace/);
  assert.match(multiline, /15' M pace/);
  assert.match(multiline, /15' calentamiento E/);
});

test("TEST 3K: quita ritmos de WU/CD y deja all-out", () => {
  const stripped = stripEmbeddedPaceFromText(REAL.test3k);
  assertNoEmbeddedPace("TEST 3K", stripped);
  assert.match(stripped, /TEST 3K/);
  assert.match(stripped, /3km all-out/);
  assert.match(stripped, /calentamiento E/);
});

test("Cruise: 4x(1' … + 1' …) se lee bien sin ritmos", () => {
  const stripped = stripEmbeddedPaceFromText(REAL.cruise);
  assertNoEmbeddedPace("Cruise", stripped);
  assert.match(stripped, /4x\(1'/);
  assert.match(stripped, /\+\s*1'/);
  const visible = athleteVisibleWorkoutDescription("Cruise Intervals", REAL.cruise);
  assert.equal(visible.includes("4x(1' + 1')"), true, visible);
});

test("Fartlek: 4x(1' … + 1' …) se lee bien sin ritmos", () => {
  const stripped = stripEmbeddedPaceFromText(REAL.fartlek);
  assertNoEmbeddedPace("Fartlek", stripped);
  assert.match(stripped, /Fartlek 4x\(1'/);
  const visible = athleteVisibleWorkoutDescription("Fartlek 4x(1'/1') I", REAL.fartlek);
  assert.equal(visible, "Fartlek 4x(1' + 1')");
});

test("Cuestas: 8x(45s … + 90s …) se lee bien sin ritmos", () => {
  const stripped = stripEmbeddedPaceFromText(REAL.cuestas);
  assertNoEmbeddedPace("Cuestas", stripped);
  assert.match(stripped, /8x\(45s/);
  assert.match(stripped, /\+\s*90s/);
  const visible = athleteVisibleWorkoutDescription("8x45s cuesta R", REAL.cuestas);
  assert.equal(visible, "8x(45s + 90s)");
});

test("sin espacio antes del punto: I pace . Rec 1:1 → I pace. Rec 1:1", () => {
  const raw = `4x1km I pace @ ${T_PACE}. Rec 1:1`;
  const stripped = stripEmbeddedPaceFromText(raw);
  assertNoEmbeddedPace("I pace period", stripped);
  assert.equal(stripped, "4x1km I pace . Rec 1:1");
  assert.equal(
    athleteVisibleWorkoutDescription("Cruise Intervals", raw),
    "4x1km I pace. Rec 1:1",
  );
});

test("descripción sin ritmos /km queda igual", () => {
  for (const [name, text] of Object.entries(WITHOUT_PACES)) {
    assert.equal(stripEmbeddedPaceFromText(text), text, name);
    assert.equal(athleteVisibleWorkoutDescription(name, text), text, name);
  }
  assert.equal(stripEmbeddedPaceFromText(""), "");
  assert.equal(stripEmbeddedPaceFromText(null), "");
});

function pacesOf(structure) {
  return structure.map((s) => `${s.target_zone || s.zone || ""}:${s.target_pace || s.pace || ""}`);
}

test("rescale es idempotente: rescale(rescale(s,T),T) === rescale(s,T)", () => {
  assert.equal(USE_LEGACY_PACE_TO_ZONE_RESCALE, false);
  const s = [
    { block_type: "Calentamiento", description: "WU E pace", target_pace: "5:38-6:08", target_zone: "E" },
    { block_type: "Intervalo", description: "M pace", target_pace: "4:39" },
  ];
  const once = rescaleStructureToVdot(s, 41.3, PLAN_CALIBRATION_VDOT);
  const twice = rescaleStructureToVdot(once, 41.3, PLAN_CALIBRATION_VDOT);
  assert.deepEqual(pacesOf(twice), pacesOf(once));
  assert.equal(once[0].target_pace, paceRangeForZone("E", 41.3));
  assert.equal(once[1].target_pace, paceRangeForZone("M", 41.3));
});

test("entrada mezclada: zona guardada E + M a 47.2 → mismo target", () => {
  const s = [
    { block_type: "Calentamiento", target_pace: "6:24-5:49", target_zone: "E" },
    { block_type: "Intervalo", description: "15' M pace", target_pace: "4:39" },
  ];
  const out = rescaleStructureToVdot(s, 41.3, PLAN_CALIBRATION_VDOT);
  assert.equal(out[0].target_zone, "E");
  assert.equal(out[1].target_zone, "M");
  assert.equal(out[0].target_pace, paceRangeForZone("E", 41.3));
  assert.equal(out[1].target_pace, paceRangeForZone("M", 41.3));
  assert.deepEqual(pacesOf(rescaleStructureToVdot(out, 41.3, PLAN_CALIBRATION_VDOT)), pacesOf(out));
});

test("TEST 3K: all-out sin ritmo; WU no inventa I por el texto 3K", () => {
  const s = [
    { block_type: "Calentamiento", description: "WU E pace", target_pace: "5:38-6:08", target_zone: "E" },
    { block_type: "Intervalo", description: "3K all-out", distance_km: "3" },
    { block_type: "Enfriamiento", description: "CD E pace", target_pace: "5:38-6:08" },
  ];
  const out = rescaleStructureToVdot(s, 41.3, PLAN_CALIBRATION_VDOT);
  assert.equal(out[1].target_pace, undefined);
  assert.equal(out[1].pace, undefined);
  assert.equal(out[0].target_zone, "E");
  assert.equal(out[2].target_zone, "E");
  assert.equal(out[0].target_pace, paceRangeForZone("E", 41.3));
});

test("Long Progresivo: E y M del mismo VDOT; descripción visible sin /km", () => {
  const s = [
    { block_type: "Intervalo", description: "50' E pace @ 5:38-6:08/km", target_pace: "6:38-6:03" },
    { block_type: "Intervalo", description: "10' M pace @ 4:39/km", target_pace: "5:18-5:12" },
  ];
  const out = rescaleStructureToVdot(s, 41.3, 41.3);
  assert.equal(out[0].target_zone, "E");
  assert.equal(out[1].target_zone, "M");
  assert.equal(out[0].target_pace, paceRangeForZone("E", 41.3));
  assert.equal(out[1].target_pace, paceRangeForZone("M", 41.3));
  const visible = athleteVisibleWorkoutDescription(
    "Long Progresivo",
    `50' E pace @ 5:38-6:08/km + 10' M pace @ 4:39/km`,
  );
  assert.equal(visible.includes("/km"), false);
  assert.match(visible, /50' E pace/);
  assert.match(visible, /10' M pace/);
});

test("recovery más lento que E, sin zona, intacto", () => {
  const s = [{ block_type: "Recuperación", target_pace: "7:30-7:00" }];
  const out = rescaleStructureToVdot(s, 41.3, PLAN_CALIBRATION_VDOT);
  assert.equal(out[0].target_pace, "7:30-7:00");
  assert.equal(out[0].target_zone, undefined);
});
