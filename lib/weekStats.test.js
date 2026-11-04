import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workoutActualKm,
  sumWeekKm,
  weekAdherence,
  weekSessionBreakdown,
  formatCoachSessionLines,
  bogotaLoadWindows,
  weekRpeAverages,
  formatRpeValue,
  currentWeekRangeBogota,
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

const RUN = [{ block_type: "Rodaje", duration_min: "40", target_pace: "6:00-5:30" }];
const STRENGTH = [
  { block_type: "Calentamiento", duration_min: "10", description: "Movilidad" },
  { block_type: "Intervalo", duration_min: "30", description: "Sentadillas, 3 series x 12" },
];

test("sumWeekKm: planned de todos, actual solo si done", () => {
  const rows = [
    { total_km: 10, done: true, actual_distance_km: 10.4 },
    { total_km: 8, done: false, actual_distance_km: 8 },
    { total_km: 6, done: true },
  ];
  assert.deepEqual(sumWeekKm(rows), { planned: 24, actual: 10.4 });
});

test("corrido: carrera hecha 9.8 y fuerza hecha 2 no suman 11.8", () => {
  const rows = [
    { total_km: 10, done: true, actual_distance_km: 9.8, structure: RUN },
    { total_km: 0, done: true, actual_distance_km: 2, type: "recovery", structure: STRENGTH },
  ];
  assert.deepEqual(sumWeekKm(rows), { planned: 10, actual: 9.8 });
});

test("un planeado sin hacer entra en el plan y no en el corrido", () => {
  const rows = [{ total_km: 15, done: false, actual_distance_km: 15, structure: RUN }];
  assert.deepEqual(sumWeekKm(rows), { planned: 15, actual: 0 });
});

test("carrera hecha sin distancia real ni manual suma 0 y se nota", () => {
  const rows = [{ total_km: 12, done: true, structure: RUN }];
  assert.deepEqual(sumWeekKm(rows), { planned: 12, actual: 0 });
  const counts = weekSessionBreakdown(rows);
  assert.equal(counts.runningDone, 1);
  assert.equal(counts.missingDistance, 1);
  assert.deepEqual(formatCoachSessionLines(counts), [
    "1 de 1 sesiones",
    "1 de 1 carreras",
    "1 sin distancia real",
  ]);
});

test("sesiones del coach separan carrera y fuerza; la adherencia sigue combinada", () => {
  const rows = [
    { total_km: 10, done: true, actual_distance_km: 9.8, structure: RUN },
    { total_km: 8, done: false, structure: RUN },
    { total_km: 0, done: true, actual_distance_km: 2, structure: STRENGTH },
  ];
  const counts = weekSessionBreakdown(rows);
  assert.equal(counts.runningDone, 1);
  assert.equal(counts.runningPlanned, 2);
  assert.equal(counts.strengthDone, 1);
  assert.equal(counts.strengthPlanned, 1);
  assert.equal(counts.done, 2);
  assert.equal(counts.total, 3);
  assert.equal(counts.pct, 67);
  assert.deepEqual(formatCoachSessionLines(counts), [
    "2 de 3 sesiones",
    "1 de 2 carreras",
    "1 de 1 sesiones de fuerza",
  ]);
});

test("RPE principal solo de carrera; la fuerza va en su línea", () => {
  const rows = [
    { done: true, rpe: 6, structure: RUN },
    { done: true, rpe: 8, structure: RUN },
    { done: true, rpe: 9, structure: STRENGTH },
  ];
  const rpe = weekRpeAverages(rows);
  assert.equal(rpe.runAvg, 7);
  assert.equal(rpe.runCount, 2);
  assert.equal(formatRpeValue(rpe.strengthAvg), "9");
  assert.equal(`RPE fuerza: ${formatRpeValue(rpe.strengthAvg)}`, "RPE fuerza: 9");
});

test("sin fuerza hecha con RPE no hay línea de RPE fuerza", () => {
  const rows = [
    { done: true, rpe: 6, structure: RUN },
    { done: false, rpe: 9, structure: STRENGTH },
    { done: true, structure: STRENGTH },
  ];
  const rpe = weekRpeAverages(rows);
  assert.equal(rpe.runAvg, 6);
  assert.equal(rpe.strengthCount, 0);
  assert.equal(rpe.strengthAvg, null);
});

test("carga: domingo 23:30 Bogotá sigue en la semana que cierra, no en la siguiente", () => {
  const windows = bogotaLoadWindows(new Date("2026-03-02T04:30:00.000Z"));
  assert.equal(windows.today, "2026-03-01");
  assert.equal(windows.weeks[0].from, "2026-02-23");
  assert.equal(windows.weeks[0].to, "2026-03-01");
  assert.equal(windows.acuteFrom, "2026-02-23");
  assert.equal(windows.acuteTo, "2026-03-01");
  const sunday = "2026-03-01";
  const mondayUtc = "2026-03-02";
  const current = windows.weeks[0];
  assert.equal(sunday >= current.from && sunday <= current.to, true);
  assert.equal(mondayUtc >= current.from && mondayUtc <= current.to, false);
});

test("domingo 23:30 Bogotá sigue en la semana que cierra ese domingo", () => {
  const range = currentWeekRangeBogota(new Date("2026-03-02T04:30:00.000Z"));
  assert.equal(range.today, "2026-03-01");
  assert.equal(range.from, "2026-02-23");
  assert.equal(range.to, "2026-03-01");
  const rows = [
    { scheduled_date: "2026-03-01", total_km: 10, done: true, actual_distance_km: 9.8, structure: RUN },
    { scheduled_date: "2026-03-02", total_km: 12, done: true, actual_distance_km: 12, structure: RUN },
  ];
  const inWeek = rowsInRange(rows, range.from, range.to);
  assert.deepEqual(sumWeekKm(inWeek), { planned: 10, actual: 9.8 });
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
  assert.match(copy.body, /42\.0 km corridos/);
  assert.match(copy.body, /12\.0 km corridos más/);
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
