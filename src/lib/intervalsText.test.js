import { test } from "node:test";
import assert from "node:assert/strict";
import { toIntervalsText, buildIntervalsEvent } from "./intervals.js";

const VDOT = 43.37;

function test3kWorkout() {
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
  return {
    title: "TEST 3K",
    duration_min: 40,
    structure: [
      { block_type: "Calentamiento", description: "WU", duration_min: "15", distance_km: "", target_pace: "6:24-5:49" },
      fast, rec, fast, rec, fast, rec, fast, rec,
      { block_type: "Recuperación", description: "Descanso 180s", duration_min: "3", distance_km: "", target_pace: "" },
      { block_type: "Intervalo", description: "3K all-out", duration_min: "", distance_km: "3", target_pace: "" },
      { block_type: "Enfriamiento", description: "CD", duration_min: "10", distance_km: "", target_pace: "6:24-5:49" },
    ],
  };
}

function rodajeWorkout() {
  return {
    title: "Rodaje",
    duration_min: 50,
    structure: [
      { block_type: "Rodaje", description: "Easy", duration_min: "50", target_pace: "6:24-5:49" },
    ],
  };
}

const TEST_3K_TODAY = `Warmup
- 15m 6:24-5:49/km Pace

Main Set 4x
- 1m 4:02-3:56/km Pace
- 1m 6:30-7:05/km Pace

Recuperación
- 3m

Intervalo
- 3km

Cooldown
- 10m 6:24-5:49/km Pace`;

const RODAJE_TODAY = `Rodaje
- 50m 6:24-5:49/km Pace`;

test("TEST 3K flag OFF: texto ICU igual que hoy", () => {
  assert.equal(test3kWorkout().structure.length, 12);
  assert.equal(toIntervalsText(test3kWorkout(), VDOT), TEST_3K_TODAY);
  assert.equal(toIntervalsText(test3kWorkout(), VDOT, { watchStepLabels: false }), TEST_3K_TODAY);
  assert.equal(buildIntervalsEvent(test3kWorkout(), VDOT).description, TEST_3K_TODAY);
});

test("rodaje continuo flag ON u OFF: texto igual que hoy", () => {
  assert.equal(toIntervalsText(rodajeWorkout(), VDOT), RODAJE_TODAY);
  assert.equal(toIntervalsText(rodajeWorkout(), VDOT, { watchStepLabels: true }), RODAJE_TODAY);
});

test("TEST 3K flag ON: RÁPIDO/RECUPERACIÓN, intensity=, 3 km sin Pace", () => {
  const got = toIntervalsText(test3kWorkout(), VDOT, { watchStepLabels: true });
  const expected = `Warmup
- 15m 6:24-5:49/km Pace intensity=warmup

Main Set 4x
- RÁPIDO 1m 4:02-3:56/km Pace intensity=active
- RECUPERACIÓN 1m 6:30-7:05/km Pace intensity=rest

RECUPERACIÓN
- RECUPERACIÓN 3m intensity=rest

RÁPIDO
- RÁPIDO 3km intensity=active

Cooldown
- 10m 6:24-5:49/km Pace intensity=cooldown`;
  assert.equal(got, expected);
  assert.match(got, /intensity=rest/);
  assert.match(got, /intensity=active/);
  assert.match(got, /intensity=warmup/);
  assert.match(got, /intensity=cooldown/);
  assert.match(got, /RÁPIDO 3km intensity=active/);
  assert.doesNotMatch(got, /RÁPIDO 3km .*\d+:\d{2}/);
  assert.match(got, /RÁPIDO 1m 4:02-3:56\/km Pace/);
  assert.equal(
    buildIntervalsEvent(test3kWorkout(), VDOT, { watchStepLabels: true }).description,
    expected,
  );
});
