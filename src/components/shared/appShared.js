import { supabase } from "../../lib/supabase";
import {
  registerFcmToken,
  registerFcmTokenDetailed,
  currentPushPlatform,
  readOwnDeviceTokens,
  unregisterOwnDeviceToken,
  readOwnFcmToken,
  sendChatPushNotification,
  COACH_WORKOUT_COMPLETED_TYPE,
  notifyCoachWorkoutCompletedFromClient,
  PUSH_INACTIVE_REASONS,
} from "../../lib/fcmClient";
import { readStructure } from "../../lib/workoutStructure";
import {
  PACE_RANGES_BY_LEVEL,
  normalizeRacePriority,
  midPaceSecondsFromRange,
  extractPaceSecondsFromText,
  fmtPace,
} from "../../lib/vdot";
import { distKmFromLabel } from "../../lib/intervals";
import {
  acwrBandFromRatio,
  acwrGaugePercent,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_ORANGE,
} from "../../../lib/acwrBands.js";
import { workoutActualKm as workoutActualKmFromLib, sumWeekKm as sumWeekKmFromLib } from "../../../lib/weekStats.js";

export {
  registerFcmToken,
  registerFcmTokenDetailed,
  currentPushPlatform,
  readOwnDeviceTokens,
  unregisterOwnDeviceToken,
  readOwnFcmToken,
  sendChatPushNotification,
  COACH_WORKOUT_COMPLETED_TYPE,
  notifyCoachWorkoutCompletedFromClient,
  PUSH_INACTIVE_REASONS,
};

export const BRAND_NAME = "RunningApexFlow";

/**
 * Contención de `navigator.locks` entre pestañas (@supabase/gotrue-js).
 * Típico: AbortError "Lock broken by another request with the 'steal' option".
 */
export function isAuthLockContentionError(err) {
  if (!err) return false;
  const name = String(err.name || err.code || "");
  const msg = String(err.message || err.error_description || err || "");
  if (/lock broken by another request with the ['"]?steal['"]? option/i.test(msg)) return true;
  if (/was released because another request stole it/i.test(msg)) return true;
  if (/acquiring an exclusive navigator lockmanager lock/i.test(msg)) return true;
  if (name === "AbortError" && /lock/i.test(msg)) return true;
  if (name === "NavigatorLockAcquireTimeoutError" || name === "LockAcquireTimeoutError") return true;
  return false;
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reintenta solo ante contención de auth lock entre pestañas.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, delayMs?: number }} [opts] `retries` = intentos extra (default 2)
 * @returns {Promise<T>}
 */
export async function withAuthLockRetry(fn, { retries = 2, delayMs = 200 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isAuthLockContentionError(err) || attempt >= retries) throw err;
      attempt += 1;
      await sleepMs(delayMs * attempt);
    }
  }
}

/**
 * Mensaje legible para el usuario. El detalle técnico va a console.error;
 * nunca se muestra error.message crudo de Supabase/API en la UI.
 */
export const userFacingError = (err, fallback = "Algo salió mal. Inténtalo de nuevo.") => {
  console.error(err);
  const raw = String(err?.message || err || "").trim();
  const msg = raw.toLowerCase();
  if (!msg) return fallback;
  if (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg === "fetch failed"
  ) {
    return "No se pudo conectar, revisa tu internet.";
  }
  if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
    return "Confirma tu correo antes de continuar. Revisa bandeja de entrada y spam.";
  }
  if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (msg.includes("user already registered") || msg.includes("already been registered") || msg.includes("already registered")) {
    return "Ese correo ya tiene una cuenta.";
  }
  if (msg.includes("password") && (msg.includes("weak") || msg.includes("least") || msg.includes("short"))) {
    return "La contraseña es demasiado corta o débil. Usa al menos 6 caracteres.";
  }
  if (msg.includes("rate limit") || msg.includes("too many") || msg.includes("over_email_send_rate_limit")) {
    return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
  }
  if (msg.includes("jwt") || msg.includes("session") || msg.includes("not authenticated") || msg.includes("refresh_token")) {
    return "Tu sesión expiró. Vuelve a iniciar sesión.";
  }
  if (msg.includes("permission") || msg.includes("row-level security") || msg.includes("rls") || msg.includes("42501")) {
    return "No tienes permiso para esta acción.";
  }
  if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
    return "Ese registro ya existe.";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "La operación tardó demasiado. Inténtalo de nuevo.";
  }
  if (isAuthLockContentionError(err)) {
    return "No se pudieron sincronizar los datos. Recarga la página e inténtalo de nuevo.";
  }
  // Si ya viene en español claro (sin jerga técnica), se puede mostrar.
  const looksTechnical =
    /pgrst|postgrest|rpc|violates|constraint|null value|undefined|supabase|stack|exception|ecode|code\s*\d/i.test(raw) ||
    /^[a-z0-9_:\s./-]+$/i.test(raw);
  if (looksTechnical) return fallback;
  if (/[áéíóúñ¿¡]|no se |error al |intenta|revisa|correo|contraseña/i.test(raw)) return raw;
  return fallback;
};

export const WORKOUT_TYPES = [
  { id: "easy", label: "Rodaje Suave", color: "#22c55e" },
  { id: "tempo", label: "Tempo", color: "#ff8a3d" },
  { id: "interval", label: "Intervalos", color: "#ef4444" },
  { id: "long", label: "Largo", color: "#3b82f6" },
  { id: "recovery", label: "Recuperación", color: "#8b5cf6" },
  { id: "race", label: "Carrera", color: "#dc2626" },
];

export const EVAL_DISTANCES = [
  { id: "5k", label: "5K", meters: 5000 },
  { id: "10k", label: "10K", meters: 10000 },
  { id: "21k", label: "21K", meters: 21097.5 },
  { id: "42k", label: "42K", meters: 42195 },
];

export const PLAN_PREVIEW_FULL_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export const PLAN_SESSION_TYPE_OPTIONS = [
  ...WORKOUT_TYPES.filter((t) => t.id !== "race"),
  { id: "fartlek", label: "Fartlek", color: "#0d9488" },
];

export const MARKETPLACE_AI_PACE_RANGES_BY_LEVEL = PACE_RANGES_BY_LEVEL;

export const marketplacePreviewSessionType = (w) => {
  const id = w?.type;
  if (id && PLAN_SESSION_TYPE_OPTIONS.some((t) => t.id === id)) return id;
  return "easy";
};

export const marketplaceAiPaceBandKey = (typeId) => {
  const t = String(typeId || "easy").toLowerCase();
  if (t === "tempo") return "tempo";
  if (t === "interval") return "interval";
  return "easy";
};

export const buildMarketplaceAiPacePromptSection = () => {
  const L = (lvl) => MARKETPLACE_AI_PACE_RANGES_BY_LEVEL[lvl] || MARKETPLACE_AI_PACE_RANGES_BY_LEVEL.intermedio;
  const line = (name, lvl) => {
    const p = L(lvl);
    return `- ${name}: Fácil ${p.easy.desc} · Tempo ${p.tempo.desc} · Intervalos ${p.interval.desc} → pace_range easy/long/recovery/fartlek="${p.easy.pace_range}", tempo="${p.tempo.pace_range}", interval="${p.interval.pace_range}"`;
  };
  return [
    "Ritmos por nivel del plan (min/km) — referencia obligatoria; cada sesión debe alinearse al nivel del plan (campo level):",
    line("Principiante", "principiante"),
    line("Intermedio", "intermedio"),
    line("Avanzado", "avanzado"),
    'Para type "easy", "long", "recovery" o "fartlek" usa el ritmo Fácil del nivel. Para "tempo" usa Tempo. Para "interval" usa Intervalos.',
    "Cada elemento de preview_workouts DEBE incluir el campo \"type\" (easy|long|recovery|tempo|interval|fartlek).",
    "Cada elemento de preview_workouts DEBE incluir \"pace_range\" como string en formato H:MM-H:MM con guión ASCII (ej. 6:00-6:45), exactamente el valor de la tabla para ese type y el level del plan.",
    "Cada \"description\" DEBE incluir el rango numérico explícito en min/km según type y level, p. ej. \"Rodaje suave a 6:00–6:45 min/km\" o \"Series a 4:30–5:00 min/km\".",
    "PROHIBIDO usar descripciones vagas como \"ritmo cómodo\", \"ritmo moderado\", \"ritmo suave\" o similares sin cifras; siempre incluye valores min/km concretos de la tabla.",
  ].join("\n");
};

export const applyMarketplaceAiPaceDefaultsToPreviewRows = (rows, levelRaw) => {
  const level = String(levelRaw || "intermedio").toLowerCase();
  const table = MARKETPLACE_AI_PACE_RANGES_BY_LEVEL[level] || MARKETPLACE_AI_PACE_RANGES_BY_LEVEL.intermedio;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    const type = marketplacePreviewSessionType(row);
    const band = marketplaceAiPaceBandKey(type);
    const pr = table[band];
    const pace_range = pr.pace_range;
    let description = String(row.description || "").trim();
    const hasNumericPace = /\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}/.test(description);
    if (!hasNumericPace) {
      const title = String(row.title || "Sesión").trim();
      description = description ? `${description} · Objetivo ${pr.desc}` : `${title} a ${pr.desc}`;
    }
    return { ...row, type, pace_range, description };
  });
};

export const getMarketplacePlanWorkoutRows = (plan) => {
  if (!plan || typeof plan !== "object") return [];
  const prev = Array.isArray(plan.preview_workouts) ? plan.preview_workouts : [];
  const sess = Array.isArray(plan.plan_sessions) ? plan.plan_sessions : [];
  const full = Array.isArray(plan.full_workouts) ? plan.full_workouts : [];
  const longest = (a, b) => (b.length > a.length ? b : a);
  return [prev, sess, full].reduce(longest, []);
};

/**
 * Kilometros por semana de un plan del marketplace: { [semana]: km }.
 *
 * La carga de estos planes es FIJA: al cargarlos se personalizan los ritmos
 * por VDOT, pero no los kilometros ni las series. El comprador necesita saber
 * en que volumen arranca el plan antes de pagarlo.
 *
 * Devuelve null si el plan no trae sesiones, si ninguna declara semana o si
 * ninguna trae distancia: es mejor no mostrar nada que mostrar ceros.
 */
const getPlanWeeklyKmMap = (plan) => {
  const rows = getMarketplacePlanWorkoutRows(plan);
  if (!rows.length) return null;
  const byWeek = new Map();
  let hasDistance = false;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const weekRaw = row.week != null && row.week !== "" ? Number(row.week) : NaN;
    if (!Number.isFinite(weekRaw) || weekRaw < 1) continue;
    const week = Math.round(weekRaw);
    // Las sesiones de la biblioteca del coach usan total_km; las generadas por
    // IA, distance_km. Una sesion sin distancia cuenta como 0, no invalida la
    // semana (puede ser fuerza o movilidad).
    const kmRaw = Number(row.distance_km ?? row.total_km);
    const km = Number.isFinite(kmRaw) && kmRaw > 0 ? kmRaw : 0;
    if (km > 0) hasDistance = true;
    byWeek.set(week, (byWeek.get(week) || 0) + km);
  }
  if (!byWeek.size || !hasDistance) return null;
  return byWeek;
};

/** Km de la semana 1 del plan (volumen de arranque). null si no se puede saber. */
export const getPlanStartingWeeklyKm = (plan) => {
  const byWeek = getPlanWeeklyKmMap(plan);
  if (!byWeek) return null;
  const firstWeek = Math.min(...byWeek.keys());
  const km = byWeek.has(1) ? byWeek.get(1) : byWeek.get(firstWeek);
  return km > 0 ? Math.round(km) : null;
};

/** Km de la semana mas exigente del plan (volumen pico). null si no se sabe. */
export const getPlanPeakWeeklyKm = (plan) => {
  const byWeek = getPlanWeeklyKmMap(plan);
  if (!byWeek) return null;
  const peak = Math.max(...byWeek.values());
  return peak > 0 ? Math.round(peak) : null;
};

