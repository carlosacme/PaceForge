import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanStreakRisk, planDailyPushes, streakRiskCopy, streaksByAthlete } from "./streakRisk.js";

const w = (date, done, athleteId = 1) => ({ athlete_id: athleteId, scheduled_date: date, done });

test("2 fallos + racha previa de 12 califica", () => {
  const rows = [];
  for (let d = 1; d <= 12; d += 1) {
    const day = String(d).padStart(2, "0");
    rows.push(w(`2026-08-${day}`, true));
  }
  rows.push(w("2026-08-13", false));
  rows.push(w("2026-08-14", false));
  const r = computePlanStreakRisk(rows, "2026-08-15");
  assert.equal(r.x, 2);
  assert.equal(r.y, 12);
  assert.equal(r.qualifies, true);
  assert.equal(streakRiskCopy(r.x, r.y).body, "Llevas 2 días sin entrenar, tu racha de 12 está en riesgo 🔥");
});

test("los descansos no rompen X ni Y", () => {
  const rows = [
    w("2026-08-10", true),
    w("2026-08-11", true),
    // 12 descanso
    w("2026-08-13", false),
    // 14 descanso
    w("2026-08-15", false),
  ];
  const r = computePlanStreakRisk(rows, "2026-08-16");
  assert.equal(r.x, 2);
  assert.equal(r.y, 2);
  assert.equal(r.qualifies, true);
});

test("un solo fallo no califica", () => {
  const rows = [w("2026-08-10", true), w("2026-08-11", false)];
  const r = computePlanStreakRisk(rows, "2026-08-12");
  assert.equal(r.x, 1);
  assert.equal(r.y, 1);
  assert.equal(r.qualifies, false);
});

test("dos fallos sin racha previa no califica", () => {
  const rows = [w("2026-08-10", false), w("2026-08-11", false)];
  const r = computePlanStreakRisk(rows, "2026-08-12");
  assert.equal(r.x, 2);
  assert.equal(r.y, 0);
  assert.equal(r.qualifies, false);
});

test("hoy no cuenta como fallo (aún se puede salvar)", () => {
  const rows = [
    w("2026-08-10", true),
    w("2026-08-11", false),
    w("2026-08-12", false),
    w("2026-08-13", false),
  ];
  const r = computePlanStreakRisk(rows, "2026-08-13");
  assert.equal(r.x, 2);
  assert.equal(r.y, 1);
  assert.equal(r.qualifies, true);
  assert.equal(r.todayFullyDone, false);
});

test("si hoy ya está completo no dispara (salvó la racha)", () => {
  const rows = [
    w("2026-08-10", true),
    w("2026-08-11", false),
    w("2026-08-12", false),
    w("2026-08-13", true),
  ];
  const r = computePlanStreakRisk(rows, "2026-08-13");
  assert.equal(r.x, 2);
  assert.equal(r.y, 1);
  assert.equal(r.todayFullyDone, true);
  assert.equal(r.qualifies, false);
});

test("un día con dos workouts, uno sin done, es fallo", () => {
  const rows = [
    w("2026-08-10", true),
    { athlete_id: 1, scheduled_date: "2026-08-11", done: true },
    { athlete_id: 1, scheduled_date: "2026-08-11", done: false },
    w("2026-08-12", false),
  ];
  const r = computePlanStreakRisk(rows, "2026-08-13");
  assert.equal(r.x, 2);
  assert.equal(r.y, 1);
  assert.equal(r.qualifies, true);
});

test("quien califica racha no recibe remind genérico; el resto sí", () => {
  const todayUndone = [
    { id: 10, athlete_id: 1, title: "Fartlek" },
    { id: 11, athlete_id: 1, title: "Core" },
    { id: 20, athlete_id: 2, title: "Rodaje" },
  ];
  const plan = planDailyPushes(todayUndone, {
    1: { qualifies: true, x: 2, y: 12 },
    2: { qualifies: false, x: 0, y: 4 },
  });
  assert.equal(plan.streakAthleteIds.has("1"), true);
  assert.equal(plan.streakAthleteIds.has("2"), false);
  assert.deepEqual(plan.genericWorkouts.map((w) => w.id), [20]);
});

test("streaksByAthlete agrupa y no cruza atletas", () => {
  const rows = [
    w("2026-08-10", true, 1),
    w("2026-08-11", false, 1),
    w("2026-08-12", false, 1),
    w("2026-08-11", false, 2),
  ];
  const by = streaksByAthlete(rows, "2026-08-13");
  assert.equal(by["1"].qualifies, true);
  assert.equal(by["2"].qualifies, false);
});
