import FitParser from "fit-file-parser";

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