export const normalizeAthlete = (athlete) => ({
  id: athlete?.id,
  name: athlete?.name || "Atleta sin nombre",
  age: Number.isFinite(Number(athlete?.age)) ? Number(athlete.age) : 0,
  goal: athlete?.goal || "Objetivo pendiente",
  pace: athlete?.pace || "N/A",
  weekly_km: Number.isFinite(Number(athlete?.weekly_km)) ? Number(athlete.weekly_km) : 0,
  email: typeof athlete?.email === "string" ? athlete.email : "",
  avatar: athlete?.avatar || "🏃",
  // Foto de perfil que sube el atleta (bucket athlete-avatars). Viene en la
  // misma consulta de la lista, no se pide aparte.
  avatar_url: typeof athlete?.avatar_url === "string" ? athlete.avatar_url : "",
  status: athlete?.status || "on-track",
  next_race: athlete?.next_race || "Próxima carrera - Dec 31",
  workouts_done: Number.isFinite(Number(athlete?.workouts_done)) ? Number(athlete.workouts_done) : 0,
  workouts_total: Number.isFinite(Number(athlete?.workouts_total)) ? Number(athlete.workouts_total) : 18,
  plan: typeof athlete?.plan === "string" ? athlete.plan : "",
  coach_id: athlete?.coach_id ?? "",
  user_id: athlete?.user_id ?? null,
  fc_max: Number.isFinite(Number(athlete?.fc_max)) && Number(athlete.fc_max) > 0 ? Math.round(Number(athlete.fc_max)) : null,
  fc_reposo: Number.isFinite(Number(athlete?.fc_reposo)) && Number(athlete.fc_reposo) > 0 ? Math.round(Number(athlete.fc_reposo)) : null,
  athlete_plan: typeof athlete?.athlete_plan === "string" ? athlete.athlete_plan : "",
});

export const PAYMENT_METHOD_OPTIONS = ["Nequi", "Bancolombia", "Efectivo", "Transferencia", "Otro"];

export const PAYMENT_PLAN_OPTIONS = ["Basico", "Pro"];

/** COP mensual para UI atleta / monto por defecto al registrar pago (coach). */
export const PAYMENT_PLAN_AMOUNT_COP = Object.freeze({ Basico: 129000, Pro: 199000 });

export function defaultPaymentAmountStringForPlan(plan) {
  const p = String(plan || "").trim();
  const n = PAYMENT_PLAN_AMOUNT_COP[p];
  return String(Number.isFinite(n) ? n : PAYMENT_PLAN_AMOUNT_COP.Basico);
}

export const WORKOUT_BLOCK_TYPES = ["Calentamiento", "Intervalo", "Recuperación", "Enfriamiento", "Rodaje"];

export const WORKOUT_BLOCK_COLORS = {
  Calentamiento: { bg: "rgba(255,138,61,.14)", border: "rgba(255,138,61,.45)", text: "#b45309" },
  Intervalo: { bg: "rgba(239,68,68,.12)", border: "rgba(239,68,68,.4)", text: "#b91c1c" },
  Recuperación: { bg: "rgba(34,197,94,.12)", border: "rgba(34,197,94,.38)", text: "#166534" },
  Enfriamiento: { bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.38)", text: "#1d4ed8" },
  Rodaje: { bg: "rgba(148,163,184,.16)", border: "rgba(100,116,139,.45)", text: "#475569" },
};

export const FIT_IMPORT_STEP_TYPES = ["Calentamiento", "Intervalo", "Recuperación", "Enfriamiento", "Rodaje"];

export const newFitImportStepKey = () => `fitst_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const emptyFitImportStructureRow = () => ({
  block_type: "Rodaje",
  duration_min: "",
  distance_km: "",
  target_pace: "",
  target_hr: "",
  // Zona Daniels (E/M/T/I/R) cuando se deduce del ritmo al reescalar el workout
  // al VDOT del atleta. Viaja por aqui para poder auditar de donde sale el ritmo.
  target_zone: "",
  description: "",
  __key: newFitImportStepKey(),
});

export const normalizeStructureForFitImportModal = (structure) => {
  const arr = Array.isArray(structure) ? structure : [];
  return arr.map((s, idx) => {
    const raw = String(s?.block_type || s?.phase || "").trim();
    let block_type = "Rodaje";
    if (FIT_IMPORT_STEP_TYPES.includes(raw)) block_type = raw;
    else if (raw === "Intervalos") block_type = "Intervalo";
    const duration_min =
      s?.duration_min != null && String(s.duration_min).trim() !== ""
        ? String(s.duration_min).trim()
        : String(s?.duration ?? "").trim();
    const distance_km =
      s?.distance_km != null && String(s.distance_km).trim() !== "" ? String(s.distance_km).trim() : "";
    const target_pace =
      s?.target_pace != null && String(s.target_pace).trim() !== ""
        ? String(s.target_pace).trim()
        : String(s?.pace || "").trim();
    const target_hr =
      s?.target_hr != null && String(s.target_hr).trim() !== ""
        ? String(s.target_hr).trim()
        : String(s?.intensity || "").trim();
    const description = s?.description != null ? String(s.description).trim() : "";
    return {
      block_type,
      duration_min,
      distance_km,
      target_pace,
      target_hr,
      target_zone: String(s?.target_zone ?? "").trim(),
      description,
      __key: s?.__key || newFitImportStepKey(),
    };
  });
};

// Whitelist de lo que se guarda de cada paso: cualquier campo que no este aqui
// se descarta al insertar en la biblioteca.
export const structureRowsForFitImportInsert = (rows) =>
  (Array.isArray(rows) ? rows : []).map((s) => ({
    block_type: String(s.block_type || "Rodaje").trim(),
    duration_min: String(s.duration_min ?? "").trim(),
    distance_km: String(s.distance_km ?? "").trim(),
    target_pace: String(s.target_pace ?? "").trim(),
    target_hr: String(s.target_hr ?? "").trim(),
    target_zone: String(s.target_zone ?? "").trim(),
    description: String(s.description ?? "").trim(),
  }));

export const paymentStatusLabel = (status) =>
  status === "confirmed" ? "Confirmado" : status === "rejected" ? "Rechazado" : "Pendiente";

export const formatLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const calendarCellToIsoYmd = (d) => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const normalizeScheduledDateYmd = (raw) => {
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") {
    const t = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return formatLocalYMD(d);
    return "";
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return formatLocalYMD(raw);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return formatLocalYMD(d);
};

export const startOfWeekMonday = (ref = new Date()) => {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d;
};

export const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

/** Km últimos 7d vs promedio semanal (4 semanas lun–dom), ratio aguda/crónica y barras (solo workouts completados). */
export const computeGarminLoadMetricsFromWorkouts = (workouts) => {
  const today = new Date();
  const todayYmd = formatLocalYMD(today);
  const doneWorkouts = (workouts || []).filter((w) => w?.done);

  const acuteStartYmd = formatLocalYMD(addDays(today, -6));
  let acuteKm = 0;
  for (const w of doneWorkouts) {
    const ymd = normalizeScheduledDateYmd(w.scheduled_date);
    if (!ymd || ymd < acuteStartYmd || ymd > todayYmd) continue;
    acuteKm += Number(w.total_km) || 0;
  }

  const currentMonday = startOfWeekMonday(today);
  const weekBars = [];
  let totalKm4w = 0;
  let totalSessions4w = 0;
  let totalMin4w = 0;
  for (let i = 0; i < 4; i += 1) {
    const start = addDays(currentMonday, -(i * 7));
    const end = addDays(start, 6);
    const startYmd = formatLocalYMD(start);
    const endYmd = formatLocalYMD(end);
    let weekKm = 0;
    let weekSessions = 0;
    let weekMin = 0;
    for (const w of doneWorkouts) {
      const ymd = normalizeScheduledDateYmd(w.scheduled_date);
      if (!ymd || ymd < startYmd || ymd > endYmd) continue;
      weekKm += Number(w.total_km) || 0;
      weekSessions += 1;
      weekMin += Number(w.duration_min) || 0;
    }
    totalKm4w += weekKm;
    totalSessions4w += weekSessions;
    totalMin4w += weekMin;
    const weekLabel = i === 0 ? "Esta semana" : i === 1 ? "Hace 1 sem" : i === 2 ? "Hace 2 sem" : "Hace 3 sem";
    weekBars.push({
      key: startYmd,
      label: weekLabel,
      rangeLabel: `${startYmd} → ${endYmd}`,
      km: weekKm,
      sessions: weekSessions,
    });
  }

  const chronicWeeklyAvgKm = totalKm4w / 4;
  const ratio = chronicWeeklyAvgKm > 1e-6 ? acuteKm / chronicWeeklyAvgKm : null;
  const avgSessionsPerWeek = totalSessions4w / 4;
  const band = acwrBandFromRatio(ratio);
  const gaugePct = acwrGaugePercent(ratio);

  const maxBarKm = Math.max(1, ...weekBars.map((b) => b.km));
  const weekBarsOldestFirst = [...weekBars].reverse();

  return {
    acuteKm,
    chronicWeeklyAvgKm,
    ratio,
    statusLabel: band.label,
    statusColor: band.color,
    acwrBandKey: band.key,
    ratioIndicatorColor: band.color,
    ratioGaugePercent: gaugePct,
    weekBarsOldestFirst,
    maxBarKm,
    avgSessionsPerWeek,
    totalMin4w,
    hasRatio: ratio != null && Number.isFinite(ratio),
    COLOR_ORANGE,
    COLOR_GREEN,
    COLOR_RED,
  };
};

export const firstDayOfNextMonthYmd = () => {
  const n = new Date();
  return formatLocalYMD(new Date(n.getFullYear(), n.getMonth() + 1, 1));
};

export const lastDayOfNextMonthYmd = () => {
  const n = new Date();
  return formatLocalYMD(new Date(n.getFullYear(), n.getMonth() + 2, 0));
};

export const nextWeekMondayToSundayYmd = () => {
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = d.getDay();
  let daysToNextMonday;
  if (dow === 0) daysToNextMonday = 1;
  else if (dow === 1) daysToNextMonday = 7;
  else daysToNextMonday = 8 - dow;
  const monday = addDays(d, daysToNextMonday);
  const sunday = addDays(monday, 6);
  return { start: formatLocalYMD(monday), end: formatLocalYMD(sunday) };
};

export const formatDurationMinutesTotal = (mins) => {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (m === 0) return "0 min";
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} min`;
};

export const startOfMonthWeekMonday = (year, monthIndex) => startOfWeekMonday(new Date(year, monthIndex, 1));

export const getMonthGrid = (year, monthIndex) => {
  const gridStart = startOfMonthWeekMonday(year, monthIndex);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
};

export const cellIsInViewMonth = (cellDate, year, monthIndex) =>
  cellDate.getFullYear() === year && cellDate.getMonth() === monthIndex;

