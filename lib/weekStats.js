/**
 * Km semanales: misma semántica que el Dashboard del coach
 * (`workoutActualKm` + `sumWeekKm` en appShared). No usar distance_km ni
 * sumar total_km de sesiones no hechas como "corridos".
 */
import { addDaysYmd, startOfWeekMondayYmd } from "./cotDate.js";

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
    if (w?.done) actual += workoutActualKm(w);
  }
  return { planned: roundKm(planned), actual: roundKm(actual) };
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
      body: `${kmText} km · ${sessions}. Queda registrada: a partir de la que viene vas a ver el salto.`,
    };
  }

  if (summary.total > 0 && summary.pct >= 80 && summary.km >= summary.prevKm) {
    const cmp = delta > 0
      ? `${deltaAbs} km más que la anterior.`
      : "Mismos km que la anterior.";
    return {
      title: "📬 Tu semana",
      body: `Cerraste ${kmText} km y ${sessions} sesiones. ${cmp} Así se construye fondo.`,
    };
  }

  if (summary.total > 0 && summary.pct >= 50) {
    const cmp = delta > 0
      ? `${deltaAbs} km más que la anterior.`
      : delta === 0
        ? "Mismos km que la anterior."
        : "Un poco menos que la anterior, pero la consistencia sigue ahí.";
    return {
      title: "📬 Tu semana",
      body: `${kmText} km · ${sessions} (${pct} %). ${cmp} Esta semana suma una.`,
    };
  }

  return {
    title: "📬 Tu semana",
    body: `${kmText} km · ${sessions}. La anterior fue más llena. Un entreno hecho hoy ya cambia el recuento.`,
  };
}
