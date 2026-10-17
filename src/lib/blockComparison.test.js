import { test } from "node:test";
import assert from "node:assert/strict";
import { pacesForVdot } from "./vdot.js";
import {
  compareBlocks,
  compareBlockRows,
  zoneForEffort,
  classifyPlanKind,
  UNGUIDED_MESSAGE,
  unguidedBlocksPrompt,
} from "./blockComparison.js";

const VDOT_PUSH = 43.37;
const VDOT_NOW = 40.37;

function eCenter(vdot) {
  const p = pacesForVdot(vdot);
  return (p.E[0] + p.E[1]) / 2;
}

function lap({ t, d, hr = 140, type = "WORK" }) {
  return { moving_time: t, distance: d, average_heartrate: hr, type };
}

/** Plan anonimo de TEST 3K (12 bloques), ritmos ya horneados al VDOT del push. */
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

/** 12 vueltas, una por bloque (golden i). 3 km = 12:32 / 4:10. */
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

test("zoneForEffort vacio no cae a Easy", () => {
  assert.equal(zoneForEffort(""), null);
  assert.equal(zoneForEffort("   "), null);
  assert.equal(zoneForEffort("easy jog"), "E");
});

test("classifyPlanKind distingue rest de recovery con trote", () => {
  assert.equal(classifyPlanKind({ block_type: "Recuperación", description: "Descanso 180s" }), "rest");
  assert.equal(classifyPlanKind({ block_type: "Recuperación", description: "Rec 6:30-7:05/km" }), "recovery");
  assert.equal(classifyPlanKind({ block_type: "Intervalo", description: "3K all-out" }), "work");
  assert.equal(classifyPlanKind({ block_type: "Enfriamiento" }), "cooldown");
});

test("ritmo previsto usa VDOT del push, no el vigente; aviso si difieren", () => {
  const structure = [
    { block_type: "Rodaje", description: "easy jog", duration_min: "20", target_pace: "easy jog" },
  ];
  const laps = [lap({ t: 1200, d: 3200 })];
  const result = compareBlocks({
    structure,
    laps,
    vdot: VDOT_PUSH,
    currentVdot: VDOT_NOW,
  });
  assert.equal(result.mode, "matched");
  assert.ok(result.vdot_warning);
  assert.equal(result.vdot_warning.generated_vdot, VDOT_PUSH);
  assert.equal(result.vdot_warning.current_vdot, VDOT_NOW);
  const planned = result.blocks[0].planned_pace_s;
  assert.ok(Math.abs(planned - eCenter(VDOT_PUSH)) < 0.5);
  assert.ok(Math.abs(planned - eCenter(VDOT_NOW)) > 10);
});

test("sin objetivo prescrito nunca hereda Easy", () => {
  const structure = [
    { block_type: "Intervalo", description: "3K all-out", duration_min: "", distance_km: "3", target_pace: "" },
  ];
  const laps = [lap({ t: 752, d: 3000 })];
  const result = compareBlocks({ structure, laps, vdot: VDOT_PUSH, currentVdot: VDOT_NOW });
  assert.equal(result.blocks[0].has_objective, false);
  assert.equal(result.blocks[0].planned_pace_s, null);
  assert.equal(result.blocks[0].delta_s, null);
  assert.equal(result.blocks[0].target_zone, null);
  assert.ok(result.blocks[0].actual_pace_s > 240 && result.blocks[0].actual_pace_s < 260);
});

test("(i) vueltas = bloques: match 1:1, 3 km no se fusiona al enfriamiento", () => {
  const result = compareBlocks({
    structure: test3kStructure(),
    laps: lapsOnePerBlock(),
    vdot: VDOT_PUSH,
  });
  assert.equal(result.mode, "matched");
  assert.equal(result.message, null);
  assert.equal(result.blocks.length, 12);
  assert.equal(result.extra.length, 0);

  const k3 = result.blocks[10];
  assert.equal(k3.no_data, false);
  assert.equal(k3.has_objective, false);
  assert.equal(k3.planned_pace_s, null);
  assert.equal(k3.delta_s, null);
  assert.equal(k3.actual_dur_s, 752);
  assert.equal(k3.actual_dist_m, 3000);
  assert.ok(Math.abs(k3.actual_pace_s - 752 / 3) < 1e-6);
  assert.equal(k3.fused, false);

  const cd = result.blocks[11];
  assert.equal(cd.actual_dur_s, 598);
  assert.equal(cd.actual_dist_m, 1820);
  assert.equal(cd.fused, false);
  assert.equal(cd.splits.length, 1);

  const rest = result.blocks[9];
  assert.equal(rest.kind, "rest");
  assert.equal(rest.delta_s, null);
  assert.equal(rest.actual_dur_s, 180);
  assert.equal(rest.actual_hr, 110);
});