export const daysBetweenYmd = (fromYmd, toYmd) => {
  const a = new Date(`${fromYmd}T12:00:00`);
  const b = new Date(`${toYmd}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

export const RACE_DISTANCE_PRESETS = ["5K", "10K", "21K", "42K", "Otro"];

/** Prioridad de la carrera: decide cuanto afinamiento mete el generador. */
export const RACE_PRIORITY_OPTIONS = [
  { id: "A", label: "A — Carrera objetivo (afinamiento completo)", short: "Objetivo", color: "#b45309" },
  { id: "B", label: "B — Carrera importante (afinamiento corto)", short: "Importante", color: "#0e7490" },
  { id: "C", label: "C — Carrera de entrenamiento (sin afinamiento)", short: "Entrenamiento", color: "#64748b" },
];

export const racePriorityMeta = (priority) =>
  RACE_PRIORITY_OPTIONS.find((p) => p.id === normalizeRacePriority(priority)) || RACE_PRIORITY_OPTIONS[0];

export const raceDistanceToFormFields = (dist) => {
  const d = String(dist || "").trim();
  const fixed = RACE_DISTANCE_PRESETS.filter((x) => x !== "Otro");
  if (fixed.includes(d)) return { distance: d, distanceOther: "" };
  return { distance: "Otro", distanceOther: d };
};

export const normalizeRaceRow = (row) => {
  const raw = row?.date;
  const dateStr =
    typeof raw === "string"
      ? raw.slice(0, 10)
      : raw
        ? formatLocalYMD(new Date(raw))
        : "";
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    coach_id: row.coach_id,
    name: row.name || "",
    date: dateStr,
    distance: row.distance != null ? String(row.distance) : "",
    city: row.city != null ? String(row.city) : "",
    priority: normalizeRacePriority(row.priority),
  };
};

export const getNextRaceCountdown = (races, todayYmd) => {
  const list = (races || [])
    .filter((r) => r.date && r.date >= todayYmd)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const r = list[0];
  const days = daysBetweenYmd(todayYmd, r.date);
  return { race: r, days };
};

/**
 * Extrae el texto utilizable de una respuesta Anthropic Messages API.
 * NUNCA tomar content[0]: claude-sonnet-5 puede devolver primero un bloque
 * "thinking" (razonamiento extendido) y el JSON/texto va en bloques "text".
 * Concatena todos los bloques type==="text"; ignora thinking/tool_use/etc.
 */
export const extractAnthropicTextContent = (content, logTag = "[anthropic]") => {
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks
    .filter((b) => b && b.type === "text")
    .map((b) => String(b.text || ""))
    .join("\n")
    .trim();
  if (!text) {
    console.error(
      `${logTag} sin bloque de texto. Tipos recibidos:`,
      blocks.map((b) => b?.type),
      "| stop_reason se loguea en /api/generate-workout",
    );
  }
  return text;
};

export const extractJsonFromAnthropicText = (text) => {
  const raw = (text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const startArr = raw.indexOf("[");
  const endArr = raw.lastIndexOf("]");
  if (startArr >= 0 && endArr > startArr) {
    try {
      return JSON.parse(raw.slice(startArr, endArr + 1));
    } catch {
      /* continue */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
};

export const formatDurationClock = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const normalizeWorkoutStructure = (rawStructure) => {
  const arr = Array.isArray(rawStructure) ? rawStructure : [];
  return arr
    .map((s) => {
      const block_type =
        WORKOUT_BLOCK_TYPES.includes(String(s?.block_type || "").trim())
          ? String(s.block_type).trim()
          : String(s?.phase || "").trim() || "Intervalo";
      const duration_min =
        s?.duration_min != null && String(s.duration_min).trim() !== ""
          ? String(s.duration_min).trim()
          : String(s?.duration || "").trim();
      let distance_km =
        s?.distance_km != null && String(s.distance_km).trim() !== "" ? String(s.distance_km).trim() : "";
      const target_pace =
        s?.target_pace != null && String(s.target_pace).trim() !== ""
          ? String(s.target_pace).trim()
          : String(s?.pace || "").trim();
      const target_hr =
        s?.target_hr != null && String(s.target_hr).trim() !== ""
          ? String(s.target_hr).trim()
          : String(s?.intensity || "").trim();
      const description =
        s?.description != null && String(s.description).trim() !== "" ? String(s.description).trim() : "";
      // Auto-rellena distance_km desde el nombre/descripcion ("400m" -> "0.4")
      // solo si el bloque no lo trae ya. Deja el dato explicito, no solo en el
      // nombre; el export usa el nombre como red de seguridad (misma fuente:
      // distKmFromLabel en intervals.js). No sobrescribe valores existentes.
      if (!distance_km) {
        const km = distKmFromLabel(block_type) ?? distKmFromLabel(description);
        if (km != null) distance_km = String(km);
      }
      if (!block_type && !duration_min && !distance_km && !target_pace && !target_hr && !description) return null;
      // La IA nombra los bloques con la distancia ("Repetition 3 - 400m") y ese
      // nombre no esta en WORKOUT_BLOCK_TYPES. Se guarda aparte para no
      // perderlo al pasar por el editor, que solo maneja el vocabulario fijo.
      const rawPhase = String(s?.phase || "").trim();
      const block_label = rawPhase && !WORKOUT_BLOCK_TYPES.includes(rawPhase) ? rawPhase : "";
      const gradeRaw = Number(s?.grade_pct);
      const grade_pct = Number.isFinite(gradeRaw) ? gradeRaw : undefined;
      const race_zone = String(s?.race_zone || "").trim().toUpperCase() || undefined;
      return {
        block_type,
        duration_min,
        distance_km,
        target_pace,
        target_hr,
        description,
        block_label,
        ...(grade_pct != null ? { grade_pct } : {}),
        ...(race_zone ? { race_zone } : {}),
      };
    })
    .filter(Boolean);
};

/**
 * Minutos de un bloque a partir de lo que haya escrito la IA o el coach:
 * "12", "12 min", "90 sec", "1:30". null si no hay nada usable.
 */
export const blockDurationToMinutes = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  const clock = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const num = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!num) return null;
  const n = Number(String(num[1]).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return /\b(s|sec|seg|segundos?)\b/.test(text) ? n / 60 : n;
};

/**
 * Suma de km y minutos de las filas del editor de bloques.
 * kmComplete/minComplete dicen si TODAS las filas aportaron el dato: un
 * calentamiento por tiempo no lleva distancia, y sumar solo las series daria
 * un total mas corto que la sesion real.
 */
export const sumStructureRows = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  let km = 0;
  let min = 0;
  let kmComplete = list.length > 0;
  let minComplete = list.length > 0;
  for (const r of list) {
    const d = Number(String(r?.distance_km ?? "").replace(",", "."));
    if (Number.isFinite(d) && d > 0) km += d;
    else kmComplete = false;
    const m = blockDurationToMinutes(r?.duration_min);
    if (m != null && m > 0) min += m;
    else minComplete = false;
  }
  return { km: Math.round(km * 10) / 10, min: Math.round(min), kmComplete, minComplete };
};

export const emptyWorkoutStructureRow = () => ({ block_type: "Intervalo", duration_min: "", distance_km: "", target_pace: "", target_hr: "", description: "" });

export const workoutStructureToEditableRows = (structure) => {
  return normalizeWorkoutStructure(structure);
};

export const editableRowsToWorkoutStructure = (rows) => {
  const out = (rows || [])
    .map((r) => {
      const block_type = WORKOUT_BLOCK_TYPES.includes(String(r?.block_type || "").trim()) ? String(r.block_type).trim() : "Intervalo";
      const duration_min = (r?.duration_min ?? "").toString().trim();
      const distance_km = (r?.distance_km ?? "").toString().trim();
      const target_pace = (r?.target_pace ?? "").toString().trim();
      const target_hr = (r?.target_hr ?? "").toString().trim();
      const description = (r?.description ?? "").toString().trim();
      if (!block_type && !duration_min && !distance_km && !target_pace && !target_hr && !description) return null;
      const o = { block_type };
      if (duration_min) o.duration_min = duration_min;
      if (distance_km) o.distance_km = distance_km;
      if (target_pace) o.target_pace = target_pace;
      if (target_hr) o.target_hr = target_hr;
      if (description) o.description = description;
      // compatibilidad visual con código legado. El nombre original manda si
      // existe: "Repetition 3 - 400m" es lo que el reloj y la tabla muestran.
      const block_label = (r?.block_label ?? "").toString().trim();
      if (block_label) o.block_label = block_label;
      const gradeRaw = Number(r?.grade_pct);
      if (Number.isFinite(gradeRaw)) o.grade_pct = gradeRaw;
      const race_zone = String(r?.race_zone || "").trim().toUpperCase();
      if (race_zone) o.race_zone = race_zone;
      o.phase = block_label || block_type;
      o.duration = duration_min;
      o.pace = target_pace;
      o.intensity = target_hr || description;
      return Object.keys(o).length ? o : null;
    })
    .filter(Boolean);
  return out;
};

/**
 * Parte de la sesion que se corre a ritmo facil (calentamiento y vuelta a la
 * calma). En tempo e intervalos el ritmo de las series NO es el ritmo medio de
 * la sesion, y usarlo para convertir km en minutos se queda muy corto.
 */
export const EASY_SHARE_BY_TYPE = { tempo: 0.35, interval: 0.5 };

/** Zona de ritmo que le corresponde a cada tipo de sesion. */
export const PACE_ZONE_BY_TYPE = {
  easy: "easy",
  long: "easy",
  recovery: "recovery",
  tempo: "tempo",
  interval: "interval",
  race: "marathon",
};

/**
 * Tipos en los que manda la distancia. Un rodaje largo se prescribe en km
 * ("hoy toca el largo de 25 km"); el resto se prescribe en tiempo, asi que si
 * los numeros no cuadran se corrigen los km, no los minutos.
 */
const KM_PRIMARY_TYPES = new Set(["long"]);

/** Discrepancia relativa a partir de la que se considera incoherente. */
export const KM_DURATION_TOLERANCE = 0.05;

/**
 * Ritmo medio de una sesion en segundos por km, con su procedencia.
 *
 * Prioridad: los bloques del structure (tiempo total / distancia total, que es
 * el ritmo real de la sesion incluyendo recuperaciones), el pace_range de la
 * propia sesion, la mezcla por tipo con los ritmos del VDOT del atleta y, por
 * ultimo, el ritmo que la IA escribio en la descripcion. null si no hay nada.
 */
export const sessionMeanPaceSeconds = (workout, { paceRanges = null } = {}) => {
  const type = String(workout?.type || "").toLowerCase();

  const blocks = normalizeWorkoutStructure(readStructure(workout));
  if (blocks.length) {
    let seconds = 0;
    let km = 0;
    let resolved = 0;
    for (const b of blocks) {
      const durMin = blockDurationToMinutes(b.duration_min);
      const paceSecs = midPaceSecondsFromRange(b.target_pace);
      const distRaw = Number(String(b.distance_km ?? "").replace(",", "."));
      const dist = Number.isFinite(distRaw) && distRaw > 0 ? distRaw : null;
      if (durMin != null && paceSecs) {
        seconds += durMin * 60;
        km += (durMin * 60) / paceSecs;
        resolved += 1;
      } else if (dist != null && paceSecs) {
        seconds += dist * paceSecs;
        km += dist;
        resolved += 1;
      } else if (dist != null && durMin != null) {
        seconds += durMin * 60;
        km += dist;
        resolved += 1;
      }
    }
    // Solo sirve si TODOS los bloques aportaron datos: con la mitad resueltos
    // el "ritmo medio" seria el de un trozo de la sesion, no el de la sesion.
    if (resolved === blocks.length && km > 0 && seconds > 0) {
      return { secs: seconds / km, source: "bloques" };
    }
  }

  const fromField = midPaceSecondsFromRange(workout?.pace_range);
  if (fromField) return { secs: fromField, source: "pace_range" };

  // Mismo orden que el editor manual (editPace en Plan2Weeks), para que la
  // correccion automatica y la manual usen el mismo ritmo.
  const zoneKey = PACE_ZONE_BY_TYPE[type] || "easy";
  const zoneSecs = paceRanges?.[zoneKey] ? midPaceSecondsFromRange(paceRanges[zoneKey].pace_range) : null;
  const easySecs = paceRanges?.easy ? midPaceSecondsFromRange(paceRanges.easy.pace_range) : null;
  const easyShare = EASY_SHARE_BY_TYPE[type];
  if (easyShare && zoneSecs && easySecs) {
    return { secs: zoneSecs * (1 - easyShare) + easySecs * easyShare, source: "VDOT (calentamiento + series)" };
  }

  const fromText = extractPaceSecondsFromText(workout?.description);
  if (fromText) return { secs: fromText, source: "descripción" };

  if (zoneSecs) return { secs: zoneSecs, source: `zona ${zoneKey} del VDOT` };

  return null;
};

/**
 * Cuadra los km y los minutos de una sesion generada por IA.
 *
 * La IA devuelve total_km y duration_min como campos independientes y a veces
 * suelta un numero redondo que no cuadra con los ritmos ("10 km en 60 min" a
 * 7:30 min/km son 8 km, no 10). Esto recalcula el campo secundario a partir
 * del primario y del ritmo medio, para que lo que ve el atleta sea coherente.
 *
 * No toca la estructura de bloques ni ningun otro campo.
 *
 * @returns {{workout: object, changed: boolean, field?: string, from?: number,
 *   to?: number, paceSecs?: number, paceSource?: string, reason: string}}
 */
export const reconcileWorkoutKmDuration = (workout, { paceRanges = null, tolerance = KM_DURATION_TOLERANCE, kmKey = null } = {}) => {
  if (!workout || typeof workout !== "object") return { workout, changed: false, reason: "sesión vacía" };

  // El marketplace guarda la distancia en distance_km; el resto en total_km.
  const key = kmKey
    || (workout.total_km != null ? "total_km" : workout.distance_km != null ? "distance_km" : "total_km");
  const km = Number(workout[key]);
  const min = Number(workout.duration_min);
  const kmOk = Number.isFinite(km) && km > 0;
  const minOk = Number.isFinite(min) && min > 0;
  if (!kmOk && !minOk) return { workout, changed: false, reason: "sin km ni duración" };

  const pace = sessionMeanPaceSeconds(workout, { paceRanges });
  if (!pace?.secs) return { workout, changed: false, reason: "sin ritmo de referencia" };

  const kmFromMin = Math.round(((min * 60) / pace.secs) * 10) / 10;
  const minFromKm = Math.round((km * pace.secs) / 60);
  const meta = { paceSecs: pace.secs, paceSource: pace.source };

  if (!kmOk) {
    return { workout: { ...workout, [key]: kmFromMin }, changed: true, field: key, from: km || 0, to: kmFromMin, reason: "faltaban los km", ...meta };
  }
  if (!minOk) {
    return { workout: { ...workout, duration_min: minFromKm }, changed: true, field: "duration_min", from: min || 0, to: minFromKm, reason: "faltaba la duración", ...meta };
  }

  const drift = Math.abs(minFromKm - min) / min;
  if (drift <= tolerance) return { workout, changed: false, reason: "coherente", ...meta };

  if (KM_PRIMARY_TYPES.has(String(workout.type || "").toLowerCase())) {
    return { workout: { ...workout, duration_min: minFromKm }, changed: true, field: "duration_min", from: min, to: minFromKm, reason: "la distancia manda en el rodaje largo", ...meta };
  }
  return { workout: { ...workout, [key]: kmFromMin }, changed: true, field: key, from: km, to: kmFromMin, reason: "la duración manda en esta sesión", ...meta };
};

/** Aplica reconcileWorkoutKmDuration a una lista y loguea lo que corrigió. */
export const reconcileWorkoutList = (list, { paceRanges = null, kmKey = null, logLabel = "ia" } = {}) => {
  let fixed = 0;
  const out = (Array.isArray(list) ? list : []).map((wo) => {
    const r = reconcileWorkoutKmDuration(wo, { paceRanges, kmKey });
    if (r.changed) {
      fixed += 1;
      console.log(
        `[${logLabel}] "${wo?.title || "sesión"}": ${r.field} ${r.from} -> ${r.to}`,
        `(${r.reason}, ritmo ${fmtPace(r.paceSecs)} min/km desde ${r.paceSource})`,
      );
    }
    return r.workout;
  });
  return { list: out, fixed };
};

/**
 * Lunes y domingo (YYYY-MM-DD) de la semana en curso, en la hora local del
 * navegador, que es la misma convencion que usa el calendario del coach.
 */
export const currentWeekRangeYmd = (ref = new Date()) => {
  const monday = startOfWeekMonday(ref);
  return { from: formatLocalYMD(monday), to: formatLocalYMD(addDays(monday, 6)) };
};

/**
 * Distancia realmente corrida y km semanales: misma fórmula que el cron de
 * resumen (`lib/weekStats.js`). planned = total_km; actual solo si done.
 */
export const workoutActualKm = workoutActualKmFromLib;
export const sumWeekKm = sumWeekKmFromLib;

/**
 * Km programados y corridos de esta semana por atleta, en UNA sola consulta
 * para toda la lista (nunca una por atleta). ok=false si la consulta falla:
 * mejor no pintar nada que enseñar ceros que no son ciertos.
 */
export const fetchWeeklyKmByAthlete = async (athleteIds, range) => {
  const ids = (Array.isArray(athleteIds) ? athleteIds : []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return { ok: true, byAthlete: {} };
  const { from, to } = range || currentWeekRangeYmd();
  const { data, error } = await supabase
    .from("workouts")
    .select("athlete_id, total_km, done, actual_distance_km, manual_distance_km")
    .in("athlete_id", ids)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);
  if (error) {
    console.warn("[carga semanal] no se pudieron leer los workouts de la semana:", error.message);
    return { ok: false, byAthlete: {} };
  }
  const rowsByAthlete = {};
  for (const row of data || []) {
    const key = String(row?.athlete_id ?? "");
    if (!key) continue;
    if (!rowsByAthlete[key]) rowsByAthlete[key] = [];
    rowsByAthlete[key].push(row);
  }
  const byAthlete = {};
  for (const [key, rows] of Object.entries(rowsByAthlete)) byAthlete[key] = sumWeekKm(rows);
  return { ok: true, byAthlete };
};

/**
 * Mensajes sin leer por atleta, en UNA sola consulta para toda la lista del
 * coach (nunca una por atleta). Para el coach "sin leer" es lo que le mando el
 * atleta; el senderRole se puede invertir para el caso simetrico.
 *
 * ok=false cuando la consulta falla: mejor no pintar nada que inventar ceros.
 */
export const fetchUnreadMessageCounts = async ({ coachId, athleteIds, senderRole = "athlete" }) => {
  const ids = (Array.isArray(athleteIds) ? athleteIds : []).map(Number).filter((n) => Number.isFinite(n));
  if (!coachId || !ids.length) return { ok: true, byAthlete: {} };
  const { data, error } = await supabase
    .from("messages")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("sender_role", senderRole)
    .eq("read", false)
    .in("athlete_id", ids);
  if (error) {
    console.warn("[chat] no se pudieron contar los mensajes sin leer:", error.message);
    return { ok: false, byAthlete: {} };
  }
  const byAthlete = {};
  for (const row of data || []) {
    const key = String(row?.athlete_id ?? "");
    if (!key) continue;
    byAthlete[key] = (byAthlete[key] || 0) + 1;
  }
  return { ok: true, byAthlete };
};

/**
 * Marca como leidos los mensajes que el OTRO lado envio en la conversacion.
 * readerRole "coach" marca los del atleta; "athlete" marca los del coach.
 * Devuelve cuantas filas se marcaron (0 si no habia nada o si la RLS filtro).
 */
export const markConversationRead = async ({ coachId, athleteId, readerRole }) => {
  if (!athleteId) return 0;
  const senderRole = readerRole === "coach" ? "athlete" : "coach";
  let q = supabase
    .from("messages")
    .update({ read: true })
    .eq("athlete_id", athleteId)
    .eq("sender_role", senderRole)
    .eq("read", false);
  if (coachId) q = q.eq("coach_id", coachId);
  const { data, error } = await q.select("id");
  if (error) {
    console.warn("[chat] no se pudieron marcar como leidos:", error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
};

export const normalizeLibraryRow = (row) => {
  const structure = normalizeWorkoutStructure(readStructure(row));
  const type = row.type && WORKOUT_TYPES.some((t) => t.id === row.type) ? row.type : "easy";
  const totalKm = Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0;
  const distKm = Number.isFinite(Number(row.distance_km)) ? Number(row.distance_km) : totalKm;
  const wtype = row.workout_type && String(row.workout_type).trim() ? String(row.workout_type).trim() : type;
  return {
    id: row.id,
    coach_id: row.coach_id,
    title: row.title || "",
    type,
    workout_type: wtype,
    total_km: totalKm,
    distance_km: distKm,
    duration_min: Number.isFinite(Number(row.duration_min)) ? Math.round(Number(row.duration_min)) : 0,
    description: row.description || "",
    structure: Array.isArray(structure) ? structure : [],
    created_at: row.created_at ?? null,
    intensity: row.intensity != null ? String(row.intensity) : "",
    notes: row.notes != null ? String(row.notes) : "",
    is_fitness_test:
      row.is_fitness_test === true ? true : row.is_fitness_test === false ? false : null,
  };
};

export const libraryRowToBuilderWorkout = (row) => ({
  title: row.title,
  type: row.type,
  total_km: row.total_km,
  duration_min: row.duration_min,
  description: row.description || "",
  structure: Array.isArray(row.structure) ? row.structure : [],
  is_fitness_test:
    row.is_fitness_test === true ? true : row.is_fitness_test === false ? false : null,
});


export const PLATFORM_ADMIN_USER_ID = "b5c9e44a-6695-4800-99bd-f19b05d2f66f";

/** Duración fija del trial de coach (días desde trial_started_at). */
export const COACH_PROFILE_TRIAL_DAYS = 7;

/** Días restantes de trial: max(0, 7 − días transcurridos desde trial_started_at). */
export const coachTrialDaysRemainingFromStart = (prof) => {
  if (!prof || prof.plan_status !== "trial" || !prof.trial_started_at) return null;
  const start = new Date(prof.trial_started_at);
  if (Number.isNaN(start.getTime())) return null;
  const elapsedDays = Math.floor((Date.now() - start.getTime()) / 86400000);
  return Math.max(0, COACH_PROFILE_TRIAL_DAYS - elapsedDays);
};

export const styles = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  },
  sidebar: {
    width: 228,
    background: "#ffffff",
    borderRight: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    padding: "0 0 20px",
    flexShrink: 0,
    boxShadow: "1px 0 0 rgba(15,23,42,0.04)",
  },
  logo: { display: "flex", gap: 10, alignItems: "center", padding: "20px 16px 22px", borderBottom: "1px solid #e2e8f0" },
  logoTitle: { fontSize: "1em", fontWeight: 800, letterSpacing: ".06em", color: "#0f172a" },
  logoSub: { fontSize: ".65em", color: "#64748b", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 },
  navBtn: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#475569",
    padding: "11px 16px",
    cursor: "pointer",
    fontSize: ".86em",
    textAlign: "left",
    fontFamily: "inherit",
    fontWeight: 600,
    borderRadius: 0,
    borderRight: "3px solid transparent",
  },
  navBtnActive: {
    color: "#c2410c",
    background: "rgba(255,138,61, 0.14)",
    borderRight: "3px solid #ff8a3d",
  },
  sidebarFooter: { padding: "16px", borderTop: "1px solid #e2e8f0", marginTop: "auto", background: "#fafafa" },
  page: { padding: "28px 32px", maxWidth: 1120, width: "100%" },
  pageTitle: { fontSize: "1.65em", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" },
  card: {
    background: "#ffffff",
    border: "1px solid #f1f5f9",
    borderRadius: 12,
    padding: 22,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "rgba(255,138,61, 0.12)",
    border: "1px solid rgba(255,138,61, 0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.2em",
    flexShrink: 0,
  },
  notification: {
    position: "fixed",
    top: 20,
    right: 20,
    background: "#ffffff",
    border: "1px solid #86efac",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: ".82em",
    fontWeight: 700,
    color: "#15803d",
    zIndex: 200,
    boxShadow: "0 4px 20px rgba(15,23,42,0.12)",
  },
};

export const TAB_KEY_CREATE_WORKOUT = "raf_tab_crear_workout";

export const getCurrentMonthKey = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
};

export const PLAN_12_LEVELS = [
  { id: "principiante", label: "Principiante" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

export const PLAN2_NEXT_BLOCK_FOCUSES = ["Base", "Construcción", "Desarrollo", "Pico", "Descarga"];

export const PLAN2_TRAINING_DAY_OPTIONS = [
  { weekday: 2, label: "Mar" },
  { weekday: 3, label: "Mié" },
  { weekday: 4, label: "Jue" },
  { weekday: 6, label: "Sáb" },
  { weekday: 7, label: "Dom" },
];

export const PLAN2_ATHLETE_STORAGE_KEY = "raf_plan2_athlete";

/**
 * Plantilla fija del plan de 2 semanas.
 *
 * El largo va en DOMINGO: es la sesion mas larga (puede pasar de 18 km) y
 * necesita una mañana libre y el resto del dia para recuperar. Antes caia en
 * martes, dia laborable, y ademas habia dos sesiones "long".
 *
 * Lunes y viernes son descanso, asi que las dos sesiones de calidad (miercoles
 * tempo y sabado intervalos) nunca caen en dias consecutivos.
 */
const PLAN2_FIXED_SLOTS = [
  { weekday: 2, type: "easy" },
  { weekday: 3, type: "tempo" },
  { weekday: 4, type: "easy" },
  { weekday: 6, type: "interval" },
  { weekday: 7, type: "long" },
];
// Se cae primero el jueves y luego el martes (los rodajes suaves). El domingo
// no se descarta nunca: sin largo no hay plan.
const PLAN2_OMIT_ORDER = [4, 2, 3];

export const getPlan2ExpectedSlots = (sessionsPerWeek) => {
  let slots = [...PLAN2_FIXED_SLOTS];
  for (const wd of PLAN2_OMIT_ORDER) {
    if (slots.length <= sessionsPerWeek) break;
    slots = slots.filter((s) => s.weekday !== wd);
  }
  return slots;
};

export const validatePlan2Distribution = (weeks, sessionsPerWeek) => {
  const expected = getPlan2ExpectedSlots(sessionsPerWeek);
  if (expected.length !== sessionsPerWeek) return "template";
  for (const week of weeks) {
    const list = Array.isArray(week.workouts) ? week.workouts : [];
    if (list.length !== sessionsPerWeek) return "count";
    const byWd = new Map(list.map((w) => [Number(w.weekday), w]));
    for (const slot of expected) {
      const wo = byWd.get(slot.weekday);
      if (!wo) return "missing";
      if (wo.type !== slot.type) return "type";
    }
    if (byWd.size !== expected.length) return "extra";
  }
  return null;
};

export const getNextMonday = (dateStr) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return formatLocalYMD(addDays(new Date(), 1));
  const day = d.getDay();
  const diff = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return formatLocalYMD(d);
};

/* ============================================================
 * ZONAS DE FRECUENCIA CARDIACA — FUENTE UNICA
 * ============================================================
 * Habia dos calculos distintos (la evaluacion con Karvonen y el panel del
 * coach con %FCmax a secas, mas una copia de este ultimo en App.jsx), asi que
 * el mismo atleta veia tablas de zonas incompatibles segun la pantalla.
 * Todo pasa por computeHrZones().
 */

const HR_ZONE_DEFS = [
  { z: 1, lowPct: 0.5, highPct: 0.6, label: "Recuperación activa", color: "#22c55e" },
  { z: 2, lowPct: 0.6, highPct: 0.7, label: "Aeróbico base", color: "#3b82f6" },
  { z: 3, lowPct: 0.7, highPct: 0.8, label: "Aeróbico tempo", color: "#eab308" },
  { z: 4, lowPct: 0.8, highPct: 0.9, label: "Umbral anaeróbico", color: "#f97316" },
  { z: 5, lowPct: 0.9, highPct: 1.0, label: "VO2 max", color: "#ef4444" },
];

/** Limites de una FC en reposo creible, y separacion minima con la maxima. */
export const RESTING_HR_MIN = 30;
export const RESTING_HR_MAX = 90;
export const MIN_HR_RESERVE = 40;

/**
 * ¿La FC en reposo sirve para Karvonen?
 *
 * Un atleta escribio 140 lpm, que es su FC media de esfuerzo, y Karvonen le
 * comprimio las cinco zonas en 18 lpm (Z1 de 3 lpm de ancho). De ahi el minimo
 * de reserva: sin al menos 40 lpm entre maxima y reposo, las zonas no sirven
 * para entrenar.
 */
export const isValidRestingHr = (fcReposo, fcMax) => {
  const rest = Number(fcReposo);
  if (!Number.isFinite(rest) || rest < RESTING_HR_MIN || rest > RESTING_HR_MAX) return false;
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) return false;
  return max - rest >= MIN_HR_RESERVE;
};

/**
 * Zonas de FC del atleta. Karvonen si la FC en reposo es valida, y si no,
 * porcentaje de la FC maxima avisando de que el dato es menos preciso.
 *
 * @param {number} fcMax     FC maxima en lpm
 * @param {number} fcReposo  FC en reposo en lpm (opcional)
 * @returns {{ zones: object[], method: 'karvonen'|'fcmax'|null, warning: string|null }}
 *
 * Cada zona trae los bpm por duplicado en low/high y lowBpm/highBpm: la
 * primera pareja es la que leen el panel del coach y el PDF, y la segunda es
 * la forma con la que ya estan guardadas las evaluaciones historicas en
 * athlete_evaluations.hr_zones.
 */
export const computeHrZones = (fcMax, fcReposo) => {
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) {
    return { zones: [], method: null, warning: "Registra tu FC máxima para calcular tus zonas de entrenamiento." };
  }
  const useKarvonen = isValidRestingHr(fcReposo, max);
  const rest = Number(fcReposo);
  const reserve = max - rest;
  const zones = HR_ZONE_DEFS.map((d) => {
    const low = useKarvonen ? Math.round(rest + reserve * d.lowPct) : Math.round(max * d.lowPct);
    const high = useKarvonen ? Math.round(rest + reserve * d.highPct) : Math.round(max * d.highPct);
    return {
      zone: d.z,
      z: `Z${d.z}`,
      label: d.label,
      color: d.color,
      lowPct: d.lowPct,
      highPct: d.highPct,
      low,
      high,
      lowBpm: low,
      highBpm: high,
      pctLabel: `${d.lowPct * 100}-${d.highPct * 100}% ${useKarvonen ? "FC reserva" : "FC máx"}`,
    };
  });
  return {
    zones,
    method: useKarvonen ? "karvonen" : "fcmax",
    warning: useKarvonen ? null : "Zonas calculadas solo con FC máxima. Registra tu FC en reposo para zonas más precisas.",
  };
};

export const buildAthleteHrZonesPromptText = (athlete) => {
  if (!athlete || !athlete.fc_max || athlete.fc_max <= 0) return "";
  const { zones, method } = computeHrZones(athlete.fc_max, athlete.fc_reposo);
  if (!zones.length) return "";
  const lines = zones.map((z) => `Z${z.zone} (${z.pctLabel}): ${z.low}-${z.high} bpm — ${z.label}`);
  const basis = method === "karvonen"
    ? `Karvonen, max HR ${athlete.fc_max} bpm and resting HR ${athlete.fc_reposo} bpm`
    : `max HR ${athlete.fc_max} bpm`;
  return `Athlete heart rate zones (${basis}):\n${lines.join("\n")}`;
};

/** Nombre bonito de cada plataforma de dispositivo. */
export const DEVICE_PROVIDER_LABELS = {
  intervals_icu: "intervals.icu",
  garmin: "Garmin",
  coros: "COROS",
};

/** "intervals_icu" -> "intervals.icu"; lo desconocido se capitaliza tal cual. */
export const providerLabel = (provider) => {
  const raw = String(provider || "").trim();
  if (!raw) return "Dispositivo";
  const known = DEVICE_PROVIDER_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

/** Fecha de la ultima sincronizacion para el tooltip del badge. */
export const formatDeviceSyncDate = (value) => {
  if (!value) return "sin datos aún";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "sin datos aún";
  return d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
};

/**
 * Conexiones activas de una tanda de atletas, en UNA sola consulta.
 *
 * Lee la vista athlete_device_status y no la tabla device_connections: esa
 * tabla guarda api_key, access_token y refresh_token, y dar SELECT al coach
 * sobre ella le entregaria los tokens del atleta. La vista expone solo el
 * estado (provider, status, last_pull_at).
 *
 * Devuelve { ok, byAthlete }. ok=false cuando la consulta falla (por ejemplo
 * si la vista aun no existe), para poder no pintar nada en vez de asegurar en
 * falso que el atleta no tiene dispositivo.
 */
export const fetchActiveDeviceConnections = async (athleteIds) => {
  const ids = [...new Set((athleteIds || []).map((v) => Number(v)).filter((n) => Number.isFinite(n)))];
  if (!ids.length) return { ok: true, byAthlete: {} };
  const { data, error } = await supabase
    .from("athlete_device_status")
    .select("athlete_id, provider, last_pull_at")
    .eq("status", "active")
    .in("athlete_id", ids);
  if (error) {
    console.error("Error cargando conexiones de dispositivos:", error);
    return { ok: false, byAthlete: {} };
  }
  const byAthlete = {};
  for (const row of data || []) {
    const key = String(row.athlete_id);
    if (!byAthlete[key]) byAthlete[key] = [];
    byAthlete[key].push({ provider: row.provider, last_pull_at: row.last_pull_at });
  }
  for (const key of Object.keys(byAthlete)) {
    byAthlete[key].sort((a, b) => providerLabel(a.provider).localeCompare(providerLabel(b.provider)));
  }
  return { ok: true, byAthlete };
};

/**
 * Retira de intervals.icu los eventos de unos workouts ya borrados en la app.
 *
 * Va por /api/integrations a proposito: las credenciales del atleta (api_key o
 * access_token de OAuth) NUNCA salen del servidor, asi que el cliente no puede
 * hablar con intervals.icu por su cuenta.
 *
 * BEST EFFORT: nunca lanza. El borrado local ya ocurrio y es lo primario; si
 * esto falla, el evento queda huerfano en el calendario del atleta, que es
 * mucho menos grave que dejar en la app un entreno que el coach quiso borrar.
 *
 * @returns {Promise<{ok: boolean, requested?: number, deleted?: number, skipped?: string, reason?: string}>}
 */
export const deleteIntervalsEvents = async (athleteId, workoutIds) => {
  const ids = [...new Set((workoutIds || []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (!athleteId || !ids.length) return { ok: true, requested: 0 };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, reason: "sin sesión" };
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "delete-workout", athlete_id: athleteId, workout_ids: ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`[intervals] no se pudo borrar ${ids.length} evento(s):`, data?.error || res.status);
      return { ok: false, reason: data?.error || `Error ${res.status}` };
    }
    if (!data?.skipped) {
      console.log(`[intervals] eventos retirados del reloj: ${data?.deleted ?? "?"} de ${ids.length} pedido(s)`);
    }
    return { ok: true, requested: data?.requested ?? ids.length, deleted: data?.deleted, skipped: data?.skipped };
  } catch (e) {
    console.warn(`[intervals] no se pudo borrar ${ids.length} evento(s):`, e.message);
    return { ok: false, reason: e.message };
  }
};

/**
 * Bearer de la sesion actual para endpoints /api/* que exigen requireUser.
 * @returns {Promise<string|null>}
 */
export const getAccessToken = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
};

/**
 * fetch a /api/* con Authorization: Bearer <sesion>.
 * @returns {Promise<Response>}
 */
export const authApiFetch = async (url, options = {}) => {
  const token = await getAccessToken();
  if (!token) {
    const err = new Error("sin sesión");
    err.code = "NO_SESSION";
    throw err;
  }
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  if (options.body != null && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...options, headers });
};

/**
 * Envia un correo transaccional por /api/send-email.
 *
 * Contrato: { template, to, vars }. El servidor monta subject/html desde
 * plantillas fijas; HTML libre del cliente ya no se acepta.
 *
 * Nunca lanza: un correo que no sale no puede tumbar la accion que lo motivo
 * (asignar un plan, confirmar un pago). Quien llama decide si avisar.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export const sendAppEmail = async ({ template, to, vars }) => {
  if (!to) return { ok: false, reason: "sin destinatario" };
  if (!template) return { ok: false, reason: "sin plantilla" };
  try {
    const res = await authApiFetch("/api/send-email", {
      method: "POST",
      body: JSON.stringify({ template, to, vars: vars || {} }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error || "";
      } catch {
        /* respuesta sin JSON */
      }
      console.error("[send-email]", res.status, detail);
      return { ok: false, reason: detail || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[send-email]", e);
    return { ok: false, reason: e?.message || "error de red" };
  }
};

/**
 * Crea/actualiza el perfil del usuario autenticado via /api/create-profile.
 * El user_id lo fija el servidor desde el JWT.
 */
export const ensureOwnProfile = async ({ name, role, coach_id = null, accessToken = null }) => {
  const token = accessToken || (await getAccessToken());
  if (!token) return { ok: false, reason: "sin sesión" };
  try {
    const res = await fetch("/api/create-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, role, coach_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: body?.error || `HTTP ${res.status}` };
    return { ok: true, name: body?.name };
  } catch (e) {
    return { ok: false, reason: e?.message || "error de red" };
  }
};

/**
 * Codigo de invitacion atleta pendiente de aceptar tras confirmar correo.
 *
 * accept_invitation_by_code exige sesion + email match (migracion 0064).
 * En el registro casi nunca hay JWT todavía, asi que se guarda aqui y se
 * consume en ConfirmEmailScreen / primer loadProfile.
 */
export const RAF_PENDING_INVITE_CODE_KEY = "raf_pending_invite_code";

export const stashPendingInviteCode = (code) => {
  const c = String(code || "").trim();
  if (!c || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RAF_PENDING_INVITE_CODE_KEY, c);
  } catch {
    /* ignore */
  }
};

/**
 * Si hay un codigo pendiente, llama a accept_invitation_by_code con la sesion
 * actual. Limpia el storage cuando se acepta, cuando ya no estaba pending, o
 * cuando el error no es recuperable. Si aun no hay sesion, deja el codigo.
 *
 * @returns {Promise<{ok: boolean, accepted?: boolean, skipped?: boolean, reason?: string}>}
 */
export const acceptPendingInvitationIfAny = async () => {
  if (typeof localStorage === "undefined") return { ok: true, skipped: true };
  let code = "";
  try {
    code = String(localStorage.getItem(RAF_PENDING_INVITE_CODE_KEY) || "").trim();
  } catch {
    return { ok: true, skipped: true };
  }
  if (!code) return { ok: true, skipped: true };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, reason: "sin sesión", keep: true };
  }

  const { data, error } = await supabase.rpc("accept_invitation_by_code", { p_code: code });
  if (error) {
    const msg = String(error.message || "");
    const notAuth = error.code === "28000" || /not_authenticated/i.test(msg);
    console.warn("[invite] accept_invitation_by_code:", error);
    if (notAuth) return { ok: false, reason: msg, keep: true };
    // Codigo invalido / email no coincide: no reintentar en bucle.
    try { localStorage.removeItem(RAF_PENDING_INVITE_CODE_KEY); } catch { /* ignore */ }
    return { ok: false, reason: msg };
  }

  try { localStorage.removeItem(RAF_PENDING_INVITE_CODE_KEY); } catch { /* ignore */ }
  return { ok: true, accepted: Boolean(data) };
};

/** Package del APK, para intentar abrirla desde el navegador con un intent:// */
export const ANDROID_PACKAGE_ID = "com.runningapexflow.app";

/**
 * Reenvia el correo de confirmacion de registro.
 *
 * Vive aqui porque lo piden dos pantallas (el login y /auth/confirm) y la
 * traduccion de los errores de Supabase no merece estar duplicada.
 *
 * @returns {Promise<{ok: boolean, alreadyConfirmed: boolean, message: string}>}
 */
export const resendSignupConfirmation = async (rawEmail) => {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, alreadyConfirmed: false, message: "Escribe tu correo para poder reenviarte la confirmación." };
  }
  try {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) {
      const code = String(error.code || "").toLowerCase();
      const msg = String(error.message || "").toLowerCase();
      if (code === "user_already_confirmed" || msg.includes("already confirmed")) {
        return {
          ok: false,
          alreadyConfirmed: true,
          message: "Tu correo ya está confirmado. Inicia sesión con tu contraseña.",
        };
      }
      if (code.includes("rate_limit") || msg.includes("rate limit")) {
        return {
          ok: false,
          alreadyConfirmed: false,
          message: "Ya te enviamos un correo hace poco. Espera unos minutos y revisa la bandeja y el spam.",
        };
      }
      return {
        ok: false,
        alreadyConfirmed: false,
        message: error.message || "No se pudo reenviar el correo de confirmación.",
      };
    }
    return {
      ok: true,
      alreadyConfirmed: false,
      message: `Te reenviamos el código y el enlace de confirmación a ${email}. Revisa también la carpeta de spam.`,
    };
  } catch (err) {
    console.error("[auth] resend signup:", err);
    return {
      ok: false,
      alreadyConfirmed: false,
      message: "No se pudo reenviar el correo de confirmación. Inténtalo de nuevo.",
    };
  }
};

/** Minimo propio, por encima del 6 que trae Supabase de fabrica. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Valida una contraseña nueva y su confirmacion.
 * Devuelve el mensaje de error para la UI, o cadena vacia si sirve.
 *
 * No se recorta con trim: un espacio en medio es parte legitima de la
 * contraseña. Solo se rechaza la que es SOLO espacios.
 */
export const validateNewPassword = (password, confirm) => {
  const pw = String(password ?? "");
  const pw2 = String(confirm ?? "");
  if (!pw) return "Escribe la contraseña nueva.";
  if (!pw.trim()) return "La contraseña no puede ser solo espacios.";
  if (pw.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!pw2) return "Repite la contraseña nueva para confirmarla.";
  if (pw !== pw2) return "Las dos contraseñas no coinciden.";
  return "";
};

/**
 * Traduce a lenguaje claro los errores de updateUser al cambiar la contraseña.
 * Los de Supabase llegan en ingles y algunos son crípticos para el usuario.
 */
export const passwordUpdateErrorText = (error) => {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  if (code === "same_password" || msg.includes("should be different")) {
    return "Esa es la contraseña que ya tenías. Elige una distinta.";
  }
  if (code === "weak_password" || msg.includes("password should be")) {
    return `La contraseña es demasiado débil o corta (mínimo ${PASSWORD_MIN_LENGTH} caracteres).`;
  }
  if (code === "session_not_found" || msg.includes("session missing") || msg.includes("session not found")) {
    return "El enlace ya se usó o caducó. Pide otro correo de restablecimiento.";
  }
  if (msg.includes("expired")) {
    return "El enlace de restablecimiento caducó. Pide uno nuevo desde «¿Olvidaste tu contraseña?».";
  }
  return error?.message || "No se pudo cambiar la contraseña. Inténtalo de nuevo.";
};

/**
 * Inserta workouts asignados tolerando que 0062 aun no este aplicada.
 *
 * El codigo va a Vercel en cuanto se hace push, y la migracion la aplica una
 * persona: entre las dos cosas hay una ventana en la que `generated_with_vdot`
 * no existe todavia y PostgREST rechaza el insert ENTERO con PGRST204. Sin esta
 * red, esa ventana deja al coach sin poder asignar entrenos.
 *
 * El reintento pierde el VDOT de origen (esos workouts quedaran fuera del
 * recalculo automatico), que es un precio bajisimo comparado con no asignar.
 * En cuanto la migracion este aplicada este camino no se recorre nunca; se puede
 * borrar entonces.
 */
/** Id de workout_library (bigint), o null si el origen no trae uno (IA / GPX). */
export const asLibraryId = (value) => {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

export const insertAssignedWorkouts = async (rows) => {
  const { error } = await supabase.from("workouts").insert(rows);
  if (!error) return { error: null };
  const faltaVdot = error.code === "PGRST204" || /generated_with_vdot/i.test(error.message || "");
  const faltaLibrary = /library_id/i.test(error.message || "");
  if (!faltaVdot && !faltaLibrary) return { error };
  if (faltaVdot) {
    console.warn("[workouts] generated_with_vdot no existe todavía (falta migración 0062); se asigna sin él");
  }
  if (faltaLibrary) {
    console.warn("[workouts] library_id no existe todavía; se asigna sin él");
  }
  const limpios = rows.map((r) => {
    const copia = { ...r };
    if (faltaVdot) delete copia.generated_with_vdot;
    if (faltaLibrary) delete copia.library_id;
    return copia;
  });
  return await supabase.from("workouts").insert(limpios);
};

/**
 * Reescribe los ritmos de los workouts futuros del atleta al VDOT de su ultima
 * evaluacion, y los reenvia al reloj.
 *
 * Va por /api/integrations por dos razones: las credenciales de intervals.icu no
 * salen del servidor, y el recalculo escribe en `workouts` con service_role sin
 * depender de la RLS del coach que guardo la evaluacion.
 *
 * BEST EFFORT: nunca lanza. La evaluacion ya quedo guardada, que es lo primario;
 * si el recalculo falla, el plan sigue con los ritmos del test anterior.
 *
 * @returns {Promise<{ok: boolean, measured?: number, target?: number, recalculated?: number, until?: string, without_origin?: number, pushed?: number, reason?: string}>}
 */
export const resyncPacesAfterEvaluation = async (athleteId) => {
  if (!athleteId) return { ok: false, reason: "sin atleta" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, reason: "sin sesión" };
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "vdot-resync", athlete_id: athleteId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[vdot-resync] no se pudo recalcular:", data?.error || res.status);
      return { ok: false, reason: data?.error || `Error ${res.status}` };
    }
    console.log(
      `[vdot-resync] VDOT ${data?.measured} → ${data?.target}: ` +
      `${data?.recalculated ?? 0} workouts recalculados hasta ${data?.until}`,
    );
    return { ok: true, ...data };
  } catch (e) {
    console.warn("[vdot-resync] no se pudo recalcular:", e.message);
    return { ok: false, reason: e.message };
  }
};

/**
 * Avisa al atleta de que sus ritmos cambiaron tras un test.
 *
 * Distingue el VDOT MEDIDO (lo que corrio) del VDOT OBJETIVO (al que se
 * escribieron los ritmos): son distintos casi siempre, porque se entrena algo
 * por encima de lo medido, y mezclarlos hace que el atleta no reconozca su
 * propio resultado. El deep-link lleva al calendario, donde ve los ritmos nuevos.
 */
export async function sendPaceUpdatePushToAthlete({ athleteUserId, testLabel, prevVdot, measuredVdot, targetVdot, count }) {
  if (!athleteUserId) return;
  const salto = Number.isFinite(Number(prevVdot))
    ? `VDOT ${prevVdot} → ${measuredVdot}`
    : `VDOT ${measuredVdot}`;
  const sesiones = count === 1 ? "1 sesión" : `${count} sesiones`;
  const ritmos = Number(targetVdot) !== Number(measuredVdot)
    ? `Tus ritmos se ajustaron a VDOT ${targetVdot} en ${sesiones}.`
    : `Tus ritmos se ajustaron en ${sesiones}.`;
  await sendChatPushNotification({
    toUserId: athleteUserId,
    title: "📈 Tus ritmos se actualizaron",
    body: `Tras el ${testLabel}: ${salto}. ${ritmos}`,
    data: { type: "athlete_calendar" },
    logLabel: "vdot resync coach→athlete",
  });
}

export async function sendWorkoutAssignmentPushToAthlete({ athleteUserId, workoutTitle, scheduledDate, body }) {
  if (!athleteUserId) return;
  await sendChatPushNotification({
    toUserId: athleteUserId,
    title: "🏃 Nuevo entrenamiento asignado",
    body: body || `${workoutTitle || "Entrenamiento"} programado para el ${scheduledDate || "día asignado"}`,
    data: { type: "athlete_calendar" },
    logLabel: "workout coach→athlete",
  });
}

export const DAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const MONTH_INDEX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export const getRaceCountdownText = (nextRace) => {
  if (!nextRace || typeof nextRace !== "string") return "🏁 Próxima carrera · fecha pendiente";
  const [raceNameRaw, datePartRaw] = nextRace.split(" - ");
  const raceName = (raceNameRaw || "Próxima carrera").trim();
  const datePart = (datePartRaw || "").trim();
  const [monthAbbr, dayRaw] = datePart.split(/\s+/);
  const month = MONTH_INDEX[monthAbbr];
  const day = Number(dayRaw);
  if (month === undefined || !Number.isFinite(day)) return `🏁 ${raceName} · fecha pendiente`;
  const today = new Date();
  let raceDate = new Date(today.getFullYear(), month, day);
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (raceDate < todayLocal) raceDate = new Date(todayLocal.getFullYear() + 1, month, day);
  const daysLeft = Math.ceil((raceDate.getTime() - todayLocal.getTime()) / 86400000);
  return `🏁 ${raceName} · faltan ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`;
};


export const achievementJoinMeta = (row) => {
  if (!row) return null;
  const a = row.achievements;
  if (a != null) return Array.isArray(a) ? a[0] : a;
  if (row.achievement_code) return { code: row.achievement_code, name: row.achievement_code, icon: "", description: "" };
  return null;
};

const getLongestConsecutiveDays = (ymdList) => {
  if (!Array.isArray(ymdList) || ymdList.length === 0) return 0;
  const uniq = [...new Set(ymdList)].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < uniq.length; i += 1) {
    const prev = new Date(`${uniq[i - 1]}T12:00:00`);
    const now = new Date(`${uniq[i]}T12:00:00`);
    const diffDays = Math.round((now.getTime() - prev.getTime()) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    if (current > best) best = current;
  }
  return best;
};

export const clampWorkoutRpe = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.round(v);
  if (i < 1 || i > 10) return null;
  return i;
};

export const computeAchievementProgress = (doneWorkouts) => {
  const done = doneWorkouts || [];
  const totalKm = done.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
  const doneCount = done.length;
  const rpeCount = done.filter((w) => clampWorkoutRpe(w.rpe) != null).length;
  const longestStreak = getLongestConsecutiveDays(done.map((w) => w.scheduled_date).filter(Boolean));
  const hasLong15 = done.some((w) => (Number(w.total_km) || 0) >= 15);
  const hasHalf = done.some((w) => (Number(w.total_km) || 0) >= 21);
  const has30 = done.some((w) => (Number(w.total_km) || 0) >= 30);
  const hasInterval = done.some((w) => w.type === "interval");
  const hasEarlyBird = done.some((w) => {
    const raw = String(w.scheduled_date || "");
    if (!raw.includes("T")) return false;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    return d.getHours() < 7;
  });
  return {
    unlockedByCode: {
      FIRST_KM: doneCount >= 1, KM_10: totalKm >= 10, KM_50: totalKm >= 50, KM_100: totalKm >= 100, KM_500: totalKm >= 500, KM_1000: totalKm >= 1000,
      FIRST_WORKOUT: doneCount >= 1, STREAK_7: longestStreak >= 7, STREAK_30: longestStreak >= 30, FIRST_LONG: hasLong15, SPEED_DEMON: hasInterval,
      CONSISTENT: doneCount >= 10, HALF_WARRIOR: hasHalf, MARATHON_READY: has30, EARLY_BIRD: hasEarlyBird, RPE_MASTER: rpeCount >= 10,
    },
    totalKm, doneCount, longestStreak, rpeCount,
  };
};

export const ATHLETE_ACHIEVEMENT_DISPLAY_LIST = [
  { id: "first_race", icon: "🥇", name: "Primera Carrera", requirement: "Completa tu primer workout", metric: "doneCount", target: 1, codes: ["FIRST_WORKOUT", "FIRST_KM"] },
  { id: "three_streak", icon: "🔥", name: "Tres en Raya", requirement: "Completa 3 días seguidos de entrenamiento", metric: "longestConsecutiveDays", target: 3, codes: ["STREAK_3", "STREAK_7"] },
  { id: "first_10k", icon: "🏃", name: "Primeros 10K", requirement: "Acumula 10km completados en total", metric: "totalKm", target: 10, codes: ["KM_10"] },
  { id: "weekly_streak", icon: "💪", name: "Racha Semanal", requirement: "Completa todos los workouts de una semana", metric: "fullWeeksCompleted", target: 1, codes: ["WEEK_COMPLETE_1"] },
  { id: "speedster", icon: "⚡", name: "Velocista", requirement: "Completa un workout de intervalos", metric: "intervalCount", target: 1, codes: ["SPEED_DEMON"] },
  { id: "fifty_km", icon: "🎯", name: "Medio Centenar", requirement: "Acumula 50km completados en total", metric: "totalKm", target: 50, codes: ["KM_50"] },
  { id: "centurion", icon: "🏅", name: "Centurión", requirement: "Acumula 100km completados en total", metric: "totalKm", target: 100, codes: ["KM_100"] },
  { id: "early_bird", icon: "🌅", name: "Madrugador", requirement: "Completa 5 workouts marcados antes de las 8am", metric: "earlyMorningDoneCount", target: 5, codes: ["EARLY_BIRD"] },
  { id: "consistent_4w", icon: "🗓️", name: "Constante", requirement: "Completa workouts durante 4 semanas seguidas", metric: "consecutiveDoneWeeks", target: 4, codes: ["CONSISTENT"] },
  { id: "super_athlete", icon: "🚀", name: "Súper Atleta", requirement: "Completa 50 workouts en total", metric: "doneCount", target: 50, codes: ["WORKOUT_50"] },
  { id: "no_excuses", icon: "💯", name: "Sin Excusas", requirement: "Completa 10 workouts seguidos sin fallar ninguno", metric: "longestDoneNoFailStreak", target: 10, codes: ["NO_EXCUSES_10"] },
  { id: "marathoner", icon: "🏆", name: "Maratonista", requirement: "Acumula 200km completados en total", metric: "totalKm", target: 200, codes: ["KM_200"] },
  { id: "heart", icon: "❤️", name: "Corazón de Atleta", requirement: "Registra FC en 10 workouts", metric: "hrLoggedCount", target: 10, codes: ["HR_10", "RPE_MASTER"] },
  { id: "in_shape", icon: "📈", name: "En Forma", requirement: "Mejora tu VDOT en 2 evaluaciones consecutivas", metric: "vdotImprovementStreak", target: 2, codes: ["VDOT_UP_2"] },
  { id: "elite", icon: "🌟", name: "Élite", requirement: "Acumula 500km completados en total", metric: "totalKm", target: 500, codes: ["KM_500"] },
  { id: "legend", icon: "🎖️", name: "Leyenda", requirement: "Completa 100 workouts en total", metric: "doneCount", target: 100, codes: ["WORKOUT_100", "KM_1000"] },
];

const getWorkoutReferenceDate = (w) => {
  const raw = w?.completed_at || w?.scheduled_date || w?.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};
const getWeekStartYmdFromDate = (d) => (d && !Number.isNaN(d.getTime()) ? formatLocalYMD(startOfWeekMonday(d)) : null);
const getLongestConsecutiveWeeks = (weekKeys) => {
  if (!Array.isArray(weekKeys) || weekKeys.length === 0) return 0;
  const uniq = [...new Set(weekKeys)].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < uniq.length; i += 1) {
    const prev = new Date(`${uniq[i - 1]}T12:00:00`);
    const now = new Date(`${uniq[i]}T12:00:00`);
    const diffDays = Math.round((now.getTime() - prev.getTime()) / 86400000);
    current = diffDays === 7 ? current + 1 : 1;
    if (current > best) best = current;
  }
  return best;
};

export const computeAthleteAchievementVisualProgress = (allWorkouts, evaluations) => {
  const all = Array.isArray(allWorkouts) ? allWorkouts : [];
  const done = all.filter((w) => w?.done);
  const todayYmd = formatLocalYMD(new Date());
  const totalKm = done.reduce((sum, w) => sum + (Number(w.total_km) || 0), 0);
  const doneCount = done.length;
  const longestConsecutiveDays = getLongestConsecutiveDays(done.map((w) => normalizeScheduledDateYmd(w.scheduled_date || w.completed_at)).filter(Boolean));
  const intervalCount = done.filter((w) => String(w.type || "").toLowerCase() === "interval").length;
  const hrLoggedCount = done.filter((w) => [w.manual_avg_hr, w.manual_max_hr, w.avg_hr, w.average_heartrate].some((v) => Number(v) > 0)).length;
  const earlyMorningDoneCount = done.filter((w) => { const d = getWorkoutReferenceDate(w); return d && d.getHours() < 8; }).length;
  const sortedScheduled = [...all].filter((w) => normalizeScheduledDateYmd(w.scheduled_date || w.completed_at) && normalizeScheduledDateYmd(w.scheduled_date || w.completed_at) <= todayYmd).sort((a, b) => (getWorkoutReferenceDate(a)?.getTime() || 0) - (getWorkoutReferenceDate(b)?.getTime() || 0));
  let streak = 0;
  let longestDoneNoFailStreak = 0;
  for (const w of sortedScheduled) { streak = w?.done ? streak + 1 : 0; if (streak > longestDoneNoFailStreak) longestDoneNoFailStreak = streak; }
  const weekMap = {};
  for (const w of sortedScheduled) {
    const weekKey = getWeekStartYmdFromDate(getWorkoutReferenceDate(w));
    if (!weekKey) continue;
    if (!weekMap[weekKey]) weekMap[weekKey] = { total: 0, done: 0 };
    weekMap[weekKey].total += 1;
    if (w?.done) weekMap[weekKey].done += 1;
  }
  const fullWeeksCompleted = Object.values(weekMap).filter((x) => x.total > 0 && x.done >= x.total).length;
  const doneWeekKeys = done.map((w) => getWeekStartYmdFromDate(getWorkoutReferenceDate(w))).filter(Boolean);
  const consecutiveDoneWeeks = getLongestConsecutiveWeeks(doneWeekKeys);
  const evalRows = Array.isArray(evaluations) ? evaluations : [];
  const vdotValues = evalRows.map((r) => Number(r?.vdot)).filter((v) => Number.isFinite(v) && v > 0);
  let vdotImprovementStreak = 0;
  let vdotCurrent = 0;
  for (let i = 1; i < vdotValues.length; i += 1) { vdotCurrent = vdotValues[i] > vdotValues[i - 1] ? vdotCurrent + 1 : 0; if (vdotCurrent > vdotImprovementStreak) vdotImprovementStreak = vdotCurrent; }
  return { totalKm, doneCount, longestConsecutiveDays, fullWeeksCompleted, intervalCount, hrLoggedCount, earlyMorningDoneCount, consecutiveDoneWeeks, longestDoneNoFailStreak, vdotImprovementStreak };
};

export async function loadAthleteAchievementSnapshot(athleteId) {
  if (!athleteId) return { achievements: [], earned: [] };
  try {
    const res = await authApiFetch(`/api/achievements?athlete_id=${encodeURIComponent(String(athleteId))}`);
    const json = await res.json();
    if (!res.ok) return { achievements: [], earned: [] };
    const achievements = Array.isArray(json.all) ? json.all.filter((row) => row && typeof row.code === "string") : [];
    const earned = Array.isArray(json.earned) ? json.earned.filter((row) => row && typeof row.achievement_code === "string") : [];
    return { achievements, earned };
  } catch {
    return { achievements: [], earned: [] };
  }
}

export async function evaluateAndAwardAthleteAchievements(athleteId) {
  if (!athleteId) return { newAwards: [], snapshot: { achievements: [], earned: [] }, progress: null };
  try {
    const [achRes, workRes] = await Promise.all([
      authApiFetch(`/api/achievements?athlete_id=${encodeURIComponent(athleteId)}`),
      supabase.from("workouts").select("*").eq("athlete_id", athleteId).eq("done", true),
    ]);
    if (!achRes.ok) return { newAwards: [], snapshot: { achievements: [], earned: [] }, progress: null };
    const { all: allAchievements, earned: earnedList } = await achRes.json();
    const doneWorkouts = workRes.data || [];
    const totalKm = doneWorkouts.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
    const earnedCodes = new Set((earnedList || []).map((e) => e.achievement_code));
    const newAchievements = [];
    for (const ach of allAchievements || []) {
      if (earnedCodes.has(ach.code)) continue;
      let earned = false;
      if (ach.condition_type === "total_km" && totalKm >= Number(ach.condition_value)) earned = true;
      if (ach.condition_type === "workout_count" && doneWorkouts.length >= Number(ach.condition_value)) earned = true;
      if (ach.condition_type === "single_km" && doneWorkouts.some((w) => (Number(w.total_km) || 0) >= Number(ach.condition_value))) earned = true;
      if (ach.condition_type === "interval" && doneWorkouts.some((w) => w.type === "interval")) earned = true;
      if (earned) {
        await authApiFetch("/api/achievements", {
          method: "POST",
          body: JSON.stringify({ athlete_id: athleteId, achievement_code: ach.code, value: totalKm }),
        });
        newAchievements.push(ach);
      }
    }
    const snapshot = await loadAthleteAchievementSnapshot(athleteId);
    const progress = computeAchievementProgress(doneWorkouts);
    const newAwards = newAchievements.map((ach) => ({ achievement_code: ach.code, awarded_at: new Date().toISOString(), achievements: ach }));
    return { newAwards, snapshot, progress };
  } catch {
    return { newAwards: [], snapshot: { achievements: [], earned: [] }, progress: null };
  }
}

/**
 * messages.created_at es `timestamp without time zone` y guarda UTC, así que llega sin offset
 * y `new Date()` lo tomaría como hora local (5 h de desfase en Bogotá). Los mensajes optimistas
 * del cliente sí traen `Z`, y una futura migración a timestamptz traería `+00:00`: de ahí el test.
 */
export const parseUtcTimestamp = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad2 = (n) => String(n).padStart(2, "0");

const isSameLocalDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Se construye a mano para dar el mismo resultado en cualquier navegador o WebView, sin depender de Intl. */
export const formatMessageTimestamp = (value) => {
  const d = parseUtcTimestamp(value);
  if (!d) return "";
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const now = new Date();
  if (isSameLocalDay(d, now)) return `hoy ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(d, yesterday)) return `ayer ${time}`;
  const dayMonth = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  if (d.getFullYear() === now.getFullYear()) return `${dayMonth} ${time}`;
  return `${dayMonth}/${String(d.getFullYear()).slice(-2)} ${time}`;
};

