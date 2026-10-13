/**
 * Reglas de logros del atleta: puras, sin I/O.
 *
 * La grilla lee ATHLETE_ACHIEVEMENT_DISPLAY_LIST (appShared), no el catálogo
 * SQL. Aquí vive qué código persistir, la fecha del evento (scheduled_date)
 * y si un POST duplicado cuenta como "ya lo tenía".
 */
import { colombiaTodayYmd, parseYmdUtc, startOfWeekMondayYmd } from "./cotDate.js";

export const ACHIEVEMENT_MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sept", "oct", "nov", "dic",
];

/** Un código persistido por tile de la grilla. `aliases` = ya ganado si existe cualquiera. */
export const ATHLETE_ACHIEVEMENT_RULES = [
  { code: "FIRST_WORKOUT", aliases: ["FIRST_KM"], kind: "nth_done", n: 1 },
  { code: "STREAK_3", aliases: ["STREAK_7"], kind: "consecutive_days", n: 3 },
  { code: "KM_10", aliases: [], kind: "total_km", n: 10 },
  { code: "WEEK_COMPLETE_1", aliases: [], kind: "week_complete", n: 1 },
  { code: "SPEED_DEMON", aliases: [], kind: "interval", n: 1 },
  { code: "KM_50", aliases: [], kind: "total_km", n: 50 },
  { code: "KM_100", aliases: [], kind: "total_km", n: 100 },
  { code: "EARLY_BIRD", aliases: [], kind: "early_bird", n: 5 },
  { code: "CONSISTENT", aliases: [], kind: "consecutive_weeks", n: 4 },
  { code: "WORKOUT_50", aliases: [], kind: "nth_done", n: 50 },
  { code: "NO_EXCUSES_10", aliases: [], kind: "no_fail_streak", n: 10 },
  { code: "KM_200", aliases: [], kind: "total_km", n: 200 },
  { code: "HR_10", aliases: ["RPE_MASTER"], kind: "hr_count", n: 10 },
  { code: "VDOT_UP_2", aliases: [], kind: "vdot_up", n: 2 },
  { code: "KM_500", aliases: [], kind: "total_km", n: 500 },
  { code: "WORKOUT_100", aliases: ["KM_1000"], kind: "nth_done", n: 100 },
  { code: "KM_1000", aliases: ["WORKOUT_100"], kind: "total_km", n: 1000 },
];

export function parseAchievementYmd(value) {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** "12 oct 2026". No usa `new Date("YYYY-MM-DD")` (UTC → día anterior en Colombia). */
export function formatAchievementDate(value) {
  const ymd = parseAchievementYmd(value);
  if (!ymd) return "Sin fecha registrada";
  const [, mo, d] = ymd.split("-");
  const month = ACHIEVEMENT_MONTHS_ES[Number(mo) - 1];
  if (!month) return "Sin fecha registrada";
  return `${Number(d)} ${month} ${ymd.slice(0, 4)}`;
}

export function isAlreadyOwnedAward(status, body) {
  if (Number(status) === 409) return true;
  const code = body?.code ?? body?.data?.code ?? body?.error?.code;
  if (String(code) === "23505") return true;
  const msg = [
    typeof body?.error === "string" ? body.error : "",
    body?.error?.message,
    body?.message,
    body?.data?.message,
  ].filter(Boolean).join(" ");
  return /duplicate|unique constraint|already exists|already_awarded/i.test(msg);
}

/**
 * Solo un POST 2xx cuenta como logro nuevo (toast). 409 / unique = ya lo tenía.
 */
export function recordAwardPostResult(newAwards, proposal, status, body) {
  if (isAlreadyOwnedAward(status, body)) {
    return { toast: false, reason: "already_owned" };
  }
  const n = Number(status);
  if (!Number.isFinite(n) || n < 200 || n >= 300) {
    return { toast: false, reason: "http_error" };
  }
  newAwards.push(proposal);
  return { toast: true, reason: "inserted" };
}

export function earnedCodesFromRows(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const code = String(row?.achievement_code || "").trim();
    if (code) set.add(code);
  }
  return set;
}

export function alreadyHasRule(earnedCodes, rule) {
  if (earnedCodes.has(rule.code)) return true;
  return (rule.aliases || []).some((alias) => earnedCodes.has(alias));
}

export function pickAchievedOnForCodes(earnedRows, codes) {
  const byCode = new Map();
  for (const row of earnedRows || []) {
    const code = String(row?.achievement_code || "").trim();
    if (!code) continue;
    const ymd = parseAchievementYmd(row?.achieved_on);
    const id = Number(row?.id);
    const prev = byCode.get(code);
    if (!prev || (Number.isFinite(id) && id < prev.id)) {
      byCode.set(code, { id: Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER, ymd });
    }
  }
  for (const code of codes || []) {
    const ymd = byCode.get(code)?.ymd;
    if (ymd) return ymd;
  }
  return "";
}

