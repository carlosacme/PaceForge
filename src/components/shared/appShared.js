import FitParser from "fit-file-parser";
import { supabase } from "../../lib/supabase";

export const BRAND_NAME = "RunningApexFlow";

export const STRAVA_CALLBACK_URL = "https://pace-forge-eta.vercel.app/api/strava/callback";

export const WORKOUT_TYPES = [
  { id: "easy", label: "Rodaje Suave", color: "#22c55e" },
  { id: "tempo", label: "Tempo", color: "#f59e0b" },
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

export const MARKETPLACE_AI_PACE_RANGES_BY_LEVEL = {
  principiante: {
    easy: { desc: "7:00–8:00 min/km", pace_range: "7:00-8:00" },
    tempo: { desc: "6:00–6:30 min/km", pace_range: "6:00-6:30" },
    interval: { desc: "5:30–6:00 min/km", pace_range: "5:30-6:00" },
  },
  intermedio: {
    easy: { desc: "6:00–6:45 min/km", pace_range: "6:00-6:45" },
    tempo: { desc: "5:00–5:30 min/km", pace_range: "5:00-5:30" },
    interval: { desc: "4:30–5:00 min/km", pace_range: "4:30-5:00" },
  },
  avanzado: {
    easy: { desc: "5:00–5:45 min/km", pace_range: "5:00-5:45" },
    tempo: { desc: "4:00–4:30 min/km", pace_range: "4:00-4:30" },
    interval: { desc: "3:30–4:00 min/km", pace_range: "3:30-4:00" },
  },
};

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

export const normalizeAthlete = (athlete) => ({
  id: athlete?.id,
  name: athlete?.name || "Atleta sin nombre",
  age: Number.isFinite(Number(athlete?.age)) ? Number(athlete.age) : 0,
  goal: athlete?.goal || "Objetivo pendiente",
  pace: athlete?.pace || "N/A",
  weekly_km: Number.isFinite(Number(athlete?.weekly_km)) ? Number(athlete.weekly_km) : 0,
  email: typeof athlete?.email === "string" ? athlete.email : "",
  avatar: athlete?.avatar || "🏃",
  status: athlete?.status || "on-track",
  next_race: athlete?.next_race || "Próxima carrera - Dec 31",
  workouts_done: Number.isFinite(Number(athlete?.workouts_done)) ? Number(athlete.workouts_done) : 0,
  workouts_total: Number.isFinite(Number(athlete?.workouts_total)) ? Number(athlete.workouts_total) : 18,
  device: typeof athlete?.device === "string" ? athlete.device : "",
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

/** Catálogo mostrado en Perfil → Pagos (atleta). `id` coincide con PAYMENT_PLAN_OPTIONS. */
export const ATHLETE_SUBSCRIPTION_PLAN_CATALOG = [
  {
    id: "Basico",
    label: "Básico",
    priceCOP: PAYMENT_PLAN_AMOUNT_COP.Basico,
    description: "Acceso a calendario y chat con coach",
  },
  {
    id: "Pro",
    label: "Pro",
    priceCOP: PAYMENT_PLAN_AMOUNT_COP.Pro,
    description: "Básico + marketplace + retos + evaluaciones",
  },
];

export const STRAVA_ACTIVITY_ICONS = {
  Run: "🏃",
  Ride: "🚴",
  Swim: "🏊",
  Walk: "🚶",
  Hike: "🥾",
  Workout: "🏋️",
};

export const WORKOUT_BLOCK_TYPES = ["Calentamiento", "Intervalo", "Recuperación", "Enfriamiento", "Rodaje"];

export const WORKOUT_BLOCK_COLORS = {
  Calentamiento: { bg: "rgba(245,158,11,.14)", border: "rgba(245,158,11,.45)", text: "#b45309" },
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
      description,
      __key: s?.__key || newFitImportStepKey(),
    };
  });
};