export const normalizeWorkoutRow = (row) => {
  const structure = normalizeWorkoutStructure(readStructure(row));
  const scheduled = normalizeScheduledDateYmd(row.scheduled_date);
  const type = row.type && WORKOUT_TYPES.some((t) => t.id === row.type) ? row.type : "easy";
  return {
    id: row.id, athlete_id: row.athlete_id, coach_id: row.coach_id, scheduled_date: scheduled, type,
    title: row.title || WORKOUT_TYPES.find((t) => t.id === type)?.label || "Entrenamiento",
    total_km: Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0,
    distance_km: Number.isFinite(Number(row.distance_km)) ? Number(row.distance_km) : (Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0),
    duration_min: Number.isFinite(Number(row.duration_min)) ? Number(row.duration_min) : 0,
    description: row.description || "", structure: Array.isArray(structure) ? structure : [],
    done: Boolean(row.done), rpe: clampWorkoutRpe(row.rpe),
    manual_distance_km: Number.isFinite(Number(row.manual_distance_km)) ? Number(row.manual_distance_km) : null,
    manual_duration_min: Number.isFinite(Number(row.manual_duration_min)) ? Number(row.manual_duration_min) : null,
    manual_avg_hr: Number.isFinite(Number(row.manual_avg_hr)) ? Math.round(Number(row.manual_avg_hr)) : null,
    manual_max_hr: Number.isFinite(Number(row.manual_max_hr)) ? Math.round(Number(row.manual_max_hr)) : null,
    manual_calories: Number.isFinite(Number(row.manual_calories)) ? Math.round(Number(row.manual_calories)) : null,
    athlete_notes: typeof row.athlete_notes === "string" ? row.athlete_notes : "",
    completed_at: row.completed_at || null,
    created_at: row.created_at || null,
    actual_distance_km: row.actual_distance_km ?? null,
    actual_duration_min: row.actual_duration_min ?? null,
    actual_avg_pace_s: row.actual_avg_pace_s ?? null,
    actual_avg_hr: row.actual_avg_hr ?? null,
    actual_max_hr: row.actual_max_hr ?? null,
    actual_elevation_m: row.actual_elevation_m ?? null,
    actual_synced_at: row.actual_synced_at ?? null,
    intervals_activity_id: row.intervals_activity_id ?? null,
  };
};

