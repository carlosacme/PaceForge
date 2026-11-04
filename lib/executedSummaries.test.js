import assert from "node:assert/strict";
import test from "node:test";
import {
  bogotaSummaryRanges,
  executedActivities,
  isStrengthSession,
  monthBoundsYmd,
  summarizeExecuted,
  workoutExecutedKm,
  workoutExecutedPaceSec,
  workoutsInRange,
  yearMonthBreakdown,
} from "./executedSummaries.js";

const STRENGTH_STRUCTURE = [
  { block_type: "Calentamiento", duration_min: "10", description: "Movilidad y activación" },
  { block_type: "Intervalo", duration_min: "30", description: "Sentadillas, peso muerto, 3 series x 12" },
  { block_type: "Enfriamiento", duration_min: "5", description: "Estiramientos" },
];

const RECOVERY_RUN_STRUCTURE = [
  { block_type: "Rodaje", duration_min: "30", target_pace: "6:30-6:00", description: "Trote suave" },
];

const FEBRUARY = [
  {
    id: "plan",
    scheduled_date: "2026-02-10",
    done: false,
    title: "No corrido",
    total_km: 20,
    distance_km: 20,
    duration_min: 90,
    actual_distance_km: 12,
  },
  {
    id: "watch",
    scheduled_date: "2026-02-12",
    done: true,
    title: "Rodaje reloj",
    total_km: 10,
    duration_min: 60,
    actual_distance_km: 8,
    actual_duration_min: 48,
    actual_avg_pace_s: 360,
    manual_distance_km: 7,
  },
  {
    id: "manual",
    scheduled_date: "2026-02-14",
    done: true,
    title: "Rodaje manual",
    total_km: 6,
    duration_min: 40,
    manual_distance_km: 5,
    manual_duration_min: 32,
  },
  {
    id: "recovery-run",
    scheduled_date: "2026-02-11",
    done: true,
    type: "recovery",
    title: "Trote",
    total_km: 6,
    actual_distance_km: 4,
    actual_duration_min: 24,
    structure: RECOVERY_RUN_STRUCTURE,
  },
  {
    id: "strength",
    scheduled_date: "2026-02-25",
    done: true,
    type: "recovery",
    title: "Fuerza",
    total_km: 4,
    duration_min: 45,
    actual_distance_km: 3,
    actual_duration_min: 40,
    structure: STRENGTH_STRUCTURE,
  },
  {
    id: "strength-open",
    scheduled_date: "2026-02-26",
    done: false,
    type: "recovery",
    title: "Fuerza pendiente",
    total_km: 4,
    structure: STRENGTH_STRUCTURE,
  },
  {
    id: "march",
    scheduled_date: "2026-03-01",
    done: true,
    title: "Marzo",
    total_km: 18,
    actual_distance_km: 15,
  },
];

test("km reales: reloj, si no manual, nunca el plan", () => {
  assert.equal(workoutExecutedKm(FEBRUARY[1]), 8);
  assert.equal(workoutExecutedKm(FEBRUARY[2]), 5);
  assert.equal(workoutExecutedKm({ done: true, total_km: 12, distance_km: 12 }), 0);
});

test("fortalecimiento es recovery sin ritmo; un trote con ritmo sigue siendo carrera", () => {
  const strength = FEBRUARY.find((w) => w.id === "strength");
  const trot = FEBRUARY.find((w) => w.id === "recovery-run");
  assert.equal(strength.type, "recovery");
  assert.equal(isStrengthSession(strength), true);
  assert.equal(isStrengthSession(trot), false);
  assert.equal(isStrengthSession({ type: "recovery", done: true, structure: [] }), false);
});

test("lo planeado y no realizado no suma sesiones ni km", () => {
  const feb = workoutsInRange(FEBRUARY, "2026-02-01", "2026-02-28");
  const summary = summarizeExecuted(feb);
  assert.equal(summary.planned, 6);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.strengthSessions, 1);
  assert.equal(summary.km, 17);
  assert.equal(summary.durationMin, 104);
  assert.equal(summary.missingDistance, 0);
  const titles = executedActivities(feb).map((a) => a.title);
  assert.deepEqual(titles, ["Trote", "Rodaje reloj", "Rodaje manual", "Fuerza"]);
});

test("la suma de km de carrera coincide y la fuerza realizada no entra", () => {
  const febDone = FEBRUARY.filter((w) => w.done && String(w.scheduled_date).startsWith("2026-02"));
  const runningKm = febDone.filter((w) => !isStrengthSession(w)).reduce((s, w) => s + workoutExecutedKm(w), 0);
  const summary = summarizeExecuted(febDone);
  assert.equal(runningKm, 17);
  assert.equal(summary.km, runningKm);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.strengthSessions, 1);
  assert.equal(workoutExecutedKm(FEBRUARY.find((w) => w.id === "strength")), 3);
});