export const structureRowsForFitImportInsert = (rows) =>
  (Array.isArray(rows) ? rows : []).map((s) => ({
    block_type: String(s.block_type || "Rodaje").trim(),
    duration_min: String(s.duration_min ?? "").trim(),
    distance_km: String(s.distance_km ?? "").trim(),
    target_pace: String(s.target_pace ?? "").trim(),
    target_hr: String(s.target_hr ?? "").trim(),
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
  const COLOR_GREEN = "#16a34a";
  const COLOR_RED = "#dc2626";
  const COLOR_ORANGE = "#f97316";
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

  let statusLabel = "Sin datos suficientes";
  let statusColor = "#64748b";
  if (ratio != null && Number.isFinite(ratio)) {
    if (ratio < 0.8) {
      statusLabel = "Desentrenado";
      statusColor = COLOR_RED;
    } else if (ratio > 1.3) {
      statusLabel = "Sobreentrenado";
      statusColor = COLOR_RED;
    } else {
      statusLabel = "Óptimo";
      statusColor = COLOR_GREEN;
    }
  }

  const maxBarKm = Math.max(1, ...weekBars.map((b) => b.km));
  const weekBarsOldestFirst = [...weekBars].reverse();

  return {
    acuteKm,
    chronicWeeklyAvgKm,
    ratio,
    statusLabel,
    statusColor,
    ratioIndicatorColor: ratio == null || !Number.isFinite(ratio) ? COLOR_ORANGE : ratio < 0.8 || ratio > 1.3 ? COLOR_RED : COLOR_GREEN,
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

export const formatStravaPace = (distanceM, movingTimeSec) => {
  const d = Number(distanceM) || 0;
  const t = Number(movingTimeSec) || 0;
  if (d <= 0 || t <= 0) return "—";
  const secPerKm = t / (d / 1000);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
};

export const normalizeStravaActivity = (row) => {
  if (!row) return null;
  const distanceKm = Number(row.distance || 0) / 1000;
  const dateIso = row.start_date_local || row.start_date || null;
  const ymd = dateIso ? formatLocalYMD(new Date(dateIso)) : null;
  return {
    id: row.id,
    name: row.name || "Actividad",
    type: row.type || "Workout",
    icon: STRAVA_ACTIVITY_ICONS[row.type] || "🟠",
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
    movingTime: Number(row.moving_time || 0),
    pace: formatStravaPace(row.distance, row.moving_time),
    dateIso,
    ymd,
  };
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
      const description =
        s?.description != null && String(s.description).trim() !== "" ? String(s.description).trim() : "";
      if (!block_type && !duration_min && !distance_km && !target_pace && !target_hr && !description) return null;
      return { block_type, duration_min, distance_km, target_pace, target_hr, description };
    })
    .filter(Boolean);
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
      // compatibilidad visual con código legado
      o.phase = block_type;
      o.duration = duration_min;
      o.pace = target_pace;
      o.intensity = target_hr || description;
      return Object.keys(o).length ? o : null;
    })
    .filter(Boolean);
  return out;
};

export const normalizeLibraryRow = (row) => {
  let structure = row.workout_structure ?? row.structure;
  if (typeof structure === "string") {
    try { structure = JSON.parse(structure); } catch { structure = []; }
  }
  structure = normalizeWorkoutStructure(structure);
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
    workout_structure: Array.isArray(structure) ? structure : [],
    created_at: row.created_at ?? null,
    intensity: row.intensity != null ? String(row.intensity) : "",
    notes: row.notes != null ? String(row.notes) : "",
  };
};

export const libraryRowToBuilderWorkout = (row) => ({
  title: row.title,
  type: row.type,
  total_km: row.total_km,
  duration_min: row.duration_min,
  description: row.description || "",
  structure: Array.isArray(row.structure) ? row.structure : [],
});