const sessionRpeKmLoad = (w) => {
  const km = Number(w.total_km);
  const rpe = clampWorkoutRpe(w.rpe);
  if (rpe == null || !Number.isFinite(km) || km < 0) return null;
  return rpe * km;
};
const avgRpeKmInWindow = (eligibleWorkouts, startYmd, endYmd) => {
  const loads = eligibleWorkouts.filter((w) => w.scheduled_date >= startYmd && w.scheduled_date <= endYmd).map(sessionRpeKmLoad).filter((v) => v != null);
  if (!loads.length) return null;
  return loads.reduce((a, b) => a + b, 0) / loads.length;
};

export const computeFormaFatigaWeeklyPoints = (workouts) => {
  const eligible = workouts.filter((w) => w.done && clampWorkoutRpe(w.rpe) != null);
  const today = new Date();
  const points = [];
  for (let i = 0; i < 8; i += 1) {
    const endD = addDays(today, -i * 7);
    const endYmd = formatLocalYMD(endD);
    const acute = avgRpeKmInWindow(eligible, formatLocalYMD(addDays(endD, -6)), endYmd);
    const chronic = avgRpeKmInWindow(eligible, formatLocalYMD(addDays(endD, -27)), endYmd);
    points.push({ i, label: i === 0 ? "Actual" : `−${i} sem`, endYmd, acute, chronic, forma: acute != null || chronic != null ? (chronic ?? 0) - (acute ?? 0) : null });
  }
  return points;
};