test("fuerza no realizada no cuenta y la realizada no suma km ni minutos", () => {
  const open = summarizeExecuted([FEBRUARY.find((w) => w.id === "strength-open")]);
  assert.equal(open.sessions, 0);
  assert.equal(open.strengthSessions, 0);
  assert.equal(open.km, 0);
  const done = summarizeExecuted([FEBRUARY.find((w) => w.id === "strength")]);
  assert.equal(done.sessions, 0);
  assert.equal(done.strengthSessions, 1);
  assert.equal(done.km, 0);
  assert.equal(done.durationMin, 0);
  const [activity] = executedActivities([FEBRUARY.find((w) => w.id === "strength")]);
  assert.equal(activity.strength, true);
  assert.equal(activity.km, 0);
  assert.equal(activity.paceLabel, null);
});

test("un realizado sin distancia real no hereda el km del plan", () => {
  const bare = { id: "bare", scheduled_date: "2026-02-18", done: true, title: "Sin reloj", total_km: 12, duration_min: 70 };
  const only = summarizeExecuted([bare]);
  assert.equal(only.sessions, 1);
  assert.equal(only.km, 0);
  assert.equal(only.missingDistance, 1);
  assert.equal(only.strengthSessions, 0);
  const [activity] = executedActivities([bare]);
  assert.equal(activity.missingDistance, true);
  assert.equal(activity.km, 0);
  assert.equal(activity.paceLabel, null);
});

test("el ritmo sale del reloj o de km y minutos reales", () => {
  assert.equal(workoutExecutedPaceSec(FEBRUARY[1]), 360);
  assert.equal(workoutExecutedPaceSec(FEBRUARY[2]), 384);
});

test("1 de marzo 02:00 UTC sigue siendo febrero en Bogotá", () => {
  const ranges = bogotaSummaryRanges(new Date("2026-03-01T02:00:00.000Z"));
  assert.equal(ranges.today, "2026-02-28");
  assert.equal(ranges.month.start, "2026-02-01");
  assert.equal(ranges.month.end, "2026-02-28");
  assert.equal(ranges.lastMonth.start, "2026-01-01");
  assert.equal(ranges.lastMonth.end, "2026-01-31");
  const monthRows = workoutsInRange(FEBRUARY, ranges.month.start, ranges.month.end);
  const month = summarizeExecuted(monthRows);
  assert.equal(month.km, 17);
  assert.equal(month.sessions, 3);
  assert.equal(month.strengthSessions, 1);
  assert.equal(monthRows.some((w) => w.id === "march"), false);
});

test("el domingo 1 de marzo a las 23:30 Bogotá cierra la semana del 23 de febrero", () => {
  const ranges = bogotaSummaryRanges(new Date("2026-03-02T04:30:00.000Z"));
  assert.equal(ranges.today, "2026-03-01");
  assert.equal(ranges.week.start, "2026-02-23");
  assert.equal(ranges.week.end, "2026-03-01");
  assert.equal(ranges.month.start, "2026-03-01");
  const week = summarizeExecuted(workoutsInRange(FEBRUARY, ranges.week.start, ranges.week.end));
  assert.equal(week.sessions, 1);
  assert.equal(week.km, 15);
  assert.equal(week.strengthSessions, 1);
  assert.equal(week.completed, 2);
});

test("el lunes 2 de marzo a las 00:30 Bogotá abre la semana nueva", () => {
  const ranges = bogotaSummaryRanges(new Date("2026-03-02T05:30:00.000Z"));
  assert.equal(ranges.today, "2026-03-02");
  assert.equal(ranges.week.start, "2026-03-02");
  assert.equal(ranges.week.end, "2026-03-08");
  assert.equal(ranges.month.month, 3);
});

test("el año se parte por mes con los mismos acumulados y enero mira a diciembre anterior", () => {
  const months = yearMonthBreakdown(FEBRUARY, 2026);
  assert.deepEqual(months.map((m) => [m.month, m.sessions, m.km, m.strengthSessions]), [
    [2, 3, 17, 1],
    [3, 1, 15, 0],
  ]);
  assert.deepEqual(monthBoundsYmd(2026, 1), { start: "2026-01-01", end: "2026-01-31", year: 2026, month: 1 });
  const january = bogotaSummaryRanges(new Date("2026-01-01T15:00:00.000Z"));
  assert.equal(january.lastMonth.start, "2025-12-01");
  assert.equal(january.lastMonth.end, "2025-12-31");
});

test("una marca de tiempo no mueve el día: manda el prefijo de scheduled_date", () => {
  const ymd = workoutsInRange(
    [{ scheduled_date: "2026-09-01T02:00:00.000Z", done: true, actual_distance_km: 9 }],
    "2026-09-01",
    "2026-09-30",
  );
  assert.equal(ymd.length, 1);
  assert.equal(summarizeExecuted(ymd).km, 9);
});
