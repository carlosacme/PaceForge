/**
 * Racha de plan: días programados completados (todos done) sin fallar.
 * Los días sin workout (descanso) no rompen ni cuentan.
 * Hoy no cuenta como fallo: el atleta todavía puede marcar lo de hoy.
 */

function ymdOf(w) {
  return String(w?.scheduled_date || "").slice(0, 10);
}

export function groupPlanDays(workouts, todayYmd) {
  const byDay = new Map();
  for (const w of workouts || []) {
    const ymd = ymdOf(w);
    if (!ymd || ymd > todayYmd) continue;
    let rec = byDay.get(ymd);
    if (!rec) {
      rec = { total: 0, done: 0 };
      byDay.set(ymd, rec);
    }
    rec.total += 1;
    if (w?.done) rec.done += 1;
  }
  return byDay;
}

/**
 * @returns {{ x: number, y: number, qualifies: boolean, todayFullyDone: boolean }}
 * x = días programados fallidos consecutivos desde ayer
 * y = racha de días programados completados justo antes de esos fallos
 */
export function computePlanStreakRisk(workouts, todayYmd) {
  const byDay = groupPlanDays(workouts, todayYmd);
  const todayRec = byDay.get(todayYmd);
  const todayFullyDone = Boolean(todayRec && todayRec.total > 0 && todayRec.done >= todayRec.total);

  const plannedPast = [...byDay.entries()]
    .filter(([ymd]) => ymd < todayYmd)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));

  let x = 0;
  let y = 0;
  let phase = "misses";
  for (const [, rec] of plannedPast) {
    const completed = rec.total > 0 && rec.done >= rec.total;
    const failed = rec.total > 0 && rec.done < rec.total;
    if (phase === "misses") {
      if (failed) x += 1;
      else if (completed) {
        phase = "streak";
        y += 1;
      }
    } else if (completed) {
      y += 1;
    } else {
      break;
    }
  }

  const qualifies = !todayFullyDone && x >= 2 && y >= 1;
  return { x, y, qualifies, todayFullyDone };
}

export function streakRiskCopy(x, y) {
  const missLabel = x === 1 ? "1 día" : `${x} días`;
  return {
    title: "🔥 Tu racha está en riesgo",
    body: `Llevas ${missLabel} sin entrenar, tu racha de ${y} está en riesgo 🔥`,
  };
}

/**
 * Si el atleta califica para racha, no recibe el remind genérico (ni uno por
 * cada sesión de hoy). El resto sigue igual: un remind por workout no hecho.
 */
export function planDailyPushes(todayUndoneWorkouts, streakByAthleteId) {
  const streakAthleteIds = new Set();
  for (const [athleteId, streak] of Object.entries(streakByAthleteId || {})) {
    if (streak?.qualifies) streakAthleteIds.add(String(athleteId));
  }
  const genericWorkouts = (todayUndoneWorkouts || []).filter(
    (w) => !streakAthleteIds.has(String(w.athlete_id)),
  );
  return { streakAthleteIds, genericWorkouts };
}

export function streaksByAthlete(workouts, todayYmd) {
  const byAthlete = new Map();
  for (const w of workouts || []) {
    const id = w?.athlete_id;
    if (id == null) continue;
    const key = String(id);
    if (!byAthlete.has(key)) byAthlete.set(key, []);
    byAthlete.get(key).push(w);
  }
  const out = {};
  for (const [athleteId, rows] of byAthlete) {
    out[athleteId] = computePlanStreakRisk(rows, todayYmd);
  }
  return out;
}