export const formaFatigaStatusFromPoint = (p) => {
  if (!p || (p.acute == null && p.chronic == null)) return { label: "Sin datos suficientes", kind: "none" };
  const acute = p.acute ?? 0;
  const chronic = p.chronic ?? 0;
  const forma = p.forma != null ? p.forma : chronic - acute;
  const r = forma / Math.max(Math.abs(acute), Math.abs(chronic), 1);
  if (r > 0.12) return { label: "En forma 🟢", kind: "forma" };
  if (r < -0.12) return { label: "Fatigado 🔴", kind: "fatiga" };
  return { label: "Fresco 🟡", kind: "fresco" };
};

export async function resolveCoachUserIdFromPublicCode(codeInput) {
  const codigoIngresado = String(codeInput || "").trim().toUpperCase();
  if (!codigoIngresado || codigoIngresado.length !== 8) return null;
  const { data, error } = await supabase.rpc("find_coach_by_code", { code: codigoIngresado });
  if (error) { console.error("resolveCoachUserIdFromPublicCode:", error); return null; }
  return data ?? null;
}

/**
 * Coach al que se dirige una solicitud de entrenador.
 *
 * Hoy solo hay un coach publico en la plataforma, asi que la solicitud va a
 * el. Cuando haya varios, este es el punto donde hay que dejar que el atleta
 * elija: mientras tanto se cae al coach de la plataforma para no dejar la
 * solicitud sin destinatario.
 */