function workoutYmd(w) {
  return parseAchievementYmd(w?.scheduled_date);
}

function byYmdId(a, b) {
  const ya = workoutYmd(a);
  const yb = workoutYmd(b);
  if (ya !== yb) return ya < yb ? -1 : 1;
  const ia = Number(a?.id);
  const ib = Number(b?.id);
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function doneDated(workouts) {
  return (workouts || []).filter((w) => w?.done && workoutYmd(w)).sort(byYmdId);
}

function hasHr(w) {
  return [
    w?.manual_avg_hr, w?.manual_max_hr, w?.avg_hr, w?.average_heartrate,
    w?.actual_avg_hr, w?.actual_max_hr,
  ].some((v) => Number(v) > 0);
}

function hasTimeComponent(raw) {
  return /T\d{2}:/.test(String(raw || ""));
}

/** Cuenta visual de madrugador; no produce fecha (hora de marca ≠ fecha de evento). */
function earlyMorningCount(workouts) {
  let n = 0;
  for (const w of workouts || []) {
    if (!w?.done) continue;
    const raw = w.completed_at;
    if (!hasTimeComponent(raw)) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getHours() < 8) n += 1;
  }
  return n;
}

function firstConsecutiveDayYmd(ymds, n) {
  const uniq = [...new Set((ymds || []).filter(Boolean))].sort();
  if (n <= 1) return uniq[0] || "";
  let run = 1;
  for (let i = 1; i < uniq.length; i += 1) {
    const prev = parseYmdUtc(uniq[i - 1]);
    const cur = parseYmdUtc(uniq[i]);
    if (!prev || !cur) {
      run = 1;
      continue;
    }
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    run = diff === 1 ? run + 1 : 1;
    if (run === n) return uniq[i];
  }
  return "";
}

function lastWorkoutInWeek(workouts, weekStart) {
  const inWeek = (workouts || []).filter((w) => startOfWeekMondayYmd(workoutYmd(w)) === weekStart);
  if (!inWeek.length) return null;
  inWeek.sort(byYmdId);
  return inWeek[inWeek.length - 1];
}

function reconstructRule(rule, { workouts, evaluations, todayYmd }) {
  const done = doneDated(workouts);
  if (rule.kind === "nth_done") {
    if (done.length < rule.n) return null;
    const w = done[rule.n - 1];
    return { workout: w, achieved_on: workoutYmd(w) };
  }
  if (rule.kind === "total_km") {
    let sum = 0;
    for (const w of done) {
      sum += Number(w.total_km) || 0;
      if (sum >= rule.n) return { workout: w, achieved_on: workoutYmd(w) };
    }
    return null;
  }
  if (rule.kind === "interval") {
    const w = done.find((x) => String(x.type || "").toLowerCase() === "interval");
    return w ? { workout: w, achieved_on: workoutYmd(w) } : null;
  }
  if (rule.kind === "consecutive_days") {
    const ymd = firstConsecutiveDayYmd(done.map(workoutYmd), rule.n);
    if (!ymd) return null;
    const w = done.find((x) => workoutYmd(x) === ymd) || null;
    return { workout: w, achieved_on: ymd };
  }
  if (rule.kind === "week_complete") {
    const byWeek = new Map();
    for (const w of workouts || []) {
      const ymd = workoutYmd(w);
      if (!ymd) continue;
      const week = startOfWeekMondayYmd(ymd);
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week).push(w);
    }
    for (const week of [...byWeek.keys()].sort()) {
      const list = byWeek.get(week);
      if (!list.length || !list.every((w) => w?.done)) continue;
      const last = lastWorkoutInWeek(list, week);
      return { workout: last, achieved_on: workoutYmd(last) };
    }
    return null;
  }
  if (rule.kind === "consecutive_weeks") {
    const weekKeys = [...new Set(done.map((w) => startOfWeekMondayYmd(workoutYmd(w))).filter(Boolean))].sort();
    if (rule.n <= 1 && weekKeys[0]) {
      const last = lastWorkoutInWeek(done, weekKeys[0]);
      return last ? { workout: last, achieved_on: workoutYmd(last) } : null;
    }
    let run = 1;
    for (let i = 1; i < weekKeys.length; i += 1) {
      const prev = parseYmdUtc(weekKeys[i - 1]);
      const cur = parseYmdUtc(weekKeys[i]);
      const diff = prev && cur ? Math.round((cur.getTime() - prev.getTime()) / 86400000) : 0;
      run = diff === 7 ? run + 1 : 1;
      if (run === rule.n) {
        const last = lastWorkoutInWeek(done, weekKeys[i]);
        return last ? { workout: last, achieved_on: workoutYmd(last) } : null;
      }
    }
    return null;
  }
  if (rule.kind === "no_fail_streak") {
    const rows = (workouts || [])
      .filter((w) => {
        const ymd = workoutYmd(w);
        return ymd && ymd <= todayYmd;
      })
      .sort(byYmdId);
    let streak = 0;
    for (const w of rows) {
      if (w?.done) {
        streak += 1;
        if (streak === rule.n) return { workout: w, achieved_on: workoutYmd(w) };
      } else {
        streak = 0;
      }
    }
    return null;
  }
  if (rule.kind === "hr_count") {
    const withHr = done.filter(hasHr);
    if (withHr.length < rule.n) return null;
    const w = withHr[rule.n - 1];
    return { workout: w, achieved_on: workoutYmd(w) };
  }
  if (rule.kind === "vdot_up") {
    const rows = [...(evaluations || [])].sort((a, b) => {
      const ta = new Date(a?.created_at || 0).getTime();
      const tb = new Date(b?.created_at || 0).getTime();
      return ta - tb;
    });
    let current = 0;
    for (let i = 1; i < rows.length; i += 1) {
      const prev = Number(rows[i - 1]?.vdot);
      const cur = Number(rows[i]?.vdot);
      if (Number.isFinite(prev) && Number.isFinite(cur) && prev > 0 && cur > 0 && cur > prev) {
        current += 1;
        if (current === rule.n) {
          const at = rows[i]?.created_at ? new Date(rows[i].created_at) : null;
          const ymd = at && !Number.isNaN(at.getTime()) ? colombiaTodayYmd(at) : "";
          return { workout: null, achieved_on: ymd || null, unreconstructable: !ymd };
        }
      } else {
        current = 0;
      }
    }
    return null;
  }
  if (rule.kind === "early_bird") {
    if (earlyMorningCount(workouts) < rule.n) return null;
    return { workout: null, achieved_on: null, unreconstructable: true };
  }
  return null;
}