test("(ii) menos vueltas que bloques: no rebanar, unguided", () => {
  const laps = [
    lap({ t: 4, d: 0, type: "RECOVERY" }),
    lap({ t: 1576, d: 4492.46, hr: 146, type: "WORK" }),
  ];
  const result = compareBlocks({
    structure: test3kStructure(),
    laps,
    vdot: VDOT_PUSH,
    kmSplits: [
      { dur_s: 356, dist_m: 1000, hr: 140 },
      { dur_s: 331, dist_m: 1000, hr: 150 },
    ],
  });
  assert.equal(result.mode, "unguided");
  assert.equal(result.message, UNGUIDED_MESSAGE);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.blocks.some((b) => b?.delta_s != null), false);
  assert.ok(result.summary.actual_dist_m > 4400);
  assert.equal(result.km_splits.length, 2);
  assert.ok(result.extra.some((e) => e.reason === "glitch"));
  assert.ok(result.extra.some((e) => e.reason === "unmatched" && e.dur_s === 1576));
});

test("(iii) mas vueltas que bloques: glitch y sobrante a Extra, no al CD", () => {
  const laps = [
    ...lapsOnePerBlock(),
    lap({ t: 0.5, d: 2, type: "RECOVERY" }),
    lap({ t: 80, d: 200, hr: 120, type: "WORK" }),
  ];
  const result = compareBlocks({
    structure: test3kStructure(),
    laps,
    vdot: VDOT_PUSH,
  });
  assert.equal(result.mode, "matched");
  const cd = result.blocks[11];
  assert.equal(cd.actual_dist_m, 1820);
  assert.equal(cd.fused, false);
  assert.ok(result.extra.some((e) => e.reason === "glitch" && e.dur_s === 1 || e.dur_s === 0));
  assert.ok(result.extra.some((e) => e.reason === "unmatched" && e.dist_m === 200));
});

test("(iv) rodaje de un ritmo: una fila, km como splits fusionados", () => {
  const structure = [
    { block_type: "Rodaje", description: "Easy", duration_min: "50", target_pace: "6:24-5:49" },
  ];
  const laps = Array.from({ length: 8 }, () => lap({ t: 360, d: 1000, hr: 135 }));
  const result = compareBlocks({ structure, laps, vdot: VDOT_PUSH });
  assert.equal(result.mode, "matched");
  assert.equal(result.blocks.length, 1);
  const b = result.blocks[0];
  assert.equal(b.fused, true);
  assert.equal(b.fused_label, "8 vueltas");
  assert.equal(b.splits.length, 8);
  assert.equal(b.actual_dist_m, 8000);
  assert.ok(b.has_objective);
  assert.equal(Math.round(b.planned_pace_s), 367); // 6:07
  assert.equal(result.extra.length, 0);
});

test("(v) series con descanso caminando: rest sin Δ de ritmo", () => {
  const fast = { block_type: "Intervalo", duration_min: "1", target_pace: "4:02-3:56" };
  const rec = { block_type: "Recuperación", duration_min: "1", target_pace: "6:30-7:05/km" };
  const structure = [
    fast, rec, fast, rec, fast, rec, fast, rec,
    { block_type: "Recuperación", description: "Descanso", duration_min: "3", target_pace: "" },
    { block_type: "Enfriamiento", duration_min: "10", target_pace: "6:24-5:49" },
  ];
  const pair = [
    lap({ t: 60, d: 250, hr: 152 }),
    lap({ t: 60, d: 140, hr: 132, type: "RECOVERY" }),
  ];
  const laps = [
    ...pair, ...pair, ...pair, ...pair,
    lap({ t: 180, d: 50, hr: 108, type: "RECOVERY" }),
    lap({ t: 600, d: 1600, hr: 138 }),
  ];
  const result = compareBlocks({ structure, laps, vdot: VDOT_PUSH });
  assert.equal(result.mode, "matched");
  assert.equal(result.blocks.length, 10);
  const rest = result.blocks[8];
  assert.equal(rest.kind, "rest");
  assert.equal(rest.delta_s, null);
  assert.equal(rest.planned_pace_s, null);
  assert.equal(rest.actual_dur_s, 180);
  assert.equal(rest.actual_hr, 108);
  const cd = result.blocks[9];
  assert.equal(cd.actual_dur_s, 600);
  assert.equal(cd.kind, "cooldown");
});

