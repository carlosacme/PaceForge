import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workoutActualKm,
  sumWeekKm,
  weekAdherence,
  closedAndPreviousWeekRanges,
  rowsInRange,
  athleteWeekSummary,
  weeklySummaryCopy,
} from "./weekStats.js";
import { colombiaTodayYmd } from "./cotDate.js";

test("workoutActualKm prefiere reloj, luego manual, nunca total_km", () => {
  assert.equal(workoutActualKm({ actual_distance_km: 10.2, manual_distance_km: 9, total_km: 12 }), 10.2);
  assert.equal(workoutActualKm({ manual_distance_km: 8, total_km: 12 }), 8);
  assert.equal(workoutActualKm({ total_km: 12, done: true }), 0);
});

test("sumWeekKm: planned de todos, actual solo si done", () => {
  const rows = [
    { total_km: 10, done: true, actual_distance_km: 10.4 },
    { total_km: 8, done: false, actual_distance_km: 8 },
    { total_km: 6, done: true },
  ];
  assert.deepEqual(sumWeekKm(rows), { planned: 24, actual: 10.4 });
});

test("semana cerrada el lunes 31 ago 2026 es 24–30; previa 17–23", () => {
  const r = closedAndPreviousWeekRanges("2026-08-31");
  assert.equal(r.thisMonday, "2026-08-31");
  assert.equal(r.closedFrom, "2026-08-24");
  assert.equal(r.closedTo, "2026-08-30");
  assert.equal(r.prevFrom, "2026-08-17");
  assert.equal(r.prevTo, "2026-08-23");
});

test("en miércoles sigue resumiendo la semana que cerró el domingo", () => {
  const r = closedAndPreviousWeekRanges("2026-09-02");
  assert.equal(r.closedFrom, "2026-08-24");
  assert.equal(r.closedTo, "2026-08-30");
});

test("resumen compara km reales vs semana previa", () => {
  const closed = [
    { scheduled_date: "2026-08-24", total_km: 10, done: true, actual_distance_km: 10 },
    { scheduled_date: "2026-08-26", total_km: 8, done: true, actual_distance_km: 8 },
    { scheduled_date: "2026-08-28", total_km: 12, done: true, actual_distance_km: 12 },
    { scheduled_date: "2026-08-30", total_km: 16, done: true, actual_distance_km: 12 },
  ];
  const prev = [
    { scheduled_date: "2026-08-17", total_km: 20, done: true, actual_distance_km: 20 },
    { scheduled_date: "2026-08-19", total_km: 10, done: true, actual_distance_km: 10 },
  ];
  const range = closedAndPreviousWeekRanges("2026-08-31");
  const s = athleteWeekSummary(rowsInRange(closed, range.closedFrom, range.closedTo), rowsInRange(prev, range.prevFrom, range.prevTo));
  assert.equal(s.km, 42);
  assert.equal(s.done, 4);
  assert.equal(s.total, 4);
  assert.equal(s.pct, 100);
  assert.equal(s.prevKm, 30);
  assert.equal(s.deltaKm, 12);
  const copy = weeklySummaryCopy(s);
  assert.match(copy.body, /42\.0 km/);
  assert.match(copy.body, /12\.0 km más/);
  assert.match(copy.body, /fondo/);
});

test("copy de ánimo si bajó la carga con adherencia media", () => {
  const s = {
    km: 28,
    done: 3,
    total: 4,
    pct: 75,
    prevKm: 32,
    hasPrev: true,
    deltaKm: -4,
  };
  const copy = weeklySummaryCopy(s);
  assert.match(copy.body, /75 %/);
  assert.match(copy.body, /consistencia/);
});

test("copy primera semana sin previa", () => {
  const copy = weeklySummaryCopy({ km: 32, done: 4, total: 4, pct: 100, prevKm: 0, hasPrev: false, deltaKm: 32 });
  assert.match(copy.title, /primera semana/);
});

test("adherencia done/total como el Dashboard", () => {
  assert.deepEqual(weekAdherence([{ done: true }, { done: true }, { done: false }]), { total: 3, done: 2, pct: 67 });
});

test("colombiaTodayYmd usa UTC-5", () => {
  assert.equal(colombiaTodayYmd(new Date("2026-08-31T12:00:00.000Z")), "2026-08-31");
  assert.equal(colombiaTodayYmd(new Date("2026-08-31T04:59:59.000Z")), "2026-08-30");
});