export function reconstructAchievedOn(code, ctx) {
  const rule = ATHLETE_ACHIEVEMENT_RULES.find((r) => r.code === code);
  if (!rule) return { achieved_on: null, source_workout_id: null, unreconstructable: true, reason: "codigo_desconocido" };
  const todayYmd = ctx.todayYmd || colombiaTodayYmd();
  const hit = reconstructRule(rule, { ...ctx, todayYmd });
  if (!hit) return { achieved_on: null, source_workout_id: null, unreconstructable: true, reason: "no_cumple" };
  if (hit.unreconstructable || !hit.achieved_on) {
    return {
      achieved_on: null,
      source_workout_id: hit.workout?.id ?? null,
      unreconstructable: true,
      reason: rule.kind === "early_bird" ? "madrugador_sin_hora_de_evento" : "sin_scheduled_date",
    };
  }
  return {
    achieved_on: hit.achieved_on,
    source_workout_id: hit.workout?.id ?? null,
    unreconstructable: false,
    reason: null,
  };
}

export function proposeNewAthleteAwards({
  workouts,
  evaluations,
  earnedCodes,
  todayYmd,
  value,
} = {}) {
  const today = todayYmd || colombiaTodayYmd();
  const owned = earnedCodes instanceof Set ? earnedCodes : earnedCodesFromRows(earnedCodes);
  const proposals = [];
  const ownedNow = new Set(owned);
  for (const rule of ATHLETE_ACHIEVEMENT_RULES) {
    if (alreadyHasRule(ownedNow, rule)) continue;
    const hit = reconstructRule(rule, { workouts, evaluations, todayYmd: today });
    if (!hit) continue;
    // EARLY_BIRD (y cualquier hit sin fecha de evento) no se persiste: la
    // hora de completed_at no es la del workout y getHours() es local del
    // cliente, no Colombia. La grilla sigue pintándolo por progreso visual.
    if (hit.unreconstructable) continue;
    const achievedOn = hit.achieved_on || null;
    const proposal = {
      code: rule.code,
      aliases: rule.aliases || [],
      achieved_on: achievedOn,
      source_workout_id: hit.workout?.id ?? null,
      value: value ?? null,
    };
    proposals.push(proposal);
    ownedNow.add(rule.code);
  }
  return proposals;
}

export function totalKmFromWorkouts(workouts) {
  return (workouts || []).reduce((s, w) => s + (w?.done ? (Number(w.total_km) || 0) : 0), 0);
}

