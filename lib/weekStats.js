/**
 * Km semanales del coach. planned = total_km de todos los workouts.
 * actual (corrido) = solo carreras hechas, con la distancia real.
 * La fuerza hecha no suma km. La semana del coach es America/Bogota.
 */
import { isRunWorkout } from "../src/lib/intervals.js";
import { addDaysYmd, bogotaWeekStartYmd, colombiaTodayYmd, startOfWeekMondayYmd } from "./cotDate.js";

export function workoutActualKm(w) {
  const fromDevice = Number(w?.actual_distance_km);
  if (Number.isFinite(fromDevice) && fromDevice > 0) return fromDevice;
  const manual = Number(w?.manual_distance_km);
  if (Number.isFinite(manual) && manual > 0) return manual;
  return 0;
}

const roundKm = (n) => Math.round(n * 10) / 10;

export function sumWeekKm(rows) {
  let planned = 0;
  let actual = 0;
  for (const w of Array.isArray(rows) ? rows : []) {
    const km = Number(w?.total_km);
    if (Number.isFinite(km) && km > 0) planned += km;
    if (w?.done === true && isRunWorkout(w)) actual += workoutActualKm(w);
  }
  return { planned: roundKm(planned), actual: roundKm(actual) };
}

/** Carrera vs fuerza con la misma regla que los resúmenes del atleta. */
export function weekSessionBreakdown(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let runningPlanned = 0;
  let runningDone = 0;
  let strengthPlanned = 0;
  let strengthDone = 0;
  let missingDistance = 0;
  for (const w of list) {
    const done = w?.done === true;
    if (!isRunWorkout(w)) {
      strengthPlanned += 1;
      if (done) strengthDone += 1;
      continue;
    }
    runningPlanned += 1;
    if (!done) continue;
    runningDone += 1;
    if (workoutActualKm(w) <= 0) missingDistance += 1;
  }
  const total = list.length;
  const done = runningDone + strengthDone;
  return {
    runningPlanned,
    runningDone,
    strengthPlanned,
    strengthDone,
    missingDistance,
    total,
    done,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

export function formatCoachSessionLines(counts) {
  if (!counts?.total) return [];
  const lines = [`${counts.done} de ${counts.total} sesiones`];
  if (counts.runningPlanned > 0) lines.push(`${counts.runningDone} de ${counts.runningPlanned} carreras`);
  if (counts.strengthPlanned > 0) lines.push(`${counts.strengthDone} de ${counts.strengthPlanned} sesiones de fuerza`);
  if (counts.missingDistance > 0) {
    const n = counts.missingDistance;
    lines.push(`${n} sin distancia real`);
  }
  return lines;
}

/**
 * Ventanas de la carga aguda/crónica en America/Bogota.
 * La aguda es hoy y los 6 días anteriores. Las cuatro barras son lun–dom,
 * la primera es la semana que contiene hoy. No suma km: solo corta fechas.
 */
export function bogotaLoadWindows(now = new Date()) {
  const today = colombiaTodayYmd(now);
  const thisMonday = startOfWeekMondayYmd(today);
  const weeks = [];
  for (let i = 0; i < 4; i += 1) {
    const from = addDaysYmd(thisMonday, -7 * i);
    weeks.push({ from, to: addDaysYmd(from, 6) });
  }
  return { today, acuteFrom: addDaysYmd(today, -6), acuteTo: today, weeks };
}

export { bogotaWeekStartYmd };

const rpeValue = (raw) => {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  const i = Math.round(v);
  if (i < 1 || i > 10) return null;
  return i;
};

const average = (values) => (
  values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null
);

/** RPE de la semana del coach: el promedio principal es solo carrera. */
export function weekRpeAverages(rows) {
  const run = [];
  const strength = [];
  for (const w of Array.isArray(rows) ? rows : []) {
    if (w?.done !== true) continue;
    const rpe = rpeValue(w.rpe);
    if (rpe == null) continue;
    if (isRunWorkout(w)) run.push(rpe);
    else strength.push(rpe);
  }
  return {
    runAvg: average(run),
    runCount: run.length,
    strengthAvg: average(strength),
    strengthCount: strength.length,
  };
}

export function formatRpeValue(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const rounded = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Lunes–domingo de la semana en curso, en America/Bogota. */
export function currentWeekRangeBogota(now = new Date()) {
  const today = colombiaTodayYmd(now);
  const from = startOfWeekMondayYmd(today);
  return { from, to: addDaysYmd(from, 6), today };
}

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function formatYmdLongEs(ymd) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(ymd || "");
  const month = MONTHS_ES[Number(match[2]) - 1] || match[2];
  return `${Number(match[3])} de ${month} de ${match[1]}`;
}

export function weekAdherence(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const done = list.filter((w) => w?.done).length;
  return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/**
 * Semana lun–dom ya cerrada (la que terminó el domingo anterior) y la previa.
 * El lunes a las 07:00 COT resume lun–dom de la semana que acaba de terminar.
 */
export function closedAndPreviousWeekRanges(todayYmd) {
  const thisMonday = startOfWeekMondayYmd(todayYmd);
  const closedFrom = addDaysYmd(thisMonday, -7);
  const closedTo = addDaysYmd(thisMonday, -1);
  const prevFrom = addDaysYmd(thisMonday, -14);
  const prevTo = addDaysYmd(thisMonday, -8);
  return { closedFrom, closedTo, prevFrom, prevTo, thisMonday };
}

export function ymdOfWorkout(w) {
  return String(w?.scheduled_date || "").slice(0, 10);
}

export function rowsInRange(rows, from, to) {
  return (rows || []).filter((w) => {
    const ymd = ymdOfWorkout(w);
    return ymd && ymd >= from && ymd <= to;
  });
}

export function athleteWeekSummary(closedRows, prevRows) {
  const km = sumWeekKm(closedRows);
  const adherence = weekAdherence(closedRows);
  const prevKm = sumWeekKm(prevRows);
  const hasPrev = (prevRows || []).length > 0;
  const deltaKm = roundKm(km.actual - prevKm.actual);
  return {
    km: km.actual,
    plannedKm: km.planned,
    done: adherence.done,
    total: adherence.total,
    pct: adherence.pct,
    prevKm: prevKm.actual,
    hasPrev,
    deltaKm,
  };
}

export function weeklySummaryCopy(summary) {
  const kmText = Number(summary.km).toFixed(1);
  const sessions = `${summary.done}/${summary.total}`;
  const pct = summary.pct;
  const delta = Number(summary.deltaKm) || 0;
  const deltaAbs = Math.abs(delta).toFixed(1);

  if (!summary.hasPrev) {
    return {
      title: "📬 Tu primera semana en el plan",
      body: `${kmText} km corridos · ${sessions}. Queda registrada: a partir de la que viene vas a ver el salto.`,
    };
  }

  if (summary.total > 0 && summary.pct >= 80 && summary.km >= summary.prevKm) {
    const cmp = delta > 0
      ? `${deltaAbs} km corridos más que la anterior.`
      : "Mismos km corridos que la anterior.";
    return {
      title: "📬 Tu semana",
      body: `Cerraste ${kmText} km corridos y ${sessions} sesiones. ${cmp} Así se construye fondo.`,
    };
  }

  if (summary.total > 0 && summary.pct >= 50) {
    const cmp = delta > 0
      ? `${deltaAbs} km corridos más que la anterior.`
      : delta === 0
        ? "Mismos km corridos que la anterior."
        : "Un poco menos de km corridos que la anterior, pero la consistencia sigue ahí.";
    return {
      title: "📬 Tu semana",
      body: `${kmText} km corridos · ${sessions} (${pct} %). ${cmp} Esta semana suma una.`,
    };
  }

  return {
    title: "📬 Tu semana",
    body: `${kmText} km corridos · ${sessions}. La anterior fue más llena. Un entreno hecho hoy ya cambia el recuento.`,
  };
}