export async function resolveDefaultCoachUserId() {
  const { data, error } = await supabase
    .from("coach_public")
    .select("user_id")
    .eq("is_public", true)
    .limit(2);
  if (error) {
    console.error("resolveDefaultCoachUserId:", error);
    return PLATFORM_ADMIN_USER_ID;
  }
  const rows = data || [];
  if (rows.length === 1) return rows[0].user_id;
  const admin = rows.find((r) => String(r.user_id) === PLATFORM_ADMIN_USER_ID);
  return admin?.user_id || rows[0]?.user_id || PLATFORM_ADMIN_USER_ID;
}

export const TAB_KEY_LIBRARY = "raf_tab_biblioteca";

export const formatCopInt = (n) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 }) : "—";

export const CHALLENGE_TYPE_OPTIONS = [
  { id: "distancia", label: "Distancia (km)" },
  { id: "tiempo", label: "Tiempo (min)" },
  { id: "workouts", label: "Workouts completados" },
  { id: "racha", label: "Racha (días)" },
];

export const normalizeChallengeType = (raw) => {
  const type = String(raw || "").trim().toLowerCase();
  if (type === "distance") return "distancia";
  if (type === "time") return "tiempo";
  if (type === "streak") return "racha";
  return type;
};

export const challengeUnitByType = (rawType) => {
  const type = normalizeChallengeType(rawType);
  if (type === "distancia") return "km";
  if (type === "workouts") return "sesiones";
  if (type === "tiempo") return "min";
  if (type === "racha") return "dias";
  return "km";
};