export const parseFitFileToLibraryDraft = async (file) => {
  const parser = new FitParser({
    force: true,
    speedUnit: "km/h",
    lengthUnit: "km",
    mode: "cascade",
  });
  const data = await parser.parseAsync(await file.arrayBuffer());
  const session = Array.isArray(data?.sessions) && data.sessions.length > 0 ? data.sessions[0] : null;
  const records = Array.isArray(data?.records) ? data.records : [];
  const laps = Array.isArray(data?.laps) ? data.laps : [];
  const sessionTitle = String(session?.name || session?.sport || "").trim();
  const title =
    sessionTitle ||
    String(file?.name || "Workout FIT")
      .replace(/\.fit$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
  const sport = String(session?.sport || data?.activity?.type || "running").toLowerCase();
  const durationMinRaw = Number(session?.total_timer_time ?? session?.total_elapsed_time);
  const distanceKmRaw = Number(session?.total_distance);
  const duration_min = Number.isFinite(durationMinRaw) && durationMinRaw > 0 ? Math.round(durationMinRaw / 60) : 0;
  const distance_km = Number.isFinite(distanceKmRaw) && distanceKmRaw > 0 ? Number((distanceKmRaw / 1000).toFixed(2)) : 0;
  const avgHrSession = Number(session?.avg_heart_rate);
  const avgHrRecords = records
    .map((r) => Number(r?.heart_rate))
    .filter((v) => Number.isFinite(v) && v > 0);
  const avg_hr = Number.isFinite(avgHrSession) && avgHrSession > 0
    ? Math.round(avgHrSession)
    : avgHrRecords.length
      ? Math.round(avgHrRecords.reduce((acc, v) => acc + v, 0) / avgHrRecords.length)
      : null;
  const speedChanges = getFitAvgSpeedChanges(records);
  const type = mapFitWorkoutType({
    sport,
    title,
    speedChanges,
    durationMin: duration_min,
    distanceKm: distance_km,
  });
  const structureFromLaps = laps
    .slice(0, 10)
    .map((lap, idx) => {
      const lapDuration = Number(lap?.total_timer_time ?? lap?.total_elapsed_time);
      const lapDistance = Number(lap?.total_distance);
      const row = {
        block_type: idx % 2 === 0 ? "Intervalo" : "Recuperación",
      };
      if (Number.isFinite(lapDuration) && lapDuration > 0) row.duration_min = String(Math.max(1, Math.round(lapDuration / 60)));
      if (Number.isFinite(lapDistance) && lapDistance > 0) row.distance_km = String((lapDistance / 1000).toFixed(2));
      return row;
    })
    .filter(Boolean);
  return {
    id: `fit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sourceFileName: file?.name || "",
    title: title || "Workout FIT",
    sport,
    type,
    duration_min,
    total_km: distance_km,
    distance_km,
    avg_hr,
    structure: structureFromLaps,
    speedChanges,
  };
};

export const mapJsonWorkoutToLibraryDraft = (row, fileName, idx) => {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const isGarminLike =
    row.workoutName != null ||
    row.estimatedDurationInSecs != null ||
    row.estimatedDistanceInMeters != null ||
    Array.isArray(row.workoutSegments);
  const titleValue = row.title ?? row.name ?? (isGarminLike ? row.workoutName : "");
  const sport = String(row.sport ?? "running").trim().toLowerCase() || "running";
  const rawType = String(row.type ?? row.workout_type ?? "").trim().toLowerCase();
  const garminSegments = Array.isArray(row.workoutSegments) ? row.workoutSegments : [];
  const garminSteps = Array.isArray(garminSegments[0]?.workoutSteps) ? garminSegments[0].workoutSteps : [];

  const stepTypeKeyOf = (step) =>
    String(step?.stepType?.stepTypeKey || step?.stepTypeKey || step?.stepType || step?.type || "").trim().toLowerCase();
  const hasRepeatGroup = garminSteps.some((step) => {
    const t = String(step?.type || step?.stepType?.stepTypeKey || "").toLowerCase();
    return t.includes("repeatgroupdto") || t.includes("repeat_group") || t.includes("repeatgroup");
  });
  const hasIntervalStep = garminSteps.some((step) => stepTypeKeyOf(step) === "interval");

  const hasTempoWord = /\b(tempo|cruise)\b/i.test(String(titleValue || ""));
  const hasLongWord = /\b(long|largo)\b/i.test(String(titleValue || ""));
  let inferredType = sport === "running" ? "easy" : "easy";
  if (hasIntervalStep || hasRepeatGroup) inferredType = "interval";
  else if (hasTempoWord) inferredType = "tempo";
  else if (hasLongWord) inferredType = "long";
  const safeMappedType = WORKOUT_TYPES.some((t) => t.id === rawType) ? rawType : inferredType;

  const durationRaw = Number(
    row.duration_min ??
      row.duration ??
      (isGarminLike ? Number(row.estimatedDurationInSecs) / 60 : NaN),
  );
  const distanceRaw = Number(
    row.total_km ??
      row.distance_km ??
      (isGarminLike && row.estimatedDistanceInMeters != null ? Number(row.estimatedDistanceInMeters) / 1000 : NaN),
  );
  const durationMin = Number.isFinite(durationRaw) ? Math.max(0, Math.round(durationRaw)) : 0;
  const distanceKm = Number.isFinite(distanceRaw) ? Math.max(0, Number(distanceRaw)) : 0;

  const speedToPace = (mps) => {
    const speed = Number(mps);
    if (!Number.isFinite(speed) || speed <= 0) return null;
    const totalMinPerKm = 1000 / speed / 60;
    const paceMin = Math.floor(totalMinPerKm);
    const paceSec = Math.round((totalMinPerKm - paceMin) * 60);
    const safeSec = paceSec >= 60 ? 59 : Math.max(0, paceSec);
    return `${paceMin}:${String(safeSec).padStart(2, "0")}`;
  };
  const secToMinInt = (sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(1, Math.round(n / 60));
  };
  const numericTarget = (step, key) => Number(step?.[key] ?? step?.targetType?.[key]);

  const endConditionLooksLikeMeters = (st) => {
    const ect = String(st?.endConditionType ?? st?.endConditionTypeKey ?? "").toLowerCase();
    if (ect.includes("distance")) return true;
    const v = Number(st?.endConditionValue);
    return Number.isFinite(v) && v >= 400;
  };

  const intervalDistanceKmFromStep = (st) => {
    if (!st) return null;
    const ev = Number(st?.endConditionValue);
    if (endConditionLooksLikeMeters(st) && Number.isFinite(ev) && ev > 0) {
      return Number((ev / 1000).toFixed(2));
    }
    const dm = Number(st?.distance ?? st?.totalDistance);
    if (Number.isFinite(dm) && dm > 400) return Number((dm / 1000).toFixed(2));
    return null;
  };

  const stepDurationMinFromNestedStep = (st) => {
    if (!st) return null;
    const ev = Number(st?.endConditionValue);
    if (!Number.isFinite(ev) || ev <= 0) return null;
    if (endConditionLooksLikeMeters(st)) return null;
    return secToMinInt(ev);
  };

  const descriptionLines = [];
  const structureRows = [];
  for (const step of garminSteps) {
    const rawType = String(step?.type || "").toLowerCase();
    const stepTypeKey = stepTypeKeyOf(step);

    if (stepTypeKey === "warmup") {
      const mins = secToMinInt(step?.endConditionValue);
      descriptionLines.push(`${mins}' E calentamiento`);
      structureRows.push({ block_type: "Calentamiento", duration_min: String(mins) });
      continue;
    }
    if (stepTypeKey === "cooldown") {
      const mins = secToMinInt(step?.endConditionValue);
      descriptionLines.push(`${mins}' E enfriamiento`);
      structureRows.push({ block_type: "Enfriamiento", duration_min: String(mins) });
      continue;
    }
    if (rawType.includes("repeatgroupdto") || rawType.includes("repeat_group") || rawType.includes("repeatgroup")) {
      const reps = Math.max(1, Math.floor(Number(step?.numberOfIterations)) || 1);
      const nested = Array.isArray(step?.workoutSteps) ? step.workoutSteps : [];
      const intervalStep = nested.find((s) => stepTypeKeyOf(s) === "interval") || nested[0];
      const recoveryStep = nested.find((s) => stepTypeKeyOf(s) === "recovery") || nested[1];

      const summaryParts = [];
      if (intervalStep) {
        const kmI = intervalDistanceKmFromStep(intervalStep);
        const paceI = speedToPace(numericTarget(intervalStep, "targetValueOne"));
        const minI = stepDurationMinFromNestedStep(intervalStep);
        if (kmI != null) summaryParts.push(`${kmI}km @ ${paceI || "?"}/km`);
        else if (minI != null) summaryParts.push(`${minI}' @ ${paceI || "?"} min/km`);
        else if (paceI) summaryParts.push(`@ ${paceI}/km`);
      }
      if (recoveryStep) {
        const recMin = stepDurationMinFromNestedStep(recoveryStep) ?? secToMinInt(Number(recoveryStep?.endConditionValue));
        if (recMin) summaryParts.push(`${recMin}' jog E`);
      }
      if (summaryParts.length) {
        descriptionLines.push(`${reps}x(${summaryParts.join(" + ")})`);
      } else {
        descriptionLines.push(`${reps}x(bloque)`);
      }

      for (let r = 0; r < reps; r += 1) {
        for (const ns of nested) {
          const nk = stepTypeKeyOf(ns);
          if (nk === "interval") {
            const km = intervalDistanceKmFromStep(ns);
            const pace = speedToPace(numericTarget(ns, "targetValueOne"));
            const dm = stepDurationMinFromNestedStep(ns);
            const paceKm = pace ? `${pace}/km` : "";
            let desc = "Paso: Intervalo";
            if (km != null && pace) desc = `Paso: Intervalo · ${km}km · ${paceKm}`;
            else if (km != null) desc = `Paso: Intervalo · ${km}km`;
            else if (pace) desc = `Paso: Intervalo · ${paceKm}`;
            else if (dm != null) desc = `Paso: Intervalo · ${dm}min`;
            structureRows.push({
              block_type: "Intervalo",
              ...(km != null ? { distance_km: String(km) } : {}),
              ...(dm != null ? { duration_min: String(dm) } : {}),
              target_pace: paceKm,
              description: desc,
            });
          } else if (nk === "recovery") {
            const rm = stepDurationMinFromNestedStep(ns) ?? secToMinInt(Number(ns?.endConditionValue));
            const recDesc = rm ? `Paso: Recuperación · ${rm}min · ritmo E` : `Paso: Recuperación · ritmo E`;
            structureRows.push({
              block_type: "Recuperación",
              duration_min: rm ? String(rm) : "",
              description: recDesc,
            });
          }
        }
      }
      continue;
    }
    if (stepTypeKey === "interval") {
      const mins = secToMinInt(step?.endConditionValue);
      const pace = speedToPace(numericTarget(step, "targetValueOne"));
      descriptionLines.push(`${mins}' @ ${pace || "?"} min/km`);
      structureRows.push({
        block_type: "Intervalo",
        duration_min: String(mins),
        target_pace: pace ? `${pace} min/km` : "",
      });
      continue;
    }
    if (stepTypeKey === "recovery") {
      const mins = secToMinInt(step?.endConditionValue);
      descriptionLines.push(`${mins}' jog E`);
      structureRows.push({ block_type: "Recuperación", duration_min: String(mins) });
    }
  }
  const garminDescription = descriptionLines.join("\n");

  return {
    id: `json_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
    sourceFileName: fileName || "",
    title: String(titleValue ?? "").trim() || `Workout JSON ${idx + 1}`,
    sport,
    type: safeMappedType,
    duration_min: durationMin,
    total_km: distanceKm,
    distance_km: distanceKm,
    avg_hr: null,
    structure: structureRows,
    speedChanges: 0,
    // Garmin: la nota en row.description no sustituye la estructura desde workoutSteps
    description: isGarminLike ? garminDescription : row.description != null ? String(row.description) : garminDescription,
  };
};

export const INVALID_JSON_WORKOUT_FORMAT_MSG = "Formato JSON inválido. Debe ser un workout o array de workouts.";

export const parseJsonFileToLibraryDrafts = async (file) => {
  const jsonContent = await file.text();
  console.log("JSON raw content:", jsonContent);
  let parsed;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error(INVALID_JSON_WORKOUT_FORMAT_MSG);
  }
  console.log("Parsed JSON:", parsed);
  console.log(
    "estimatedDurationInSecs:",
    parsed.estimatedDurationInSecs,
    "estimatedDistanceInMeters:",
    parsed.estimatedDistanceInMeters,
  );
  const payload = parsed;
  const list = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload] : null;
  if (!list) {
    throw new Error(INVALID_JSON_WORKOUT_FORMAT_MSG);
  }
  const drafts = list.map((row, idx) => mapJsonWorkoutToLibraryDraft(row, file?.name || "", idx)).filter(Boolean);
  if (!drafts.length) {
    throw new Error(INVALID_JSON_WORKOUT_FORMAT_MSG);
  }
  return drafts;
};

export const ADMIN_EMAIL = "acostamerlano87@gmail.com";

export const PLATFORM_ADMIN_USER_ID = "b5c9e44a-6695-4800-99bd-f19b05d2f66f";

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
    background: "rgba(245, 158, 11, 0.14)",
    borderRight: "3px solid #f59e0b",
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
    background: "rgba(245, 158, 11, 0.12)",
    border: "1px solid rgba(245, 158, 11, 0.35)",
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

const PLAN2_FIXED_SLOTS = [
  { weekday: 2, type: "long" },
  { weekday: 3, type: "tempo" },
  { weekday: 4, type: "recovery" },
  { weekday: 6, type: "interval" },
  { weekday: 7, type: "long" },
];
const PLAN2_OMIT_ORDER = [7, 4, 3];

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

const HR_ZONE_DEFS = [
  { z: 1, lowPct: 0.5, highPct: 0.6, label: "Recuperación activa", color: "#22c55e" },
  { z: 2, lowPct: 0.6, highPct: 0.7, label: "Aeróbico base", color: "#3b82f6" },
  { z: 3, lowPct: 0.7, highPct: 0.8, label: "Aeróbico tempo", color: "#eab308" },
  { z: 4, lowPct: 0.8, highPct: 0.9, label: "Umbral anaeróbico", color: "#f97316" },
  { z: 5, lowPct: 0.9, highPct: 1.0, label: "VO2 max", color: "#ef4444" },
];

export const computeAthleteHrZones = (fcMax) => {
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) return null;
  return HR_ZONE_DEFS.map((d) => ({
    zone: d.z,
    low: Math.round(max * d.lowPct),
    high: Math.round(max * d.highPct),
    label: d.label,
    color: d.color,
    pctLabel: `${d.lowPct * 100}-${d.highPct * 100}% FC máx`,
  }));
};

export const buildAthleteHrZonesPromptText = (athlete) => {
  if (!athlete || !athlete.fc_max || athlete.fc_max <= 0) return "";
  const zones = computeAthleteHrZones(athlete.fc_max);
  if (!zones) return "";
  const lines = zones.map((z) => `Z${z.zone} (${z.pctLabel}): ${z.low}-${z.high} bpm — ${z.label}`);
  let t = `Athlete heart rate zones (based on max HR ${athlete.fc_max} bpm):\n${lines.join("\n")}`;
  if (athlete.fc_reposo && athlete.fc_reposo > 0) {
    t += `\nResting HR (reference): ${athlete.fc_reposo} bpm.`;
  }
  return t;
};

export async function sendWorkoutAssignmentPushToAthlete({ athleteUserId, workoutTitle, scheduledDate }) {
  if (!athleteUserId) return;
  const { data: prof } = await supabase.from("profiles").select("fcm_token").eq("user_id", athleteUserId).maybeSingle();
  const token = prof?.fcm_token ?? null;
  await sendChatPushNotification({
    token,
    title: "🏃 Nuevo entrenamiento asignado",
    body: `${workoutTitle || "Entrenamiento"} programado para el ${scheduledDate || "día asignado"}`,
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

const pushBodySnippet = (text, max = 400) => {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
};

export async function sendChatPushNotification({ token, title, body, data = null, logLabel = "chat push" }) {
  const tokenOk = token != null && String(token).trim() !== "";
  if (!tokenOk || typeof window === "undefined") return;
  try {
    const res = await fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        title,
        body: pushBodySnippet(body),
        data: data && typeof data === "object" ? data : undefined,
      }),
    });
    if (!res.ok) console.warn(`[${logLabel}] /api/send-notification respuesta no OK`, await res.text());
  } catch (e) {
    console.warn(`[${logLabel}] /api/send-notification error`, e);
  }
}

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
  const hrLoggedCount = done.filter((w) => [w.manual_avg_hr, w.manual_max_hr, w.avg_hr, w.average_heartrate, w.strava_avg_hr].some((v) => Number(v) > 0)).length;
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
    const res = await fetch(`/api/achievements?athlete_id=${encodeURIComponent(String(athleteId))}`);
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
      fetch(`/api/achievements?athlete_id=${encodeURIComponent(athleteId)}`),
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
        await fetch("/api/achievements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ athlete_id: athleteId, achievement_code: ach.code, value: totalKm }) });
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

export const formatMessageTimestamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
};

export const normalizeWorkoutRow = (row) => {
  let structure = row.workout_structure ?? row.structure;
  if (typeof structure === "string") { try { structure = JSON.parse(structure); } catch { structure = []; } }
  structure = normalizeWorkoutStructure(structure);
  const scheduled = normalizeScheduledDateYmd(row.scheduled_date);
  const type = row.type && WORKOUT_TYPES.some((t) => t.id === row.type) ? row.type : "easy";
  return {
    id: row.id, athlete_id: row.athlete_id, coach_id: row.coach_id, scheduled_date: scheduled, type,
    title: row.title || WORKOUT_TYPES.find((t) => t.id === type)?.label || "Entrenamiento",
    total_km: Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0,
    distance_km: Number.isFinite(Number(row.distance_km)) ? Number(row.distance_km) : (Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0),
    duration_min: Number.isFinite(Number(row.duration_min)) ? Number(row.duration_min) : 0,
    description: row.description || "", structure: Array.isArray(structure) ? structure : [], workout_structure: Array.isArray(structure) ? structure : [],
    done: Boolean(row.done), rpe: clampWorkoutRpe(row.rpe),
    manual_distance_km: Number.isFinite(Number(row.manual_distance_km)) ? Number(row.manual_distance_km) : null,
    manual_duration_min: Number.isFinite(Number(row.manual_duration_min)) ? Number(row.manual_duration_min) : null,
    manual_avg_hr: Number.isFinite(Number(row.manual_avg_hr)) ? Math.round(Number(row.manual_avg_hr)) : null,
    manual_max_hr: Number.isFinite(Number(row.manual_max_hr)) ? Math.round(Number(row.manual_max_hr)) : null,
    manual_calories: Number.isFinite(Number(row.manual_calories)) ? Math.round(Number(row.manual_calories)) : null,
    athlete_notes: typeof row.athlete_notes === "string" ? row.athlete_notes : "", completed_at: row.completed_at || null,
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
    points.push({ i, label: i === 0 ? "Actual" : `-${i} sem`, endYmd, acute, chronic, forma: acute != null || chronic != null ? (chronic ?? 0) - (acute ?? 0) : null });
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
  const codigoIngresado = String(codeInput || "").trim();
  if (!codigoIngresado) return null;
  const { data, error } = await supabase.from("profiles").select("user_id, role, name").eq("coach_id", codigoIngresado.trim().toUpperCase()).maybeSingle();
  if (error) return null;
  return data?.user_id ?? null;
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
