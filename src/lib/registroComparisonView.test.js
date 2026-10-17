import { test } from "node:test";
import assert from "node:assert/strict";
import { compareBlocks, UNGUIDED_MESSAGE } from "./blockComparison.js";
import {
  kindBadge,
  showsDelta,
  deltaDisplay,
  plannedObjectiveText,
  actualText,
  shouldShowKmSplits,
  isUnguidedComparison,
  blockStatusNote,
  extraLabel,
} from "./registroComparisonView.js";

const VDOT_PUSH = 43.37;

function lap({ t, d, hr = 140, type = "WORK" }) {
  return { moving_time: t, distance: d, average_heartrate: hr, type };
}

function test3kStructure() {
  const rec = {
    block_type: "Recuperación",
    description: "Rec 6:30-7:05/km",
    duration_min: "1",
    distance_km: "",
    target_pace: "6:30-7:05/km",
  };
  const fast = {
    block_type: "Intervalo",
    description: "activación R pace",
    duration_min: "1",
    distance_km: "",
    target_pace: "4:02-3:56",
  };
  return [
    { block_type: "Calentamiento", description: "WU", duration_min: "15", distance_km: "", target_pace: "6:24-5:49" },
    fast, rec, fast, rec, fast, rec, fast, rec,
    { block_type: "Recuperación", description: "Descanso 180s", duration_min: "3", distance_km: "", target_pace: "" },
    { block_type: "Intervalo", description: "3K all-out", duration_min: "", distance_km: "3", target_pace: "" },
    { block_type: "Enfriamiento", description: "CD", duration_min: "10", distance_km: "", target_pace: "6:24-5:49" },
  ];
}

function lapsOnePerBlock() {
  const pair = [
    lap({ t: 60, d: 250, hr: 150, type: "WORK" }),
    lap({ t: 60, d: 140, hr: 130, type: "RECOVERY" }),
  ];
  return [
    lap({ t: 900, d: 2400, hr: 128, type: "WORK" }),
    ...pair, ...pair, ...pair, ...pair,
    lap({ t: 180, d: 50, hr: 110, type: "RECOVERY" }),
    lap({ t: 752, d: 3000, hr: 155, type: "WORK" }),
    lap({ t: 598, d: 1820, hr: 140, type: "WORK" }),
  ];
}

test("TEST 3K 12 bloques: etiquetas RÁPIDO / RECUPERACIÓN / WU / CD", () => {
  const result = compareBlocks({
    structure: test3kStructure(),
    laps: lapsOnePerBlock(),
    vdot: VDOT_PUSH,
  });
  assert.equal(result.mode, "matched");
  assert.equal(result.blocks.length, 12);
  assert.equal(kindBadge(result.blocks[0]).text, "CALENTAMIENTO");
  assert.equal(kindBadge(result.blocks[1]).text, "RÁPIDO");
  assert.equal(kindBadge(result.blocks[2]).text, "RECUPERACIÓN");
  assert.equal(kindBadge(result.blocks[9]).text, "RECUPERACIÓN");
  assert.equal(kindBadge(result.blocks[10]).text, "RÁPIDO");
  assert.equal(kindBadge(result.blocks[11]).text, "ENFRIAMIENTO");
  assert.equal(kindBadge(result.blocks[1]).key, "fast");
  assert.equal(kindBadge(result.blocks[2]).key, "recovery");
  assert.notEqual(kindBadge(result.blocks[1]).bg, kindBadge(result.blocks[2]).bg);
  assert.equal(showsDelta(result.blocks[2]), false);
  assert.equal(showsDelta(result.blocks[9]), false);
  assert.equal(deltaDisplay(result.blocks[9]).text, "—");
  assert.equal(shouldShowKmSplits(result), false);
  assert.match(plannedObjectiveText(result.blocks[0]), /\/km/);
  assert.match(actualText(result.blocks[10]), /3\.00 km/);
});

test("rodaje 10 km: una fila RODAJE + km_splits visibles", () => {
  const result = compareBlocks({
    structure: [{ block_type: "Rodaje", distance_km: "10", target_pace: "6:24-5:49" }],
    laps: Array.from({ length: 10 }, () => lap({ t: 360, d: 1000 })),
    vdot: VDOT_PUSH,
  });
  assert.equal(result.blocks.length, 1);
  assert.equal(kindBadge(result.blocks[0]).text, "RODAJE");
  assert.equal(result.blocks[0].fused_label, "10 vueltas");
  assert.equal(shouldShowKmSplits(result), true);
  assert.equal(isUnguidedComparison(result), false);
});

test("unguided auto-lap: mensaje + km_splits, sin tabla de bloques", () => {
  const laps = Array.from({ length: 9 }, (_, i) => lap({ t: 350 + i, d: 1000 + i }));
  const result = compareBlocks({
    structure: test3kStructure(),
    laps,
    vdot: VDOT_PUSH,
  });
  assert.equal(isUnguidedComparison(result), true);
  assert.equal(result.message, UNGUIDED_MESSAGE);
  assert.equal(result.blocks.length, 0);
  assert.equal(shouldShowKmSplits(result), true);
  assert.equal(result.km_splits.length, 9);
});

test("incompleto y extra no se etiquetan como fallo", () => {
  assert.equal(blockStatusNote({ no_data: true }), "Sin datos del reloj");
  assert.equal(blockStatusNote({ incomplete: true, no_data: false }), "Registro parcial");
  assert.equal(extraLabel({ reason: "glitch", name: "Vuelta 1" }), "Vuelta muy corta");
  assert.equal(extraLabel({ reason: "unmatched", name: "Vuelta 3" }), "Vuelta 3");
});
