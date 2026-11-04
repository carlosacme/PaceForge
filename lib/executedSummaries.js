/**
 * Totales de lo corrido para Semana / Mes / Año.
 * Un workout cuenta solo si done === true.
 * Los km salen de la ejecución (reloj, si no el registro manual). Nunca de total_km.
 * La fecha de corte es scheduled_date (YYYY-MM-DD), en el calendario de Bogotá.
 */
import { addDaysYmd, colombiaTodayYmd, startOfWeekMondayYmd } from "./cotDate.js";
import { workoutActualKm } from "./weekStats.js";

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function monthLabelEs(year, month) {
  const name = MONTHS_ES[month - 1] || "";
  return `${name} ${year}`;
}

/** Fecha de calendario del workout. No reinterpreta la hora: el prefijo YYYY-MM-DD manda. */
export function workoutCalendarYmd(workout) {
  const raw = workout?.scheduled_date;
  if (raw == null || raw === "") return "";
  const text = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

export function isCompletedWorkout(workout) {
  return workout?.done === true;
}

export function workoutExecutedKm(workout) {
  return workoutActualKm(workout);
}

/** Minutos corridos: reloj y, si no hay, el registro manual. Nunca duration_min del plan. */
export function workoutExecutedDurationMin(workout) {
  return positiveNumber(workout?.actual_duration_min) ?? positiveNumber(workout?.manual_duration_min);
}

/**
 * Ritmo real en s/km. Usa actual_avg_pace_s y, si falta, lo calcula con km y minutos reales.
 * No usa el ritmo prescrito.
 */
export function workoutExecutedPaceSec(workout) {
  const stored = positiveNumber(workout?.actual_avg_pace_s);
  if (stored) return Math.round(stored);
  const km = workoutExecutedKm(workout);
  const minutes = workoutExecutedDurationMin(workout);
  if (km > 0 && minutes) return Math.round((minutes * 60) / km);
  return null;
}

export function formatExecutedDuration(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (m === 0) return "0 min";
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} min`;
}

export function formatPacePerKm(paceSec) {
  if (!Number.isFinite(paceSec) || paceSec <= 0) return null;
  const s = Math.round(paceSec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}/km`;
}

export function monthBoundsYmd(year, month) {
  const start = `${year}-${pad2(month)}-01`;
  const nextStart = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return { start, end: addDaysYmd(nextStart, -1), year, month };
}

export function shiftMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return monthBoundsYmd(nextYear, nextMonth);
}

export function bogotaSummaryRanges(now = new Date()) {
  const today = colombiaTodayYmd(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const weekStart = startOfWeekMondayYmd(today);
  return {
    today,
    week: { start: weekStart, end: addDaysYmd(weekStart, 6) },
    month: monthBoundsYmd(year, month),
    lastMonth: shiftMonth(year, month, -1),
    year: { start: `${year}-01-01`, end: `${year}-12-31`, year },
  };
}

/** Semanas lun–dom en Bogotá, la actual primero. */
export function recentBogotaWeeks(now = new Date(), count = 4) {
  const currentStart = startOfWeekMondayYmd(colombiaTodayYmd(now));
  const weeks = [];
  for (let i = 0; i < count; i += 1) {
    const start = addDaysYmd(currentStart, -7 * i);
    weeks.push({ start, end: addDaysYmd(start, 6), offset: i });
  }
  return weeks;
}

export function workoutsInRange(rows, start, end) {
  return (Array.isArray(rows) ? rows : []).filter((w) => {
    const ymd = workoutCalendarYmd(w);
    return Boolean(ymd) && ymd >= start && ymd <= end;
  });
}

export function summarizeExecuted(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const done = list.filter(isCompletedWorkout);
  let km = 0;
  let durationMin = 0;
  let missingDistance = 0;
  for (const w of done) {
    const distance = workoutExecutedKm(w);
    if (distance > 0) km += distance;
    else missingDistance += 1;
    const minutes = workoutExecutedDurationMin(w);
    if (minutes) durationMin += minutes;
  }
  return {
    planned: list.length,
    sessions: done.length,
    km: round1(km),
    durationMin,
    missingDistance,
  };
}

export function executedActivity(workout) {
  const km = workoutExecutedKm(workout);
  const durationMin = workoutExecutedDurationMin(workout);
  const paceSec = workoutExecutedPaceSec(workout);
  return {
    id: workout?.id ?? null,
    date: workoutCalendarYmd(workout),
    title: String(workout?.title || "Entrenamiento"),
    type: workout?.type || workout?.workout_type || "",
    km,
    durationMin,
    paceSec,
    paceLabel: formatPacePerKm(paceSec),
    missingDistance: !(km > 0),
    rpe: workout?.rpe ?? null,
  };
}

export function executedActivities(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(isCompletedWorkout)
    .map(executedActivity)
    .filter((a) => a.date)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

export function yearMonthBreakdown(rows, year) {
  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    const bounds = monthBoundsYmd(year, month);
    const summary = summarizeExecuted(workoutsInRange(rows, bounds.start, bounds.end));
    if (summary.sessions === 0) continue;
    months.push({ ...bounds, ...summary });
  }
  return months;
}