export const formatChallengeMetricValue = (value, rawType) => {
  const n = Number(value) || 0;
  const type = normalizeChallengeType(rawType);
  if (type === "distancia") return n.toFixed(1);
  return String(Math.max(0, Math.round(n)));
};

export const challengeValueLabel = (challenge) => {
  const target = Number(challenge?.target_value);
  if (!Number.isFinite(target) || target <= 0) return "Sin meta fija · Ranking por km";
  const unit = challengeUnitByType(challenge?.challenge_type);
  const type = normalizeChallengeType(challenge?.challenge_type);
  if (type === "distancia") return `${Number(target).toFixed(1)} ${unit}`;
  return `${Math.round(target)} ${unit}`;
};

export const challengeProgressLabel = (challenge, progress) => {
  if (!Number.isFinite(progress?.target) || Number(progress.target) <= 0) return "Sin meta fija · Ranking por km";
  const unit = challengeUnitByType(challenge?.challenge_type);
  const done = formatChallengeMetricValue(progress?.value, challenge?.challenge_type);
  const target = formatChallengeMetricValue(progress?.target, challenge?.challenge_type);
  return `${done} / ${target} ${unit}`;
};

export const challengeProgressOpenText = (challenge, progress) => {
  const done = formatChallengeMetricValue(progress?.value, challenge?.challenge_type);
  const unit = challengeUnitByType(challenge?.challenge_type);
  if (normalizeChallengeType(challenge?.challenge_type) === "distancia") {
    return `Km acumulados en el periodo: ${done} ${unit} · ranking sin meta fija`;
  }
  return `Avance actual: ${done} ${unit} · Sin meta fija · Ranking por km`;
};

export const challengeHasOpenTarget = (challenge) => {
  const target = Number(challenge?.target_value);
  return !Number.isFinite(target) || target <= 0;
};

export const computeWorkoutDayStreak = (workouts, startYmd, endYmd) => {
  const doneDays = new Set(
    (workouts || [])
      .filter((w) => w.done)
      .map((w) => normalizeScheduledDateYmd(w.scheduled_date))
      .filter((ymd) => ymd && ymd >= startYmd && ymd <= endYmd),
  );
  let best = 0;
  let current = 0;
  const start = new Date(`${startYmd}T12:00:00`);
  const end = new Date(`${endYmd}T12:00:00`);
  for (let d = new Date(start.getTime()); d <= end; d = addDays(d, 1)) {
    const ymd = formatLocalYMD(d);
    if (doneDays.has(ymd)) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
};

export const computeChallengeProgressForAthlete = (challenge, workouts) => {
  const startYmd = String(challenge?.start_date || "");
  const endYmd = String(challenge?.end_date || "");
  const target = Math.max(0, Number(challenge?.target_value) || 0);
  const type = normalizeChallengeType(challenge?.challenge_type);
  const inRange = (workouts || []).filter((w) => {
    const ymd = normalizeScheduledDateYmd(w.scheduled_date);
    return Boolean(ymd && ymd >= startYmd && ymd <= endYmd && w.done);
  });
  let value = 0;
  if (type === "distancia") {
    value = inRange.reduce((sum, w) => sum + (Number(w.total_km) || 0), 0);
  } else if (type === "tiempo") {
    value = inRange.reduce((sum, w) => sum + (Number(w.duration_min) || 0), 0);
  } else if (type === "workouts") {
    value = inRange.length;
  } else if (type === "racha") {
    value = computeWorkoutDayStreak(workouts, startYmd, endYmd);
  }
  const pct = target > 0 ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
  return { value, target, pct };
};