test("(vi) bloque por distancia empareja por metros", () => {
  const structure = [
    { block_type: "Calentamiento", duration_min: "10", target_pace: "6:24-5:49" },
    { block_type: "Intervalo", description: "3K all-out", distance_km: "3", target_pace: "" },
    { block_type: "Enfriamiento", duration_min: "10", target_pace: "6:24-5:49" },
  ];
  const laps = [
    lap({ t: 600, d: 1600, hr: 125 }),
    lap({ t: 752, d: 3000, hr: 155 }),
    lap({ t: 600, d: 1550, hr: 140 }),
  ];
  const result = compareBlocks({ structure, laps, vdot: VDOT_PUSH });
  assert.equal(result.mode, "matched");
  const k3 = result.blocks[1];
  assert.equal(k3.actual_dist_m, 3000);
  assert.equal(k3.actual_dur_s, 752);
  assert.equal(k3.has_objective, false);
  assert.equal(k3.planned_pace_s, null);
  assert.equal(result.blocks[2].actual_dist_m, 1550);
  assert.notEqual(result.blocks[2].actual_dist_m, 3000);
});

test("(vii) una sola vuelta: unguided, resumen, sin Δ por bloque", () => {
  const result = compareBlocks({
    structure: test3kStructure(),
    laps: [lap({ t: 1576, d: 4492, hr: 146 })],
    vdot: VDOT_PUSH,
    currentVdot: VDOT_NOW,
    kmSplits: [
      { dur_s: 356, dist_m: 1000 },
      { dur_s: 331, dist_m: 1002 },
    ],
  });
  assert.equal(result.mode, "unguided");
  assert.equal(result.message, UNGUIDED_MESSAGE);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.summary.actual_dur_s, 1576);
  assert.equal(result.summary.actual_dist_m, 4492);
  assert.equal(result.km_splits.length, 2);
  assert.ok(result.vdot_warning);
  assert.equal(compareBlockRows({
    structure: test3kStructure(),
    laps: [lap({ t: 1576, d: 4492 })],
    vdot: VDOT_PUSH,
  }).length, 0);
});

test("(viii) 9 vueltas de 1 km vs TEST 3K de 12 bloques: unguided, km_splits", () => {
  const laps = Array.from({ length: 9 }, (_, i) =>
    lap({ t: 350 + i, d: 1000 + i, hr: 140 + (i % 5) }),
  );
  const result = compareBlocks({
    structure: test3kStructure(),
    laps,
    vdot: VDOT_PUSH,
  });
  assert.equal(result.mode, "unguided");
  assert.equal(result.message, UNGUIDED_MESSAGE);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.km_splits.length, 9);
  assert.equal(result.km_splits[0].name, "km 1");
  assert.ok(result.summary.actual_dist_m >= 9000);
  const prompt = unguidedBlocksPrompt(result.summary);
  assert.match(prompt, /no se lanzó el entreno guiado/i);
  assert.match(prompt, /NO analices por bloque/i);
});

test("3 km en 3 vueltas de 1 km se fusiona si el resto de vueltas corresponde al plan", () => {
  const pair = [
    lap({ t: 60, d: 250, hr: 150, type: "WORK" }),
    lap({ t: 60, d: 140, hr: 130, type: "RECOVERY" }),
  ];
  const laps = [
    lap({ t: 900, d: 2400, hr: 128, type: "WORK" }),
    ...pair, ...pair, ...pair, ...pair,
    lap({ t: 180, d: 50, hr: 110, type: "RECOVERY" }),
    lap({ t: 250, d: 1000, hr: 152, type: "WORK" }),
    lap({ t: 248, d: 1000, hr: 155, type: "WORK" }),
    lap({ t: 254, d: 1000, hr: 158, type: "WORK" }),
    lap({ t: 598, d: 1820, hr: 140, type: "WORK" }),
  ];
  const result = compareBlocks({
    structure: test3kStructure(),
    laps,
    vdot: VDOT_PUSH,
  });
  assert.equal(result.mode, "matched");
  const k3 = result.blocks[10];
  assert.equal(k3.fused, true);
  assert.equal(k3.fused_label, "3 vueltas");
  assert.equal(k3.actual_dist_m, 3000);
  assert.equal(k3.splits.length, 3);
  assert.equal(result.blocks[11].actual_dist_m, 1820);
  assert.equal(result.blocks[11].fused, false);
});

test("fusion de auto-lap en calentamiento lleva chip 2 vueltas", () => {
  const structure = [
    { block_type: "Calentamiento", duration_min: "10", target_pace: "easy jog" },
    { block_type: "Intervalo", duration_min: "5", target_pace: "5k" },
  ];
  const laps = [
    lap({ t: 350, d: 1000 }),
    lap({ t: 250, d: 800 }),
    lap({ t: 300, d: 1200 }),
  ];
  const result = compareBlocks({ structure, laps, vdot: VDOT_PUSH });
  assert.equal(result.mode, "matched");
  const wu = result.blocks[0];
  assert.equal(wu.fused, true);
  assert.equal(wu.fused_label, "2 vueltas");
  assert.equal(wu.splits.length, 2);
  assert.equal(wu.actual_dur_s, 600);
  assert.equal(result.blocks[1].actual_dur_s, 300);
  assert.equal(result.blocks[1].fused, false);
});
