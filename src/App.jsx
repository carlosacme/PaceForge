import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "./lib/supabase";
import {
  initMessaging,
  onMessage,
  refreshFcmTokenIfGranted,
  requestNotificationPermission,
} from "./firebase.js";

const BRAND_NAME = "RunningApexFlow";
const STRAVA_CALLBACK_URL = "https://pace-forge-eta.vercel.app/api/strava/callback";

const WORKOUT_TYPES = [
  { id: "easy", label: "Rodaje Suave", color: "#22c55e" },
  { id: "tempo", label: "Tempo", color: "#f59e0b" },
  { id: "interval", label: "Intervalos", color: "#ef4444" },
  { id: "long", label: "Largo", color: "#3b82f6" },
  { id: "recovery", label: "Recuperación", color: "#8b5cf6" },
  { id: "race", label: "Carrera", color: "#dc2626" },
];

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const MONTH_INDEX = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const getRaceCountdownText = (nextRace) => {
  if (!nextRace || typeof nextRace !== "string") return "🏁 Próxima carrera · fecha pendiente";

  const [raceNameRaw, datePartRaw] = nextRace.split(" - ");
  const raceName = (raceNameRaw || "Próxima carrera").trim();
  const datePart = (datePartRaw || "").trim();
  const [monthAbbr, dayRaw] = datePart.split(/\s+/);
  const month = MONTH_INDEX[monthAbbr];
  const day = Number(dayRaw);

  if (month === undefined || !Number.isFinite(day)) {
    return `🏁 ${raceName} · fecha pendiente`;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let raceDate = new Date(today.getFullYear(), month, day);
  if (raceDate < today) raceDate = new Date(today.getFullYear() + 1, month, day);

  const diffMs = raceDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const label = daysLeft === 1 ? "día" : "días";

  return `🏁 ${raceName} · faltan ${daysLeft} ${label}`;
};

/** Etiqueta de carrera y días restantes (para tablas y métricas). */
const getRaceMeta = (nextRace) => {
  if (!nextRace || typeof nextRace !== "string") return { name: "—", daysLeft: null };
  const [raceNameRaw, datePartRaw] = nextRace.split(" - ");
  const raceName = (raceNameRaw || "Próxima carrera").trim();
  const datePart = (datePartRaw || "").trim();
  const [monthAbbr, dayRaw] = datePart.split(/\s+/);
  const month = MONTH_INDEX[monthAbbr];
  const day = Number(dayRaw);
  if (month === undefined || !Number.isFinite(day)) {
    return { name: raceName, daysLeft: null };
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let raceDate = new Date(today.getFullYear(), month, day);
  if (raceDate < today) raceDate = new Date(today.getFullYear() + 1, month, day);
  const diffMs = raceDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { name: raceName, daysLeft };
};

const normalizeAthlete = (athlete) => ({
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
});

const pushBodySnippet = (text, max = 400) => {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
};

async function sendChatPushNotification({ token, title, body, logLabel = "chat push" }) {
  const tokenOk = token != null && String(token).trim() !== "";
  console.log(`[${logLabel}] Token FCM del destinatario:`, tokenOk ? token : "Token FCM no disponible");
  if (!tokenOk || typeof window === "undefined") return;
  console.log(`[${logLabel}] Llamando POST /api/send-notification`, { title });
  try {
    const res = await fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        title,
        body: pushBodySnippet(body),
      }),
    });
    if (!res.ok) console.warn(`[${logLabel}] /api/send-notification respuesta no OK`, await res.text());
    else console.log(`[${logLabel}] /api/send-notification OK`, res.status);
  } catch (e) {
    console.warn(`[${logLabel}] /api/send-notification error`, e);
  }
}

const achievementKmTargets = [10, 50, 100, 500, 1000];
const PAYMENT_METHOD_OPTIONS = ["Nequi", "Bancolombia", "Efectivo", "Transferencia", "Otro"];
const PAYMENT_PLAN_OPTIONS = ["Basico", "Pro"];
const STRAVA_ACTIVITY_ICONS = {
  Run: "🏃",
  Ride: "🚴",
  Swim: "🏊",
  Walk: "🚶",
  Hike: "🥾",
  Workout: "🏋️",
};

const paymentStatusLabel = (status) =>
  status === "confirmed" ? "Confirmado" : status === "rejected" ? "Rechazado" : "Pendiente";
const getCurrentMonthKey = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
};

const achievementJoinMeta = (row) => {
  if (!row) return null;
  const a = row.achievements;
  if (a != null) return Array.isArray(a) ? a[0] : a;
  if (row.achievement_code)
    return { code: row.achievement_code, name: row.achievement_code, icon: "", description: "" };
  return null;
};

const getLongestConsecutiveDays = (ymdList) => {
  if (!Array.isArray(ymdList) || ymdList.length === 0) return 0;
  const uniq = [...new Set(ymdList)].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < uniq.length; i++) {
    const prev = new Date(`${uniq[i - 1]}T12:00:00`);
    const now = new Date(`${uniq[i]}T12:00:00`);
    const diffDays = Math.round((now.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) current += 1;
    else current = 1;
    if (current > best) best = current;
  }
  return best;
};

const computeAchievementProgress = (doneWorkouts) => {
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

  const unlockedByCode = {
    FIRST_KM: doneCount >= 1,
    KM_10: totalKm >= 10,
    KM_50: totalKm >= 50,
    KM_100: totalKm >= 100,
    KM_500: totalKm >= 500,
    KM_1000: totalKm >= 1000,
    FIRST_WORKOUT: doneCount >= 1,
    STREAK_7: longestStreak >= 7,
    STREAK_30: longestStreak >= 30,
    FIRST_LONG: hasLong15,
    SPEED_DEMON: hasInterval,
    CONSISTENT: doneCount >= 10,
    HALF_WARRIOR: hasHalf,
    MARATHON_READY: has30,
    EARLY_BIRD: hasEarlyBird,
    RPE_MASTER: rpeCount >= 10,
  };

  return { unlockedByCode, totalKm, doneCount, longestStreak, rpeCount };
};

async function loadAthleteAchievementSnapshot(athleteId) {
  if (!athleteId) return { achievements: [], earned: [] };
  try {
    const res = await fetch(`/api/achievements?athlete_id=${encodeURIComponent(athleteId)}`);
    const json = await res.json();
    if (!res.ok) {
      console.warn("loadAthleteAchievementSnapshot", json);
      return { achievements: [], earned: [] };
    }
    return { achievements: json.all || [], earned: json.earned || [] };
  } catch (e) {
    console.warn("loadAthleteAchievementSnapshot", e);
    return { achievements: [], earned: [] };
  }
}

async function evaluateAndAwardAthleteAchievements(athleteId) {
  if (!athleteId) return { newAwards: [], snapshot: { achievements: [], earned: [] }, progress: null };
  try {
    const [achRes, workRes] = await Promise.all([
      fetch(`/api/achievements?athlete_id=${encodeURIComponent(athleteId)}`),
      supabase.from("workouts").select("*").eq("athlete_id", athleteId).eq("done", true),
    ]);
    if (!achRes.ok) {
      const err = await achRes.json().catch(() => ({}));
      console.warn("evaluateAndAwardAthleteAchievements achievements API", err);
      return { newAwards: [], snapshot: { achievements: [], earned: [] }, progress: null };
    }
    const { all: allAchievements, earned: earnedList } = await achRes.json();
    const { data: doneWorkouts, error: doneErr } = workRes;
    if (doneErr) console.warn("evaluateAndAwardAthleteAchievements workouts", doneErr);
    const dw = doneWorkouts || [];
    const totalKm = dw.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
    const earnedCodes = new Set((earnedList || []).map((e) => e.achievement_code));
    const newAchievements = [];
    for (const ach of allAchievements || []) {
      if (earnedCodes.has(ach.code)) continue;
      let earned = false;
      if (ach.condition_type === "total_km" && totalKm >= Number(ach.condition_value)) earned = true;
      if (ach.condition_type === "workout_count" && dw.length >= Number(ach.condition_value)) earned = true;
      if (ach.condition_type === "single_km" && dw.some((w) => (Number(w.total_km) || 0) >= Number(ach.condition_value))) earned = true;
      if (ach.condition_type === "interval" && dw.some((w) => w.type === "interval")) earned = true;
      if (earned) {
        await fetch("/api/achievements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ athlete_id: athleteId, achievement_code: ach.code, value: totalKm }),
        });
        newAchievements.push(ach);
      }
    }
    const snapshot = await loadAthleteAchievementSnapshot(athleteId);
    const progress = computeAchievementProgress(dw);
    const newAwards = newAchievements.map((ach) => ({
      achievement_code: ach.code,
      awarded_at: new Date().toISOString(),
      achievements: ach,
    }));
    return { newAwards, snapshot, progress };
  } catch (e) {
    console.error("achievements error:", e);
    return { newAwards: [], snapshot: { achievements: [], earned: [] }, progress: null };
  }
}

/** Zonas % de FC máx (bpm). */
const HR_ZONE_DEFS = [
  { z: 1, lowPct: 0.5, highPct: 0.6, label: "Recuperación activa", color: "#22c55e" },
  { z: 2, lowPct: 0.6, highPct: 0.7, label: "Aeróbico base", color: "#3b82f6" },
  { z: 3, lowPct: 0.7, highPct: 0.8, label: "Aeróbico tempo", color: "#eab308" },
  { z: 4, lowPct: 0.8, highPct: 0.9, label: "Umbral anaeróbico", color: "#f97316" },
  { z: 5, lowPct: 0.9, highPct: 1.0, label: "VO2 max", color: "#ef4444" },
];

const computeAthleteHrZones = (fcMax) => {
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

const buildAthleteHrZonesPromptText = (athlete) => {
  if (!athlete || !athlete.fc_max || athlete.fc_max <= 0) return "";
  const zones = computeAthleteHrZones(athlete.fc_max);
  if (!zones) return "";
  const lines = zones.map(
    (z) => `Z${z.zone} (${z.pctLabel}): ${z.low}-${z.high} bpm — ${z.label}`,
  );
  let t = `Athlete heart rate zones (based on max HR ${athlete.fc_max} bpm):\n${lines.join("\n")}`;
  if (athlete.fc_reposo && athlete.fc_reposo > 0) {
    t += `\nResting HR (reference): ${athlete.fc_reposo} bpm.`;
  }
  return t;
};

const formatMessageTimestamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
};

const formatLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** YYYY-MM-DD desde componentes locales (celdas del calendario); evita desfaces vs strings ISO del workout. */
const calendarCellToIsoYmd = (d) => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Normaliza scheduled_date del workout a YYYY-MM-DD sin depender de Date cuando ya viene como fecha. */
const normalizeScheduledDateYmd = (raw) => {
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

const startOfWeekMonday = (ref = new Date()) => {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d;
};

const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

/** Lunes de la semana que contiene el primer día del mes */
const startOfMonthWeekMonday = (year, monthIndex) => startOfWeekMonday(new Date(year, monthIndex, 1));

/** 42 celdas (6 semanas), vista mensual */
const getMonthGrid = (year, monthIndex) => {
  const gridStart = startOfMonthWeekMonday(year, monthIndex);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
};

const cellIsInViewMonth = (cellDate, year, monthIndex) =>
  cellDate.getFullYear() === year && cellDate.getMonth() === monthIndex;

const daysBetweenYmd = (fromYmd, toYmd) => {
  const a = new Date(`${fromYmd}T12:00:00`);
  const b = new Date(`${toYmd}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

const RACE_DISTANCE_PRESETS = ["5K", "10K", "21K", "42K", "Otro"];

const raceDistanceToFormFields = (dist) => {
  const d = String(dist || "").trim();
  const fixed = RACE_DISTANCE_PRESETS.filter((x) => x !== "Otro");
  if (fixed.includes(d)) return { distance: d, distanceOther: "" };
  return { distance: "Otro", distanceOther: d };
};

const normalizeRaceRow = (row) => {
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

/** Carreras con fecha >= todayYmd, la primera es la más próxima */
const getNextRaceCountdown = (races, todayYmd) => {
  const list = (races || [])
    .filter((r) => r.date && r.date >= todayYmd)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const r = list[0];
  const days = daysBetweenYmd(todayYmd, r.date);
  return { race: r, days };
};

const extractJsonFromAnthropicText = (text) => {
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

const PLAN_12_LEVELS = [
  { id: "principiante", label: "Principiante" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

/** Plantilla fija plan 2 semanas: omitir domingo, luego jueves, luego miércoles si N<5 */
const PLAN2_FIXED_SLOTS = [
  { weekday: 2, type: "long" },
  { weekday: 3, type: "tempo" },
  { weekday: 4, type: "recovery" },
  { weekday: 6, type: "interval" },
  { weekday: 7, type: "long" },
];
const PLAN2_OMIT_ORDER = [7, 4, 3];

const getPlan2ExpectedSlots = (sessionsPerWeek) => {
  let slots = [...PLAN2_FIXED_SLOTS];
  for (const wd of PLAN2_OMIT_ORDER) {
    if (slots.length <= sessionsPerWeek) break;
    slots = slots.filter((s) => s.weekday !== wd);
  }
  return slots;
};

const validatePlan2Distribution = (weeks, sessionsPerWeek) => {
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

const clampWorkoutRpe = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.round(v);
  if (i < 1 || i > 10) return null;
  return i;
};

const formatDurationClock = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatStravaPace = (distanceM, movingTimeSec) => {
  const d = Number(distanceM) || 0;
  const t = Number(movingTimeSec) || 0;
  if (d <= 0 || t <= 0) return "—";
  const secPerKm = t / (d / 1000);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
};

const normalizeStravaActivity = (row) => {
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

/** Emoji por banda RPE (1–10). */
const rpeBandMeta = (rpe) => {
  if (rpe == null || rpe < 1 || rpe > 10) return { emoji: "", label: "" };
  if (rpe <= 3) return { emoji: "😌", label: "Muy fácil" };
  if (rpe <= 5) return { emoji: "🙂", label: "Moderado" };
  if (rpe <= 7) return { emoji: "😤", label: "Duro" };
  if (rpe <= 9) return { emoji: "😰", label: "Muy duro" };
  return { emoji: "🔥", label: "Máximo" };
};

const normalizeWorkoutRow = (row) => {
  let structure = row.structure;
  if (typeof structure === "string") {
    try { structure = JSON.parse(structure); } catch { structure = []; }
  }
  const scheduled = normalizeScheduledDateYmd(row.scheduled_date);
  const type = row.type && WORKOUT_TYPES.some(t => t.id === row.type) ? row.type : "easy";
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    coach_id: row.coach_id,
    scheduled_date: scheduled,
    type,
    title: row.title || WORKOUT_TYPES.find(t => t.id === type)?.label || "Entrenamiento",
    total_km: Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0,
    duration_min: Number.isFinite(Number(row.duration_min)) ? Number(row.duration_min) : 0,
    description: row.description || "",
    structure: Array.isArray(structure) ? structure : [],
    done: Boolean(row.done),
    rpe: clampWorkoutRpe(row.rpe),
  };
};

const emptyWorkoutStructureRow = () => ({ phase: "", duration: "", pace: "", intensity: "" });

/** Convierte structure del workout a filas editables (fases). */
const workoutStructureToEditableRows = (structure) => {
  const arr = Array.isArray(structure) ? structure : [];
  return arr.map((s) => ({
    phase: String(s?.phase ?? s?.name ?? ""),
    duration: String(s?.duration ?? ""),
    pace: String(s?.pace ?? ""),
    intensity: String(s?.intensity ?? ""),
  }));
};

/** Filas del formulario → JSON guardado en workouts.structure */
const editableRowsToWorkoutStructure = (rows) => {
  const out = (rows || [])
    .map((r) => {
      const phase = (r?.phase ?? "").trim();
      const duration = (r?.duration ?? "").trim();
      const pace = (r?.pace ?? "").trim();
      const intensity = (r?.intensity ?? "").trim();
      if (!phase && !duration && !pace && !intensity) return null;
      const o = {};
      if (phase) o.phase = phase;
      if (duration) o.duration = duration;
      if (pace) o.pace = pace;
      if (intensity) o.intensity = intensity;
      return Object.keys(o).length ? o : null;
    })
    .filter(Boolean);
  return out;
};

const normalizeLibraryRow = (row) => {
  let structure = row.structure;
  if (typeof structure === "string") {
    try { structure = JSON.parse(structure); } catch { structure = []; }
  }
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
  };
};

const libraryRowToBuilderWorkout = (row) => ({
  title: row.title,
  type: row.type,
  total_km: row.total_km,
  duration_min: row.duration_min,
  description: row.description || "",
  structure: Array.isArray(row.structure) ? row.structure : [],
});

/** Carga sesión: RPE × km (solo sesiones con RPE válido). */
const sessionRpeKmLoad = (w) => {
  const km = Number(w.total_km);
  const rpe = clampWorkoutRpe(w.rpe);
  if (rpe == null || !Number.isFinite(km) || km < 0) return null;
  return rpe * km;
};

/** Promedio de RPE×km en ventana [startYmd, endYmd] inclusive; null si no hay sesiones válidas. */
const avgRpeKmInWindow = (eligibleWorkouts, startYmd, endYmd) => {
  const loads = eligibleWorkouts
    .filter((w) => w.scheduled_date >= startYmd && w.scheduled_date <= endYmd)
    .map(sessionRpeKmLoad)
    .filter((v) => v != null);
  if (!loads.length) return null;
  return loads.reduce((a, b) => a + b, 0) / loads.length;
};

/** 8 puntos semanales (índice 0 = semana actual respecto a hoy): aguda 7d, crónica 28d, forma = crónica − aguda. */
const computeFormaFatigaWeeklyPoints = (workouts) => {
  const eligible = workouts.filter((w) => w.done && clampWorkoutRpe(w.rpe) != null);
  const today = new Date();
  const points = [];
  for (let i = 0; i < 8; i++) {
    const endD = addDays(today, -i * 7);
    const endYmd = formatLocalYMD(endD);
    const acuteStartYmd = formatLocalYMD(addDays(endD, -6));
    const chronicStartYmd = formatLocalYMD(addDays(endD, -27));
    const acute = avgRpeKmInWindow(eligible, acuteStartYmd, endYmd);
    const chronic = avgRpeKmInWindow(eligible, chronicStartYmd, endYmd);
    const forma = acute != null || chronic != null ? (chronic ?? 0) - (acute ?? 0) : null;
    points.push({
      i,
      label: i === 0 ? "Actual" : `−${i} sem`,
      endYmd,
      acute,
      chronic,
      forma,
    });
  }
  return points;
};

const formaFatigaStatusFromPoint = (p) => {
  if (!p || (p.acute == null && p.chronic == null)) {
    return { label: "Sin datos suficientes", kind: "none" };
  }
  const acute = p.acute ?? 0;
  const chronic = p.chronic ?? 0;
  const forma = p.forma != null ? p.forma : chronic - acute;
  const scale = Math.max(Math.abs(acute), Math.abs(chronic), 1);
  const r = forma / scale;
  if (r > 0.12) return { label: "En forma 🟢", kind: "forma" };
  if (r < -0.12) return { label: "Fatigado 🔴", kind: "fatiga" };
  return { label: "Fresco 🟡", kind: "fresco" };
};

/** Gráfico de líneas (SVG + estilos inline, sin librerías de gráficos). */
const FormaFatigaLineChart = ({ chronological }) => {
  const n = chronological.length;
  const W = 360;
  const H = 160;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = n <= 1 ? [padL + innerW / 2] : chronological.map((_, idx) => padL + (innerW * idx) / (n - 1));

  const vals = [];
  chronological.forEach((p) => {
    vals.push(p.acute ?? 0, p.chronic ?? 0, p.forma ?? 0);
  });
  const minV = Math.min(0, ...vals);
  const maxV = Math.max(1e-6, ...vals);
  const span = maxV - minV || 1;
  const toY = (v) => padT + innerH - ((v - minV) / span) * innerH;

  const linePoints = (key) =>
    chronological
      .map((p, idx) => {
        const v = p[key] ?? 0;
        return `${xs[idx]},${toY(v)}`;
      })
      .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Carga aguda, crónica y forma en las últimas 8 semanas"
      style={{ width: "100%", maxWidth: 520, height: "auto", display: "block" }}
    >
      <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={8} />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        const gv = minV + span * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(148,163,184,.15)" strokeWidth={1} />
            <text x={4} y={y + 4} fill="#64748b" fontSize={9} fontFamily="system-ui,sans-serif">
              {gv.toFixed(0)}
            </text>
          </g>
        );
      })}
      <polyline fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("acute")} />
      <polyline fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("chronic")} />
      <polyline fill="none" stroke="#22c55e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("forma")} />
      {chronological.map((p, idx) => (
        <text
          key={p.i}
          x={xs[idx]}
          y={H - 6}
          fill="#64748b"
          fontSize={8}
          fontFamily="system-ui,sans-serif"
          textAnchor="middle"
        >
          {p.label}
        </text>
      ))}
    </svg>
  );
};

const PDF_WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

const pdfWeekdayFromYmd = (ymd) => {
  const t = new Date(`${ymd}T12:00:00`).getTime();
  if (Number.isNaN(t)) return "—";
  return PDF_WEEKDAY_SHORT[new Date(t).getDay()];
};

const getCurrentMonthYmdRange = () => {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const p2 = (n) => String(n).padStart(2, "0");
  const start = `${y}-${p2(mo + 1)}-01`;
  const lastD = new Date(y, mo + 1, 0).getDate();
  const end = `${y}-${p2(mo + 1)}-${p2(lastD)}`;
  const label = now.toLocaleDateString("es", { month: "long", year: "numeric" });
  return { start, end, label };
};

const sanitizePdfFilenamePart = (s) => {
  const base = (s || "atleta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  return base || "atleta";
};

/** Plan del atleta: mes calendario actual, footer en todas las páginas. */
const exportAthletePlanToPdf = ({ athlete, workouts, coachDisplayName }) => {
  const { start, end, label: monthLabel } = getCurrentMonthYmdRange();
  const monthWorkouts = workouts
    .filter((w) => w.scheduled_date >= start && w.scheduled_date <= end)
    .sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date);
      return String(a.id).localeCompare(String(b.id));
    });

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 16;
  const R = 16;
  let y = 14;
  const coach = (coachDisplayName && String(coachDisplayName).trim()) || "Coach";
  const genStamp = `${formatLocalYMD(new Date())} ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;

  const checkPage = (needMm = 10) => {
    if (y + needMm > pageH - 18) {
      doc.addPage();
      y = 14;
    }
  };

  doc.setFillColor(245, 158, 11);
  doc.roundedRect(L, y - 3, 7, 7, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(15);
  doc.text(BRAND_NAME, L + 9, y + 2.5);
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.25);
  doc.line(L, y + 6, pageW - R, y + 6);
  y += 12;

  doc.setTextColor(40, 40, 40);
  doc.setFontSize(11);
  doc.text(`Plan mensual — ${monthLabel}`, L, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Atleta:", L, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(athlete.name || "—"), L + 22, y);
  y += 5.5;
  doc.setFont("helvetica", "bold");
  doc.text("Objetivo:", L, y);
  doc.setFont("helvetica", "normal");
  const goalLines = doc.splitTextToSize(String(athlete.goal || "—"), pageW - L - R - 24);
  doc.text(goalLines, L + 24, y);
  y += Math.max(5.5, goalLines.length * 4.5);
  doc.setFont("helvetica", "bold");
  doc.text("Ritmo:", L, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(athlete.pace || "—"), L + 22, y);
  y += 5.5;
  doc.setFont("helvetica", "bold");
  doc.text("Km/semana:", L, y);
  doc.setFont("helvetica", "normal");
  doc.text(athlete.weekly_km != null ? `${athlete.weekly_km} km` : "—", L + 28, y);
  y += 9;

  checkPage(16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Workouts del mes (${monthWorkouts.length})`, L, y);
  y += 6;

  doc.setFillColor(241, 245, 249);
  doc.rect(L, y - 4, pageW - L - R, 6.5, "F");
  doc.setFontSize(7.5);
  doc.setTextColor(50, 50, 50);
  doc.setFont("helvetica", "bold");
  const xDate = L;
  const xDay = L + 24;
  const xTitle = L + 36;
  const xType = L + 118;
  const xKm = L + 150;
  const xMin = L + 166;
  doc.text("Fecha", xDate, y);
  doc.text("Dia", xDay, y);
  doc.text("Titulo", xTitle, y);
  doc.text("Tipo", xType, y);
  doc.text("Km", xKm, y);
  doc.text("Min", xMin, y);
  y += 6;
  doc.setFont("helvetica", "normal");

  if (monthWorkouts.length === 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text("No hay entrenamientos programados en este mes.", L, y);
    y += 6;
  } else {
    for (const w of monthWorkouts) {
      const typeLabel = WORKOUT_TYPES.find((t) => t.id === w.type)?.label || w.type || "—";
      const titleLines = doc.splitTextToSize(String(w.title || "—"), 78);
      const rowH = Math.max(4.5, titleLines.length * 4);
      checkPage(rowH + 4);
      doc.setFontSize(7.5);
      doc.setTextColor(30, 30, 30);
      doc.text(w.scheduled_date, xDate, y);
      doc.text(pdfWeekdayFromYmd(w.scheduled_date), xDay, y);
      doc.text(titleLines, xTitle, y);
      doc.text(String(typeLabel), xType, y);
      doc.text(String(w.total_km ?? 0), xKm, y);
      doc.text(String(w.duration_min ?? 0), xMin, y);
      y += rowH + 1.5;
    }
  }

  const zones = computeAthleteHrZones(athlete.fc_max);
  if (zones?.length) {
    y += 4;
    checkPage(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text("Zonas FC (segun FC max)", L, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    for (const z of zones) {
      checkPage(6);
      doc.text(
        `Z${z.zone}: ${z.low}-${z.high} lpm  (${z.pctLabel})  ${z.label}`,
        L,
        y,
      );
      y += 4.5;
    }
    if (athlete.fc_reposo && athlete.fc_reposo > 0) {
      doc.text(`FC reposo (referencia): ${athlete.fc_reposo} lpm`, L, y);
      y += 5;
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(110, 110, 110);
    doc.setFont("helvetica", "normal");
    doc.text(`Generado: ${genStamp}  ·  Coach: ${coach}`, L, pageH - 8);
  }

  const fname = `Plan_${sanitizePdfFilenamePart(athlete.name)}_${formatLocalYMD(new Date())}.pdf`;
  doc.save(fname);
};

const StatusBadge = ({ status }) => {
  const map = { "on-track": ["#22c55e", "EN RUTA"], "behind": ["#ef4444", "REZAGADO"], "ahead": ["#f59e0b", "ADELANTADO"] };
  const [color, label] = map[status] || ["#64748b", "N/A"];
  return <span style={{ fontSize: ".65em", fontWeight: 700, letterSpacing: ".1em", color, border: `1px solid ${color}40`, borderRadius: 4, padding: "2px 7px" }}>{label}</span>;
};

const ProgressBar = ({ value, total, color = "#f59e0b" }) => (
  <div style={{ background: "#f1f5f9", borderRadius: 4, height: 5, overflow: "hidden", marginTop: 6 }}>
    <div style={{ width: `${(value / total) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
  </div>
);

const ADMIN_EMAIL = "acostamerlano87@gmail.com";
/** Admin plataforma (Coaches, biblioteca global, prioridad en directorio). */
const PLATFORM_ADMIN_USER_ID = "b5c9e44a-6695-4800-99bd-f19b05d2f66f";
const ADMIN_WHATSAPP_E164 = "573233675434";
const COACH_PROFILE_TRIAL_DAYS = 7;

/** Días restantes de trial: max(0, 7 − días transcurridos desde trial_started_at). */
const coachTrialDaysRemainingFromStart = (prof) => {
  if (!prof || prof.plan_status !== "trial" || !prof.trial_started_at) return null;
  const start = new Date(prof.trial_started_at);
  if (Number.isNaN(start.getTime())) return null;
  const elapsedDays = Math.floor((Date.now() - start.getTime()) / 86400000);
  return Math.max(0, COACH_PROFILE_TRIAL_DAYS - elapsedDays);
};

async function resolveCoachUserIdFromPublicCode(codeInput) {
  const codigoIngresado = String(codeInput || "").trim();
  if (!codigoIngresado) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, role, name")
    .eq("coach_id", codigoIngresado.trim().toUpperCase())
    .maybeSingle();
  if (error) {
    console.error("resolveCoachUserIdFromPublicCode:", error);
    return null;
  }
  return data?.user_id ?? null;
}

function coachDirectorySpecialtyLabel(row) {
  const city = (row?.city || "").trim();
  const country = (row?.country || "").trim();
  const loc = [city, country].filter(Boolean).join(" · ");
  if (loc) return loc;
  const plan = (row?.subscription_plan || "").trim();
  if (plan) return plan;
  return "Entrenador de running";
}

const COACH_NAV_BASE_ITEMS = [
  { id: "dashboard", icon: "▤", label: "Dashboard", shortLabel: "Inicio", color: "#f59e0b" },
  { id: "athletes", icon: "◉", label: "Atletas", shortLabel: "Atletas", color: "#3b82f6" },
  { id: "evaluation", icon: "📊", label: "Evaluación", shortLabel: "Eval", color: "#0ea5e9" },
  { id: "plan12", icon: "◇", label: "Plan 2 Semanas", shortLabel: "2 sem.", color: "#8b5cf6" },
  { id: "plans", icon: "◆", label: "Planes", shortLabel: "Planes", color: "#0d9488" },
  { id: "builder", icon: "◎", label: "Crear Workout", shortLabel: "IA", color: "#ea580c" },
  { id: "library", icon: "◈", label: "Biblioteca", shortLabel: "Biblio", color: "#6366f1" },
];

export default function App() {
  const [view, setView] = useState("dashboard");
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const [workoutsRefresh, setWorkoutsRefresh] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWorkout, setAiWorkout] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [notification, setNotification] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [showAddAthleteForm, setShowAddAthleteForm] = useState(false);
  const [planLimitWarning, setPlanLimitWarning] = useState("");
  const [newAthlete, setNewAthlete] = useState({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [landingAuthOpen, setLandingAuthOpen] = useState(false);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [authRole, setAuthRole] = useState("");
  const [authName, setAuthName] = useState("");
  const [authCoachCode, setAuthCoachCode] = useState("");
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pushInviteDismissed, setPushInviteDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("raf_push_invite_dismissed") === "1",
  );
  const [stravaRefreshTick, setStravaRefreshTick] = useState(0);
  const [inviteCodeFromUrl, setInviteCodeFromUrl] = useState("");
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [publicCoaches, setPublicCoaches] = useState([]);
  const [loadingPublicCoaches, setLoadingPublicCoaches] = useState(false);
  const [pendingCoachRequestId, setPendingCoachRequestId] = useState("");
  const [viewRestored, setViewRestored] = useState(false);

  const notify = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const syncFcmTokenToProfile = useCallback(async () => {
    try {
      const uid = session?.user?.id;
      if (!uid) {
        console.log("[FCM] syncFcmTokenToProfile: sin sesión (user_id)");
        return;
      }
      const token = await requestNotificationPermission();
      if (!token) {
        console.log("[FCM] No se obtuvo token FCM (permiso denegado, cancelado o no soportado en este navegador)");
        return;
      }
      console.log("[FCM] Token FCM obtenido:", token);
      const { data: updated, error } = await supabase
        .from("profiles")
        .update({ fcm_token: token })
        .eq("user_id", uid)
        .limit(1)
        .select("user_id, fcm_token")
        .maybeSingle();
      if (error) {
        console.error("[FCM] Error al guardar fcm_token en profiles:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        return;
      }
      if (!updated) {
        console.warn("[FCM] UPDATE profiles no devolvió fila: ¿existe perfil para user_id?", uid);
        return;
      }
      console.log("[FCM] fcm_token guardado en profiles para user_id:", updated.user_id);
    } catch (e) {
      console.warn("syncFcmTokenToProfile", e);
    }
  }, [session?.user?.id]);

  const dismissPushInvite = useCallback(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("raf_push_invite_dismissed", "1");
    setPushInviteDismissed(true);
  }, []);

  const coachNavItems = useMemo(() => {
    const role = profile?.role;
    const items = [...COACH_NAV_BASE_ITEMS];
    if (role === "admin") {
      items.push({ id: "admin-coaches", icon: "👥", label: "Coaches", shortLabel: "Coaches", color: "#6366f1" });
    }
    items.push({ id: "settings", icon: "⚙", label: "Configuración", shortLabel: "Ajustes", color: "#64748b" });
    const em = session?.user?.email?.toLowerCase();
    if (role === "admin" || em === ADMIN_EMAIL) {
      items.push({ id: "admin", icon: "⚙️", label: "Admin", shortLabel: "Admin", color: "#7c3aed" });
    }
    return items;
  }, [profile?.role, session?.user?.email]);
  const allowedCoachViews = useMemo(() => new Set(coachNavItems.map((item) => item.id)), [coachNavItems]);

  const S = styles;

  const updateNewAthleteField = (field, value) => {
    setNewAthlete(prev => ({ ...prev, [field]: value }));
  };

  const coachCodeFromId = useCallback((userId) => String(userId || "").replace(/-/g, "").slice(0, 8).toUpperCase(), []);

  const resolveCoachIdByCode = useCallback(async (codeInput) => {
    const codigoIngresado = String(codeInput || "").trim();
    if (!codigoIngresado) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, role, name")
      .eq("coach_id", codigoIngresado.trim().toUpperCase())
      .maybeSingle();
    if (error) {
      console.error("Error resolviendo código de coach:", error);
      return null;
    }
    return data?.user_id || null;
  }, []);

  const sendAthleteInvitation = useCallback(async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !session?.user?.id) {
      notify("Completa el email del atleta.");
      return;
    }
    setInviteSending(true);
    try {
      const code =
        (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const inviteLink = `https://pace-forge-eta.vercel.app?invite=${encodeURIComponent(code)}`;
      const { error: insError } = await supabase.from("invitations").insert({
        coach_id: session.user.id,
        email,
        code,
        status: "pending",
      });
      if (insError) {
        console.error("Error guardando invitación:", insError);
        notify(insError.message || "No se pudo guardar la invitación.");
        return;
      }
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          subject: "Invitación para entrenar en RunningApexFlow",
          html: `<div style="font-family:Arial,sans-serif"><h2>¡Tu coach te invitó! 🏃</h2><p>Haz clic aquí para registrarte y vincularte automáticamente:</p><p><a href="${inviteLink}">${inviteLink}</a></p></div>`,
        }),
      });
      notify("Invitación enviada ✓");
      setInviteModalOpen(false);
      setInviteEmail("");
    } catch (e) {
      console.error("sendAthleteInvitation:", e);
      notify("No se pudo enviar la invitación.");
    } finally {
      setInviteSending(false);
    }
  }, [inviteEmail, notify, session?.user?.id]);

  useEffect(() => {
    let mounted = true;
    const bootstrapAuth = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error leyendo sesión:", error);
      }
      if (mounted) {
        setSession(data?.session ?? null);
        setAuthLoading(false);
      }
    };

    bootstrapAuth();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const invite = (params.get("invite") || "").trim();
    if (!invite) return;
    setInviteCodeFromUrl(invite);
    setAuthMode("register");
    setAuthRole("athlete");
    setLandingAuthOpen(true);
  }, []);

  useEffect(() => {
    setViewRestored(false);
  }, [session?.user?.id]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!session?.user) {
        setProfile(null);
        return;
      }
      setProfileLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) {
        console.error("Error cargando perfil:", error);
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const syncCoachPlanIfNeeded = async (prof) => {
        if (!prof || prof.role !== "coach") return prof;
        if (prof.plan_status === "trial" && prof.trial_started_at) {
          const start = new Date(prof.trial_started_at);
          if (!Number.isNaN(start.getTime()) && Date.now() > start.getTime() + COACH_PROFILE_TRIAL_DAYS * 86400000) {
            const { data: upd, error: upErr } = await supabase
              .from("profiles")
              .update({ plan_status: "blocked" })
              .eq("user_id", prof.user_id)
              .select()
              .maybeSingle();
            if (upErr) console.error("syncCoachPlanIfNeeded blocked:", upErr);
            return upd || { ...prof, plan_status: "blocked" };
          }
        }
        return prof;
      };

      if (data == null) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const roleMissing = data.role == null || String(data.role).trim() === "";
      if (roleMissing) {
        const u = session.user;
        const displayName =
          (typeof u.user_metadata?.full_name === "string" && u.user_metadata.full_name.trim()) ||
          (u.email ? u.email.split("@")[0] : "") ||
          "Coach";
        const nowIso = new Date().toISOString();
        const payload = {
          user_id: u.id,
          role: "coach",
          name: (typeof data?.name === "string" && data.name.trim()) || displayName,
          coach_id: null,
          plan_status: "trial",
          trial_started_at: nowIso,
        };
        const { data: saved, error: upErr } = await supabase
          .from("profiles")
          .insert(payload)
          .select()
          .single();
        if (upErr) {
          console.error("Error creando perfil coach por defecto (completo):", {
            message: upErr.message,
            details: upErr.details,
            hint: upErr.hint,
            code: upErr.code,
            status: upErr.status,
            fullError: upErr,
          });
          setProfile(data ?? null);
        } else {
          console.log("Perfil coach creado/actualizado (sin role previo):", saved?.user_id);
          setProfile(await syncCoachPlanIfNeeded(saved));
        }
      } else {
        console.log("Perfil cargado, role:", data.role);
        setProfile(await syncCoachPlanIfNeeded(data));
      }
      setProfileLoading(false);
    };

    loadProfile();
  }, [session]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !profile || profile.role === "athlete" || viewRestored) return;
    const saved = localStorage.getItem("raf_lastView");
    if (saved && allowedCoachViews.has(saved)) {
      setView(saved);
    }
    setViewRestored(true);
  }, [session?.user?.id, profile, viewRestored, allowedCoachViews]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPublicCoaches(true);
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("user_id, full_name, city, country, avatar_url, is_public")
        .eq("is_public", true)
        .order("updated_at", { ascending: false })
        .limit(12);
      if (cancelled) return;
      if (error) {
        console.error("Error cargando coaches públicos:", error);
        setPublicCoaches([]);
      } else {
        setPublicCoaches(data || []);
      }
      setLoadingPublicCoaches(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    (async () => {
      const tok = await refreshFcmTokenIfGranted();
      if (cancelled || !tok) return;
      await supabase.from("profiles").update({ fcm_token: tok }).eq("user_id", session.user.id).limit(1);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session) return undefined;
    let unsub = () => {};
    (async () => {
      const m = await initMessaging();
      if (!m) return;
      unsub = onMessage(m, (payload) => {
        const t = payload.notification?.title;
        notify(t || "Nuevo mensaje");
      });
    })();
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [session, notify]);

  useEffect(() => {
    const em = session?.user?.email?.toLowerCase();
    const role = profile?.role;
    if (view === "admin" && role !== "admin" && em !== ADMIN_EMAIL) {
      setView("dashboard");
    }
    if (view === "admin-coaches" && role !== "admin") {
      setView("dashboard");
    }
  }, [view, session?.user?.email, profile?.role]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !profile || profile.role === "athlete" || !viewRestored) return;
    localStorage.setItem("raf_lastView", view);
  }, [view, session?.user?.id, profile, viewRestored]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && session?.user?.id && profile?.role !== "athlete") {
        const saved = localStorage.getItem("raf_lastView");
        if (saved && allowedCoachViews.has(saved)) setView(saved);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session?.user?.id, profile?.role, allowedCoachViews]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("strava_code");
    const athleteIdFromState = params.get("state");
    console.log("[STRAVA CALLBACK][App] search params", {
      search: window.location.search,
      has_code: Boolean(code),
      state: athleteIdFromState,
    });
    if (!code) return;
    const currentAthlete =
      (athleteIdFromState
        ? (athletes || []).find((a) => String(a.id) === String(athleteIdFromState))
        : null) ||
      selectedAthlete ||
      (athletes || [])[0] ||
      null;
    if (!currentAthlete?.id) {
      console.log("[STRAVA CALLBACK][App] no athlete id found");
      return;
    }
    console.log("[STRAVA CALLBACK][App] processing athlete", {
      athlete_id: currentAthlete.id,
      athlete_name: currentAthlete.name,
      callback_url_expected: STRAVA_CALLBACK_URL,
    });
    let cancelled = false;
    (async () => {
      try {
        console.log("[STRAVA CALLBACK][App] requesting /api/strava token exchange");
        const r = await fetch(`/api/strava?code=${encodeURIComponent(code)}`);
        const data = await r.json();
        console.log("[STRAVA CALLBACK][App] raw JSON", JSON.stringify(data));
        console.log("[STRAVA CALLBACK][App] /api/strava response", {
          status: r.status,
          ok: r.ok,
          data,
          callback_url_expected: STRAVA_CALLBACK_URL,
        });
        if (!r.ok || !data?.access_token) {
          notify("No se pudo conectar Strava.");
          return;
        }
        const payload = {
          athlete_id: currentAthlete.id,
          athlete_id_strava: data.athlete?.id ?? null,
          access_token: data.access_token ?? null,
          refresh_token: data.refresh_token ?? null,
          expires_at: data.expires_at ?? null,
          strava_athlete_name:
            (typeof data.athlete?.name === "string" && data.athlete.name.trim()) ||
            `${data.athlete?.firstname || ""} ${data.athlete?.lastname || ""}`.trim() ||
            null,
        };
        const { error } = await supabase.from("strava_connections").upsert(payload, { onConflict: "athlete_id" });
        if (error) {
          console.error("Error guardando conexión Strava:", error);
          notify(error.message || "No se pudo guardar la conexión Strava.");
          return;
        }
        console.log("[STRAVA CALLBACK][App] strava_connections upsert OK", payload);
        setStravaRefreshTick((n) => n + 1);
        notify("✅ Strava conectado exitosamente");
      } catch (e) {
        console.error("Error conectando Strava en App:", e);
        notify("No se pudo completar la conexión de Strava.");
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, "", "/");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAthlete?.id, athletes, notify]);

  useEffect(() => {
    const loadAthletes = async () => {
      if (!session) {
        setAthletes([]);
        setLoadingAthletes(false);
        return;
      }
      setLoadingAthletes(true);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error("Error obteniendo usuario para filtrar atletas:", userError);
        notify("Error cargando atletas");
        setAthletes([]);
        setLoadingAthletes(false);
        return;
      }
      const coachId = userData.user.id;
      const { data, error } = await supabase
        .from("athletes")
        .select("*")
        .eq("coach_id", coachId)
        .order("id", { ascending: true });
      if (error) {
        notify("Error cargando atletas");
        setAthletes([]);
      } else {
        setAthletes((data || []).map(normalizeAthlete));
      }
      setLoadingAthletes(false);
    };

    loadAthletes();
  }, [session]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    if (!authEmail.trim() || !authPassword.trim()) {
      alert("Completa email y contraseña.");
      return;
    }
    if (authMode === "register") {
      if (!authRole) {
        alert("Selecciona si eres coach o atleta.");
        return;
      }
      if (!authName.trim()) {
        alert("Completa tu nombre.");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const blockedDomains = ["test.com", "fake.com", "example.com", "correo.com", "mail.com", "temp.com", "yopmail.com"];
      const emailDomain = authEmail.trim().toLowerCase().split("@")[1];
      if (!emailRegex.test(authEmail.trim()) || blockedDomains.includes(emailDomain)) {
        setAuthError("Por favor ingresa un correo electrónico válido.");
        return;
      }
    }

    setAuthSubmitting(true);
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) {
          console.error("Error en login:", error);
          alert(`Error en login: ${error.message}`);
          return;
        }
        await syncFcmTokenToProfile();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) {
          console.error("Error en registro:", error);
          alert(`Error en registro: ${error.message}`);
          return;
        }

        const newUserId = data?.user?.id;
        if (!newUserId) {
          console.log("signUp completado pero no devolvió user. data:", data);
          alert("Registro exitoso. Revisa tu correo si la verificación está habilitada.");
          setAuthMode("login");
          return;
        }

        let linkedCoachId = authRole === "coach" ? newUserId : null;
        let inviteRow = null;
        if (authRole === "athlete") {
          if (inviteCodeFromUrl) {
            const { data: inv, error: invErr } = await supabase
              .from("invitations")
              .select("*")
              .eq("code", inviteCodeFromUrl)
              .eq("status", "pending")
              .maybeSingle();
            if (invErr) {
              console.error("Error consultando invitación:", invErr);
            }
            if (inv) {
              const inviteEmail = String(inv.email || "").trim().toLowerCase();
              const regEmail = authEmail.trim().toLowerCase();
              if (inviteEmail && inviteEmail !== regEmail) {
                alert("Este link de invitación fue emitido para otro email.");
                setAuthSubmitting(false);
                return;
              }
              linkedCoachId = inv.coach_id || null;
              inviteRow = inv;
            }
          } else if (authCoachCode.trim()) {
            const coachIdFromCode = await resolveCoachIdByCode(authCoachCode);
            if (!coachIdFromCode) {
              alert("No encontramos un coach con ese código.");
              setAuthSubmitting(false);
              return;
            }
            linkedCoachId = coachIdFromCode;
          }
        }

        const nowIso = new Date().toISOString();
        const profilePayload =
          authRole === "coach"
            ? {
                user_id: newUserId,
                role: "coach",
                coach_id: linkedCoachId,
                name: authName.trim(),
                plan_status: "trial",
                trial_started_at: nowIso,
              }
            : {
                user_id: newUserId,
                role: authRole,
                coach_id: linkedCoachId,
                name: authName.trim(),
              };

        const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
        if (profileError) {
          console.log("Error insertando en profiles:", profileError, { profilePayload });
        } else {
          console.log("Perfil creado en profiles:", { user_id: newUserId, role: authRole });
          if (authRole === "athlete") {
            setProfile({ user_id: newUserId, role: "athlete", name: authName.trim() });
          }
          await syncFcmTokenToProfile();
        }

        if (authRole === "coach" || authRole === "admin") {
          const cpPayload = {
            user_id: newUserId,
            full_name: authName.trim(),
            email: authEmail.trim().toLowerCase(),
            trial_start: new Date().toISOString(),
            trial_days: 10,
            subscription_status: "trial",
            approved_by_admin: false,
            registered_at: new Date().toISOString(),
          };
          const { error: cpErr } = await supabase.from("coach_profiles").insert(cpPayload);
          if (cpErr) console.error("Error creando coach_profiles en registro:", cpErr);
        }

        if (authRole === "athlete") {
          const athletePayload = {
            name: authName.trim(),
            email: authEmail.trim().toLowerCase(),
            goal: "Objetivo pendiente",
            pace: "Pendiente",
            weekly_km: 0,
            coach_id: linkedCoachId,
            user_id: newUserId,
          };
          const { data: athleteRow, error: athleteErr } = await supabase.from("athletes").insert(athletePayload).select().maybeSingle();
          if (athleteErr) {
            console.error("Error creando athlete al registrar:", athleteErr);
          } else if (pendingCoachRequestId && athleteRow?.id) {
            await supabase.from("coach_requests").upsert(
              {
                athlete_id: athleteRow.id,
                coach_id: pendingCoachRequestId,
                status: "pending",
              },
              { onConflict: "athlete_id,coach_id" },
            );
            setPendingCoachRequestId("");
          }
        }

        if (inviteRow?.id) {
          await supabase
            .from("invitations")
            .update({ status: "accepted", accepted_at: new Date().toISOString() })
            .eq("id", inviteRow.id);
          setInviteCodeFromUrl("");
          if (typeof window !== "undefined") {
            window.history.replaceState({}, "", "/");
          }
        }

        alert("Registro exitoso. Revisa tu correo si la verificación está habilitada.");
        setAuthMode("login");
        setAuthRole("");
        setAuthName("");
        setAuthCoachCode("");
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error al cerrar sesión:", error);
      alert(`Error al cerrar sesión: ${error.message}`);
    }
    setLandingAuthOpen(false);
    setDemoModalOpen(false);
    setAuthMode("login");
  };

  const saveNewAthlete = async () => {
    const name = newAthlete.name.trim();
    const email = newAthlete.email.trim();
    const goal = newAthlete.goal.trim();
    const pace = newAthlete.pace.trim();
    const weeklyKm = Number(newAthlete.weekly_km);

    if (!name || !email || !goal || !pace || !Number.isFinite(weeklyKm) || weeklyKm <= 0) {
      notify("Completa todos los campos ✓");
      return;
    }

    const rawPlan = String(profile?.subscription_plan || athletes?.find((a) => a.plan)?.plan || "Basico").toLowerCase();
    const isBasicPlan = rawPlan === "basico" || rawPlan === "básico" || rawPlan === "starter";
    if (isBasicPlan && athletes.length >= 15) {
      const limitMsg = "Has alcanzado el límite de tu plan. Actualiza al plan Pro para agregar más atletas.";
      setPlanLimitWarning(limitMsg);
      notify(limitMsg);
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      console.error("Error obteniendo usuario para guardar atleta:", userError);
      alert(userError?.message || "No se pudo obtener el usuario autenticado.");
      notify("Error al guardar atleta");
      return;
    }

    const payload = { name, email, goal, pace, weekly_km: weeklyKm, coach_id: userData.user.id };
    const { data, error } = await supabase.from("athletes").insert(payload).select().single();
    if (error) {
      const errorText = [
        "Error al guardar atleta en Supabase:",
        `message: ${error.message || "N/A"}`,
        `details: ${error.details || "N/A"}`,
        `hint: ${error.hint || "N/A"}`,
        `code: ${error.code || "N/A"}`,
      ].join("\n");
      console.error(errorText, error);
      alert(errorText);
      notify("Error al guardar atleta");
      return;
    }

    setAthletes(prev => [normalizeAthlete(data), ...prev]);

    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
    setPlanLimitWarning("");
    notify("Atleta agregado ✓");
  };

  const cancelAddAthleteForm = () => {
    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  };

  const handleDeleteAthlete = async (athleteRow) => {
    if (!athleteRow?.id) return;
    const name = athleteRow.name || "este atleta";
    if (!window.confirm(`¿Eliminar a ${name}? Se borrarán sus mensajes y workouts asociados. Esta acción no se puede deshacer.`)) {
      return;
    }
    const id = athleteRow.id;
    const { error: mErr } = await supabase.from("messages").delete().eq("athlete_id", id);
    if (mErr) console.warn("messages delete:", mErr);
    const { error: wErr } = await supabase.from("workouts").delete().eq("athlete_id", id);
    if (wErr) console.warn("workouts delete:", wErr);
    const { error } = await supabase.from("athletes").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert(`No se pudo eliminar: ${error.message}`);
      return;
    }
    setAthletes((prev) => prev.filter((a) => String(a.id) !== String(id)));
    setSelectedAthlete((prev) => (prev && String(prev.id) === String(id) ? null : prev));
    setWorkoutsRefresh((r) => r + 1);
    notify("Atleta eliminado");
  };

  if (authLoading) {
    return (
      <div style={S.root}>
        <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <h1 style={S.pageTitle}>Cargando sesión...</h1>
        </main>
      </div>
    );
  }

  if (!session) {
    if (landingAuthOpen) {
      return (
        <div style={S.root}>
          <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
            <div style={{ ...S.card, width: 360 }}>
              <h1 style={{ ...S.pageTitle, fontSize: "1.3em", marginBottom: 16 }}>
                {authMode === "login" ? "Login" : "Registro"}
              </h1>
              <form onSubmit={handleAuthSubmit}>
                {authMode === "register" && (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>¿Qué eres?</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setAuthRole("coach")}
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: authRole === "coach" ? "2px solid #f59e0b" : "1px solid rgba(148,163,184,.4)",
                            background: authRole === "coach" ? "rgba(245,158,11,.15)" : "#f1f5f9",
                            color: "#0f172a",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontWeight: 800,
                            fontSize: ".8em",
                          }}
                        >
                          Soy coach
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuthRole("athlete")}
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: authRole === "athlete" ? "2px solid #3b82f6" : "1px solid rgba(148,163,184,.4)",
                            background: authRole === "athlete" ? "rgba(59,130,246,.15)" : "#f1f5f9",
                            color: "#0f172a",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontWeight: 800,
                            fontSize: ".8em",
                          }}
                        >
                          Soy atleta
                        </button>
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre</div>
                      <input
                        type="text"
                        value={authName}
                        onChange={e => setAuthName(e.target.value)}
                        placeholder="Tu nombre completo"
                        style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                    {authRole === "athlete" && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Código de tu coach (opcional)</div>
                        <input
                          type="text"
                          value={authCoachCode}
                          onChange={e => setAuthCoachCode(e.target.value.toUpperCase())}
                          placeholder="Ej: A1B2C3D4"
                          style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                        />
                        {inviteCodeFromUrl ? (
                          <div style={{ marginTop: 6, fontSize: ".7em", color: "#b45309", fontWeight: 700 }}>
                            Invitación detectada por link: se priorizará esa vinculación.
                          </div>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Email</div>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={e => {
                      setAuthEmail(e.target.value);
                      if (authError) setAuthError("");
                    }}
                    placeholder="correo@ejemplo.com"
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                  />
                  {authMode === "register" && authError ? (
                    <div style={{ marginTop: 6, fontSize: ".74em", color: "#dc2626", fontWeight: 600 }}>{authError}</div>
                  ) : null}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Contraseña</div>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    placeholder="********"
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={authSubmitting}
                  style={{ width: "100%", background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "10px 14px", color: authSubmitting ? "#334155" : "white", cursor: authSubmitting ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".85em", marginBottom: 10 }}
                >
                  {authSubmitting ? "Procesando..." : (authMode === "login" ? "Iniciar sesión" : "Crear cuenta")}
                </button>
              </form>
              <button
                onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", padding: 0 }}
              >
                {authMode === "login" ? "¿No tienes cuenta? Ir a Registro" : "¿Ya tienes cuenta? Ir a Login"}
              </button>
            </div>
          </main>
        </div>
      );
    }

    const PLAN_CATALOG = [
      {
        plan: "Basico",
        label: "Básico",
        priceCop: 100000,
        priceUsd: 24,
        maxAthletes: 15,
        description: "Para coaches independientes que quieren profesionalizar su trabajo.",
        benefits: [
          "✓ Hasta 15 atletas",
          "Generador de workouts con IA",
          "Plan 2 semanas renovable",
          "Biblioteca personal de entrenamientos",
          "Chat con atletas",
          "Evaluación VDOT y zonas FC",
          "Exportar PDF",
          "App móvil",
        ],
      },
      {
        plan: "Pro",
        label: "Pro",
        priceCop: 160000,
        priceUsd: 39,
        maxAthletes: null,
        description: "Para coaches y academias que quieren escalar sin límites.",
        benefits: [
          "✓ Atletas ilimitados",
          "Todo lo del Básico",
          "Integración Garmin y COROS",
          "Notificaciones push",
          "Sistema de logros y medallas",
          "Códigos promocionales",
          "Validación de pagos",
          "Soporte prioritario",
          "Panel de administración",
        ],
      },
    ];

    return (
      <div style={S.root}>
        <main style={{ ...S.page, width: "100%" }}>
          <div style={{ marginTop: 10, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <span style={{ fontSize: "2.1em", color: "#f59e0b", lineHeight: 1 }} aria-hidden>▲</span>
              <div style={{ fontSize: "1.35em", fontWeight: 800, letterSpacing: ".05em", color: "#0f172a" }}>
                RUNNING<span style={{ color: "#f59e0b" }}>APEX</span>FLOW
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 720 }}>
                <div style={{ fontSize: "0.9em", color: "#f59e0b", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
                  {BRAND_NAME} · Coach Platform
                </div>
                <h1 style={{ fontSize: "2.2em", fontWeight: 900, color: "#0f172a", margin: "0 0 8px" }}>
                  La plataforma de coaching para todo tipo de runners
                </h1>
                <p style={{ color: "#94a3b8", fontSize: ".95em", marginTop: 0 }}>
                  Crea, asigna y sincroniza entrenamientos con IA. Conecta con Garmin y COROS. Lleva a tus atletas al siguiente nivel.
                </p>
                <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => { setAuthMode("register"); setAuthRole("athlete"); setLandingAuthOpen(true); }}
                    style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "12px 16px", color: "white", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".9em" }}
                  >
                    Regístrate aquí como atleta
                  </button>
                </div>
              </div>
              <div style={{ minWidth: 320, flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: ".75em", color: "#94a3b8", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, marginBottom: 10 }}>
                  Vista previa
                </div>
                <div style={{ fontSize: "1.2em", fontWeight: 800, color: "#f59e0b", marginBottom: 8 }}>
                  Dashboard + Planes + IA
                </div>
                <div style={{ color: "#64748b", fontSize: ".9em" }}>
                  Asignación de workouts con IA, calendario y sincronización con dispositivos.
                </div>
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                  {[
                    { t: "IA", c: "#f59e0b", s: "Workouts inteligentes" },
                    { t: "Garmin", c: "#3b82f6", s: "Sync & seguimiento" },
                    { t: "COROS", c: "#22c55e", s: "Conexión flexible" },
                    { t: "Strava", c: "#f97316", s: "Sincroniza tus actividades de Apple Watch, Garmin y más dispositivos automáticamente" },
                  ].map((x) => (
                    <div key={x.t} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: "1.2em", fontWeight: 900, color: x.c, fontFamily: "monospace" }}>{x.t}</div>
                      <div style={{ color: "#94a3b8", fontSize: ".8em", marginTop: 6 }}>{x.s}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Encuentra tu coach
            </div>
            {loadingPublicCoaches ? (
              <div style={{ ...S.card, color: "#64748b", fontSize: ".88em" }}>Cargando coaches públicos…</div>
            ) : publicCoaches.length === 0 ? (
              <div style={{ ...S.card, color: "#64748b", fontSize: ".88em" }}>Aún no hay coaches públicos disponibles.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
                {publicCoaches.map((c) => (
                  <div key={c.user_id} style={{ ...S.card, padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {c.avatar_url ? <img src={c.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "👤"}
                      </div>
                      <div>
                        <div style={{ color: "#0f172a", fontWeight: 800, fontSize: ".9em" }}>{c.full_name || "Coach"}</div>
                        <div style={{ color: "#64748b", fontSize: ".75em" }}>{[c.city, c.country].filter(Boolean).join(", ") || "Ubicación no especificada"}</div>
                      </div>
                    </div>
                    <div style={{ color: "#64748b", fontSize: ".78em", marginBottom: 12 }}>
                      Código: <strong>{coachCodeFromId(c.user_id)}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingCoachRequestId(c.user_id);
                        setAuthCoachCode(coachCodeFromId(c.user_id));
                        setAuthMode("register");
                        setAuthRole("athlete");
                        setLandingAuthOpen(true);
                      }}
                      style={{ width: "100%", background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "9px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
                    >
                      Solicitar unirme
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Features
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }}>
              {[
                { title: "Generador IA", body: "Crea entrenamientos en segundos y ajusta estructura, ritmos y fases." },
                { title: "Sync con relojes", body: "Exporta y sincroniza para que tu atleta entrene con precisión." },
                { title: "Seguimiento real", body: "Marca “done”, mide progreso y mantén el control del plan." },
              ].map((f) => (
                <div key={f.title} style={{ ...S.card, padding: 18 }}>
                  <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>{f.title}</div>
                  <div style={{ color: "#94a3b8", fontSize: ".9em", lineHeight: 1.35 }}>{f.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Precios
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
              {PLAN_CATALOG.map((p) => (
                <div key={p.plan} style={{ ...S.card, padding: 18 }}>
                  <div style={{ fontSize: "1.25em", fontWeight: 900, color: "#f59e0b" }}>
                    {p.label} (${p.priceUsd} USD)
                  </div>
                  <div style={{ fontSize: "2em", fontWeight: 900, color: "#f59e0b", fontFamily: "monospace", marginTop: 6 }}>
                    {`$${Number(p.priceCop).toLocaleString("es-CO")}`}
                    <span style={{ fontSize: ".55em", color: "#64748b", fontFamily: "inherit", marginLeft: 6 }}>COP</span>
                  </div>
                  <div style={{ color: "#64748b", fontSize: ".88em", marginTop: 8, lineHeight: 1.45 }}>{p.description}</div>
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    {(p.benefits || []).map((benefit) => (
                      <div key={benefit} style={{ color: "#334155", fontSize: ".82em", display: "flex", alignItems: "flex-start", gap: 6, lineHeight: 1.35 }}>
                        <span style={{ color: "#22c55e", fontWeight: 900 }}>✓</span>
                        <span>{benefit}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => { setAuthMode("register"); setAuthRole("coach"); setLandingAuthOpen(true); }}
                      style={{ width: "100%", background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 14px", color: "white", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".85em" }}
                    >
                      Regístrate aquí como coach
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Testimonios
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
              {[
                { name: "Sofía Ríos", role: "Coach en Colombia", body: `Con ${BRAND_NAME}, la IA me ayuda a construir semanas completas. Ver el estado “done” en el calendario hace que mis atletas sigan el plan con claridad.` },
                { name: "Luis Martínez", role: "Coach en México", body: "Ahora asigno workouts en minutos y sincronizo con relojes. La vista semanal hace que todo sea más transparente." },
                { name: "María Torres", role: "Coach en España", body: "El seguimiento real y la exportación a dispositivos me permiten ajustar ritmos con confianza. Se nota el progreso semana a semana." },
              ].map((t) => (
                <div key={t.name} style={{ ...S.card, padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: "1.05em", fontWeight: 900, color: "#0f172a" }}>{t.name}</div>
                      <div style={{ color: "#64748b", fontSize: ".85em" }}>{t.role}</div>
                    </div>
                    <div style={{ color: "#f59e0b", fontWeight: 900, fontFamily: "monospace" }}>★★★★★</div>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: ".92em", marginTop: 12, lineHeight: 1.35 }}>{t.body}</div>
                </div>
              ))}
            </div>
          </div>

          <footer style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid #e2e8f0", color: "#64748b", fontSize: ".85em" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#0f172a", fontWeight: 900 }}>
                <span style={{ color: "#f59e0b" }} aria-hidden>▲</span>
                {BRAND_NAME}
              </div>
              <div>© 2026</div>
            </div>
          </footer>
        </main>

        {demoModalOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }}>
            <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, marginBottom: 6 }}>Demo simulada</div>
              <div style={{ color: "#94a3b8", fontSize: ".9em", marginBottom: 14 }}>
                En esta demo verás cómo, con {BRAND_NAME}, un coach crea entrenamientos con IA, los asigna al atleta y marca progreso en el calendario.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setDemoModalOpen(false)}
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".82em" }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div style={S.root}>
        <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <h1 style={S.pageTitle}>Cargando perfil...</h1>
        </main>
      </div>
    );
  }

  if (profile && profile.role === "athlete") {
    console.log("Renderizando vista AthleteHome para role=athlete");
    return <AthleteHome profile={profile} />;
  }

  const isCoachUi = Boolean(profile && profile.role !== "athlete");
  const sessionEmailLower = session?.user?.email?.toLowerCase() ?? "";
  const sessionUserId = session?.user?.id ?? "";
  const isProfilesAdmin = profile?.role === "admin";
  const coachPlanBlockedUi =
    profile?.role === "coach" && profile?.plan_status === "blocked" && !isProfilesAdmin;

  const trialBannerDays =
    profile?.role === "coach" ? coachTrialDaysRemainingFromStart(profile) : null;
  const showTrialBanner =
    profile?.role === "coach" &&
    profile?.plan_status === "trial" &&
    trialBannerDays != null &&
    trialBannerDays > 0 &&
    !coachPlanBlockedUi;

  const goCoachView = (id) => {
    setView(id);
    setSelectedAthlete(null);
    setShowAddAthleteForm(false);
  };

  return (
    <div style={S.root}>
      {notification && <div style={S.notification}>✓ {notification}</div>}
      {inviteModalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 460, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>📧 Invitar Atleta</div>
            <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 8 }}>Email del atleta</div>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="atleta@email.com"
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
            />
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setInviteModalOpen(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
              <button
                type="button"
                onClick={sendAthleteInvitation}
                disabled={inviteSending}
                style={{ background: inviteSending ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: inviteSending ? "#64748b" : "#fff", cursor: inviteSending ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
              >
                {inviteSending ? "Enviando..." : "Enviar invitación"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <aside className="pf-sidebar-desktop" style={S.sidebar}>
        <div style={S.logo}>
          <span style={{ fontSize: "1.5em", color: "#f59e0b", width: 26, textAlign: "center" }} aria-hidden>▲</span>
          <div>
            <div style={S.logoTitle}>
              RUNNING<span style={{ color: "#f59e0b" }}>APEX</span>FLOW
            </div>
            <div style={S.logoSub}>Coach Platform</div>
          </div>
        </div>
        <nav style={{ flex: 1, paddingTop: 8 }}>
          {coachNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goCoachView(item.id)}
              style={{ ...S.navBtn, ...(view === item.id ? S.navBtnActive : {}) }}
            >
              <span style={{ fontSize: "1.15em", color: item.color, width: 22, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div style={S.sidebarFooter}>
          <div style={{ fontSize: ".82em", color: "#64748b", fontWeight: 600 }}>
            👤 {profile?.name || session?.user?.email?.split("@")[0] || "Coach"}
          </div>
          <div style={{ fontSize: ".7em", color: "#94a3b8", marginTop: 4 }}>
            {athletes.length} atletas · {athletes.reduce((a, b) => a + b.weekly_km, 0)} km
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              marginTop: 10,
              width: "100%",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "9px 10px",
              color: "#dc2626",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".78em",
              fontWeight: 700,
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main
        className="pf-main-mobile-pad"
        style={{ flex: 1, overflowY: "auto", background: "#f8fafc", position: "relative" }}
      >
        {coachPlanBlockedUi ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 40,
              background: "rgba(15, 23, 42, 0.78)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              textAlign: "center",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                maxWidth: 440,
                background: "#fff",
                borderRadius: 16,
                padding: "28px 24px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 8px 30px rgba(15,23,42,.08)",
              }}
            >
              <div style={{ fontSize: "2em", marginBottom: 12 }}>⏱</div>
              <h1 style={{ ...S.pageTitle, fontSize: "1.2em", marginBottom: 14, lineHeight: 1.35 }}>
                Tu período de prueba ha vencido. Contacta al administrador para activar tu cuenta.
              </h1>
              <a
                href={`https://wa.me/${ADMIN_WHATSAPP_E164}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 8,
                  padding: "12px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg,#22c55e,#16a34a)",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: ".9em",
                  textDecoration: "none",
                }}
              >
                📲 Contactar admin
              </a>
            </div>
          </div>
        ) : null}
        {typeof Notification !== "undefined" &&
          session &&
          Notification.permission !== "granted" &&
          !pushInviteDismissed && (
            <div
              style={{
                margin: "12px 16px 0",
                padding: "12px 16px",
                borderRadius: 12,
                background: "#fffbeb",
                border: "1px solid #fde68a",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              }}
            >
              <span style={{ flex: "1 1 200px", color: "#78350f", fontSize: ".88em", fontWeight: 600 }}>
                Activa las notificaciones para recibir mensajes
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    if (typeof localStorage !== "undefined") localStorage.removeItem("raf_push_invite_dismissed");
                    await syncFcmTokenToProfile();
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "linear-gradient(135deg,#b45309,#f59e0b)",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: ".8em",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Activar
                </button>
                <button
                  type="button"
                  onClick={dismissPushInvite}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: "#fff",
                    color: "#64748b",
                    fontWeight: 700,
                    fontSize: ".8em",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Ahora no
                </button>
              </div>
            </div>
          )}
        {showTrialBanner ? (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 25,
              margin: "0 0 0",
              padding: "12px 16px",
              background: "linear-gradient(90deg, rgba(245,158,11,.22), rgba(251,191,36,.16))",
              borderBottom: "1px solid rgba(245,158,11,.45)",
              color: "#92400e",
              fontSize: ".82em",
              fontWeight: 700,
              boxShadow: "0 2px 8px rgba(15,23,42,.06)",
            }}
          >
            ⏳ Período de prueba: {trialBannerDays} día{trialBannerDays === 1 ? "" : "s"} restantes
          </div>
        ) : null}
        {loadingAthletes ? (
          <div style={S.page}>
            <h1 style={S.pageTitle}>Cargando atletas...</h1>
          </div>
        ) : (
          <>
        {view === "dashboard" && (
          <Dashboard
            coachUserId={session?.user?.id ?? null}
            onSelect={a => { setSelectedAthlete(a); setView("athletes"); setShowAddAthleteForm(false); }}
            onRequestAddAthlete={() => setShowAddAthleteForm(true)}
            showAddAthleteForm={showAddAthleteForm}
            planLimitWarning={planLimitWarning}
            onGoToPlans={() => setView("plans")}
            onDismissPlanLimitWarning={() => setPlanLimitWarning("")}
            newAthlete={newAthlete}
            onChangeNewAthleteField={updateNewAthleteField}
            onSaveNewAthlete={saveNewAthlete}
            onCancelAddAthlete={cancelAddAthleteForm}
          />
        )}
        {view === "athletes" && (
          <Athletes
            athletes={athletes}
            selected={selectedAthlete}
            onSelect={setSelectedAthlete}
            workoutsRefresh={workoutsRefresh}
            onAthleteWorkoutsDoneSync={(athleteId, workoutsDone) => {
              setAthletes(prev => prev.map(a => (String(a.id) === String(athleteId) ? { ...a, workouts_done: workoutsDone } : a)));
              setSelectedAthlete(prev => (prev && String(prev.id) === String(athleteId) ? { ...prev, workouts_done: workoutsDone } : prev));
            }}
            onAthleteFcSync={(athleteId, fc_max, fc_reposo) => {
              setAthletes((prev) =>
                prev.map((a) => (String(a.id) === String(athleteId) ? normalizeAthlete({ ...a, fc_max, fc_reposo }) : a)),
              );
              setSelectedAthlete((prev) =>
                prev && String(prev.id) === String(athleteId) ? normalizeAthlete({ ...prev, fc_max, fc_reposo }) : prev,
              );
            }}
            coachDisplayName={
              profile?.name ||
              session?.user?.user_metadata?.full_name ||
              (session?.user?.email ? session.user.email.split("@")[0] : null) ||
              "Coach"
            }
            onDeleteAthlete={handleDeleteAthlete}
            notify={notify}
            onOpenInviteModal={() => setInviteModalOpen(true)}
          />
        )}
        {view === "evaluation" && (
          <EvaluationView
            athletes={athletes}
            currentUserId={session?.user?.id ?? null}
            notify={notify}
          />
        )}
        {view === "plans" && <Plans athletes={athletes} notify={notify} />}
        {view === "settings" && (
          <CoachSettings
            coachUserId={session?.user?.id ?? null}
            sessionEmail={session?.user?.email ?? ""}
            profileName={profile?.name ?? ""}
            athletes={athletes}
            setAthletes={setAthletes}
            stravaRefreshTick={stravaRefreshTick}
            notify={notify}
            onSignOut={handleSignOut}
          />
        )}
        {view === "admin-coaches" && profile?.role === "admin" && (
          <AdminCoachesProfilesPanel notify={notify} adminUserId={PLATFORM_ADMIN_USER_ID} />
        )}
        {view === "admin" && (profile?.role === "admin" || sessionEmailLower === ADMIN_EMAIL) && (
          <AdminPanel notify={notify} />
        )}
        {view === "plan12" && (
          <Plan2Weeks
            athletes={athletes}
            notify={notify}
            coachUserId={session?.user?.id ?? null}
            coachPlan={String(profile?.subscription_plan || athletes?.find((a) => a.plan)?.plan || "Basico")}
            onGoToPlans={() => setView("plans")}
            onPlanAssigned={() => setWorkoutsRefresh((r) => r + 1)}
          />
        )}
        {view === "builder" && (
          <Builder
            athletes={athletes}
            aiPrompt={aiPrompt}
            setAiPrompt={setAiPrompt}
            aiWorkout={aiWorkout}
            setAiWorkout={setAiWorkout}
            aiLoading={aiLoading}
            setAiLoading={setAiLoading}
            notify={notify}
            coachUserId={session?.user?.id ?? null}
            coachPlan={String(profile?.subscription_plan || athletes?.find((a) => a.plan)?.plan || "Basico")}
            onGoToPlans={() => setView("plans")}
            onWorkoutAssigned={() => setWorkoutsRefresh(r => r + 1)}
            onSavedToLibrary={() => setLibraryRefresh((r) => r + 1)}
          />
        )}
        {view === "library" && (
          <WorkoutLibrary
            coachUserId={sessionUserId || null}
            libraryRefresh={libraryRefresh}
            athletes={athletes}
            profileRole={profile?.role ?? ""}
            adminLibraryOwnerId={PLATFORM_ADMIN_USER_ID}
            onUseWorkout={(row) => {
              setAiWorkout(libraryRowToBuilderWorkout(row));
              setView("builder");
              notify("Workout cargado en el generador. Puedes asignarlo a un atleta.");
            }}
            onCopiedGlobalToLibrary={() => setLibraryRefresh((r) => r + 1)}
            notify={notify}
          />
        )}
          </>
        )}
      </main>

      <nav className="pf-bottom-nav" aria-label="Navegación principal">
        {coachNavItems.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={`m-${item.id}`}
              type="button"
              onClick={() => goCoachView(item.id)}
              style={{
                color: active ? "#c2410c" : "#64748b",
                background: active ? "rgba(245, 158, 11, 0.14)" : "transparent",
                fontWeight: active ? 800 : 600,
              }}
            >
              <span className="pf-bnav-icon" style={{ color: item.color }}>
                {item.icon}
              </span>
              <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>{item.shortLabel || item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Dashboard({
  coachUserId,
  onSelect,
  onRequestAddAthlete,
  showAddAthleteForm,
  planLimitWarning,
  onGoToPlans,
  onDismissPlanLimitWarning,
  newAthlete,
  onChangeNewAthleteField,
  onSaveNewAthlete,
  onCancelAddAthlete,
}) {
  const S = styles;
  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekRangeLabel = useMemo(() => {
    const opt = { day: "numeric", month: "long", year: "numeric" };
    return `Semana del ${weekStart.toLocaleDateString("es", opt)} al ${weekEnd.toLocaleDateString("es", opt)}`;
  }, [weekStart, weekEnd]);

  const [dashAthletes, setDashAthletes] = useState([]);
  const [weekWorkouts, setWeekWorkouts] = useState([]);
  const [dashLoading, setDashLoading] = useState(true);

  const loadDashboardData = useCallback(async (silent) => {
    if (!coachUserId) {
      setDashAthletes([]);
      setWeekWorkouts([]);
      setDashLoading(false);
      return;
    }
    if (!silent) setDashLoading(true);
    const ws = formatLocalYMD(weekStart);
    const we = formatLocalYMD(weekEnd);
    const [aRes, wRes] = await Promise.all([
      supabase.from("athletes").select("*").eq("coach_id", coachUserId).order("id", { ascending: true }),
      supabase.from("workouts").select("*").eq("coach_id", coachUserId).gte("scheduled_date", ws).lte("scheduled_date", we),
    ]);
    if (aRes.error) console.error("Dashboard athletes:", aRes.error);
    else setDashAthletes((aRes.data || []).map(normalizeAthlete));
    if (wRes.error) console.error("Dashboard workouts:", wRes.error);
    else setWeekWorkouts((wRes.data || []).map(normalizeWorkoutRow));
    if (!silent) setDashLoading(false);
  }, [coachUserId, weekStart, weekEnd]);

  useEffect(() => {
    loadDashboardData(false);
  }, [loadDashboardData]);

  useEffect(() => {
    if (!coachUserId) return undefined;
    const channel = supabase
      .channel(`dashboard-coach-${coachUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "athletes", filter: `coach_id=eq.${coachUserId}` },
        () => loadDashboardData(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workouts", filter: `coach_id=eq.${coachUserId}` },
        () => loadDashboardData(true),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [coachUserId, loadDashboardData]);

  const totalWeeklyKmTarget = useMemo(
    () => dashAthletes.reduce((sum, a) => sum + (Number(a.weekly_km) || 0), 0),
    [dashAthletes],
  );

  const { weekWorkoutsTotal, weekWorkoutsDone, weekAvgRpe, weekRpeCount } = useMemo(() => {
    const total = weekWorkouts.length;
    const done = weekWorkouts.filter((w) => w.done).length;
    const rpeVals = weekWorkouts.filter((w) => w.done && w.rpe != null).map((w) => w.rpe);
    const avgRpe = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : null;
    return { weekWorkoutsTotal: total, weekWorkoutsDone: done, weekAvgRpe: avgRpe, weekRpeCount: rpeVals.length };
  }, [weekWorkouts]);

  const globalAdherencePct = weekWorkoutsTotal > 0
    ? Math.round((weekWorkoutsDone / weekWorkoutsTotal) * 100)
    : 0;

  const athleteRows = useMemo(() => {
    return dashAthletes.map((a) => {
      const forAthlete = weekWorkouts.filter((w) => String(w.athlete_id) === String(a.id));
      const weekTotal = forAthlete.length;
      const weekDone = forAthlete.filter((w) => w.done).length;
      const adherencePct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;
      const { name: raceName, daysLeft } = getRaceMeta(a.next_race);
      return { athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft };
    });
  }, [dashAthletes, weekWorkouts]);

  const maxWeeklyKm = useMemo(() => {
    const m = Math.max(1, ...dashAthletes.map((a) => Number(a.weekly_km) || 0));
    return m;
  }, [dashAthletes]);

  return (
    <div style={{ ...S.page, display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={S.pageTitle}>Dashboard</h1>
            <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>{weekRangeLabel} · datos en vivo</p>
          </div>
          <button
            onClick={onRequestAddAthlete}
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "10px 14px",
              color: "#0f172a",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            ＋ Nuevo Atleta
          </button>
        </div>
      </div>

      {planLimitWarning ? (
        <div style={{ ...S.card, marginBottom: 16, border: "1px solid rgba(245,158,11,.4)", background: "#fffbeb" }}>
          <div style={{ color: "#92400e", fontSize: ".86em", fontWeight: 700, marginBottom: 10 }}>
            {planLimitWarning}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onDismissPlanLimitWarning}
              style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={onGoToPlans}
              style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
            >
              Ver Planes
            </button>
          </div>
        </div>
      ) : null}

      {showAddAthleteForm && (
        <div style={{ marginBottom: 22, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: ".75em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>
            Nuevo Atleta
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre</div>
              <input
                value={newAthlete.name}
                onChange={e => onChangeNewAthleteField("name", e.target.value)}
                placeholder="Ej: Carlos Rojas"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Email</div>
              <input
                type="email"
                value={newAthlete.email}
                onChange={e => onChangeNewAthleteField("email", e.target.value)}
                placeholder="atleta@correo.com"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Ritmo por km</div>
              <input
                value={newAthlete.pace}
                onChange={e => onChangeNewAthleteField("pace", e.target.value)}
                placeholder="Ej: 5:10/km"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Objetivo</div>
              <input
                value={newAthlete.goal}
                onChange={e => onChangeNewAthleteField("goal", e.target.value)}
                placeholder="Ej: Sub 3:45 Maratón"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Km semanales</div>
              <input
                type="number"
                value={newAthlete.weekly_km}
                onChange={e => onChangeNewAthleteField("weekly_km", e.target.value)}
                placeholder="Ej: 65"
                min="1"
                step="1"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", paddingBottom: 2, textAlign: "right" }}>
                Se agrega con estado “En ruta” y calendario básico.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onCancelAddAthlete}
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "10px 14px",
                color: "#94a3b8",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: ".85em",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={onSaveNewAthlete}
              style={{
                background: "linear-gradient(135deg,#b45309,#f59e0b)",
                border: "none",
                borderRadius: 10,
                padding: "10px 14px",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 800,
                fontSize: ".85em",
              }}
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {dashLoading ? (
        <div style={{ color: "#94a3b8", padding: "24px 0" }}>Cargando métricas desde Supabase…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
            {[
              { label: "Atletas activos", value: dashAthletes.length, sub: "Registrados bajo tu cuenta", icon: "🏃", color: "#f59e0b" },
              { label: "Km objetivo / semana", value: `${totalWeeklyKmTarget} km`, sub: "Suma de weekly_km de tus atletas", icon: "📍", color: "#3b82f6" },
              {
                label: "Adherencia global",
                value: weekWorkoutsTotal ? `${globalAdherencePct}%` : "—",
                sub: weekWorkoutsTotal ? `${weekWorkoutsDone} de ${weekWorkoutsTotal} workouts esta semana` : "Sin entrenamientos programados esta semana",
                icon: "✅",
                color: "#22c55e",
              },
              {
                label: "Carga promedio RPE",
                value: weekAvgRpe != null ? weekAvgRpe.toFixed(1) : "—",
                sub:
                  weekAvgRpe != null
                    ? `Promedio de RPE en sesiones completadas con registro (${weekRpeCount} sesiones)`
                    : "Ningún workout completado con RPE esta semana",
                icon: "📊",
                color: "#a855f7",
              },
            ].map((s, i) => (
              <div key={i} style={S.card}>
                <div style={{ fontSize: "1.8em", marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: "2em", fontWeight: 700, color: s.color, fontFamily: "monospace", lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 6 }}>{s.label}</div>
                <div style={{ fontSize: ".68em", color: "#475569", marginTop: 8, lineHeight: 1.35 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Detalle por atleta</div>
          <div style={{ ...S.card, padding: 0, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82em" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#94a3b8" }}>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Atleta</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Km / sem</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700, minWidth: 160 }}>Adherencia (semana)</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Próxima carrera</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Días restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {athleteRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "20px 14px", color: "#64748b" }}>
                        Aún no hay atletas. Usa «Nuevo Atleta» para comenzar.
                      </td>
                    </tr>
                  ) : (
                    athleteRows.map(({ athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft }) => (
                      <tr
                        key={a.id}
                        onClick={() => onSelect(a)}
                        style={{ borderTop: "1px solid #e2e8f0", cursor: "pointer" }}
                      >
                        <td style={{ padding: "12px 14px", color: "#0f172a", fontWeight: 600 }}>{a.name}</td>
                        <td style={{ padding: "12px 14px", color: "#cbd5e1", fontFamily: "monospace" }}>{a.weekly_km} km</td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 4 }}>
                            {weekTotal ? `${weekDone}/${weekTotal} · ${adherencePct}%` : "Sin workouts esta semana"}
                          </div>
                          <ProgressBar value={weekDone} total={weekTotal || 1} color={adherencePct >= 70 ? "#22c55e" : adherencePct >= 40 ? "#f59e0b" : "#ef4444"} />
                        </td>
                        <td style={{ padding: "12px 14px", color: "#94a3b8", maxWidth: 200 }}>{raceName}</td>
                        <td style={{ padding: "12px 14px", color: "#cbd5e1", fontFamily: "monospace" }}>
                          {daysLeft == null ? "—" : `${daysLeft} ${daysLeft === 1 ? "día" : "días"}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Km semanales por atleta</div>
          <div style={{ ...S.card, padding: "18px 16px 22px" }}>
            {dashAthletes.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos para graficar.</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "flex-start",
                  gap: 10,
                  minHeight: 140,
                  paddingTop: 8,
                }}
              >
                {dashAthletes.map((a) => {
                  const km = Number(a.weekly_km) || 0;
                  const hPct = Math.max(6, (km / maxWeeklyKm) * 100);
                  return (
                    <div
                      key={a.id}
                      style={{
                        flex: "1 1 0",
                        minWidth: 36,
                        maxWidth: 72,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                      }}
                      title={`${a.name}: ${km} km/semana`}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: 110,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          background: "#f8fafc",
                          borderRadius: 8,
                          padding: "0 6px",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            width: "72%",
                            height: `${hPct}%`,
                            maxHeight: "100%",
                            background: "linear-gradient(180deg,#fbbf24,#b45309)",
                            borderRadius: "6px 6px 2px 2px",
                            boxShadow: "0 0 12px rgba(245,158,11,.25)",
                          }}
                        />
                      </div>
                      <div style={{ fontSize: ".62em", color: "#94a3b8", textAlign: "center", lineHeight: 1.2, wordBreak: "break-word" }}>
                        {(a.name || "").split(/\s+/)[0]}
                      </div>
                      <div style={{ fontSize: ".65em", color: "#64748b", fontFamily: "monospace" }}>{km}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Athletes({ athletes, selected, onSelect, workoutsRefresh, onAthleteWorkoutsDoneSync, onAthleteFcSync, coachDisplayName, onDeleteAthlete, notify, onOpenInviteModal }) {
  const S = styles;
  const athlete = (selected ? athletes.find(a => String(a.id) === String(selected.id)) : athletes[0]) || null;
  const [searchQuery, setSearchQuery] = useState("");
  const [workouts, setWorkouts] = useState([]);
  const [loadingWorkouts, setLoadingWorkouts] = useState(false);
  const [fcMaxInput, setFcMaxInput] = useState("");
  const [fcReposoInput, setFcReposoInput] = useState("");
  const [fcSaving, setFcSaving] = useState(false);
  const [coachId, setCoachId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [achievementsCatalog, setAchievementsCatalog] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [achProgress, setAchProgress] = useState(null);
  const [dragWorkoutId, setDragWorkoutId] = useState(null);
  const calendarDragRef = useRef(false);
  const [calendarCtxMenu, setCalendarCtxMenu] = useState(null);
  const calendarCtxMenuRef = useRef(null);
  const [workoutPanel, setWorkoutPanel] = useState(null);
  const [workoutFormSaving, setWorkoutFormSaving] = useState(false);
  const [workoutEditForm, setWorkoutEditForm] = useState({
    title: "",
    type: "easy",
    total_km: "",
    duration_min: "",
    description: "",
    structureRows: [emptyWorkoutStructureRow()],
  });
  const [moveDateInput, setMoveDateInput] = useState("");
  const [athletePayments, setAthletePayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentActionBusyId, setPaymentActionBusyId] = useState(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_method: "Nequi",
    plan: "Basico",
    payment_date: formatLocalYMD(new Date()),
    notes: "",
  });
  const chatScrollRef = useRef(null);
  const normalized = searchQuery.trim().toLowerCase();
  const filteredAthletes = normalized
    ? athletes.filter(a => (a.name || "").toLowerCase().includes(normalized) || (a.goal || "").toLowerCase().includes(normalized))
    : athletes;

  useEffect(() => {
    if (!athlete?.id) {
      setWorkouts([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingWorkouts(true);
      const { data, error } = await supabase
        .from("workouts")
        .select("*")
        .eq("athlete_id", athlete.id)
        .order("scheduled_date", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Error cargando workouts:", error);
        setWorkouts([]);
      } else {
        setWorkouts((data || []).map(normalizeWorkoutRow));
      }
      setLoadingWorkouts(false);
    };
    load();
    return () => { cancelled = true; };
  }, [athlete?.id, workoutsRefresh]);

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      const k = w.scheduled_date;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const calendarCells = useMemo(
    () => getMonthGrid(calendarViewMonth.y, calendarViewMonth.m),
    [calendarViewMonth],
  );
  const calendarMonthLabel = useMemo(
    () =>
      new Date(calendarViewMonth.y, calendarViewMonth.m, 1).toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
      }),
    [calendarViewMonth],
  );

  const [races, setRaces] = useState([]);
  const [raceModalOpen, setRaceModalOpen] = useState(false);
  const [raceSaving, setRaceSaving] = useState(false);
  const [raceForm, setRaceForm] = useState({
    name: "",
    date: formatLocalYMD(new Date()),
    distance: "21K",
    distanceOther: "",
    city: "",
  });
  const [raceCtxMenu, setRaceCtxMenu] = useState(null);
  const raceCtxMenuRef = useRef(null);
  const [racePanel, setRacePanel] = useState(null);
  const [raceEditForm, setRaceEditForm] = useState({
    name: "",
    date: "",
    distance: "21K",
    distanceOther: "",
    city: "",
  });
  const [raceMoveDate, setRaceMoveDate] = useState("");
  const [raceActionBusy, setRaceActionBusy] = useState(false);
  const [chatClearing, setChatClearing] = useState(false);

  const refreshRacesList = useCallback(async () => {
    if (!athlete?.id) return;
    const { data, error } = await supabase
      .from("races")
      .select("*")
      .eq("athlete_id", athlete.id)
      .order("date", { ascending: true });
    if (error) {
      console.error("Error cargando carreras:", error);
      return;
    }
    setRaces((data || []).map(normalizeRaceRow));
  }, [athlete?.id]);

  useEffect(() => {
    if (!athlete?.id) {
      setRaces([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("races")
        .select("*")
        .eq("athlete_id", athlete.id)
        .order("date", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Error cargando carreras:", error);
        setRaces([]);
        return;
      }
      setRaces((data || []).map(normalizeRaceRow));
    })();
    return () => {
      cancelled = true;
    };
  }, [athlete?.id, workoutsRefresh]);

  const racesByDate = useMemo(() => {
    const m = {};
    for (const r of races) {
      const k = r.date;
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(r);
    }
    return m;
  }, [races]);

  const nextRaceCountdown = useMemo(() => getNextRaceCountdown(races, formatLocalYMD(new Date())), [races]);

  const closeRaceCtxMenu = () => setRaceCtxMenu(null);

  const ctxMenuRace = useMemo(
    () => (raceCtxMenu ? races.find((r) => String(r.id) === String(raceCtxMenu.raceId)) || null : null),
    [races, raceCtxMenu],
  );

  const panelRace = useMemo(
    () => (racePanel ? races.find((r) => String(r.id) === String(racePanel.raceId)) || null : null),
    [races, racePanel],
  );

  const openRaceCalendarMenu = (e, race) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const mw = 280;
    const mh = 160;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setRaceCtxMenu({ x, y, raceId: race.id });
  };

  const openRaceEditPanel = (race) => {
    if (!race) return;
    const df = raceDistanceToFormFields(race.distance);
    setRaceEditForm({
      name: race.name || "",
      date: race.date || formatLocalYMD(new Date()),
      ...df,
      city: race.city || "",
    });
    setRacePanel({ mode: "edit", raceId: race.id });
    closeRaceCtxMenu();
  };

  const openRaceMovePanel = (race) => {
    if (!race) return;
    setRaceMoveDate(race.date || formatLocalYMD(new Date()));
    setRacePanel({ mode: "move", raceId: race.id });
    closeRaceCtxMenu();
  };

  const closeRacePanel = () => {
    setRacePanel(null);
    setRaceActionBusy(false);
  };

  const saveRaceEdits = async () => {
    if (!panelRace?.id) return;
    const dist =
      raceEditForm.distance === "Otro"
        ? (raceEditForm.distanceOther || "").trim() || "Otro"
        : raceEditForm.distance;
    if (raceEditForm.distance === "Otro" && !(raceEditForm.distanceOther || "").trim()) {
      notify?.("Describe la distancia (Otro)");
      return;
    }
    setRaceActionBusy(true);
    const { error } = await supabase
      .from("races")
      .update({
        name: raceEditForm.name.trim() || panelRace.name,
        date: raceEditForm.date,
        distance: dist,
        city: raceEditForm.city.trim() || null,
      })
      .eq("id", panelRace.id);
    setRaceActionBusy(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "Error al guardar");
      return;
    }
    notify?.("Carrera actualizada");
    closeRacePanel();
    await refreshRacesList();
  };

  const applyRaceMoveDate = async () => {
    if (!panelRace?.id || !raceMoveDate) return;
    setRaceActionBusy(true);
    const { error } = await supabase.from("races").update({ date: raceMoveDate }).eq("id", panelRace.id);
    setRaceActionBusy(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "Error al mover");
      return;
    }
    notify?.("Fecha actualizada");
    closeRacePanel();
    await refreshRacesList();
  };

  const deleteRaceFromCalendar = async (race) => {
    if (!race?.id) return;
    if (!window.confirm("¿Eliminar esta carrera?")) return;
    closeRaceCtxMenu();
    closeRacePanel();
    setRaceActionBusy(true);
    const { error } = await supabase.from("races").delete().eq("id", race.id);
    setRaceActionBusy(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "No se pudo eliminar");
      return;
    }
    notify?.("Carrera eliminada");
    await refreshRacesList();
  };

  useEffect(() => {
    if (!raceCtxMenu) return;
    const onDown = (ev) => {
      if (raceCtxMenuRef.current?.contains(ev.target)) return;
      closeRaceCtxMenu();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [raceCtxMenu]);

  const formaFatigaPoints = useMemo(() => computeFormaFatigaWeeklyPoints(workouts), [workouts]);
  const formaFatigaChronological = useMemo(() => [...formaFatigaPoints].reverse(), [formaFatigaPoints]);
  const formaFatigaStatus = useMemo(() => formaFatigaStatusFromPoint(formaFatigaPoints[0]), [formaFatigaPoints]);
  const formaFatigaTableRows = useMemo(() => formaFatigaPoints.slice(0, 4), [formaFatigaPoints]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athlete?.id) {
        setAchievementsCatalog([]);
        setEarnedAchievements([]);
        setAchProgress(null);
        return;
      }
      const snapshot = await loadAthleteAchievementSnapshot(athlete.id);
      if (cancelled) return;
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(computeAchievementProgress((workouts || []).filter((w) => w.done)));
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [athlete?.id, workouts]);

  const toggleWorkoutDone = async (w) => {
    const next = !w.done;
    const payload = next ? { done: true } : { done: false, rpe: null };
    const { error } = await supabase.from("workouts").update(payload).eq("id", w.id);
    if (error) {
      console.error(error);
      alert(`Error al actualizar: ${error.message}`);
      return;
    }
    const nextWorkouts = workouts.map(x => (x.id === w.id ? { ...x, done: next, rpe: next ? x.rpe : null } : x));
    setWorkouts(nextWorkouts);

    const workoutsDone = nextWorkouts.filter(x => x.done).length;
    onAthleteWorkoutsDoneSync?.(athlete.id, workoutsDone);

    const { error: athleteUpdateError } = await supabase
      .from("athletes")
      .update({ workouts_done: workoutsDone })
      .eq("id", athlete.id);
    if (athleteUpdateError) {
      console.error("Error actualizando workouts_done en athletes:", athleteUpdateError);
    }
    if (next) {
      const { newAwards, snapshot, progress } = await evaluateAndAwardAthleteAchievements(athlete.id);
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(progress);
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        notify?.(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
      }
    }
  };

  const closeCalendarCtxMenu = () => setCalendarCtxMenu(null);

  const ctxMenuWorkout = useMemo(
    () => (calendarCtxMenu ? workouts.find((x) => String(x.id) === String(calendarCtxMenu.workoutId)) || null : null),
    [workouts, calendarCtxMenu],
  );

  const panelWorkout = useMemo(
    () => (workoutPanel ? workouts.find((x) => String(x.id) === String(workoutPanel.workoutId)) || null : null),
    [workouts, workoutPanel],
  );

  const populateEditFormFromWorkout = (w) => {
    const rows = workoutStructureToEditableRows(w.structure);
    setWorkoutEditForm({
      title: w.title || "",
      type: WORKOUT_TYPES.some((t) => t.id === w.type) ? w.type : "easy",
      total_km: String(Number(w.total_km) || 0),
      duration_min: String(Number(w.duration_min) || 0),
      description: w.description || "",
      structureRows: rows.length ? rows : [emptyWorkoutStructureRow()],
    });
    setMoveDateInput(w.scheduled_date || formatLocalYMD(new Date()));
  };

  const openCalendarWorkoutMenu = (e, w) => {
    e.preventDefault();
    e.stopPropagation();
    if (calendarDragRef.current) return;
    const pad = 8;
    const mw = 280;
    const mh = 200;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setCalendarCtxMenu({ x, y, workoutId: w.id });
  };

  const openWorkoutEditPanel = (w) => {
    if (!w) return;
    populateEditFormFromWorkout(w);
    setWorkoutPanel({ mode: "edit", workoutId: w.id });
    closeCalendarCtxMenu();
  };

  const openWorkoutMovePanel = (w) => {
    if (!w) return;
    populateEditFormFromWorkout(w);
    setWorkoutPanel({ mode: "move", workoutId: w.id });
    closeCalendarCtxMenu();
  };

  const closeWorkoutPanel = () => {
    setWorkoutPanel(null);
    setWorkoutFormSaving(false);
  };

  useEffect(() => {
    if (!calendarCtxMenu) return;
    const onDown = (ev) => {
      if (calendarCtxMenuRef.current?.contains(ev.target)) return;
      closeCalendarCtxMenu();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [calendarCtxMenu]);

  const moveWorkoutToDate = async (workoutId, nextDate, withToast = true) => {
    const target = formatLocalYMD(new Date(`${nextDate}T12:00:00`));
    if (!target) return;
    const prev = workouts;
    setWorkouts((rows) => rows.map((x) => (String(x.id) === String(workoutId) ? { ...x, scheduled_date: target } : x)));
    const { error } = await supabase.from("workouts").update({ scheduled_date: target }).eq("id", workoutId);
    if (error) {
      console.error("Error moviendo workout:", error);
      setWorkouts(prev);
      notify?.(`Error moviendo workout: ${error.message}`);
      return;
    }
    if (withToast) notify?.(`Workout movido al ${target}`);
  };

  const saveWorkoutEdits = async () => {
    if (!panelWorkout?.id) return;
    const structure = editableRowsToWorkoutStructure(workoutEditForm.structureRows);
    const payload = {
      title: workoutEditForm.title.trim() || panelWorkout.title,
      type: WORKOUT_TYPES.some((t) => t.id === workoutEditForm.type) ? workoutEditForm.type : panelWorkout.type,
      total_km: Number(workoutEditForm.total_km) || 0,
      duration_min: Math.round(Number(workoutEditForm.duration_min) || 0),
      description: workoutEditForm.description || "",
      structure,
    };
    setWorkoutFormSaving(true);
    const prev = workouts;
    setWorkouts((rows) => rows.map((x) => (String(x.id) === String(panelWorkout.id) ? { ...x, ...payload } : x)));
    const { error } = await supabase.from("workouts").update(payload).eq("id", panelWorkout.id);
    setWorkoutFormSaving(false);
    if (error) {
      console.error("Error editando workout:", error);
      setWorkouts(prev);
      notify?.(`Error editando workout: ${error.message}`);
      return;
    }
    notify?.("Workout actualizado");
    closeWorkoutPanel();
  };

  const deleteCalendarWorkout = async (w) => {
    if (!w?.id) return;
    if (!window.confirm("¿Eliminar este workout? Esta acción no se puede deshacer.")) return;
    closeCalendarCtxMenu();
    closeWorkoutPanel();
    const id = w.id;
    setWorkoutFormSaving(true);
    const prev = workouts;
    setWorkouts((rows) => rows.filter((x) => String(x.id) !== String(id)));
    const { error } = await supabase.from("workouts").delete().eq("id", id);
    setWorkoutFormSaving(false);
    if (error) {
      console.error("Error eliminando workout:", error);
      setWorkouts(prev);
      notify?.(`Error eliminando workout: ${error.message}`);
      return;
    }
    notify?.("Workout eliminado");
  };


  const loadCoachChat = useCallback(async () => {
    if (!athlete?.id || !coachId) {
      setChatMessages([]);
      return;
    }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("athlete_id", athlete.id)
      .eq("coach_id", coachId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Error cargando mensajes:", error);
      return;
    }
    setChatMessages(data || []);
  }, [athlete?.id, coachId]);

  const loadAthletePayments = useCallback(async () => {
    if (!athlete?.id) {
      setAthletePayments([]);
      return;
    }
    setLoadingPayments(true);
    const { data, error } = await supabase
      .from("athlete_payments")
      .select("*")
      .eq("athlete_id", athlete.id)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoadingPayments(false);
    if (error) {
      console.error("Error cargando pagos:", error);
      setAthletePayments([]);
      return;
    }
    setAthletePayments(data || []);
  }, [athlete?.id]);

  const openRaceModal = () => {
    setRaceForm({
      name: "",
      date: formatLocalYMD(new Date()),
      distance: "21K",
      distanceOther: "",
      city: "",
    });
    setRaceModalOpen(true);
  };

  const saveRace = async () => {
    if (!athlete?.id || !coachId) return;
    const name = raceForm.name.trim();
    if (!name) {
      notify?.("Indica el nombre de la carrera");
      return;
    }
    if (!raceForm.date) {
      notify?.("Indica la fecha de la carrera");
      return;
    }
    const dist =
      raceForm.distance === "Otro" ? (raceForm.distanceOther || "").trim() || "Otro" : raceForm.distance;
    if (raceForm.distance === "Otro" && !(raceForm.distanceOther || "").trim()) {
      notify?.("Describe la distancia (Otro)");
      return;
    }
    setRaceSaving(true);
    try {
      const { error } = await supabase.from("races").insert({
        athlete_id: athlete.id,
        coach_id: coachId,
        name,
        date: raceForm.date,
        distance: dist,
        city: raceForm.city.trim() || null,
      });
      if (error) {
        console.error(error);
        notify?.(error.message || "No se pudo guardar la carrera");
        return;
      }
      notify?.("Carrera registrada");
      setRaceModalOpen(false);
      await refreshRacesList();
    } finally {
      setRaceSaving(false);
    }
  };

  const clearCoachChat = async () => {
    if (!athlete?.id || !coachId) return;
    if (!window.confirm("¿Estás seguro? Esto eliminará todos los mensajes de esta conversación.")) return;
    setChatClearing(true);
    try {
      const { error } = await supabase.from("messages").delete().eq("athlete_id", athlete.id).eq("coach_id", coachId);
      if (error) {
        console.error(error);
        notify?.(error.message || "No se pudo limpiar el chat");
        return;
      }
      setChatMessages([]);
      notify?.("Chat eliminado");
    } finally {
      setChatClearing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setCoachId(data?.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!athlete?.id) {
      setFcMaxInput("");
      setFcReposoInput("");
      return;
    }
    setFcMaxInput(athlete.fc_max != null && athlete.fc_max > 0 ? String(athlete.fc_max) : "");
    setFcReposoInput(athlete.fc_reposo != null && athlete.fc_reposo > 0 ? String(athlete.fc_reposo) : "");
  }, [athlete?.id, athlete?.fc_max, athlete?.fc_reposo]);

  useEffect(() => {
    loadCoachChat();
  }, [loadCoachChat]);

  useEffect(() => {
    loadAthletePayments();
  }, [loadAthletePayments]);

  useEffect(() => {
    const t = setInterval(() => loadCoachChat(), 10000);
    return () => clearInterval(t);
  }, [loadCoachChat]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);


  const saveAthleteFc = async () => {
    if (!athlete?.id) return;
    const fcmax = fcMaxInput.trim() === "" ? null : Math.round(Number(fcMaxInput));
    const fcr = fcReposoInput.trim() === "" ? null : Math.round(Number(fcReposoInput));
    if (fcmax != null && (!Number.isFinite(fcmax) || fcmax < 30 || fcmax > 250)) {
      alert("FC máxima: indica un valor entre 30 y 250 lpm, o déjalo vacío.");
      return;
    }
    if (fcr != null && (!Number.isFinite(fcr) || fcr < 30 || fcr > 120)) {
      alert("FC reposo: indica un valor entre 30 y 120 lpm, o déjalo vacío.");
      return;
    }
    setFcSaving(true);
    try {
      const { error } = await supabase.from("athletes").update({ fc_max: fcmax, fc_reposo: fcr }).eq("id", athlete.id);
      if (error) {
        console.error(error);
        alert(`Error al guardar FC: ${error.message}`);
        return;
      }
      onAthleteFcSync?.(athlete.id, fcmax, fcr);
    } finally {
      setFcSaving(false);
    }
  };

  const openPaymentModal = () => {
    setPaymentForm({
      amount: "",
      payment_method: "Nequi",
      plan: "Basico",
      payment_date: formatLocalYMD(new Date()),
      notes: "",
    });
    setPaymentModalOpen(true);
  };

  const registerPayment = async () => {
    if (!athlete?.id || !coachId) return;
    const amount = Number(String(paymentForm.amount).replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      notify?.("Monto inválido");
      return;
    }
    if (!paymentForm.payment_date) {
      notify?.("Selecciona la fecha de pago");
      return;
    }
    setPaymentSaving(true);
    const payload = {
      athlete_id: athlete.id,
      coach_id: coachId,
      amount,
      currency: "COP",
      payment_method: paymentForm.payment_method,
      plan: paymentForm.plan,
      status: "pending",
      notes: paymentForm.notes?.trim() || null,
      payment_date: paymentForm.payment_date,
    };
    const { error } = await supabase.from("athlete_payments").insert(payload);
    setPaymentSaving(false);
    if (error) {
      console.error("Error registrando pago:", error);
      notify?.(error.message || "No se pudo registrar el pago");
      return;
    }
    notify?.("Pago registrado");
    setPaymentModalOpen(false);
    loadAthletePayments();
  };

  const updatePaymentStatus = async (row, status) => {
    if (!row?.id || !athlete?.id) return;
    setPaymentActionBusyId(row.id);
    const { error } = await supabase
      .from("athlete_payments")
      .update({ status })
      .eq("id", row.id)
      .eq("athlete_id", athlete.id);
    setPaymentActionBusyId(null);
    if (error) {
      console.error("Error actualizando pago:", error);
      notify?.(error.message || "No se pudo actualizar el estado del pago");
      return;
    }
    if (status === "confirmed" && athlete?.email) {
      try {
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: athlete.email,
            subject: "Pago confirmado",
            html: `<div style="font-family:Arial,sans-serif"><h2>Pago recibido ✅</h2><p>Hola ${athlete.name || "atleta"}, tu pago del plan <b>${row.plan}</b> por <b>$${Number(row.amount || 0).toLocaleString("es-CO")} ${row.currency || "COP"}</b> fue confirmado.</p><p>Gracias por entrenar con RunningApexFlow.</p></div>`,
          }),
        });
      } catch (e) {
        console.error("Error enviando email de confirmación de pago:", e);
      }
    }
    notify?.(status === "confirmed" ? "Pago confirmado" : "Pago rechazado");
    loadAthletePayments();
  };

  const sendCoachChat = async () => {
    const body = chatDraft.trim();
    if (!body || !athlete?.id || !coachId || chatSending) return;
    setChatSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: athlete.id,
        coach_id: coachId,
        sender_role: "coach",
        body,
      });
      if (error) {
        console.error(error);
        alert(`No se pudo enviar: ${error.message}`);
        return;
      }
      console.log("Intentando enviar notificación a atleta");
      const athleteUserId = athlete.user_id;
      let recipientFcmToken = null;
      if (athleteUserId) {
        const { data: prow } = await supabase.from("profiles").select("fcm_token").eq("user_id", athleteUserId).maybeSingle();
        recipientFcmToken = prow?.fcm_token ?? null;
      } else {
        console.log("[chat coach→atleta] Sin athletes.user_id vinculado; no se puede resolver token del atleta.");
      }
      console.log("[chat coach→atleta] fcm_token atleta:", recipientFcmToken);
      if (recipientFcmToken == null || String(recipientFcmToken).trim() === "") {
        console.log("Atleta no tiene token FCM");
      }
      console.log("[chat coach→atleta] Verificando llamada a /api/send-notification");
      await sendChatPushNotification({
        token: recipientFcmToken,
        title: "Nuevo mensaje de tu coach",
        body,
        logLabel: "chat coach→atleta",
      });
      setChatDraft("");
      await loadCoachChat();
    } finally {
      setChatSending(false);
    }
  };

  if (!athlete) {
    return (
      <div style={S.page}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Atletas</h1>
          <button
            type="button"
            onClick={onOpenInviteModal}
            style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: ".8em", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
          >
            📧 Invitar Atleta
          </button>
        </div>
        <div style={{ color: "#64748b", fontSize: ".9em" }}>No se encontraron atletas</div>
      </div>
    );
  }
  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Atletas</h1>
        <button
          type="button"
          onClick={onOpenInviteModal}
          style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: ".8em", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
        >
          📧 Invitar Atleta
        </button>
      </div>
      <div className="pf-stack-mobile" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        <div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 6 }}>Buscar</div>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Nombre o objetivo"
              style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          {filteredAthletes.length === 0 ? (
            <div style={{ padding: "14px 8px", color: "#64748b", fontSize: ".85em" }}>No se encontraron atletas</div>
          ) : (
            filteredAthletes.map(a => (
              <div
                key={a.id}
                onClick={() => onSelect(a)}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1px solid ${athlete.id === a.id ? "rgba(245,158,11,.45)" : "#e2e8f0"}`,
                  background: athlete.id === a.id ? "rgba(245,158,11,.1)" : "#ffffff",
                  marginBottom: 8,
                  boxShadow: athlete.id === a.id ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                <span style={{ fontSize: "1.3em" }}>{a.avatar}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: ".85em", fontWeight: 700, color: "#0f172a" }}>{a.name}</div>
                  <div style={{ fontSize: ".7em", color: "#64748b" }}>{a.pace} · {a.weekly_km}km</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAthlete?.(a);
                  }}
                  style={{
                    flexShrink: 0,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    padding: "6px 10px",
                    color: "#b91c1c",
                    fontSize: ".72em",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  🗑 Eliminar
                </button>
              </div>
            ))
          )}
        </div>
        <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 0 }}>
          <div style={{ order: 1 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 20 }}>
            <div style={{ ...S.avatar, width: 52, height: 52, fontSize: "1.8em" }}>{athlete.avatar}</div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ fontSize: "1.3em", fontWeight: 700, color: "#0f172a" }}>{athlete.name}</div>
              <div style={{ color: "#64748b", fontSize: ".85em" }}>{athlete.goal}</div>
              {nextRaceCountdown ? (
                <div style={{ marginTop: 8, fontSize: ".88em", fontWeight: 700, color: "#b45309", lineHeight: 1.35 }}>
                  🏁 {nextRaceCountdown.race.name}
                  {" · "}
                  {nextRaceCountdown.days === 0
                    ? "¡Hoy es la carrera!"
                    : nextRaceCountdown.days === 1
                      ? "falta 1 día"
                      : `faltan ${nextRaceCountdown.days} días`}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  exportAthletePlanToPdf({
                    athlete,
                    workouts,
                    coachDisplayName,
                  });
                } catch (e) {
                  console.error(e);
                  alert(`No se pudo generar el PDF: ${e?.message || e}`);
                }
              }}
              style={{
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "8px 14px",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".8em",
                whiteSpace: "nowrap",
              }}
            >
              📄 Exportar PDF
            </button>
            <StatusBadge status={athlete.status} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            {[{ label: "Ritmo", value: athlete.pace, icon: "⚡" }, { label: "Km/Semana", value: `${athlete.weekly_km}km`, icon: "📍" }, { label: "Adherencia", value: `${Math.round(athlete.workouts_done/athlete.workouts_total*100)}%`, icon: "✅" }].map((m,i) => (
              <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 12px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "1.3em" }}>{m.icon}</div>
                <div style={{ fontSize: "1.2em", fontWeight: 700, color: "#f59e0b", fontFamily: "monospace" }}>{m.value}</div>
                <div style={{ fontSize: ".7em", color: "#64748b" }}>{m.label}</div>
              </div>
            ))}
          </div>
          </div>

          <div style={{ order: 5, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 12 }}>
              ZONAS FC
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 14 }}>
              <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>FC máx (lpm)</div>
                <input
                  type="number"
                  min={30}
                  max={250}
                  placeholder="Ej: 185"
                  value={fcMaxInput}
                  onChange={(e) => setFcMaxInput(e.target.value)}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>FC reposo (lpm)</div>
                <input
                  type="number"
                  min={30}
                  max={120}
                  placeholder="Ej: 48"
                  value={fcReposoInput}
                  onChange={(e) => setFcReposoInput(e.target.value)}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <button
                type="button"
                onClick={saveAthleteFc}
                disabled={fcSaving}
                style={{
                  background: fcSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: fcSaving ? "#64748b" : "white",
                  fontWeight: 800,
                  cursor: fcSaving ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                }}
              >
                {fcSaving ? "Guardando…" : "Guardar FC"}
              </button>
            </div>
            {(() => {
              const zones = computeAthleteHrZones(athlete.fc_max);
              return zones ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {zones.map((z) => (
                  <div key={z.zone}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: ".78em" }}>
                      <span style={{ color: "#0f172a", fontWeight: 600 }}>
                        Zona {z.zone}: {z.low}–{z.high} lpm
                      </span>
                      <span style={{ color: "#64748b", fontSize: ".72em" }}>{z.pctLabel}</span>
                    </div>
                    <div style={{ fontSize: ".72em", color: "#94a3b8", marginBottom: 4 }}>{z.label}</div>
                    <div style={{ height: 10, borderRadius: 5, background: "#e2e8f0", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: "100%", background: z.color, borderRadius: 5, opacity: 0.95 }} />
                    </div>
                  </div>
                ))}
              </div>
              ) : (
              <div style={{ color: "#64748b", fontSize: ".82em" }}>
                Indica una FC máx válida y pulsa Guardar FC para ver las 5 zonas.
              </div>
              );
            })()}
          </div>

          <div style={{ order: 4, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
              MEDALLAS DEL ATLETA
            </div>
            {(() => {
              const earnedMap = new Map(
                (earnedAchievements || []).map((e) => {
                  const meta = achievementJoinMeta(e);
                  return [meta?.code, e];
                }),
              );
              const totalKm = achProgress?.totalKm || 0;
              const nextKm = achievementKmTargets.find((x) => totalKm < x) || null;
              return (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".75em", color: "#64748b", marginBottom: 4 }}>
                      {nextKm
                        ? `Progreso km: ${totalKm.toFixed(1)} / ${nextKm} km`
                        : `Total: ${totalKm.toFixed(1)} km · hitos km completos`}
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${nextKm ? Math.min(100, (totalKm / nextKm) * 100) : 100}%`,
                          height: "100%",
                          background: "linear-gradient(90deg,#f59e0b,#fbbf24)",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(112px,1fr))", gap: 10 }}>
                    {(achievementsCatalog || []).map((a) => {
                      const earned = earnedMap.get(a.code);
                      return (
                        <div
                          key={a.id}
                          className={earned ? "raf-medal-earned" : undefined}
                          style={{
                            border: earned ? "1px solid rgba(245,158,11,.35)" : "1px solid #e2e8f0",
                            borderRadius: 10,
                            padding: "10px 8px",
                            background: earned ? "linear-gradient(145deg,#fffbeb,#fff7ed)" : "#f8fafc",
                            opacity: earned ? 1 : 0.55,
                            filter: earned ? "none" : "grayscale(1)",
                            textAlign: "center",
                          }}
                        >
                          <div style={{ fontSize: earned ? "1.75em" : "1.35em", marginBottom: 4 }}>{earned ? a.icon : "🔒"}</div>
                          <div style={{ fontSize: ".7em", color: "#0f172a", fontWeight: 700, lineHeight: 1.2 }}>{a.name}</div>
                          <div style={{ fontSize: ".63em", color: "#64748b", marginTop: 4 }}>
                            {earned ? (earned.earned_at ? new Date(earned.earned_at).toLocaleDateString("es-CO") : "") : "Bloqueada"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>

          <div style={{ order: 7, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
                PAGOS
              </div>
              <button
                type="button"
                onClick={openPaymentModal}
                style={{
                  background: "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: ".75em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Registrar Pago
              </button>
            </div>
            {loadingPayments ? (
              <div style={{ color: "#64748b", fontSize: ".82em" }}>Cargando pagos…</div>
            ) : athletePayments.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: ".82em" }}>No hay pagos registrados para este atleta.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {athletePayments.map((p) => {
                  const pending = p.status === "pending";
                  return (
                    <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ color: "#0f172a", fontSize: ".82em", fontWeight: 700 }}>
                          ${Number(p.amount || 0).toLocaleString("es-CO")} {p.currency || "COP"} · {p.plan}
                        </div>
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: 999,
                            fontSize: ".68em",
                            fontWeight: 700,
                            background: p.status === "confirmed" ? "rgba(34,197,94,.16)" : p.status === "rejected" ? "rgba(239,68,68,.14)" : "rgba(245,158,11,.16)",
                            color: p.status === "confirmed" ? "#15803d" : p.status === "rejected" ? "#b91c1c" : "#b45309",
                          }}
                        >
                          {paymentStatusLabel(p.status)}
                        </span>
                      </div>
                      <div style={{ marginTop: 4, color: "#64748b", fontSize: ".74em" }}>
                        {new Date(p.payment_date).toLocaleDateString("es-CO")} · {p.payment_method}
                      </div>
                      {p.notes ? <div style={{ marginTop: 4, color: "#475569", fontSize: ".74em" }}>Notas: {p.notes}</div> : null}
                      {pending ? (
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            disabled={paymentActionBusyId === p.id}
                            onClick={() => updatePaymentStatus(p, "confirmed")}
                            style={{ background: "rgba(34,197,94,.16)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 8, padding: "6px 10px", color: "#166534", cursor: "pointer", fontSize: ".72em", fontFamily: "inherit", fontWeight: 700 }}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            disabled={paymentActionBusyId === p.id}
                            onClick={() => updatePaymentStatus(p, "rejected")}
                            style={{ background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.32)", borderRadius: 8, padding: "6px 10px", color: "#b91c1c", cursor: "pointer", fontSize: ".72em", fontFamily: "inherit", fontWeight: 700 }}
                          >
                            Rechazar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ order: 6, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
              FORMA Y FATIGA
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, lineHeight: 1.45 }}>
              Basado en sesiones completadas con RPE: carga aguda = promedio (RPE × km) últimos 7 días; carga crónica = promedio (RPE × km) últimos 28 días; forma = crónica − aguda.
            </div>
            {loadingWorkouts ? (
              <div style={{ color: "#64748b", fontSize: ".85em", padding: "12px 0" }}>Cargando datos…</div>
            ) : (
              <>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 14,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    fontSize: ".88em",
                    fontWeight: 700,
                    color:
                      formaFatigaStatus.kind === "forma"
                        ? "#22c55e"
                        : formaFatigaStatus.kind === "fatiga"
                          ? "#f87171"
                          : formaFatigaStatus.kind === "fresco"
                            ? "#facc15"
                            : "#94a3b8",
                  }}
                >
                  Estado actual: {formaFatigaStatus.label}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14, fontSize: ".72em", color: "#94a3b8" }}>
                  <span>
                    <span style={{ color: "#ef4444", fontWeight: 700 }}>—</span> Carga aguda (7 d)
                  </span>
                  <span>
                    <span style={{ color: "#3b82f6", fontWeight: 700 }}>—</span> Carga crónica (28 d)
                  </span>
                  <span>
                    <span style={{ color: "#22c55e", fontWeight: 700 }}>—</span> Forma (crónica − aguda)
                  </span>
                </div>
                <FormaFatigaLineChart chronological={formaFatigaChronological} />
                <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#475569", textTransform: "uppercase", marginTop: 18, marginBottom: 8 }}>
                  Resumen últimas 4 semanas
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8em" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#94a3b8", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "8px 10px", fontWeight: 700 }}>Semana (corte)</th>
                        <th style={{ padding: "8px 10px", fontWeight: 700, color: "#ef4444" }}>Aguda</th>
                        <th style={{ padding: "8px 10px", fontWeight: 700, color: "#3b82f6" }}>Crónica</th>
                        <th style={{ padding: "8px 10px", fontWeight: 700, color: "#22c55e" }}>Forma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formaFatigaTableRows.map((row) => (
                        <tr key={row.i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 10px", color: "#0f172a" }}>
                            {row.label} <span style={{ color: "#64748b", fontSize: ".85em" }}>({row.endYmd})</span>
                          </td>
                          <td style={{ padding: "8px 10px", color: "#fecaca", fontFamily: "monospace" }}>
                            {row.acute != null ? row.acute.toFixed(1) : "—"}
                          </td>
                          <td style={{ padding: "8px 10px", color: "#bfdbfe", fontFamily: "monospace" }}>
                            {row.chronic != null ? row.chronic.toFixed(1) : "—"}
                          </td>
                          <td style={{ padding: "8px 10px", color: "#bbf7d0", fontFamily: "monospace" }}>
                            {row.forma != null ? row.forma.toFixed(1) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div style={{ order: 2, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
              CALENDARIO · {calendarMonthLabel}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: ".78em",
                }}
              >
                ← Mes anterior
              </button>
              <button
                type="button"
                onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: ".78em",
                }}
              >
                Mes siguiente →
              </button>
              <button
                type="button"
                onClick={openRaceModal}
                style={{
                  background: "linear-gradient(135deg,#fffbeb,#ffedd5)",
                  border: "1px solid rgba(245,158,11,.45)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "#b45309",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: ".78em",
                }}
              >
                🏁 Agregar Carrera
              </button>
            </div>
          </div>
          {loadingWorkouts ? (
            <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
              {DAYS.map(d => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
              {calendarCells.map((cellDate, i) => {
                const ymd = formatLocalYMD(cellDate);
                const dayWorkouts = workoutsByDate[ymd] || [];
                const dayRaces = racesByDate[ymd] || [];
                const hasWorkout = dayWorkouts.length > 0;
                const hasDoneWorkout = dayWorkouts.some(w => w.done);
                const hasRace = dayRaces.length > 0;
                const todayYmd = formatLocalYMD(new Date());
                const isRaceToday = hasRace && ymd === todayYmd;
                const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
                let borderColor = "#f1f5f9";
                if (hasRace) borderColor = "rgba(245,158,11,.55)";
                else if (hasWorkout) borderColor = `${WORKOUT_TYPES.find(t => t.id === dayWorkouts[0].type)?.color || "#64748b"}40`;
                let cellBackground = "transparent";
                if (isRaceToday) cellBackground = "linear-gradient(160deg,#fffbeb 0%,#fde68a 55%,#fff7ed 100%)";
                else if (hasRace) cellBackground = "linear-gradient(145deg,#fffbeb,#ffedd5)";
                else if (hasDoneWorkout) cellBackground = "rgba(34,197,94,.08)";
                else if (hasWorkout) cellBackground = "#f8fafc";
                return (
                  <div
                    key={i}
                    className={isRaceToday ? "raf-race-day" : undefined}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async () => {
                      if (!dragWorkoutId) return;
                      await moveWorkoutToDate(dragWorkoutId, ymd, true);
                      setDragWorkoutId(null);
                    }}
                    style={{
                      minHeight: 72,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 6,
                      padding: "4px 3px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 3,
                      background: cellBackground,
                      opacity: inViewMonth ? 1 : 0.42,
                    }}
                  >
                    <div style={{ fontSize: ".58em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                    {dayRaces.map((race) => (
                      <button
                        key={race.id}
                        type="button"
                        onClick={(e) => openRaceCalendarMenu(e, race)}
                        title={`${race.name} · ${race.distance}${race.city ? ` · ${race.city}` : ""}`}
                        style={{
                          fontSize: ".48em",
                          fontWeight: 800,
                          color: "#b45309",
                          textAlign: "center",
                          lineHeight: 1.2,
                          padding: "2px 2px",
                          borderRadius: 4,
                          background: "rgba(255,255,255,.65)",
                          border: "1px solid rgba(245,158,11,.35)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        🏁 {race.name}
                      </button>
                    ))}
                    {dayWorkouts.map(w => {
                      const wt = WORKOUT_TYPES.find(t => t.id === w.type) || WORKOUT_TYPES[0];
                      return (
                        <button
                          key={w.id}
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            calendarDragRef.current = true;
                            setDragWorkoutId(w.id);
                            try {
                              e.dataTransfer.setData("text/plain", String(w.id));
                              e.dataTransfer.effectAllowed = "move";
                            } catch (_) {}
                          }}
                          onDragEnd={() => {
                            setDragWorkoutId(null);
                            setTimeout(() => {
                              calendarDragRef.current = false;
                            }, 0);
                          }}
                          onClick={(e) => openCalendarWorkoutMenu(e, w)}
                          title="Opciones del workout"
                          style={{
                            border: `1px solid ${w.done ? "rgba(34,197,94,.55)" : `${wt.color}55`}`,
                            borderRadius: 5,
                            padding: "4px 3px",
                            background: w.done ? "rgba(34,197,94,.16)" : `${wt.color}12`,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textAlign: "center",
                            width: "100%",
                            boxSizing: "border-box",
                            position: "relative",
                          }}
                        >
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: wt.color, margin: "0 auto 2px" }} />
                          <div style={{ fontSize: ".52em", color: wt.color, fontWeight: 600, lineHeight: 1.15 }}>{w.title}</div>
                          <div style={{ fontSize: ".5em", color: "#475569" }}>{w.total_km} km</div>
                          {w.done && <div style={{ fontSize: ".52em", color: "#22c55e", marginTop: 1 }}>✓ Hecho</div>}
                          {w.done && w.rpe != null && (
                            <div style={{ fontSize: ".52em", color: "#94a3b8", marginTop: 2, lineHeight: 1.2 }}>
                              {rpeBandMeta(w.rpe).emoji} RPE {w.rpe}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          </div>

          <div style={{ order: 3, marginTop: 22 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
                CHAT CON ATLETA
              </div>
              <button
                type="button"
                onClick={clearCoachChat}
                disabled={chatClearing || !coachId || chatMessages.length === 0}
                style={{
                  background: chatClearing || chatMessages.length === 0 ? "#f1f5f9" : "#fef2f2",
                  border: `1px solid ${chatMessages.length === 0 ? "#e2e8f0" : "#fecaca"}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  color: chatMessages.length === 0 ? "#94a3b8" : "#b91c1c",
                  fontWeight: 700,
                  cursor: chatClearing || chatMessages.length === 0 ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".72em",
                }}
              >
                🗑 Limpiar chat
              </button>
            </div>
            <div
              ref={chatScrollRef}
              style={{
                maxHeight: 280,
                overflowY: "auto",
                padding: "10px 8px",
                borderRadius: 10,
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                marginBottom: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {chatMessages.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div>
              ) : (
                chatMessages.map((m) => {
                  const isCoach = m.sender_role === "coach";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isCoach ? "flex-end" : "flex-start",
                        maxWidth: "88%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: isCoach
                          ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(245,158,11,.75))"
                          : "#eff6ff",
                        border: `1px solid ${isCoach ? "rgba(245,158,11,.5)" : "rgba(59,130,246,.35)"}`,
                        color: isCoach ? "#f8fafc" : "#0f172a",
                        fontSize: ".82em",
                        lineHeight: 1.45,
                      }}
                    >
                      <div>{m.body}</div>
                      <div style={{ fontSize: ".65em", color: isCoach ? "rgba(255,255,255,.85)" : "#64748b", marginTop: 6 }}>
                        {formatMessageTimestamp(m.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCoachChat()}
                placeholder="Escribe un mensaje…"
                style={{
                  flex: 1,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#0f172a",
                  fontFamily: "inherit",
                  fontSize: ".85em",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={sendCoachChat}
                disabled={chatSending || !chatDraft.trim() || !coachId}
                style={{
                  background: chatSending || !chatDraft.trim() ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: chatSending || !chatDraft.trim() ? "#64748b" : "white",
                  fontWeight: 800,
                  cursor: chatSending || !chatDraft.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                  whiteSpace: "nowrap",
                }}
              >
                Enviar
              </button>
            </div>
          </div>

          <div style={{ order: 8, marginTop: 22, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
              EVALUACIONES
            </div>
            <div style={{ color: "#64748b", fontSize: ".82em", lineHeight: 1.45 }}>
              Revisa y registra evaluaciones del atleta desde la vista "Evaluación".
            </div>
          </div>
        </div>
      </div>

      {calendarCtxMenu && ctxMenuWorkout ? (
        <div
          ref={calendarCtxMenuRef}
          style={{
            position: "fixed",
            left: calendarCtxMenu.x,
            top: calendarCtxMenu.y,
            zIndex: 300,
            minWidth: 260,
            maxWidth: "min(92vw, 320px)",
            background: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(15,23,42,.2)",
            border: "1px solid #e2e8f0",
            padding: 6,
          }}
        >
          {[
            {
              label: ctxMenuWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho",
              onClick: () => {
                toggleWorkoutDone(ctxMenuWorkout);
                closeCalendarCtxMenu();
              },
            },
            {
              label: "✏️ Editar",
              onClick: () => openWorkoutEditPanel(ctxMenuWorkout),
            },
            {
              label: "📅 Mover a otra fecha",
              onClick: () => openWorkoutMovePanel(ctxMenuWorkout),
            },
            {
              label: "🗑 Eliminar",
              danger: true,
              onClick: () => deleteCalendarWorkout(ctxMenuWorkout),
            },
          ].map((item, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: item.danger ? "transparent" : "transparent",
                border: "none",
                borderRadius: 8,
                padding: "10px 12px",
                color: item.danger ? "#b91c1c" : "#0f172a",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".82em",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {raceCtxMenu && ctxMenuRace ? (
        <div
          ref={raceCtxMenuRef}
          style={{
            position: "fixed",
            left: raceCtxMenu.x,
            top: raceCtxMenu.y,
            zIndex: 305,
            minWidth: 240,
            maxWidth: "min(92vw, 300px)",
            background: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(15,23,42,.2)",
            border: "1px solid #e2e8f0",
            padding: 6,
          }}
        >
          {[
            { label: "✏️ Editar", onClick: () => openRaceEditPanel(ctxMenuRace) },
            { label: "📅 Mover fecha", onClick: () => openRaceMovePanel(ctxMenuRace) },
            { label: "🗑 Eliminar", danger: true, onClick: () => deleteRaceFromCalendar(ctxMenuRace) },
          ].map((item, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderRadius: 8,
                padding: "10px 12px",
                color: item.danger ? "#b91c1c" : "#0f172a",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".82em",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {racePanel && panelRace ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 290, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 480, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a" }}>
                {racePanel.mode === "edit" ? "Editar carrera" : "Mover fecha"} · {panelRace.name}
              </div>
              <button type="button" onClick={closeRacePanel} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>✕</button>
            </div>
            {racePanel.mode === "edit" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre</div>
                  <input
                    value={raceEditForm.name}
                    onChange={(e) => setRaceEditForm((f) => ({ ...f, name: e.target.value }))}
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha</div>
                  <input
                    type="date"
                    value={raceEditForm.date}
                    onChange={(e) => setRaceEditForm((f) => ({ ...f, date: e.target.value }))}
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Distancia</div>
                    <select
                      value={raceEditForm.distance}
                      onChange={(e) => setRaceEditForm((f) => ({ ...f, distance: e.target.value }))}
                      style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                    >
                      {RACE_DISTANCE_PRESETS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Ciudad</div>
                    <input
                      value={raceEditForm.city}
                      onChange={(e) => setRaceEditForm((f) => ({ ...f, city: e.target.value }))}
                      style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                {raceEditForm.distance === "Otro" ? (
                  <div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Describe la distancia</div>
                    <input
                      value={raceEditForm.distanceOther}
                      onChange={(e) => setRaceEditForm((f) => ({ ...f, distanceOther: e.target.value }))}
                      style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                    />
                  </div>
                ) : null}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={closeRacePanel} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
                  <button
                    type="button"
                    disabled={raceActionBusy}
                    onClick={saveRaceEdits}
                    style={{ background: raceActionBusy ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: raceActionBusy ? "#64748b" : "#fff", cursor: raceActionBusy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
                  >
                    {raceActionBusy ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nueva fecha</div>
                <input
                  type="date"
                  value={raceMoveDate}
                  onChange={(e) => setRaceMoveDate(e.target.value)}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={closeRacePanel} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
                  <button
                    type="button"
                    disabled={raceActionBusy}
                    onClick={applyRaceMoveDate}
                    style={{ background: raceActionBusy ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: raceActionBusy ? "#64748b" : "#fff", cursor: raceActionBusy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
                  >
                    {raceActionBusy ? "Guardando…" : "Guardar fecha"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {workoutPanel && panelWorkout ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 280, padding: 16, overflowY: "auto" }}>
          <div style={{ ...S.card, width: "100%", maxWidth: workoutPanel.mode === "edit" ? 640 : 480, margin: "24px 0", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a" }}>
                {workoutPanel.mode === "edit" ? "Editar workout" : "Mover workout"} · {panelWorkout.title}
              </div>
              <button type="button" onClick={closeWorkoutPanel} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>✕</button>
            </div>

            {workoutPanel.mode === "edit" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Título</div>
                  <input value={workoutEditForm.title} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, title: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Tipo</div>
                  <select value={workoutEditForm.type} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, type: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}>
                    {WORKOUT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Km</div>
                  <input type="number" min={0} step="0.1" value={workoutEditForm.total_km} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, total_km: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Duración (min)</div>
                  <input type="number" min={0} step="1" value={workoutEditForm.duration_min} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, duration_min: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Descripción</div>
                  <textarea rows={3} value={workoutEditForm.description} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, description: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box", resize: "vertical" }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 8 }}>Estructura (fases, duración, ritmo objetivo)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {workoutEditForm.structureRows.map((row, idx) => (
                      <div
                        key={idx}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          padding: "10px 12px",
                          background: "#f8fafc",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: ".75em", fontWeight: 700, color: "#334155" }}>Fase {idx + 1}</span>
                          <button
                            type="button"
                            disabled={workoutEditForm.structureRows.length <= 1}
                            onClick={() =>
                              setWorkoutEditForm((f) => ({
                                ...f,
                                structureRows:
                                  f.structureRows.length <= 1
                                    ? f.structureRows
                                    : f.structureRows.filter((_, j) => j !== idx),
                              }))
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              color: workoutEditForm.structureRows.length <= 1 ? "#cbd5e1" : "#b91c1c",
                              cursor: workoutEditForm.structureRows.length <= 1 ? "not-allowed" : "pointer",
                              fontSize: ".72em",
                              fontWeight: 700,
                              fontFamily: "inherit",
                            }}
                          >
                            Quitar
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Nombre de la fase</div>
                            <input
                              value={row.phase}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], phase: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración</div>
                            <input
                              value={row.duration}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], duration: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="ej. 10 min o 2 km"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Ritmo objetivo</div>
                            <input
                              value={row.pace}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], pace: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="ej. 4:45/km"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Intensidad / notas</div>
                            <input
                              value={row.intensity}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], intensity: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Z3, umbral…"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setWorkoutEditForm((f) => ({
                        ...f,
                        structureRows: [...f.structureRows, emptyWorkoutStructureRow()],
                      }))
                    }
                    style={{
                      marginTop: 10,
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".78em",
                    }}
                  >
                    + Añadir fase
                  </button>
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={closeWorkoutPanel} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
                  <button type="button" disabled={workoutFormSaving} onClick={saveWorkoutEdits} style={{ background: workoutFormSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: workoutFormSaving ? "#64748b" : "#fff", cursor: workoutFormSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}>{workoutFormSaving ? "Guardando…" : "Guardar cambios"}</button>
                </div>
              </div>
            ) : null}

            {workoutPanel.mode === "move" ? (
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nueva fecha</div>
                <input type="date" value={moveDateInput} onChange={(e) => setMoveDateInput(e.target.value)} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={closeWorkoutPanel} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
                  <button
                    type="button"
                    disabled={workoutFormSaving}
                    onClick={async () => {
                      setWorkoutFormSaving(true);
                      await moveWorkoutToDate(panelWorkout.id, moveDateInput, true);
                      setWorkoutFormSaving(false);
                      closeWorkoutPanel();
                    }}
                    style={{ background: workoutFormSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: workoutFormSaving ? "#64748b" : "#fff", cursor: workoutFormSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
                  >
                    {workoutFormSaving ? "Moviendo…" : "Mover workout"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {raceModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 215, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 480, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>🏁 Nueva carrera</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre de la carrera</div>
                <input
                  value={raceForm.name}
                  onChange={(e) => setRaceForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Media Maratón de Bogotá"
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha</div>
                <input
                  type="date"
                  value={raceForm.date}
                  onChange={(e) => setRaceForm((f) => ({ ...f, date: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Distancia</div>
                  <select
                    value={raceForm.distance}
                    onChange={(e) => setRaceForm((f) => ({ ...f, distance: e.target.value }))}
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                  >
                    {RACE_DISTANCE_PRESETS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Ciudad</div>
                  <input
                    value={raceForm.city}
                    onChange={(e) => setRaceForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Ciudad"
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              {raceForm.distance === "Otro" ? (
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Describe la distancia</div>
                  <input
                    value={raceForm.distanceOther}
                    onChange={(e) => setRaceForm((f) => ({ ...f, distanceOther: e.target.value }))}
                    placeholder="Ej: 15K, ultra 50K…"
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                  />
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setRaceModalOpen(false)}
                disabled={raceSaving}
                style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: raceSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveRace}
                disabled={raceSaving}
                style={{ background: raceSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: raceSaving ? "#64748b" : "#fff", cursor: raceSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
              >
                {raceSaving ? "Guardando…" : "Guardar carrera"}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 210, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>Registrar Pago</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Monto</div>
                <input
                  type="number"
                  min={1}
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del pago</div>
                <input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Método de pago</div>
                <select
                  value={paymentForm.payment_method}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, payment_method: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                >
                  {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Plan</div>
                <select
                  value={paymentForm.plan}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, plan: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                >
                  {PAYMENT_PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Notas</div>
                <textarea
                  rows={3}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box", resize: "vertical" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={registerPayment}
                disabled={paymentSaving}
                style={{ background: paymentSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: paymentSaving ? "#64748b" : "#fff", cursor: paymentSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
              >
                {paymentSaving ? "Guardando…" : "Guardar Pago"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function AthleteHome({ profile }) {
  const S = styles;
  const ATHLETE_TAB_STORAGE_KEY = "raf_athlete_tab";
  const [athleteInfo, setAthleteInfo] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [athleteChatMessages, setAthleteChatMessages] = useState([]);
  const [athleteChatDraft, setAthleteChatDraft] = useState("");
  const [athleteChatSending, setAthleteChatSending] = useState(false);
  const [corosModalOpen, setCorosModalOpen] = useState(false);
  const [garminModalOpen, setGarminModalOpen] = useState(false);
  const [athleteNotRegistered, setAthleteNotRegistered] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [athleteTabRestored, setAthleteTabRestored] = useState(false);
  const [achievementsCatalog, setAchievementsCatalog] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [achProgress, setAchProgress] = useState(null);
  const [medalToast, setMedalToast] = useState("");
  const [athletePayments, setAthletePayments] = useState([]);
  const [loadingAthletePayments, setLoadingAthletePayments] = useState(false);
  const [pushInviteDismissed, setPushInviteDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("raf_push_invite_dismissed") === "1",
  );
  const athleteChatScrollRef = useRef(null);
  const [athleteCalendarCtxMenu, setAthleteCalendarCtxMenu] = useState(null);
  const athleteCalendarCtxMenuRef = useRef(null);
  const [athleteChatClearing, setAthleteChatClearing] = useState(false);
  const [stravaConnection, setStravaConnection] = useState(null);
  const [stravaSyncingCode, setStravaSyncingCode] = useState(false);
  const [stravaActivities, setStravaActivities] = useState([]);
  const [stravaLoadingActivities, setStravaLoadingActivities] = useState(false);
  const [stravaDisconnecting, setStravaDisconnecting] = useState(false);
  const [findCoachCodeInput, setFindCoachCodeInput] = useState("");
  const [findCoachCodeBusy, setFindCoachCodeBusy] = useState(false);
  const [publicCoachesAthlete, setPublicCoachesAthlete] = useState([]);
  const [loadingPublicCoachesAthlete, setLoadingPublicCoachesAthlete] = useState(false);
  const [selectCoachBusyId, setSelectCoachBusyId] = useState("");
  const [coachAssignSuccess, setCoachAssignSuccess] = useState("");

  const profileUserId = profile?.user_id ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedSection = localStorage.getItem(ATHLETE_TAB_STORAGE_KEY);
    if (savedSection === "evaluation") setShowEvaluation(true);
    if (savedSection === "home") setShowEvaluation(false);
    setAthleteTabRestored(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!athleteTabRestored) return;
    const currentSection = showEvaluation ? "evaluation" : "home";
    localStorage.setItem(ATHLETE_TAB_STORAGE_KEY, currentSection);
  }, [showEvaluation, athleteTabRestored]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const savedSection = localStorage.getItem(ATHLETE_TAB_STORAGE_KEY);
      if (savedSection === "evaluation") setShowEvaluation(true);
      if (savedSection === "home") setShowEvaluation(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  /** Último `profileUserId` para el que ya se completó la carga inicial (evita loop si `profile` del padre se recrea). */
  const prevProfileUserIdRef = useRef(null);

  useEffect(() => {
    if (profileUserId == null) {
      prevProfileUserIdRef.current = null;
      setAthleteInfo(null);
      setWorkouts([]);
      setLoading(false);
      return;
    }

    if (prevProfileUserIdRef.current === profileUserId) {
      return;
    }

    let cancelled = false;
    const markInitialLoadFinished = () => {
      if (!cancelled) {
        prevProfileUserIdRef.current = profileUserId;
      }
    };

    const load = async () => {
      setLoading(true);
      setMessage("");
      setCoachAssignSuccess("");
      setAthleteNotRegistered(false);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (cancelled) return;

      const userEmail = authData?.user?.email?.trim();
      console.log("[AthleteHome] session.user.email", authData?.user?.email ?? null);
      if (authErr || !userEmail) {
        console.error("Error obteniendo sesión:", authErr);
        setAthleteInfo(null);
        setWorkouts([]);
        setLoading(false);
        if (!userEmail) setMessage("No se pudo obtener el email de tu cuenta.");
        return;
      }

      const { data: athleteRows, error: athleteErr } = await supabase
        .from("athletes")
        .select("*")
        .ilike("email", userEmail)
        .limit(1);

      console.log("[AthleteHome] consulta athletes (ilike email)", {
        emailFiltro: userEmail,
        data: athleteRows,
        error: athleteErr,
      });

      if (cancelled) return;

      if (athleteErr) {
        console.error("Error cargando atleta:", athleteErr);
        setAthleteInfo(null);
        setWorkouts([]);
        setLoading(false);
        return;
      }

      const athleteRow = athleteRows?.[0];
      if (!athleteRow) {
        setAthleteInfo(null);
        setWorkouts([]);
        setAthleteNotRegistered(true);
        setLoading(false);
        markInitialLoadFinished();
        return;
      }

      setAthleteInfo(athleteRow);

      if (authData?.user?.id) {
        const { error: linkErr } = await supabase.from("athletes").update({ user_id: authData.user.id }).eq("id", athleteRow.id);
        if (linkErr) console.warn("[AthleteHome] link user_id:", linkErr);
        const tok = await refreshFcmTokenIfGranted();
        if (tok) {
          await supabase.from("profiles").update({ fcm_token: tok }).eq("user_id", authData.user.id).limit(1);
        }
      }

      const { data: workoutsRows, error: workoutsErr } = await supabase
        .from("workouts")
        .select("*")
        .eq("athlete_id", athleteRow.id)
        .order("scheduled_date", { ascending: true });

      console.log("[AthleteHome] consulta workouts (athlete_id)", {
        athlete_id: athleteRow.id,
        data: workoutsRows,
        error: workoutsErr,
      });

      if (cancelled) return;

      if (workoutsErr) {
        console.error("Error cargando workouts atleta:", workoutsErr);
        setWorkouts([]);
      } else {
        const normalizedWorkouts = (workoutsRows || []).map(normalizeWorkoutRow);
        setWorkouts(normalizedWorkouts);
        if ((normalizedWorkouts || []).some((w) => w.done)) {
          const { snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteRow.id);
          if (!cancelled) {
            setAchievementsCatalog(snapshot.achievements || []);
            setEarnedAchievements(snapshot.earned || []);
            setAchProgress(progress || computeAchievementProgress(normalizedWorkouts.filter((w) => w.done)));
          }
        }
      }

      setLoading(false);
      markInitialLoadFinished();
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  const athleteCoachIdPrimitive = athleteInfo?.coach_id ?? null;

  useEffect(() => {
    if (!athleteInfo?.id || athleteNotRegistered || athleteCoachIdPrimitive) {
      setPublicCoachesAthlete([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPublicCoachesAthlete(true);
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("user_id, full_name, avatar_url, city, country, subscription_plan")
        .eq("is_public", true)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("[AthleteHome] coaches públicos:", error);
        setPublicCoachesAthlete([]);
      } else {
        const list = data || [];
        const sorted = [...list].sort((a, b) => {
          const ap = String(a.user_id) === PLATFORM_ADMIN_USER_ID ? 0 : 1;
          const bp = String(b.user_id) === PLATFORM_ADMIN_USER_ID ? 0 : 1;
          return ap - bp;
        });
        setPublicCoachesAthlete(sorted);
      }
      setLoadingPublicCoachesAthlete(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteInfo?.id, athleteNotRegistered, athleteCoachIdPrimitive]);

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      const k = normalizeScheduledDateYmd(w.scheduled_date);
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const calendarCells = useMemo(
    () => getMonthGrid(calendarViewMonth.y, calendarViewMonth.m),
    [calendarViewMonth.y, calendarViewMonth.m],
  );
  const calendarMonthLabel = useMemo(
    () =>
      new Date(calendarViewMonth.y, calendarViewMonth.m, 1).toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
      }),
    [calendarViewMonth.y, calendarViewMonth.m],
  );

  const [races, setRaces] = useState([]);

  useEffect(() => {
    if (!athleteInfo?.id) {
      setRaces([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("races")
        .select("*")
        .eq("athlete_id", athleteInfo.id)
        .order("date", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Error cargando carreras (atleta):", error);
        setRaces([]);
        return;
      }
      setRaces((data || []).map(normalizeRaceRow));
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteInfo?.id]);

  const racesByDate = useMemo(() => {
    const m = {};
    for (const r of races) {
      const k = r.date;
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(r);
    }
    return m;
  }, [races]);

  const stravaActivitiesByDate = useMemo(() => {
    const grouped = {};
    for (const a of stravaActivities) {
      if (!a?.ymd) continue;
      if (!grouped[a.ymd]) grouped[a.ymd] = [];
      grouped[a.ymd].push(a);
    }
    return grouped;
  }, [stravaActivities]);

  const athleteTodayYmd = calendarCellToIsoYmd(new Date());

  const nextRaceCountdownAthlete = useMemo(
    () => getNextRaceCountdown(races, athleteTodayYmd),
    [races, athleteTodayYmd],
  );

  const closeAthleteCalendarCtxMenu = () => setAthleteCalendarCtxMenu(null);

  const ctxMenuWorkoutId = athleteCalendarCtxMenu?.workoutId ?? null;

  const ctxMenuAthleteWorkout = useMemo(
    () =>
      ctxMenuWorkoutId ? workouts.find((x) => String(x.id) === String(ctxMenuWorkoutId)) || null : null,
    [workouts, ctxMenuWorkoutId],
  );

  const openAthleteWorkoutMenu = (e, w) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const mw = 260;
    const mh = 52;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setAthleteCalendarCtxMenu({ x, y, workoutId: w.id });
  };

  const ctxMenuListenerKey = athleteCalendarCtxMenu
    ? `${athleteCalendarCtxMenu.workoutId}:${athleteCalendarCtxMenu.x}:${athleteCalendarCtxMenu.y}`
    : "";

  useEffect(() => {
    if (!ctxMenuListenerKey) return;
    const onDown = (ev) => {
      if (athleteCalendarCtxMenuRef.current?.contains(ev.target)) return;
      closeAthleteCalendarCtxMenu();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [ctxMenuListenerKey]);

  const { thisWeekStartYmd, thisWeekEndYmd } = useMemo(() => {
    const start = startOfWeekMonday(new Date());
    const end = addDays(start, 6);
    return {
      thisWeekStartYmd: formatLocalYMD(start),
      thisWeekEndYmd: formatLocalYMD(end),
    };
  }, [athleteTodayYmd]);

  const weeklyWorkouts = useMemo(
    () =>
      workouts.filter((w) => {
        const ymd = normalizeScheduledDateYmd(w.scheduled_date);
        return ymd && ymd >= thisWeekStartYmd && ymd <= thisWeekEndYmd;
      }),
    [workouts, thisWeekStartYmd, thisWeekEndYmd],
  );

  const weeklyTotalKm = useMemo(() => weeklyWorkouts.reduce((s, w) => s + (Number(w.total_km) || 0), 0), [weeklyWorkouts]);
  const weeklyDoneKm = useMemo(() => weeklyWorkouts.filter(w => w.done).reduce((s, w) => s + (Number(w.total_km) || 0), 0), [weeklyWorkouts]);

  const workoutsAchSyncKey = useMemo(
    () => (workouts || []).map((w) => `${w.id}:${w.done ? 1 : 0}:${w.rpe ?? ""}`).join("|"),
    [workouts],
  );

  const toggleDone = async (w) => {
    const next = !w.done;
    const payload = next ? { done: true } : { done: false, rpe: null };
    const nextWorkouts = workouts.map((x) => (x.id === w.id ? { ...x, done: next, rpe: next ? x.rpe : null } : x));
    setWorkouts(nextWorkouts);
    const { error } = await supabase.from("workouts").update(payload).eq("id", w.id);
    if (error) {
      console.error("Error actualizando workout:", error);
      setWorkouts(prev => prev.map(x => (x.id === w.id ? { ...x, done: !next, rpe: w.rpe } : x)));
      setMessage(`Error actualizando workout: ${error.message}`);
      return;
    }
    if (next && athleteInfo?.id) {
      const doneAfterToggle = nextWorkouts.filter((x) => x.done);
      const workoutsCompletadosTotales = doneAfterToggle.length;
      const kmTotalesAcumulados = doneAfterToggle.reduce((s, x) => s + (Number(x.total_km) || 0), 0);
      console.log(`[AthleteHome] Verificando logros para atleta_id: ${athleteInfo.id}`);
      console.log("[AthleteHome] Workouts completados totales:", workoutsCompletadosTotales);
      console.log("[AthleteHome] Km totales acumulados:", kmTotalesAcumulados);
      console.log("[AthleteHome] toggleDone: llamando evaluateAndAwardAthleteAchievements tras marcar como hecho");
      const { newAwards, snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteInfo.id);
      const hayLogroNuevo = newAwards.length > 0;
      console.log("[AthleteHome] ¿Se detectó algún logro nuevo?:", hayLogroNuevo, hayLogroNuevo ? newAwards.map((row) => achievementJoinMeta(row)?.code).filter(Boolean) : []);
      if (progress) {
        console.log("[AthleteHome] Progreso tras evaluación (servidor): workouts hechos:", progress.doneCount, "km total:", progress.totalKm);
      }
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(progress || computeAchievementProgress(nextWorkouts.filter((x) => x.done)));
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        setMedalToast(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
        setTimeout(() => setMedalToast(""), 4200);
      }
    }
  };

  const saveWorkoutRpe = async (w, rawVal) => {
    if (!w.done) return;
    const rpe = clampWorkoutRpe(rawVal);
    if (rpe == null) return;
    setWorkouts((prev) => prev.map((x) => (x.id === w.id ? { ...x, rpe } : x)));
    const { error } = await supabase.from("workouts").update({ rpe }).eq("id", w.id);
    if (error) {
      console.error("Error guardando RPE:", error);
      setWorkouts((prev) => prev.map((x) => (x.id === w.id ? { ...x, rpe: w.rpe } : x)));
      setMessage(`Error guardando RPE: ${error.message}`);
      return;
    }
    if (athleteInfo?.id) {
      const { newAwards, snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteInfo.id);
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(progress);
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        setMedalToast(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
        setTimeout(() => setMedalToast(""), 4200);
      }
    }
  };

  const athleteName = profile?.name || athleteInfo?.name || "Atleta";
  const nextRaceText = athleteInfo?.next_race ? `🏁 ${getRaceCountdownText(athleteInfo.next_race)}` : "🏁 Próxima carrera · fecha pendiente";

  const coachIdForChat = athleteInfo?.coach_id || null;

  const loadAthleteChat = useCallback(async () => {
    if (!athleteInfo?.id || !coachIdForChat) {
      setAthleteChatMessages([]);
      return;
    }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("athlete_id", athleteInfo.id)
      .eq("coach_id", coachIdForChat)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Error cargando chat atleta:", error);
      return;
    }
    setAthleteChatMessages(data || []);
  }, [athleteInfo?.id, coachIdForChat]);

  const loadMyPayments = useCallback(async () => {
    if (!athleteInfo?.id) {
      setAthletePayments([]);
      return;
    }
    setLoadingAthletePayments(true);
    const { data, error } = await supabase
      .from("athlete_payments")
      .select("*")
      .eq("athlete_id", athleteInfo.id)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoadingAthletePayments(false);
    if (error) {
      console.error("Error cargando pagos del atleta:", error);
      setAthletePayments([]);
      return;
    }
    setAthletePayments(data || []);
  }, [athleteInfo?.id]);

  const loadStravaConnection = useCallback(async () => {
    if (!athleteInfo?.id) {
      setStravaConnection(null);
      return;
    }
    const { data, error } = await supabase
      .from("strava_connections")
      .select("*")
      .eq("athlete_id", athleteInfo.id)
      .maybeSingle();
    if (error) {
      console.error("Error cargando conexión Strava:", error);
      setStravaConnection(null);
      return;
    }
    setStravaConnection(data || null);
  }, [athleteInfo?.id]);

  const loadStravaActivities = useCallback(async () => {
    if (!stravaConnection?.access_token) {
      setStravaActivities([]);
      return;
    }
    setStravaLoadingActivities(true);
    try {
      const r = await fetch("/api/strava?action=activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: stravaConnection.access_token }),
      });
      const data = await r.json();
      if (!r.ok || !Array.isArray(data)) {
        console.warn("Error cargando actividades Strava:", data);
        setStravaActivities([]);
        return;
      }
      setStravaActivities(data.slice(0, 10).map(normalizeStravaActivity).filter(Boolean));
    } catch (e) {
      console.error("Error consultando Strava:", e);
      setStravaActivities([]);
    } finally {
      setStravaLoadingActivities(false);
    }
  }, [stravaConnection?.access_token]);

  useEffect(() => {
    loadAthleteChat();
  }, [loadAthleteChat]);

  useEffect(() => {
    loadMyPayments();
  }, [loadMyPayments]);

  useEffect(() => {
    loadStravaConnection();
  }, [loadStravaConnection]);

  useEffect(() => {
    loadStravaActivities();
  }, [loadStravaActivities]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteInfo?.id) {
        setAchievementsCatalog([]);
        setEarnedAchievements([]);
        setAchProgress(null);
        return;
      }
      const snapshot = await loadAthleteAchievementSnapshot(athleteInfo.id);
      if (cancelled) return;
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(computeAchievementProgress((workouts || []).filter((w) => w.done)));
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [athleteInfo?.id, workoutsAchSyncKey]);

  useEffect(() => {
    const t = setInterval(() => loadAthleteChat(), 10000);
    return () => clearInterval(t);
  }, [loadAthleteChat]);

  useEffect(() => {
    if (!athleteChatScrollRef.current) return;
    athleteChatScrollRef.current.scrollTop = athleteChatScrollRef.current.scrollHeight;
  }, [athleteChatMessages]);

  const sendAthleteChat = async () => {
    const body = athleteChatDraft.trim();
    if (!body || !athleteInfo?.id || !coachIdForChat || athleteChatSending) return;
    setAthleteChatSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: athleteInfo.id,
        coach_id: coachIdForChat,
        sender_role: "athlete",
        body,
      });
      if (error) {
        console.error(error);
        setMessage(`Error al enviar mensaje: ${error.message}`);
        return;
      }
      const { data: coachProf } = await supabase.from("profiles").select("fcm_token").eq("user_id", coachIdForChat).maybeSingle();
      const recipientFcmToken = coachProf?.fcm_token ?? null;
      await sendChatPushNotification({
        token: recipientFcmToken,
        title: `Tu atleta ${athleteName} respondió`,
        body,
        logLabel: "chat atleta→coach",
      });
      setAthleteChatDraft("");
      await loadAthleteChat();
    } finally {
      setAthleteChatSending(false);
    }
  };

  const clearAthleteChat = async () => {
    if (!athleteInfo?.id || !coachIdForChat) return;
    if (!window.confirm("¿Estás seguro? Esto eliminará todos los mensajes de esta conversación.")) return;
    setAthleteChatClearing(true);
    try {
      const { error } = await supabase.from("messages").delete().eq("athlete_id", athleteInfo.id).eq("coach_id", coachIdForChat);
      if (error) {
        console.error(error);
        setMessage(error.message || "No se pudo limpiar el chat");
        return;
      }
      setAthleteChatMessages([]);
    } finally {
      setAthleteChatClearing(false);
    }
  };

  const disconnectStrava = async () => {
    if (!athleteInfo?.id) return;
    if (!window.confirm("¿Desconectar Strava de tu cuenta?")) return;
    setStravaDisconnecting(true);
    try {
      const { error } = await supabase.from("strava_connections").delete().eq("athlete_id", athleteInfo.id);
      if (error) {
        console.error(error);
        setMessage(error.message || "No se pudo desconectar Strava");
        return;
      }
      setStravaConnection(null);
      setStravaActivities([]);
    } finally {
      setStravaDisconnecting(false);
    }
  };

  const openAthleteStravaOAuth = useCallback(() => {
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=218467&redirect_uri=${encodeURIComponent(STRAVA_CALLBACK_URL)}&response_type=code&scope=activity:read_all&state=${encodeURIComponent(String(athleteInfo?.id || ""))}`;
    window.location.href = authUrl;
  }, [athleteInfo?.id]);

  const setAthleteDeviceConnection = async (deviceValue) => {
    if (!athleteInfo?.id) return;
    const { error } = await supabase.from("athletes").update({ device: deviceValue }).eq("id", athleteInfo.id);
    if (error) {
      console.error("Error actualizando dispositivo atleta:", error);
      setMessage(error.message || "No se pudo actualizar el dispositivo");
      return;
    }
    setAthleteInfo((prev) => (prev ? { ...prev, device: deviceValue } : prev));
  };

  const athleteNeedsCoachLink =
    Boolean(athleteInfo) &&
    !athleteNotRegistered &&
    (athleteInfo.coach_id == null || athleteInfo.coach_id === "");

  const linkAthleteToCoach = async (coachUserId) => {
    if (!athleteInfo?.id || !profile?.user_id || !coachUserId) return false;
    setMessage("");
    const { error: eAth } = await supabase.from("athletes").update({ coach_id: coachUserId }).eq("id", athleteInfo.id);
    if (eAth) {
      setMessage(eAth.message || "No se pudo vincular el coach.");
      return false;
    }
    const { error: eProf } = await supabase.from("profiles").update({ coach_id: coachUserId }).eq("user_id", profile.user_id);
    if (eProf) {
      setMessage(eProf.message || "No se pudo actualizar tu perfil. Revisa permisos o contacta soporte.");
      return false;
    }
    setAthleteInfo((prev) => (prev ? { ...prev, coach_id: coachUserId } : prev));
    setCoachAssignSuccess("¡Coach asignado exitosamente! Ya puedes ver tus entrenamientos.");
    setTimeout(() => setCoachAssignSuccess(""), 8000);
    const { data: wRows, error: wErr } = await supabase
      .from("workouts")
      .select("*")
      .eq("athlete_id", athleteInfo.id)
      .order("scheduled_date", { ascending: true });
    if (!wErr && wRows) {
      setWorkouts((wRows || []).map(normalizeWorkoutRow));
    }
    return true;
  };

  const connectCoachByCode = async () => {
    const code = findCoachCodeInput.trim();
    if (!code) {
      setMessage("Ingresa el código de tu coach.");
      return;
    }
    setFindCoachCodeBusy(true);
    setMessage("");
    try {
      const coachId = await resolveCoachUserIdFromPublicCode(code);
      if (!coachId) {
        setMessage("No encontramos un coach con ese código.");
        return;
      }
      await linkAthleteToCoach(coachId);
    } finally {
      setFindCoachCodeBusy(false);
    }
  };

  const selectPublicCoach = async (coachUserId) => {
    setSelectCoachBusyId(String(coachUserId));
    setMessage("");
    try {
      await linkAthleteToCoach(coachUserId);
    } finally {
      setSelectCoachBusyId("");
    }
  };

  return (
    <div style={S.page}>
      {/* ORDEN: header, progreso, calendario, chat, logros, evaluacion, cerrar sesion */}
      {medalToast ? (
        <div
          className="raf-medal-toast"
          style={{
            ...S.card,
            marginBottom: 14,
            border: "1px solid rgba(245,158,11,.5)",
            background: "linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)",
            boxShadow: "0 4px 24px rgba(245,158,11,.4)",
          }}
        >
          <div style={{ color: "#b45309", fontWeight: 800, fontSize: "1.05em", letterSpacing: ".01em" }}>{medalToast}</div>
        </div>
      ) : null}
      {message && <div style={{ ...S.card, border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", color: "#fecaca", marginBottom: 14 }}>{message}</div>}
      {coachAssignSuccess ? (
        <div
          style={{
            ...S.card,
            border: "1px solid rgba(34,197,94,.45)",
            background: "rgba(34,197,94,.1)",
            color: "#166534",
            marginBottom: 14,
            fontWeight: 600,
            fontSize: ".92em",
          }}
        >
          {coachAssignSuccess}
        </div>
      ) : null}

      {athleteNotRegistered && !loading && (
        <div
          style={{
            ...S.card,
            marginBottom: 14,
            border: "1px solid rgba(245,158,11,.35)",
            background: "rgba(245,158,11,.08)",
            color: "#fde68a",
            fontSize: ".95em",
            lineHeight: 1.45,
          }}
        >
          Tu coach aún no te ha registrado en la plataforma
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18, order: 1 }}>
        <div>
          <h1 style={{ ...S.pageTitle, marginBottom: 6 }}>Hola, {athleteName}</h1>
          <div style={{ color: "#94a3b8", fontSize: ".9em" }}>{nextRaceText}</div>
          {nextRaceCountdownAthlete ? (
            <div style={{ marginTop: 8, fontSize: ".92em", fontWeight: 700, color: "#b45309", lineHeight: 1.35 }}>
              🏁 {nextRaceCountdownAthlete.race.name}
              {" · "}
              {nextRaceCountdownAthlete.days === 0
                ? "¡Hoy es la carrera!"
                : nextRaceCountdownAthlete.days === 1
                  ? "falta 1 día"
                  : `faltan ${nextRaceCountdownAthlete.days} días`}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 18, order: 2 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 8 }}>PROGRESO SEMANAL</div>
        <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>
          {weeklyDoneKm} / {weeklyTotalKm} km
        </div>
        <div style={{ color: "#64748b", fontSize: ".8em", marginTop: 6 }}>
          Semana {thisWeekStartYmd} → {thisWeekEndYmd}
        </div>
      </div>

      {!athleteNotRegistered && (
      <>
      <div style={{ ...S.card, order: 3 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
            CALENDARIO · {calendarMonthLabel}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
              }}
            >
              ← Mes anterior
            </button>
            <button
              type="button"
              onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
              }}
            >
              Mes siguiente →
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
              {DAYS.map(d => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
              {calendarCells.map((cellDate, i) => {
                const ymd = calendarCellToIsoYmd(cellDate);
                const dayWorkouts = workoutsByDate[ymd] || [];
                const dayRaces = racesByDate[ymd] || [];
                const dayStrava = stravaActivitiesByDate[ymd] || [];
                const hasWorkout = dayWorkouts.length > 0;
                const hasDoneWorkout = dayWorkouts.some(w => w.done);
                const hasRace = dayRaces.length > 0;
                const hasStrava = dayStrava.length > 0;
                const isRaceToday = hasRace && ymd === athleteTodayYmd;
                const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
                let borderColor = "#f1f5f9";
                if (hasRace) borderColor = "rgba(245,158,11,.55)";
                else if (hasStrava) borderColor = "rgba(249,115,22,.45)";
                else if (hasWorkout) borderColor = `${WORKOUT_TYPES.find(t => t.id === dayWorkouts[0].type)?.color || "#64748b"}40`;
                let cellBackground = "transparent";
                if (isRaceToday) cellBackground = "linear-gradient(160deg,#fffbeb 0%,#fde68a 55%,#fff7ed 100%)";
                else if (hasRace) cellBackground = "linear-gradient(145deg,#fffbeb,#ffedd5)";
                else if (hasStrava) cellBackground = "linear-gradient(145deg,#fff7ed,#ffedd5)";
                else if (hasDoneWorkout) cellBackground = "rgba(34,197,94,.08)";
                else if (hasWorkout) cellBackground = "#f8fafc";

                return (
                  <div
                    key={i}
                    className={isRaceToday ? "raf-race-day" : undefined}
                    style={{
                      minHeight: 72,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 6,
                      padding: "4px 3px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 3,
                      background: cellBackground,
                      opacity: inViewMonth ? 1 : 0.42,
                    }}
                  >
                    <div style={{ fontSize: ".58em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                    {dayRaces.map((race) => (
                      <div
                        key={race.id}
                        title={`${race.name} · ${race.distance}${race.city ? ` · ${race.city}` : ""}`}
                        style={{
                          fontSize: ".48em",
                          fontWeight: 800,
                          color: "#b45309",
                          textAlign: "center",
                          lineHeight: 1.2,
                          padding: "2px 2px",
                          borderRadius: 4,
                          background: "rgba(255,255,255,.65)",
                          border: "1px solid rgba(245,158,11,.35)",
                        }}
                      >
                        🏁 {race.name}
                      </div>
                    ))}
                    {dayStrava.map((a) => (
                      <div
                        key={`strava-${a.id}`}
                        title={`${a.name} · ${a.distanceKm.toFixed(2)} km · ${a.type}`}
                        style={{
                          fontSize: ".48em",
                          fontWeight: 800,
                          color: "#c2410c",
                          textAlign: "center",
                          lineHeight: 1.2,
                          padding: "2px 2px",
                          borderRadius: 4,
                          background: "rgba(255,255,255,.65)",
                          border: "1px solid rgba(249,115,22,.35)",
                        }}
                      >
                        🟠 {a.icon} Strava
                      </div>
                    ))}
                    {dayWorkouts.map(w => {
                      const wt = WORKOUT_TYPES.find(t => t.id === w.type) || WORKOUT_TYPES[0];
                      return (
                        <div key={w.id} style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%", minWidth: 0 }}>
                          <button
                            type="button"
                            onClick={(e) => openAthleteWorkoutMenu(e, w)}
                            title="Opciones del entrenamiento"
                            style={{
                              border: `1px solid ${w.done ? "rgba(34,197,94,.55)" : `${wt.color}55`}`,
                              borderRadius: 5,
                              padding: "4px 3px",
                              background: w.done ? "rgba(34,197,94,.16)" : `${wt.color}12`,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              textAlign: "center",
                              width: "100%",
                              boxSizing: "border-box",
                            }}
                          >
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: wt.color, margin: "0 auto 2px" }} />
                            <div style={{ fontSize: ".52em", color: wt.color, fontWeight: 600, lineHeight: 1.15 }}>{w.title}</div>
                            <div style={{ fontSize: ".5em", color: "#475569" }}>{w.total_km} km</div>
                            {w.done && <div style={{ fontSize: ".52em", color: "#22c55e", marginTop: 1 }}>✓ Hecho</div>}
                          </button>
                          {w.done && (
                            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: ".48em", color: "#64748b", textAlign: "center" }}>
                              <span style={{ letterSpacing: ".04em" }}>¿Cómo te sentiste? (RPE)</span>
                              <select
                                value={w.rpe ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "") return;
                                  saveWorkoutRpe(w, v);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  width: "100%",
                                  maxWidth: "100%",
                                  background: "rgba(0,0,0,.35)",
                                  border: "1px solid #cbd5e1",
                                  borderRadius: 4,
                                  padding: "3px 2px",
                                  color: "#0f172a",
                                  fontFamily: "inherit",
                                  fontSize: "inherit",
                                  cursor: "pointer",
                                  boxSizing: "border-box",
                                }}
                              >
                                <option value="">Elegir 1–10…</option>
                                {Array.from({ length: 10 }, (_, i) => {
                                  const n = i + 1;
                                  const { emoji, label } = rpeBandMeta(n);
                                  return (
                                    <option key={n} value={String(n)}>
                                      {n} {emoji} {label}
                                    </option>
                                  );
                                })}
                              </select>
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {athleteCalendarCtxMenu && ctxMenuAthleteWorkout ? (
              <div
                ref={athleteCalendarCtxMenuRef}
                style={{
                  position: "fixed",
                  left: athleteCalendarCtxMenu.x,
                  top: athleteCalendarCtxMenu.y,
                  zIndex: 300,
                  minWidth: 240,
                  maxWidth: "min(92vw, 300px)",
                  background: "#ffffff",
                  borderRadius: 10,
                  boxShadow: "0 10px 40px rgba(15,23,42,.2)",
                  border: "1px solid #e2e8f0",
                  padding: 6,
                }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDone(ctxMenuAthleteWorkout);
                    closeAthleteCalendarCtxMenu();
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: ".82em",
                  }}
                >
                  {ctxMenuAthleteWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {athleteNeedsCoachLink ? (
        <div style={{ ...S.card, order: 3, marginTop: 16 }}>
          <div style={{ fontSize: ".68em", letterSpacing: ".14em", color: "#334155", textTransform: "uppercase", marginBottom: 14, fontWeight: 800 }}>
            ENCUENTRA TU COACH
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 8, fontWeight: 600 }}>Ingresa el código de tu coach</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <input
                type="text"
                value={findCoachCodeInput}
                onChange={(e) => setFindCoachCodeInput(e.target.value)}
                placeholder="Ej. primeros caracteres del ID del coach"
                style={{
                  flex: "1 1 200px",
                  minWidth: 160,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#0f172a",
                  fontFamily: "inherit",
                  fontSize: ".88em",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                disabled={findCoachCodeBusy}
                onClick={() => connectCoachByCode()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: findCoachCodeBusy ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)",
                  color: findCoachCodeBusy ? "#64748b" : "#fff",
                  fontWeight: 800,
                  cursor: findCoachCodeBusy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".85em",
                }}
              >
                {findCoachCodeBusy ? "…" : "Conectar"}
              </button>
            </div>
          </div>

          <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: 18 }}>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, fontWeight: 600 }}>Coaches públicos</div>
            {loadingPublicCoachesAthlete ? (
              <div style={{ color: "#94a3b8", fontSize: ".85em" }}>Cargando directorio…</div>
            ) : publicCoachesAthlete.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".85em" }}>No hay coaches públicos por ahora.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {publicCoachesAthlete.map((c) => {
                  const name = (c.full_name && String(c.full_name).trim()) || "Coach";
                  const spec = coachDirectorySpecialtyLabel(c);
                  const busy = selectCoachBusyId === String(c.user_id);
                  const initials = name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase() || "C";
                  return (
                    <div
                      key={c.user_id}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 14,
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid #e2e8f0",
                        background: "#f8fafc",
                      }}
                    >
                      {c.avatar_url ? (
                        <img
                          src={c.avatar_url}
                          alt=""
                          style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid #e2e8f0" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: "50%",
                            background: "linear-gradient(135deg,#f59e0b,#ea580c)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 900,
                            fontSize: ".95em",
                            flexShrink: 0,
                          }}
                        >
                          {initials}
                        </div>
                      )}
                      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".95em" }}>{name}</div>
                        <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 4 }}>{spec}</div>
                      </div>
                      <button
                        type="button"
                        disabled={busy || selectCoachBusyId !== ""}
                        onClick={() => selectPublicCoach(c.user_id)}
                        style={{
                          padding: "9px 16px",
                          borderRadius: 10,
                          border: "none",
                          background: busy || selectCoachBusyId !== "" ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                          color: busy || selectCoachBusyId !== "" ? "#64748b" : "#fff",
                          fontWeight: 800,
                          fontSize: ".8em",
                          cursor: busy || selectCoachBusyId !== "" ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {busy ? "…" : "Seleccionar coach"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
      </>
      )}

      {!athleteNotRegistered && (
      <div style={{ ...S.card, marginTop: 20, order: 4 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
            CHAT CON TU COACH
          </div>
          {coachIdForChat ? (
            <button
              type="button"
              onClick={clearAthleteChat}
              disabled={athleteChatClearing || athleteChatMessages.length === 0}
              style={{
                background: athleteChatClearing || athleteChatMessages.length === 0 ? "#f1f5f9" : "#fef2f2",
                border: `1px solid ${athleteChatMessages.length === 0 ? "#e2e8f0" : "#fecaca"}`,
                borderRadius: 8,
                padding: "6px 10px",
                color: athleteChatMessages.length === 0 ? "#94a3b8" : "#b91c1c",
                fontWeight: 700,
                cursor: athleteChatClearing || athleteChatMessages.length === 0 ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: ".72em",
              }}
            >
              🗑 Limpiar chat
            </button>
          ) : null}
        </div>
        {!coachIdForChat ? (
          <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos de coach. Contacta a soporte si esto continúa.</div>
        ) : (
          <>
            <div
              ref={athleteChatScrollRef}
              style={{
                maxHeight: 300,
                overflowY: "auto",
                padding: "10px 8px",
                borderRadius: 10,
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                marginBottom: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {athleteChatMessages.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div>
              ) : (
                athleteChatMessages.map((m) => {
                  const isCoach = m.sender_role === "coach";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isCoach ? "flex-end" : "flex-start",
                        maxWidth: "88%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: isCoach
                          ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(245,158,11,.75))"
                          : "#eff6ff",
                        border: `1px solid ${isCoach ? "rgba(245,158,11,.5)" : "rgba(59,130,246,.35)"}`,
                        color: isCoach ? "#f8fafc" : "#0f172a",
                        fontSize: ".82em",
                        lineHeight: 1.45,
                      }}
                    >
                      <div>{m.body}</div>
                      <div style={{ fontSize: ".65em", color: isCoach ? "rgba(255,255,255,.85)" : "#64748b", marginTop: 6 }}>
                        {formatMessageTimestamp(m.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                type="text"
                value={athleteChatDraft}
                onChange={(e) => setAthleteChatDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendAthleteChat()}
                placeholder="Escribe un mensaje a tu coach…"
                style={{
                  flex: 1,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#0f172a",
                  fontFamily: "inherit",
                  fontSize: ".85em",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={sendAthleteChat}
                disabled={athleteChatSending || !athleteChatDraft.trim()}
                style={{
                  background: athleteChatSending || !athleteChatDraft.trim() ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: athleteChatSending || !athleteChatDraft.trim() ? "#64748b" : "white",
                  fontWeight: 800,
                  cursor: athleteChatSending || !athleteChatDraft.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                  whiteSpace: "nowrap",
                }}
              >
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
      )}

      <div style={{ ...S.card, marginBottom: 18, order: 5 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 12 }}>MIS LOGROS</div>
        {(() => {
          const earnedMap = new Map(
            (earnedAchievements || []).map((e) => {
              const meta = achievementJoinMeta(e);
              return [meta?.code, e];
            }),
          );
          const totalKm = achProgress?.totalKm || 0;
          const nextKm = achievementKmTargets.find((x) => totalKm < x) || null;
          return (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 6 }}>
                  {nextKm
                    ? `Progreso al siguiente logro de km: ${totalKm.toFixed(1)} / ${nextKm} km`
                    : `Kilómetros acumulados: ${totalKm.toFixed(1)} km · máximo de hitos alcanzado`}
                </div>
                <div style={{ height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${nextKm ? Math.min(100, (totalKm / nextKm) * 100) : 100}%`,
                      height: "100%",
                      background: "linear-gradient(90deg,#f59e0b,#fbbf24)",
                      transition: "width .4s ease",
                    }}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 12 }}>
                {(achievementsCatalog || []).map((a) => {
                  const earned = earnedMap.get(a.code);
                  return (
                    <div
                      key={a.id}
                      className={earned ? "raf-medal-earned" : undefined}
                      style={{
                        border: earned ? "1px solid rgba(245,158,11,.35)" : "1px solid #e2e8f0",
                        borderRadius: 12,
                        padding: earned ? "16px 14px" : "16px 14px",
                        background: earned ? "linear-gradient(145deg,#fffbeb,#fff7ed)" : "#f8fafc",
                        opacity: earned ? 1 : 0.52,
                        filter: earned ? "none" : "grayscale(1)",
                        transition: "opacity .2s ease",
                        minHeight: earned ? 132 : 120,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: earned ? "2.5rem" : "2rem", lineHeight: 1, marginBottom: 8 }}>{earned ? a.icon : "🔒"}</div>
                      <div style={{ fontSize: ".76em", color: "#0f172a", fontWeight: 800, lineHeight: 1.25 }}>{a.name}</div>
                      <div style={{ fontSize: ".68em", color: "#64748b", marginTop: 6, lineHeight: 1.35 }}>
                        {earned
                          ? `Ganada el ${new Date(earned.earned_at).toLocaleDateString("es-CO", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : "Bloqueada"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>

      <div style={{ ...S.card, marginBottom: 18, order: 6 }}>
        <button
          type="button"
          onClick={() => setShowEvaluation((v) => !v)}
          style={{
            width: "100%",
            background: showEvaluation ? "rgba(14,165,233,.12)" : "#f8fafc",
            border: showEvaluation ? "1px solid rgba(14,165,233,.45)" : "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 14px",
            color: showEvaluation ? "#0369a1" : "#0f172a",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: ".82em",
            fontWeight: 700,
          }}
        >
          {showEvaluation ? "Ocultar evaluación" : "Hacer mi evaluación"}
        </button>
      </div>

      {showEvaluation && athleteInfo?.id && (
        <div style={{ marginBottom: 18, order: 7 }}>
          <EvaluationView
            athletes={[normalizeAthlete(athleteInfo)]}
            currentUserId={profile?.user_id ?? null}
            notify={(msg) => setMessage(msg)}
            athleteOnlyId={athleteInfo.id}
          />
        </div>
      )}

      {!athleteNotRegistered && (
      <div style={{ ...S.card, marginTop: 20, order: 8 }}>
        <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
          MI CONFIGURACIÓN
        </div>
        {(() => {
          const currentDevice = String(athleteInfo?.device || "").trim().toLowerCase();
          const corosConnected = currentDevice === "coros";
          return (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>COROS</div>
                  {corosConnected ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                        ✅ COROS conectado
                      </span>
                      <button type="button" onClick={() => setAthleteDeviceConnection(null)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setCorosModalOpen(true)} style={{ background: "linear-gradient(135deg,#2563eb,#3b82f6)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Conectar COROS</button>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>Garmin</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button type="button" onClick={() => setGarminModalOpen(true)} style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Conectar Garmin</button>
                    <span style={{ background: "rgba(245,158,11,.14)", border: "1px solid rgba(245,158,11,.35)", borderRadius: 999, padding: "4px 9px", color: "#b45309", fontSize: ".72em", fontWeight: 700 }}>
                      Próximamente
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>Strava</div>
                  {stravaConnection ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                        ✅ Strava conectado como {stravaConnection.strava_athlete_name || "atleta"}
                      </span>
                      <button
                        type="button"
                        onClick={disconnectStrava}
                        disabled={stravaDisconnecting}
                        style={{ background: stravaDisconnecting ? "#e2e8f0" : "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: stravaDisconnecting ? "#64748b" : "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: stravaDisconnecting ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                      >
                        Desconectar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={openAthleteStravaOAuth}
                      disabled={stravaSyncingCode}
                      style={{ background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontWeight: 800, cursor: stravaSyncingCode ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".74em" }}
                    >
                      🟠 Conectar Strava
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      )}

      <div style={{ ...S.card, marginBottom: 18, order: 9 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 12 }}>Mis Pagos</div>
        {loadingAthletePayments ? (
          <div style={{ color: "#64748b", fontSize: ".84em" }}>Cargando pagos…</div>
        ) : athletePayments.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: ".84em" }}>Tu coach aún no ha registrado pagos.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {athletePayments.map((p) => (
              <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ color: "#0f172a", fontWeight: 700, fontSize: ".84em" }}>
                    ${Number(p.amount || 0).toLocaleString("es-CO")} {p.currency || "COP"} · {p.plan}
                  </div>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontSize: ".68em",
                      fontWeight: 700,
                      background: p.status === "confirmed" ? "rgba(34,197,94,.16)" : p.status === "rejected" ? "rgba(239,68,68,.14)" : "rgba(245,158,11,.16)",
                      color: p.status === "confirmed" ? "#15803d" : p.status === "rejected" ? "#b91c1c" : "#b45309",
                    }}
                  >
                    {paymentStatusLabel(p.status)}
                  </span>
                </div>
                <div style={{ marginTop: 4, color: "#64748b", fontSize: ".74em" }}>
                  {new Date(p.payment_date).toLocaleDateString("es-CO")} · {p.payment_method}
                </div>
                {p.notes ? <div style={{ marginTop: 4, color: "#475569", fontSize: ".74em" }}>Notas: {p.notes}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {typeof Notification !== "undefined" &&
        Notification.permission !== "granted" &&
        !pushInviteDismissed && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              borderRadius: 12,
              background: "#fffbeb",
              border: "1px solid #fde68a",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              order: 10,
            }}
          >
            <span style={{ flex: "1 1 200px", color: "#78350f", fontSize: ".88em", fontWeight: 600 }}>
              Activa las notificaciones para recibir mensajes
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={async () => {
                  if (typeof localStorage !== "undefined") localStorage.removeItem("raf_push_invite_dismissed");
                  const { data: u } = await supabase.auth.getUser();
                  const uid = u?.user?.id;
                  if (!uid) return;
                  const token = await requestNotificationPermission();
                  if (token) await supabase.from("profiles").update({ fcm_token: token }).eq("user_id", uid).limit(1);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg,#b45309,#f59e0b)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: ".8em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Activar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (typeof localStorage !== "undefined") localStorage.setItem("raf_push_invite_dismissed", "1");
                  setPushInviteDismissed(true);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#64748b",
                  fontWeight: 700,
                  fontSize: ".8em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Ahora no
              </button>
            </div>
          </div>
        )}

      <div style={{ ...S.card, marginBottom: 18, order: 11 }}>
        <button
          type="button"
          onClick={async () => {
            const { error } = await supabase.auth.signOut();
            if (error) {
              console.error("Error al cerrar sesión:", error);
              alert(`Error al cerrar sesión: ${error.message}`);
            }
          }}
          style={{
            width: "100%",
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.25)",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#ef4444",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: ".82em",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          Cerrar sesión
        </button>
      </div>
      {corosModalOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
          <div style={{background:'white',borderRadius:'16px',padding:'24px',maxWidth:'420px',width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <h3 style={{marginBottom:'12px',fontSize:'18px',fontWeight:'700'}}>Sincronizar COROS</h3>
            <p style={{marginBottom:'20px',lineHeight:'1.7',color:'#444',fontSize:'14px'}}>COROS no ofrece API pública. Para sincronizar tus actividades automáticamente:<br/><br/>1️⃣ En tu app COROS ve a Perfil → Ajustes → Apps de terceros → Strava<br/>2️⃣ Conecta tu cuenta Strava<br/>3️⃣ Vuelve aquí y conecta Strava abajo<br/><br/>Cada actividad que termines en tu COROS llegará automáticamente a RunningApexFlow vía Strava.</p>
            <div style={{display:'flex',gap:'12px',justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button onClick={() => setCorosModalOpen(false)} style={{padding:'10px 20px',borderRadius:'8px',border:'1px solid #ddd',cursor:'pointer',fontFamily:'inherit'}}>Entendido</button>
              <button onClick={() => { setCorosModalOpen(false); openAthleteStravaOAuth && openAthleteStravaOAuth(); }} style={{padding:'10px 20px',borderRadius:'8px',background:'#E8410A',color:'white',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:'600'}}>Conectar Strava ahora</button>
            </div>
          </div>
        </div>
      )}
      {garminModalOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
          <div style={{background:'white',borderRadius:'16px',padding:'24px',maxWidth:'420px',width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <h3 style={{marginBottom:'12px',fontSize:'18px',fontWeight:'700'}}>Conectar Garmin</h3>
            <p style={{marginBottom:'20px',lineHeight:'1.7',color:'#444',fontSize:'14px'}}>Garmin requiere aprobación empresarial para API directa. Para sincronizar tus actividades automáticamente:<br/><br/>1️⃣ En Garmin Connect ve a Configuración → Aplicaciones de terceros → Strava<br/>2️⃣ Activa la sincronización con Strava<br/>3️⃣ Vuelve aquí y conecta Strava abajo<br/><br/>Cada actividad que termines en tu Garmin llegará automáticamente a RunningApexFlow vía Strava.</p>
            <div style={{display:'flex',gap:'12px',justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button onClick={() => setGarminModalOpen(false)} style={{padding:'10px 20px',borderRadius:'8px',border:'1px solid #ddd',cursor:'pointer',fontFamily:'inherit'}}>Entendido</button>
              <button onClick={() => { setGarminModalOpen(false); openAthleteStravaOAuth && openAthleteStravaOAuth(); }} style={{padding:'10px 20px',borderRadius:'8px',background:'#E8410A',color:'white',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:'600'}}>Conectar Strava ahora</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Plan2Weeks({ athletes, notify, coachUserId, coachPlan, onGoToPlans, onPlanAssigned }) {
  const S = styles;
  const [athleteId, setAthleteId] = useState("");
  const [competition, setCompetition] = useState("Maratón");
  const [targetTime, setTargetTime] = useState("");
  const [levelId, setLevelId] = useState("intermedio");
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [raceDate, setRaceDate] = useState(() => formatLocalYMD(addDays(new Date(), 14)));
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [openWeeks, setOpenWeeks] = useState(() => new Set());
  const [planAssignedSuccess, setPlanAssignedSuccess] = useState(false);
  const [planEditModal, setPlanEditModal] = useState(null);
  const [editDraft, setEditDraft] = useState({
    title: "",
    type: "easy",
    total_km: 0,
    duration_min: 0,
    weekday: 2,
  });
  const [monthGenerations, setMonthGenerations] = useState(0);
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const [generationLimitMsg, setGenerationLimitMsg] = useState("");
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const isBasicPlan = useMemo(() => {
    const p = String(coachPlan || "").toLowerCase();
    return p === "basico" || p === "básico" || p === "starter" || p === "";
  }, [coachPlan]);
  const competitionOptions = useMemo(
    () => ["Maratón", "Media Maratón", "10K", "5K", "Trail Running", "Otro"],
    [],
  );
  const targetTimePlaceholder = useMemo(() => {
    if (competition === "Maratón") return "3:45:00";
    if (competition === "Media Maratón") return "1:45:00";
    if (competition === "10K") return "00:45:00";
    if (competition === "5K") return "00:22:00";
    if (competition === "Trail Running") return "05:30:00";
    return "hh:mm:ss";
  }, [competition]);

  const loadGenerationCounter = useCallback(async () => {
    if (!coachUserId) {
      setMonthGenerations(0);
      return;
    }
    setLoadingGenerations(true);
    const { data, error } = await supabase
      .from("ai_generations")
      .select("count")
      .eq("coach_id", coachUserId)
      .eq("month", monthKey)
      .maybeSingle();
    setLoadingGenerations(false);
    if (error) {
      console.error("ai_generations load (plan2):", error);
      return;
    }
    setMonthGenerations(Number(data?.count) || 0);
  }, [coachUserId, monthKey]);

  const incrementGenerationCounter = useCallback(async () => {
    if (!coachUserId) return;
    const nextCount = (Number(monthGenerations) || 0) + 1;
    const { error: updErr } = await supabase
      .from("ai_generations")
      .update({ count: nextCount, updated_at: new Date().toISOString() })
      .eq("coach_id", coachUserId)
      .eq("month", monthKey);
    if (updErr) {
      const { error: insErr } = await supabase.from("ai_generations").insert({
        coach_id: coachUserId,
        month: monthKey,
        count: 1,
        updated_at: new Date().toISOString(),
      });
      if (insErr) {
        console.error("ai_generations increment (plan2):", insErr);
        return;
      }
      setMonthGenerations(1);
      return;
    }
    setMonthGenerations(nextCount);
  }, [coachUserId, monthGenerations, monthKey]);

  useEffect(() => {
    loadGenerationCounter();
  }, [loadGenerationCounter]);

  useEffect(() => {
    if (athletes?.length && !athleteId) {
      setAthleteId(String(athletes[0].id));
    }
  }, [athletes, athleteId]);

  useEffect(() => {
    setPlanAssignedSuccess(false);
  }, [athleteId]);

  useEffect(() => {
    if (!planEditModal || !generatedPlan) return;
    const week = generatedPlan.weeks.find((w) => Number(w.week_number) === planEditModal.weekNumber);
    if (!week) return;
    if (planEditModal.workoutIdx === "new") {
      setEditDraft({ title: "", type: "easy", total_km: 0, duration_min: 0, weekday: 2 });
      return;
    }
    const wo = week.workouts?.[planEditModal.workoutIdx];
    if (!wo) {
      setPlanEditModal(null);
      return;
    }
    setEditDraft({
      title: String(wo.title || ""),
      type: WORKOUT_TYPES.some((t) => t.id === wo.type) ? wo.type : "easy",
      total_km: Number(wo.total_km ?? wo.km) || 0,
      duration_min: Number(wo.duration_min) || 0,
      weekday: Math.min(7, Math.max(1, Number(wo.weekday) || 2)),
    });
  }, [planEditModal, generatedPlan]);

  const toggleWeek = (weekNum) => {
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  };

  const plan2SystemPrompt = `You are an elite running coach for ${BRAND_NAME}. Output ONLY compact valid JSON. No markdown, no code fences, no extra text.
weekday: always 1=Monday .. 7=Sunday.

Fixed weekly template (same both weeks). Session types MUST match exactly:
- weekday 2 (Tuesday): type "long" — Rodaje largo
- weekday 3 (Wednesday): type "tempo" — Tempo
- weekday 4 (Thursday): type "recovery" — Recuperación
- weekday 6 (Saturday): type "interval" — Intervalos
- weekday 7 (Sunday): type "long" — Largo

If the user requests fewer than 5 sessions per week, OMIT sessions in this strict order until the count matches: (1) omit Sunday (weekday 7), (2) then omit Thursday (weekday 4), (3) then omit Wednesday (weekday 3). The remaining sessions keep the same weekdays and types as above.
Examples: N=5 → weekdays 2,3,4,6,7; N=4 → 2,3,4,6; N=3 → 2,3,6.

Schema (description ≤120 chars):
{
  "plan_title": "short string",
  "weeks": [
    {
      "week_number": 1,
      "focus": "optional ≤4 words",
      "workouts": [
        { "weekday": 2, "title": "string", "type": "long|tempo|recovery|interval", "total_km": 0, "duration_min": 0, "description": "string" }
      ]
    }
  ]
}
Rules:
- Exactly 2 weeks (week_number 1 then 2). Each week: EXACTLY N workouts (N is 3, 4, or 5 from user). Same N and same weekday/type pattern both weeks.
- Every workout must use one of the allowed weekday+type pairs from the template after applying the omission rule for that N.
- Titles should reflect the session (e.g. rodaje largo, tempo, recuperación, intervalos, largo) in the plan language but types must be exact enum values.
- Week 2 is race week: adjust volume/quality vs week 1 but never change weekdays or session types for that N.
- No extra JSON keys. All numeric fields must be numbers.`;

  const plan2UserPrompt = useMemo(() => {
    const levelLabel = PLAN_12_LEVELS.find((l) => l.id === levelId)?.label || levelId;
    return `2-week running plan JSON only.

Goal: ${competition} in ${targetTime}. Level: ${levelLabel}.
Sessions per week (N): ${daysPerWeek} — same N in week 1 and week 2.
Race date (week 2 contains this date): ${raceDate}

Follow the FIXED calendar exactly:
- Martes weekday=2: rodaje largo → type "long"
- Miércoles weekday=3: tempo → type "tempo"
- Jueves weekday=4: recuperación → type "recovery"
- Sábado weekday=6: intervalos → type "interval"
- Domingo weekday=7: largo → type "long"

If N<5, drop sessions in order: first domingo (7), then jueves (4), then miércoles (3). N=4 → keep 2,3,4,6. N=3 → keep 2,3,6.

Output 2 week objects with the correct ${daysPerWeek} workouts each; each workout: weekday, title, type, total_km, duration_min, short description.`;
  }, [competition, targetTime, levelId, daysPerWeek, raceDate]);

  const generatePlan2 = async () => {
    const timeOk = /^\d{1,2}:\d{2}:\d{2}$/.test(String(targetTime || "").trim());
    if (!competition || !String(competition).trim() || !String(targetTime || "").trim()) {
      notify("Completa competencia y tiempo objetivo antes de generar.");
      return;
    }
    if (!timeOk) {
      notify("El tiempo objetivo debe tener formato hh:mm:ss.");
      return;
    }
    if (isBasicPlan && monthGenerations >= 100) {
      setGenerationLimitMsg("Has alcanzado el límite de 100 generaciones del plan Básico. Actualiza al plan Pro para generaciones ilimitadas.");
      return;
    }
    setGenerationLimitMsg("");
    setPlanAssignedSuccess(false);
    setPlanEditModal(null);
    setPlanLoading(true);
    setGeneratedPlan(null);
    try {
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 3000,
          system: plan2SystemPrompt,
          messages: [{ role: "user", content: plan2UserPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Plan 2 semanas API error:", data);
        notify("Error al generar el plan (API).");
        return;
      }
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const parsed = extractJsonFromAnthropicText(text);
      const byWeek = new Map((parsed?.weeks || []).map((w) => [Number(w.week_number) || 0, w]));
      const orderedWeeks = [1, 2].map((n) => byWeek.get(n)).filter(Boolean);
      if (!parsed || orderedWeeks.length < 2) {
        console.error("Plan JSON inválido:", text?.slice?.(0, 500));
        notify("La IA no devolvió un plan válido (semanas 1–2). Intenta de nuevo.");
        return;
      }
      const countMismatch = orderedWeeks.some((w) => (Array.isArray(w.workouts) ? w.workouts.length : 0) !== daysPerWeek);
      if (countMismatch) {
        notify(`Cada semana debe tener exactamente ${daysPerWeek} sesiones. Reintenta la generación.`);
        return;
      }
      const distErr = validatePlan2Distribution(orderedWeeks, daysPerWeek);
      if (distErr) {
        notify("El plan no respeta la distribución fija (martes largo, miércoles tempo, etc.). Reintenta la generación.");
        return;
      }
      setGeneratedPlan({ ...parsed, weeks: orderedWeeks });
      setOpenWeeks(new Set([1, 2]));
      await incrementGenerationCounter();
      notify("Plan de 2 semanas generado ✓");
    } catch (e) {
      console.error(e);
      notify("Error al procesar el plan.");
    } finally {
      setPlanLoading(false);
    }
  };

  const assignPlanToAthlete = async () => {
    if (!generatedPlan?.weeks?.length) {
      alert("Genera un plan antes de asignar.");
      return;
    }
    if (!athleteId) {
      alert("Selecciona un atleta.");
      return;
    }
    if (!raceDate) {
      alert("Indica la fecha de la carrera.");
      return;
    }
    const selectedAthlete = (athletes || []).find((a) => String(a.id) === String(athleteId));
    if (!selectedAthlete?.id) {
      alert("No se encontró el atleta.");
      return;
    }

    const race = new Date(`${raceDate}T12:00:00`);
    const raceMonday = startOfWeekMonday(race);
    const planStartMonday = addDays(raceMonday, -1 * 7);

    const rows = [];
    for (const week of generatedPlan.weeks) {
      const wn = Number(week.week_number) || 0;
      if (wn < 1 || wn > 2) continue;
      const list = Array.isArray(week.workouts) ? week.workouts : [];
      for (const wo of list) {
        let wd = Number(wo.weekday);
        if (!Number.isFinite(wd) || wd < 1) wd = 1;
        if (wd > 7) wd = 7;
        const offsetDays = (wn - 1) * 7 + (wd - 1);
        const sessionDate = addDays(planStartMonday, offsetDays);
        const scheduled_date = formatLocalYMD(sessionDate);
        const typeRaw = wo.type || "easy";
        const type = WORKOUT_TYPES.some((t) => t.id === typeRaw) ? typeRaw : "easy";
        const kmVal = wo.total_km ?? wo.km;
        let structure = wo.structure;
        if (!Array.isArray(structure)) structure = [];
        rows.push({
          athlete_id: selectedAthlete.id,
          title: String(wo.title || "Entrenamiento"),
          type,
          total_km: Number.isFinite(Number(kmVal)) ? Number(kmVal) : 0,
          duration_min: Number.isFinite(Number(wo.duration_min)) ? Number(wo.duration_min) : 0,
          description: String(wo.description || ""),
          structure,
          scheduled_date,
          done: false,
        });
      }
    }

    if (!rows.length) {
      alert("No hay entrenamientos en el plan para guardar.");
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      alert(userError?.message || "No hay usuario autenticado.");
      return;
    }
    const coachId = userData.user.id;
    const payload = rows.map((r) => ({ ...r, coach_id: coachId }));

    setAssignLoading(true);
    try {
      const { error } = await supabase.from("workouts").insert(payload);
      if (error) {
        console.error("Error insertando plan:", error);
        alert(`Error: ${error.message}`);
        return;
      }

      setPlanAssignedSuccess(true);
      onPlanAssigned?.();

      if (selectedAthlete.email) {
        try {
          const weekSummary = (generatedPlan.weeks || [])
            .map((w) => {
              const n = Number(w.week_number) || 0;
              const c = Array.isArray(w.workouts) ? w.workouts.length : 0;
              return `<li>Semana ${n}: ${c} sesiones</li>`;
            })
            .join("");
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: selectedAthlete.email,
              subject: `Tu plan de 2 semanas: ${generatedPlan.plan_title || BRAND_NAME}`,
              html: `
                <h2>Hola ${selectedAthlete.name} 👋</h2>
                <p>Tu coach te ha asignado un <strong>plan de 2 semanas</strong> en ${BRAND_NAME}.</p>
                <p><strong>Objetivo:</strong> ${competition} en ${targetTime}<br/>
                <strong>Carrera:</strong> ${raceDate}</p>
                <p><strong>${generatedPlan.plan_title || "Plan personalizado"}</strong></p>
                <ul>${weekSummary}</ul>
                <p>Total: <strong>${rows.length}</strong> entrenamientos cargados en tu calendario.</p>
                <p>¡Mucho éxito! 💪</p>
                <p>— ${BRAND_NAME}</p>
              `,
            }),
          });
        } catch (e) {
          console.error("send-email plan12:", e);
        }
      }
      notify(`Plan asignado: ${rows.length} workouts guardados.`);
    } finally {
      setAssignLoading(false);
    }
  };

  const deletePlanWorkout = (weekNumber, workoutIndex, e) => {
    e?.stopPropagation?.();
    setGeneratedPlan((prev) => {
      if (!prev?.weeks) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w) => {
          if (Number(w.week_number) !== weekNumber) return w;
          return { ...w, workouts: (w.workouts || []).filter((_, i) => i !== workoutIndex) };
        }),
      };
    });
  };

  const savePlanEditModal = () => {
    if (!planEditModal || !generatedPlan) return;
    const { weekNumber, workoutIdx } = planEditModal;
    setGeneratedPlan((prev) => {
      if (!prev?.weeks) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w) => {
          if (Number(w.week_number) !== weekNumber) return w;
          const list = [...(w.workouts || [])];
          const prevWo = workoutIdx !== "new" ? { ...(list[workoutIdx] || {}) } : {};
          const merged = {
            ...prevWo,
            title: editDraft.title.trim() || "Entrenamiento",
            type: editDraft.type,
            total_km: Number(editDraft.total_km) || 0,
            duration_min: Number(editDraft.duration_min) || 0,
            weekday: Math.min(7, Math.max(1, Number(editDraft.weekday) || 1)),
            description: typeof prevWo.description === "string" ? prevWo.description : "",
          };
          if (workoutIdx === "new") list.push(merged);
          else list[workoutIdx] = merged;
          return { ...w, workouts: list };
        }),
      };
    });
    setPlanEditModal(null);
  };

  const inputStyle = {
    width: "100%",
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#0f172a",
    fontFamily: "inherit",
    fontSize: ".85em",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: ".72em", color: "#64748b", marginBottom: 6 };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.pageTitle}>Plan 2 Semanas</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          Distribución fija: mar largo · mié tempo · jue recuperación · sáb intervalos · dom largo. Con menos de 5 sesiones se quitan primero domingo, luego jueves y miércoles. Semana 2 = semana de carrera.
        </p>
        <div style={{ marginTop: 8, color: "#64748b", fontSize: ".8em", fontWeight: 600 }}>
          {isBasicPlan ? `${loadingGenerations ? "…" : monthGenerations} / 100 generaciones usadas este mes` : "Ilimitado"}
        </div>
      </div>
      {generationLimitMsg ? (
        <div style={{ ...S.card, marginBottom: 14, border: "1px solid rgba(245,158,11,.4)", background: "#fffbeb" }}>
          <div style={{ color: "#92400e", fontSize: ".84em", fontWeight: 700, marginBottom: 10 }}>{generationLimitMsg}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onGoToPlans}
              style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
            >
              Ver Planes
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 22, alignItems: "start" }}>
        <div style={S.card}>
          <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 16 }}>Parámetros del plan</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={labelStyle}>Atleta</div>
              <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)} style={inputStyle}>
                <option value="" disabled>{athletes?.length ? "Selecciona…" : "Sin atletas"}</option>
                {(athletes || []).map((a) => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Competencia</div>
              <select value={competition} onChange={(e) => setCompetition(e.target.value)} style={inputStyle}>
                {competitionOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Tiempo objetivo</div>
              <input
                type="text"
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
                placeholder={targetTimePlaceholder}
                style={inputStyle}
              />
            </div>
            <div>
              <div style={labelStyle}>Nivel</div>
              <select value={levelId} onChange={(e) => setLevelId(e.target.value)} style={inputStyle}>
                {PLAN_12_LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Sesiones por semana (3, 4 o 5)</div>
              <select value={String(daysPerWeek)} onChange={(e) => setDaysPerWeek(Number(e.target.value))} style={inputStyle}>
                {[3, 4, 5].map((d) => (
                  <option key={d} value={String(d)}>{d} sesiones</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Fecha de la carrera objetivo</div>
              <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} style={inputStyle} />
            </div>
            <button
              type="button"
              onClick={generatePlan2}
              disabled={planLoading || !athletes?.length}
              style={{
                marginTop: 6,
                width: "100%",
                background: planLoading || !athletes?.length ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                border: "none",
                borderRadius: 8,
                padding: "12px 16px",
                color: planLoading || !athletes?.length ? "#334155" : "white",
                fontWeight: 800,
                cursor: planLoading || !athletes?.length ? "not-allowed" : "pointer",
                fontSize: ".85em",
                fontFamily: "inherit",
              }}
            >
              {planLoading ? "⏳ Generando plan…" : "⚡ Generar Plan con IA"}
            </button>
            {generatedPlan && (
              <button
                type="button"
                onClick={assignPlanToAthlete}
                disabled={assignLoading || !athleteId}
                style={{
                  width: "100%",
                  background: assignLoading || !athleteId ? "#e2e8f0" : "rgba(59,130,246,.18)",
                  border: `1px solid ${assignLoading || !athleteId ? "#e2e8f0" : "rgba(59,130,246,.45)"}`,
                  borderRadius: 8,
                  padding: "12px 16px",
                  color: assignLoading || !athleteId ? "#475569" : "#93c5fd",
                  fontWeight: 800,
                  cursor: assignLoading || !athleteId ? "not-allowed" : "pointer",
                  fontSize: ".85em",
                  fontFamily: "inherit",
                }}
              >
                {assignLoading ? "Guardando…" : "Asignar Plan al Atleta"}
              </button>
            )}
            {planAssignedSuccess && (
              <button
                type="button"
                onClick={() => {
                  setPlanAssignedSuccess(false);
                  setPlanEditModal(null);
                  setGeneratedPlan(null);
                  setOpenWeeks(new Set());
                  const next = addDays(new Date(`${raceDate}T12:00:00`), 14);
                  setRaceDate(formatLocalYMD(next));
                  notify("Siguiente bloque: fecha de carrera avanzada 2 semanas. Genera el plan con IA cuando quieras.");
                }}
                style={{
                  width: "100%",
                  marginTop: 4,
                  background: "rgba(34,197,94,.12)",
                  border: "1px solid rgba(34,197,94,.4)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  color: "#4ade80",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontSize: ".85em",
                  fontFamily: "inherit",
                }}
              >
                ⚡ Generar Siguiente Bloque
              </button>
            )}
          </div>
        </div>

        <div style={S.card}>
          <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Vista previa</div>
          {generatedPlan && (
            <p style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, marginTop: -6 }}>
              Usá ✏️ para editar una sesión. El estado completado solo se marca en el calendario del atleta, no aquí.
            </p>
          )}
          {!generatedPlan ? (
            <div style={{ color: "#64748b", fontSize: ".88em", lineHeight: 1.5 }}>
              Completa el formulario y pulsa <strong>Generar Plan con IA</strong>. Aquí verás las 2 semanas en acordeón con todas las sesiones.
            </div>
          ) : (
            <>
              <div style={{ fontSize: "1.05em", fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>{generatedPlan.plan_title || "Plan 2 semanas"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...generatedPlan.weeks].sort((a, b) => (Number(a.week_number) || 0) - (Number(b.week_number) || 0)).map((week) => {
                  const n = Number(week.week_number) || 0;
                  const open = openWeeks.has(n);
                  const wos = Array.isArray(week.workouts) ? week.workouts : [];
                  return (
                    <div key={n} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => toggleWeek(n)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 14px",
                          background: open ? "rgba(245,158,11,.1)" : "#f8fafc",
                          border: "none",
                          color: "#0f172a",
                          fontFamily: "inherit",
                          fontWeight: 700,
                          fontSize: ".88em",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span>
                          Semana {n}
                          {week.focus ? <span style={{ color: "#64748b", fontWeight: 500 }}> · {week.focus}</span> : null}
                        </span>
                        <span style={{ color: "#94a3b8" }}>{open ? "▼" : "▶"}</span>
                      </button>
                      {open && (
                        <div style={{ padding: "10px 14px 14px", background: "rgba(0,0,0,.12)" }}>
                          <button
                            type="button"
                            onClick={() => setPlanEditModal({ weekNumber: n, workoutIdx: "new" })}
                            style={{
                              width: "100%",
                              marginBottom: 12,
                              background: "rgba(245,158,11,.1)",
                              border: "1px dashed rgba(245,158,11,.35)",
                              borderRadius: 8,
                              padding: "8px 12px",
                              color: "#fbbf24",
                              fontWeight: 700,
                              fontSize: ".8em",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            ＋ Agregar Sesión
                          </button>
                          {wos.length === 0 ? (
                            <div style={{ color: "#64748b", fontSize: ".82em" }}>Sin sesiones en esta semana.</div>
                          ) : (
                            wos.map((wo, idx) => {
                              const wd = Number(wo.weekday) || 1;
                              const dayName = DAYS[wd - 1] || `Día ${wd}`;
                              const wt = WORKOUT_TYPES.find((t) => t.id === wo.type) || WORKOUT_TYPES[0];
                              return (
                                <div
                                  key={`${n}-${idx}-${wo.title}-${wo.weekday}`}
                                  style={{
                                    marginBottom: idx === wos.length - 1 ? 0 : 10,
                                    padding: 10,
                                    borderRadius: 8,
                                    background: "#f8fafc",
                                    borderLeft: `3px solid ${wt.color}`,
                                    display: "flex",
                                    gap: 10,
                                    alignItems: "flex-start",
                                  }}
                                >
                                  <div style={{ flex: 1, minWidth: 0, cursor: "default" }}>
                                    <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 4 }}>{dayName}</div>
                                    <div style={{ fontWeight: 700, color: "#0f172a", fontSize: ".88em" }}>{wo.title || "Sin título"}</div>
                                    <div style={{ fontSize: ".76em", color: "#94a3b8", marginTop: 4 }}>
                                      {Number(wo.total_km ?? wo.km) || 0} km · {wo.duration_min} min · <span style={{ color: wt.color }}>{wt.label}</span>
                                    </div>
                                    {wo.description && <div style={{ fontSize: ".78em", color: "#cbd5e1", marginTop: 8, lineHeight: 1.45 }}>{wo.description}</div>}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                                    <button
                                      type="button"
                                      title="Editar sesión"
                                      onClick={() => {
                                        console.log("Abriendo editor");
                                        setPlanEditModal({ weekNumber: n, workoutIdx: idx });
                                      }}
                                      style={{
                                        background: "rgba(245,158,11,.14)",
                                        border: "1px solid rgba(245,158,11,.35)",
                                        borderRadius: 6,
                                        padding: "6px 10px",
                                        cursor: "pointer",
                                        fontSize: ".85em",
                                        lineHeight: 1,
                                      }}
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      type="button"
                                      title="Eliminar sesión"
                                      onClick={(e) => deletePlanWorkout(n, idx, e)}
                                      style={{
                                        background: "rgba(239,68,68,.12)",
                                        border: "1px solid rgba(239,68,68,.3)",
                                        borderRadius: 6,
                                        padding: "6px 10px",
                                        cursor: "pointer",
                                        fontSize: ".85em",
                                        lineHeight: 1,
                                      }}
                                    >
                                      🗑
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {planEditModal && (
        <>
          {(() => {
            console.log("planEditModal vale:", planEditModal);
            return null;
          })()}
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 220, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 420, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>
              {planEditModal.workoutIdx === "new" ? "Nueva sesión" : "Editar sesión"}
            </div>
            <div style={{ fontSize: ".75em", color: "#64748b", marginBottom: 14 }}>
              Semana {planEditModal.weekNumber}. El día de la semana define la fecha al asignar.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={labelStyle}>Título</div>
                <input
                  value={editDraft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Ej: Rodaje suave 45'"
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>Tipo</div>
                <select
                  value={editDraft.type}
                  onChange={(e) => setEditDraft((d) => ({ ...d, type: e.target.value }))}
                  style={inputStyle}
                >
                  {WORKOUT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={labelStyle}>Km</div>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={editDraft.total_km}
                    onChange={(e) => setEditDraft((d) => ({ ...d, total_km: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>Duración (min)</div>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={editDraft.duration_min}
                    onChange={(e) => setEditDraft((d) => ({ ...d, duration_min: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div>
                <div style={labelStyle}>Día de la semana</div>
                <select
                  value={String(editDraft.weekday)}
                  onChange={(e) => setEditDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                  style={inputStyle}
                >
                  {DAYS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>{label} ({i + 1})</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setPlanEditModal(null)}
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: ".82em",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={savePlanEditModal}
                style={{
                  background: "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "white",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: ".82em",
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

function WorkoutLibrary({ coachUserId, libraryRefresh, onUseWorkout, athletes, notify, profileRole, adminLibraryOwnerId, onCopiedGlobalToLibrary }) {
  const S = styles;
  const [libraryTab, setLibraryTab] = useState("mine");
  const [items, setItems] = useState([]);
  const [globalRows, setGlobalRows] = useState([]);
  const [globalNameByCoach, setGlobalNameByCoach] = useState({});
  const [loading, setLoading] = useState(true);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [assignAthleteId, setAssignAthleteId] = useState("");
  const [assignDate, setAssignDate] = useState(() => formatLocalYMD(new Date()));
  const [assignSaving, setAssignSaving] = useState(false);
  const [globalCopyingId, setGlobalCopyingId] = useState(null);

  const load = useCallback(async () => {
    if (!coachUserId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("workout_library")
      .select("*")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("workout_library:", error);
      setItems([]);
      notify("Error al cargar la biblioteca");
    } else {
      setItems((data || []).map(normalizeLibraryRow));
    }
    setLoading(false);
  }, [coachUserId, notify]);

  const isLibraryAdmin = profileRole === "admin";

  const loadGlobalAll = useCallback(async () => {
    if (!isLibraryAdmin || !coachUserId) {
      setGlobalRows([]);
      setGlobalNameByCoach({});
      return;
    }
    setGlobalLoading(true);
    const { data, error } = await supabase.from("workout_library").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("workout_library global:", error);
      setGlobalRows([]);
      setGlobalNameByCoach({});
      notify("No se pudo cargar la biblioteca global.");
      setGlobalLoading(false);
      return;
    }
    const rows = (data || []).map(normalizeLibraryRow);
    setGlobalRows(rows);
    const ids = [...new Set(rows.map((r) => r.coach_id).filter(Boolean))];
    if (ids.length === 0) {
      setGlobalNameByCoach({});
      setGlobalLoading(false);
      return;
    }
    const { data: profs, error: pErr } = await supabase.from("profiles").select("user_id,name,email").in("user_id", ids);
    if (pErr) console.warn("profiles names global library:", pErr);
    const nm = {};
    for (const p of profs || []) {
      nm[p.user_id] = (p.name && String(p.name).trim()) || p.user_id;
    }
    setGlobalNameByCoach(nm);
    setGlobalLoading(false);
  }, [isLibraryAdmin, coachUserId, notify]);

  useEffect(() => {
    load();
  }, [load, libraryRefresh]);

  useEffect(() => {
    if (libraryTab === "global" && isLibraryAdmin) loadGlobalAll();
  }, [libraryTab, isLibraryAdmin, loadGlobalAll, libraryRefresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const typeLabel = (WORKOUT_TYPES.find((t) => t.id === row.type)?.label || row.type || "").toLowerCase();
      return (
        (row.title || "").toLowerCase().includes(q) ||
        (row.type || "").toLowerCase().includes(q) ||
        typeLabel.includes(q)
      );
    });
  }, [items, search]);

  const deleteRow = async (id) => {
    if (!coachUserId) return;
    setDeletingId(id);
    const { error } = await supabase.from("workout_library").delete().eq("id", id).eq("coach_id", coachUserId);
    setDeletingId(null);
    if (error) {
      console.error(error);
      notify(`Error al eliminar: ${error.message}`);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
    notify("Eliminado de la biblioteca");
  };

  const assignDirectly = async (row) => {
    if (!coachUserId) return;
    if (!assignAthleteId) {
      notify("Selecciona un atleta");
      return;
    }
    if (!assignDate) {
      notify("Selecciona la fecha");
      return;
    }
    setAssignSaving(true);
    const payload = {
      athlete_id: assignAthleteId,
      coach_id: coachUserId,
      title: row.title,
      type: row.type,
      total_km: Number(row.total_km) || 0,
      duration_min: Number(row.duration_min) || 0,
      description: row.description || "",
      done: false,
      scheduled_date: assignDate,
    };
    const { error } = await supabase.from("workouts").insert(payload);
    setAssignSaving(false);
    if (error) {
      console.error(error);
      notify(`Error al asignar: ${error.message}`);
      return;
    }
    notify("Workout asignado directamente al atleta ✓");
    setAssigningId(null);
  };

  const globalGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = globalRows;
    if (q) {
      list = globalRows.filter((row) => {
        const typeLabel = (WORKOUT_TYPES.find((t) => t.id === row.type)?.label || row.type || "").toLowerCase();
        const coachLabel = (globalNameByCoach[row.coach_id] || "").toLowerCase();
        return (
          (row.title || "").toLowerCase().includes(q) ||
          (row.type || "").toLowerCase().includes(q) ||
          typeLabel.includes(q) ||
          coachLabel.includes(q)
        );
      });
    }
    const byCoach = {};
    for (const row of list) {
      const cid = row.coach_id;
      if (!byCoach[cid]) byCoach[cid] = [];
      byCoach[cid].push(row);
    }
    const coachIds = Object.keys(byCoach).sort((a, b) =>
      String(globalNameByCoach[a] || a).localeCompare(String(globalNameByCoach[b] || b)),
    );
    return { byCoach, coachIds };
  }, [globalRows, globalNameByCoach, search]);

  const copyGlobalWorkoutToMine = async (row) => {
    if (!adminLibraryOwnerId) return;
    setGlobalCopyingId(row.id);
    const structure = Array.isArray(row.structure) ? row.structure : [];
    const wtype = row.workout_type || row.type;
    const typeId = WORKOUT_TYPES.some((t) => t.id === wtype) ? wtype : WORKOUT_TYPES.some((t) => t.id === row.type) ? row.type : "easy";
    const dist = Number.isFinite(Number(row.distance_km))
      ? Number(row.distance_km)
      : Number.isFinite(Number(row.total_km))
        ? Number(row.total_km)
        : 0;
    const ins = {
      coach_id: adminLibraryOwnerId,
      title: (row.title && String(row.title).trim()) || "Workout",
      type: typeId,
      workout_type: String(wtype || typeId),
      total_km: dist,
      distance_km: dist,
      duration_min: Number.isFinite(Number(row.duration_min)) ? Math.round(Number(row.duration_min)) : 0,
      description: row.description != null ? String(row.description) : "",
      structure,
    };
    if (row.intensity) ins.intensity = String(row.intensity);
    if (row.notes) ins.notes = String(row.notes);
    const { error } = await supabase.from("workout_library").insert(ins);
    setGlobalCopyingId(null);
    if (error) {
      notify(error.message || "No se pudo copiar.");
      return;
    }
    notify("Copiado a tu biblioteca ✓");
    if (typeof onCopiedGlobalToLibrary === "function") onCopiedGlobalToLibrary();
    load();
  };

  const libTabBtn = (active) => ({
    padding: "10px 16px",
    borderRadius: 10,
    border: active ? "none" : "1px solid #e2e8f0",
    background: active ? "linear-gradient(135deg,#6366f1,#818cf8)" : "#fff",
    color: active ? "#fff" : "#475569",
    fontWeight: 800,
    fontSize: ".82em",
    cursor: "pointer",
    fontFamily: "inherit",
  });

  const showGlobalTab = Boolean(isLibraryAdmin);
  const activeTab = showGlobalTab ? libraryTab : "mine";

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={S.pageTitle}>Biblioteca</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          Workouts guardados para reutilizar en el generador y asignar a atletas
        </p>
        {showGlobalTab ? (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={libTabBtn(activeTab === "mine")} onClick={() => setLibraryTab("mine")}>
              Mi biblioteca
            </button>
            <button type="button" style={libTabBtn(activeTab === "global")} onClick={() => setLibraryTab("global")}>
              📚 Todos los coaches
            </button>
          </div>
        ) : null}
      </div>
      <div style={{ ...S.card, marginBottom: 18 }}>
        <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 8 }}>Buscar por nombre o tipo</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ej: tempo, intervalos, rodaje…"
          style={{
            width: "100%",
            maxWidth: 400,
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
            color: "#0f172a",
            fontFamily: "inherit",
            fontSize: ".85em",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>
      {!coachUserId ? (
        <div style={{ color: "#64748b", fontSize: ".9em" }}>Inicia sesión para ver tu biblioteca.</div>
      ) : activeTab === "global" && showGlobalTab ? (
        globalLoading ? (
          <div style={{ color: "#64748b", fontSize: ".9em" }}>Cargando todos los coaches…</div>
        ) : globalRows.length === 0 ? (
          <div style={{ ...S.card, color: "#64748b", fontSize: ".9em" }}>No hay workouts en bibliotecas.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {globalGrouped.coachIds.map((cid) => (
              <div key={cid}>
                <div style={{ fontSize: ".78em", fontWeight: 800, color: "#475569", marginBottom: 10, letterSpacing: ".04em" }}>
                  Coach: {globalNameByCoach[cid] || cid}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {globalGrouped.byCoach[cid].map((row) => {
                    const typeKey = row.workout_type || row.type;
                    const wt = WORKOUT_TYPES.find((t) => t.id === typeKey) || WORKOUT_TYPES.find((t) => t.id === row.type) || WORKOUT_TYPES[0];
                    const dist = row.distance_km ?? row.total_km;
                    const isOwn = String(row.coach_id) === String(adminLibraryOwnerId);
                    return (
                      <div
                        key={row.id}
                        style={{
                          ...S.card,
                          margin: 0,
                          padding: 14,
                          display: "flex",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "center",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{row.title}</div>
                          <div style={{ fontSize: ".75em", color: "#64748b", lineHeight: 1.45 }}>
                            Tipo: {wt.label}
                            {" · "}
                            Duración: {row.duration_min} min
                            {" · "}
                            Distancia: {dist} km
                            {row.intensity ? (
                              <>
                                {" · "}
                                Intensidad: {row.intensity}
                              </>
                            ) : null}
                          </div>
                        </div>
                        {!isOwn ? (
                          <button
                            type="button"
                            disabled={globalCopyingId === row.id}
                            onClick={() => copyGlobalWorkoutToMine(row)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: globalCopyingId === row.id ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#818cf8)",
                              color: globalCopyingId === row.id ? "#64748b" : "#fff",
                              fontWeight: 700,
                              fontSize: ".78em",
                              cursor: globalCopyingId === row.id ? "not-allowed" : "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            {globalCopyingId === row.id ? "Copiando…" : "➕ Copiar a mi biblioteca"}
                          </button>
                        ) : (
                          <span style={{ fontSize: ".72em", color: "#94a3b8" }}>Ya es tuyo</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div style={{ color: "#64748b", fontSize: ".9em" }}>Cargando biblioteca…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...S.card, color: "#64748b", fontSize: ".9em" }}>
          {items.length === 0
            ? "Aún no hay workouts guardados. Genera uno en «Crear Workout» y pulsa «Guardar en Biblioteca»."
            : "Ningún resultado para tu búsqueda."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((row) => {
            const wt = WORKOUT_TYPES.find((t) => t.id === row.type) || WORKOUT_TYPES[0];
            return (
              <div
                key={row.id}
                style={{
                  ...S.card,
                  margin: 0,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 14,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "1.05em", fontWeight: 700, color: "#0f172a" }}>{row.title}</span>
                    <span
                      style={{
                        fontSize: ".65em",
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        color: wt.color,
                        border: `1px solid ${wt.color}55`,
                        borderRadius: 6,
                        padding: "3px 8px",
                      }}
                    >
                      {wt.label}
                    </span>
                  </div>
                  <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 6 }}>{row.description}</div>
                  <div style={{ fontSize: ".75em", color: "#94a3b8" }}>
                    📍 {row.total_km} km · ⏱ {row.duration_min} min
                    {row.created_at && (
                      <span style={{ marginLeft: 10, color: "#475569" }}>
                        · {new Date(row.created_at).toLocaleDateString("es", { dateStyle: "medium" })}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => onUseWorkout(row)}
                    style={{
                      background: "linear-gradient(135deg,#b45309,#f59e0b)",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 14px",
                      color: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".8em",
                    }}
                  >
                    Usar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssigningId((prev) => (prev === row.id ? null : row.id));
                      if ((athletes || []).length) setAssignAthleteId(String(athletes[0].id));
                      setAssignDate(formatLocalYMD(new Date()));
                    }}
                    style={{
                      background: "rgba(59,130,246,.12)",
                      border: "1px solid rgba(59,130,246,.35)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".78em",
                    }}
                  >
                    Asignar directamente
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRow(row.id)}
                    disabled={deletingId === row.id}
                    style={{
                      background: "rgba(239,68,68,.1)",
                      border: "1px solid rgba(239,68,68,.35)",
                      borderRadius: 8,
                      padding: "8px 14px",
                      color: "#f87171",
                      fontWeight: 700,
                      cursor: deletingId === row.id ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      fontSize: ".8em",
                    }}
                  >
                    {deletingId === row.id ? "…" : "Eliminar"}
                  </button>
                </div>
                {assigningId === row.id ? (
                  <div style={{ width: "100%", borderTop: "1px dashed #cbd5e1", paddingTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                    <div style={{ minWidth: 180, flex: "1 1 180px" }}>
                      <div style={{ fontSize: ".7em", color: "#64748b", marginBottom: 4 }}>Atleta</div>
                      <select
                        value={assignAthleteId}
                        onChange={(e) => setAssignAthleteId(e.target.value)}
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".8em" }}
                      >
                        {(athletes || []).map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: ".7em", color: "#64748b", marginBottom: 4 }}>Fecha</div>
                      <input
                        type="date"
                        value={assignDate}
                        onChange={(e) => setAssignDate(e.target.value)}
                        style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".8em" }}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={assignSaving}
                      onClick={() => assignDirectly(row)}
                      style={{ background: assignSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: assignSaving ? "#64748b" : "#fff", fontWeight: 800, cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".78em" }}
                    >
                      {assignSaving ? "Asignando…" : "Asignar ahora"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Builder({ athletes, aiPrompt, setAiPrompt, aiWorkout, setAiWorkout, aiLoading, setAiLoading, notify, coachUserId, coachPlan, onGoToPlans, onWorkoutAssigned, onSavedToLibrary }) {
  const S = styles;
  const [builderTab, setBuilderTab] = useState("ai");
  const [manualForm, setManualForm] = useState({
    title: "",
    type: "easy",
    total_km: "",
    duration_min: "",
    description: "",
    structureRows: [emptyWorkoutStructureRow()],
  });
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [assignAthleteId, setAssignAthleteId] = useState("");
  const [assignDate, setAssignDate] = useState(() => formatLocalYMD(new Date()));
  const [assignSaving, setAssignSaving] = useState(false);
  const [builderHrAthleteId, setBuilderHrAthleteId] = useState("");
  const [monthGenerations, setMonthGenerations] = useState(0);
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const [generationLimitMsg, setGenerationLimitMsg] = useState("");
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const isBasicPlan = useMemo(() => {
    const p = String(coachPlan || "").toLowerCase();
    return p === "basico" || p === "básico" || p === "starter" || p === "";
  }, [coachPlan]);

  const loadGenerationCounter = useCallback(async () => {
    if (!coachUserId) {
      setMonthGenerations(0);
      return;
    }
    setLoadingGenerations(true);
    const { data, error } = await supabase
      .from("ai_generations")
      .select("count")
      .eq("coach_id", coachUserId)
      .eq("month", monthKey)
      .maybeSingle();
    setLoadingGenerations(false);
    if (error) {
      console.error("ai_generations load (builder):", error);
      return;
    }
    setMonthGenerations(Number(data?.count) || 0);
  }, [coachUserId, monthKey]);

  const incrementGenerationCounter = useCallback(async () => {
    if (!coachUserId) return;
    const nextCount = (Number(monthGenerations) || 0) + 1;
    const { error: updErr } = await supabase
      .from("ai_generations")
      .update({ count: nextCount, updated_at: new Date().toISOString() })
      .eq("coach_id", coachUserId)
      .eq("month", monthKey);
    if (updErr) {
      const { error: insErr } = await supabase.from("ai_generations").insert({
        coach_id: coachUserId,
        month: monthKey,
        count: 1,
        updated_at: new Date().toISOString(),
      });
      if (insErr) {
        console.error("ai_generations increment (builder):", insErr);
        return;
      }
      setMonthGenerations(1);
      return;
    }
    setMonthGenerations(nextCount);
  }, [coachUserId, monthGenerations, monthKey]);

  useEffect(() => {
    loadGenerationCounter();
  }, [loadGenerationCounter]);

  const previewWorkout = useMemo(() => {
    if (builderTab === "manual") {
      if (!(manualForm.title || "").trim()) return null;
      const type = WORKOUT_TYPES.some((t) => t.id === manualForm.type) ? manualForm.type : "easy";
      return {
        title: manualForm.title.trim() || "Workout",
        type,
        total_km: Number(manualForm.total_km) || 0,
        duration_min: Math.round(Number(manualForm.duration_min)) || 0,
        description: (manualForm.description || "").trim(),
        structure: editableRowsToWorkoutStructure(manualForm.structureRows),
      };
    }
    return aiWorkout;
  }, [builderTab, manualForm, aiWorkout]);

  const openAssignModal = () => {
    if (!previewWorkout) return;
    setAssignDate(formatLocalYMD(new Date()));
    if (athletes?.length) setAssignAthleteId(String(athletes[0].id));
    else setAssignAthleteId("");
    setShowAssignModal(true);
  };

  const saveAssignedWorkout = async () => {
    const w = previewWorkout;
    if (!w) return;
    if (!assignAthleteId) {
      alert("Selecciona un atleta.");
      return;
    }
    const selectedAthlete = (athletes || []).find(a => String(a.id) === String(assignAthleteId));
    if (!selectedAthlete?.id) {
      alert("No se encontró el atleta seleccionado.");
      return;
    }
    if (!assignDate) {
      alert("Selecciona una fecha.");
      return;
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      alert(userError?.message || "No hay usuario autenticado.");
      return;
    }
    setAssignSaving(true);
    try {
      const payload = {
        ...w,
        athlete_id: selectedAthlete.id,
        coach_id: userData.user.id,
        scheduled_date: assignDate,
        done: false,
      };
      const { error } = await supabase.from("workouts").insert(payload).select().single();
      if (error) {
        console.error("Error guardando workout asignado:", error);
        alert(`Error: ${error.message}\n${error.details || ""}\n${error.hint || ""}`);
        return;
      }

      if (selectedAthlete.email) {
        try {
          const structureRows = Array.isArray(w?.structure)
            ? w.structure.map((s) => `<p>• <strong>${s.phase || ""}</strong>: ${s.duration || ""} · ${s.pace || ""}</p>`).join("")
            : "";
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: selectedAthlete.email,
              subject: `Nuevo entrenamiento: ${w.title}`,
              html: `
      <h2>Hola ${selectedAthlete.name} 👋</h2>
      <p>Tu coach te ha asignado un nuevo entrenamiento:</p>
      <h3>${w.title}</h3>
      <p><strong>Fecha:</strong> ${assignDate}</p>
      <p><strong>Descripción:</strong> ${w.description}</p>
      <p><strong>Distancia:</strong> ${w.total_km} km</p>
      <p><strong>Duración:</strong> ${w.duration_min} minutos</p>
      <h4>Estructura:</h4>
      ${structureRows}
      <br/><p>¡Mucho éxito! 💪</p>
      <p>— Tu coach en ${BRAND_NAME}</p>
    `,
            }),
          });
        } catch (e) {
          console.error("Error llamando /api/send-email:", e);
        }
      }

      setShowAssignModal(false);
      onWorkoutAssigned?.();
      notify("Entrenamiento guardado correctamente en Supabase.");
    } finally {
      setAssignSaving(false);
    }
  };

  const generateWorkout = async () => {
    if (!aiPrompt.trim()) return;
    if (isBasicPlan && monthGenerations >= 100) {
      setGenerationLimitMsg("Has alcanzado el límite de 100 generaciones del plan Básico. Actualiza al plan Pro para generaciones ilimitadas.");
      return;
    }
    setGenerationLimitMsg("");
    setAiLoading(true);
    setAiWorkout(null);
    try {
      const hrAthlete = builderHrAthleteId ? athletes.find((a) => String(a.id) === String(builderHrAthleteId)) : null;
      const zonesBlock = hrAthlete ? buildAthleteHrZonesPromptText(hrAthlete) : "";
      const baseSystem =
        'You are an elite running coach. Generate a structured workout in JSON only. No markdown, no backticks. Format: {"title":"...","type":"easy|tempo|interval|long|recovery","total_km":number,"duration_min":number,"description":"...","structure":[{"phase":"...","duration":"...","intensity":"...","pace":"..."}]}';
      const system = zonesBlock
        ? `${baseSystem}\n\n${zonesBlock}\nWhen setting structure, align intensity with these HR zones where it fits (reference bpm or zone Z1-Z5 in the intensity field when useful).`
        : baseSystem;
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system,
          messages: [{ role: "user", content: aiPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Anthropic proxy error:", data);
        notify("Error al generar workout (API)");
        setAiWorkout(null);
        return;
      }
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setAiWorkout(JSON.parse(text));
      await incrementGenerationCounter();
    } catch { setAiWorkout(null); }
    finally { setAiLoading(false); }
  };

  const exportGarmin = () => {
    const w = previewWorkout;
    if (!w) return;
    const blob = new Blob([JSON.stringify(w, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${String(w.title || "workout").replace(/\s+/g, "_")}_garmin.json`; a.click();
    URL.revokeObjectURL(url);
    notify("Exportado para Garmin ✓");
  };

  const saveToLibrary = async () => {
    const w = previewWorkout;
    if (!w) return;
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      alert(userError?.message || "No hay usuario autenticado.");
      return;
    }
    const type = WORKOUT_TYPES.some((t) => t.id === w.type) ? w.type : "easy";
    const row = {
      coach_id: userData.user.id,
      title: (w.title && String(w.title).trim()) || "Workout",
      type,
      total_km: Number.isFinite(Number(w.total_km)) ? Number(w.total_km) : 0,
      duration_min: Number.isFinite(Number(w.duration_min)) ? Math.round(Number(w.duration_min)) : 0,
      description: w.description != null ? String(w.description) : "",
      structure: Array.isArray(w.structure) ? w.structure : [],
    };
    setSavingLibrary(true);
    try {
      const { error } = await supabase.from("workout_library").insert(row);
      if (error) {
        console.error("workout_library insert:", error);
        notify(`Error al guardar en biblioteca: ${error.message}`);
        return;
      }
      onSavedToLibrary?.();
      notify("Guardado en biblioteca ✓");
    } finally {
      setSavingLibrary(false);
    }
  };

  const moveManualPhase = (idx, dir) => {
    setManualForm((f) => {
      const next = [...f.structureRows];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, structureRows: next };
    });
  };

  const wtPreview = previewWorkout ? WORKOUT_TYPES.find((t) => t.id === previewWorkout.type) || WORKOUT_TYPES[0] : null;

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={S.pageTitle}>Crear Workout</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          {builderTab === "ai"
            ? "Genera con IA o construye tu sesión paso a paso en modo manual."
            : "Define título, tipo, volumen y fases; luego guarda, asigna o exporta."}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setBuilderTab("ai")}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: builderTab === "ai" ? "2px solid #f59e0b" : "1px solid #e2e8f0",
              background: builderTab === "ai" ? "rgba(245,158,11,.12)" : "#ffffff",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            ⚡ Generar con IA
          </button>
          <button
            type="button"
            onClick={() => setBuilderTab("manual")}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: builderTab === "manual" ? "2px solid #3b82f6" : "1px solid #e2e8f0",
              background: builderTab === "manual" ? "rgba(59,130,246,.1)" : "#ffffff",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            ✍️ Crear Manual
          </button>
        </div>
        {builderTab === "ai" ? (
          <div style={{ marginTop: 10, color: "#64748b", fontSize: ".8em", fontWeight: 600 }}>
            {isBasicPlan ? `${loadingGenerations ? "…" : monthGenerations} / 100 generaciones usadas este mes` : "Ilimitado"}
          </div>
        ) : null}
      </div>
      {builderTab === "ai" && generationLimitMsg ? (
        <div style={{ ...S.card, marginBottom: 14, border: "1px solid rgba(245,158,11,.4)", background: "#fffbeb" }}>
          <div style={{ color: "#92400e", fontSize: ".84em", fontWeight: 700, marginBottom: 10 }}>{generationLimitMsg}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onGoToPlans}
              style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
            >
              Ver Planes
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 24 }}>
        <div style={S.card}>
          {builderTab === "ai" ? (
            <>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>⚡ DESCRIBE EL ENTRENAMIENTO</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Zonas FC en el prompt (atleta con FC máx guardada)</div>
                <select
                  value={builderHrAthleteId}
                  onChange={(e) => setBuilderHrAthleteId(e.target.value)}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                >
                  <option value="">Sin zonas FC en el prompt</option>
                  {(athletes || []).map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.name}{a.fc_max ? ` (${a.fc_max} lpm)` : " — sin FC máx"}
                    </option>
                  ))}
                </select>
              </div>
              <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Ej: Intervalos 6x800m para atleta sub 4h maratón..." style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", outline: "none", marginBottom: 12, boxSizing: "border-box" }} rows={5} />
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 8 }}>SUGERENCIAS:</div>
                {["Intervalos 6x800m para atleta sub 4h maratón", "Rodaje largo 28km semana 18 de plan", "Tempo 8km para media maratón zona 3-4"].map((s, i) => (
                  <div key={i} onClick={() => setAiPrompt(s)} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", fontSize: ".75em", color: "#64748b", cursor: "pointer", marginBottom: 6 }}>{s}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  console.log("Botón clickeado, prompt:", aiPrompt);
                  generateWorkout();
                }}
                disabled={aiLoading || !aiPrompt.trim()}
                style={{ width: "100%", background: !aiPrompt.trim() ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "11px 20px", color: !aiPrompt.trim() ? "#334155" : "white", fontWeight: 700, cursor: !aiPrompt.trim() ? "not-allowed" : "pointer", fontSize: ".85em", fontFamily: "inherit" }}
              >
                {aiLoading ? "⏳ Generando..." : "⚡ GENERAR WORKOUT"}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>✍️ DATOS DEL ENTRENAMIENTO</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Título del workout</div>
                <input
                  value={manualForm.title}
                  onChange={(e) => setManualForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ej: Tempo 8 km + strides"
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Tipo</div>
                  <select
                    value={manualForm.type}
                    onChange={(e) => setManualForm((f) => ({ ...f, type: e.target.value }))}
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                  >
                    {WORKOUT_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Distancia total (km)</div>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={manualForm.total_km}
                    onChange={(e) => setManualForm((f) => ({ ...f, total_km: e.target.value }))}
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Duración (min)</div>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={manualForm.duration_min}
                    onChange={(e) => setManualForm((f) => ({ ...f, duration_min: e.target.value }))}
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Descripción general</div>
                <textarea
                  value={manualForm.description}
                  onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Notas para el atleta, objetivo de la sesión…"
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>ESTRUCTURA POR FASES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {manualForm.structureRows.map((row, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "12px 12px",
                      background: "#f8fafc",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: ".75em", fontWeight: 800, color: "#334155" }}>Fase {idx + 1}</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveManualPhase(idx, -1)}
                          style={{
                            background: idx === 0 ? "#f1f5f9" : "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            padding: "4px 10px",
                            fontSize: ".72em",
                            cursor: idx === 0 ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            fontWeight: 700,
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={idx >= manualForm.structureRows.length - 1}
                          onClick={() => moveManualPhase(idx, 1)}
                          style={{
                            background: idx >= manualForm.structureRows.length - 1 ? "#f1f5f9" : "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            padding: "4px 10px",
                            fontSize: ".72em",
                            cursor: idx >= manualForm.structureRows.length - 1 ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            fontWeight: 700,
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={manualForm.structureRows.length <= 1}
                          onClick={() =>
                            setManualForm((f) => ({
                              ...f,
                              structureRows: f.structureRows.length <= 1 ? f.structureRows : f.structureRows.filter((_, j) => j !== idx),
                            }))
                          }
                          style={{
                            background: "transparent",
                            border: "1px solid #fecaca",
                            borderRadius: 6,
                            padding: "4px 10px",
                            fontSize: ".72em",
                            color: manualForm.structureRows.length <= 1 ? "#cbd5e1" : "#b91c1c",
                            cursor: manualForm.structureRows.length <= 1 ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            fontWeight: 700,
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Nombre de la fase</div>
                        <input
                          value={row.phase}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], phase: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Calentamiento, Intervalos…"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración de la fase</div>
                        <input
                          value={row.duration}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], duration: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="15 min, 2 km…"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Intensidad (Z1–Z5 o texto)</div>
                        <input
                          value={row.intensity}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], intensity: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Z3, umbral…"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Ritmo objetivo (min/km)</div>
                        <input
                          value={row.pace}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], pace: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="5:00, 4:30/km…"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setManualForm((f) => ({ ...f, structureRows: [...f.structureRows, emptyWorkoutStructureRow()] }))}
                style={{
                  marginTop: 12,
                  width: "100%",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  padding: "10px 14px",
                  color: "#1d4ed8",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                }}
              >
                ＋ Agregar fase
              </button>
            </>
          )}
        </div>
        <div style={S.card}>
          {previewWorkout ? (
            <>
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: ".72em", padding: "4px 10px", borderRadius: 999, background: `${wtPreview?.color || "#64748b"}22`, color: wtPreview?.color || "#64748b", fontWeight: 800 }}>
                  {wtPreview?.label || previewWorkout.type}
                </span>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "1.1em", fontWeight: 700, color: "#0f172a" }}>{previewWorkout.title}</div>
                <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>{previewWorkout.description || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: ".78em", color: "#94a3b8" }}>
                <span>📍 {previewWorkout.total_km} km</span>
                <span>⏱ {previewWorkout.duration_min} min</span>
              </div>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>ESTRUCTURA</div>
              {(previewWorkout.structure || []).length === 0 ? (
                <div style={{ fontSize: ".8em", color: "#94a3b8", marginBottom: 12 }}>Sin fases en estructura (opcional).</div>
              ) : (
                (previewWorkout.structure || []).map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", background: "#f8fafc", borderRadius: 7, padding: "8px 10px", marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(245,158,11,.15)", color: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".7em", fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, fontSize: ".85em" }}>
                      <span style={{ color: "#0f172a", fontWeight: 600 }}>{step.phase}</span>
                      <span style={{ color: "#64748b" }}>
                        {" "}
                        · {step.duration}
                        {step.intensity ? ` · ${step.intensity}` : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: ".78em", color: "#f59e0b", fontFamily: "monospace" }}>{step.pace}</div>
                  </div>
                ))
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
                <button type="button" onClick={exportGarmin} style={{ background: "rgba(22,163,74,.12)", border: "1px solid rgba(22,163,74,.3)", borderRadius: 8, padding: "8px 14px", color: "#22c55e", cursor: "pointer", fontSize: ".78em", fontFamily: "inherit", fontWeight: 600 }}>⌚ Exportar a Garmin</button>
                <button
                  type="button"
                  onClick={saveToLibrary}
                  disabled={savingLibrary}
                  style={{
                    background: savingLibrary ? "#e2e8f0" : "rgba(168,85,247,.12)",
                    border: `1px solid ${savingLibrary ? "#e2e8f0" : "rgba(168,85,247,.35)"}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    color: savingLibrary ? "#64748b" : "#c084fc",
                    cursor: savingLibrary ? "not-allowed" : "pointer",
                    fontSize: ".78em",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  {savingLibrary ? "Guardando…" : "💾 Guardar en Biblioteca"}
                </button>
                <button
                  type="button"
                  onClick={openAssignModal}
                  disabled={!athletes?.length}
                  style={{
                    background: athletes?.length ? "rgba(59,130,246,.1)" : "#f1f5f9",
                    border: `1px solid ${athletes?.length ? "rgba(59,130,246,.3)" : "#e2e8f0"}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    color: athletes?.length ? "#3b82f6" : "#475569",
                    cursor: athletes?.length ? "pointer" : "not-allowed",
                    fontSize: ".78em",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  📤 Asignar a Atleta
                </button>
              </div>
              {showAssignModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
                  <div style={{ ...S.card, width: "100%", maxWidth: 400, margin: 0 }}>
                    <div style={{ fontSize: ".85em", fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Asignar workout a un atleta</div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 14 }}>
                      Se guardará en Supabase con los datos del workout (IA o manual), más atleta, coach y fecha.
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Atleta del coach</div>
                      <select
                        value={assignAthleteId}
                        onChange={(e) => setAssignAthleteId(e.target.value)}
                        style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                      >
                        <option value="" disabled>
                          Selecciona un atleta
                        </option>
                        {(athletes || []).map((a) => (
                          <option key={a.id} value={String(a.id)}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del workout</div>
                      <input
                        type="date"
                        value={assignDate}
                        onChange={(e) => setAssignDate(e.target.value)}
                        style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => setShowAssignModal(false)}
                        disabled={assignSaving}
                        style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveAssignedWorkout}
                        disabled={assignSaving}
                        style={{ background: assignSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 14px", color: assignSaving ? "#334155" : "white", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
                      >
                        {assignSaving ? "Guardando..." : "Confirmar"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, opacity: 0.45 }}>
              <div style={{ fontSize: "3em", marginBottom: 12 }}>{builderTab === "manual" ? "✍️" : "⚡"}</div>
              <div style={{ color: "#475569", fontSize: ".85em", textAlign: "center", maxWidth: 280 }}>
                {builderTab === "manual" ? "Indica un título para ver la vista previa y usar guardar / asignar / exportar." : "El workout generado aparecerá aquí"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EVAL_DISTANCES = [
  { id: "5k", label: "5K", meters: 5000 },
  { id: "10k", label: "10K", meters: 10000 },
  { id: "21k", label: "21K", meters: 21097.5 },
  { id: "42k", label: "42K", meters: 42195 },
];

const parseHmsToSeconds = (raw) => {
  const parts = String(raw || "").trim().split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
};

const formatSeconds = (totalSec) => {
  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const formatPaceMinKm = (paceMinPerKm) => {
  if (!Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) return "—";
  const totalSec = Math.round(paceMinPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")} /km`;
};

const velocityToVo2 = (vMetersPerMin) => -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;

const timePercentVo2 = (tMin) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

const vdotFromRace = (distanceMeters, totalSeconds) => {
  const tMin = Number(totalSeconds) / 60;
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(tMin) || distanceMeters <= 0 || tMin <= 0) return null;
  const v = distanceMeters / tMin;
  const vo2 = velocityToVo2(v);
  const pct = timePercentVo2(tMin);
  if (!Number.isFinite(vo2) || !Number.isFinite(pct) || pct <= 0) return null;
  return vo2 / pct;
};

const vdotFromCooper = (distanceMeters) => {
  const d = Number(distanceMeters);
  if (!Number.isFinite(d) || d <= 0) return null;
  return (d - 504.9) / 44.73;
};

const velocityFromVo2 = (targetVo2) => {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(targetVo2 + 4.6);
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  return (-b + Math.sqrt(disc)) / (2 * a);
};

const predictTimeFromVdot = (vdot, distanceMeters) => {
  if (!Number.isFinite(vdot) || vdot <= 0) return null;
  let lo = 5;
  let hi = 360;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = distanceMeters / mid;
    const current = velocityToVo2(v) / timePercentVo2(mid);
    if (current > vdot) lo = mid;
    else hi = mid;
  }
  return hi * 60;
};

const computeHrZones = (fcMax, fcRest) => {
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) return [];
  const rest = Number(fcRest);
  const useKarvonen = Number.isFinite(rest) && rest > 0 && rest < max;
  const ranges = [
    { z: "Z1", low: 0.5, high: 0.6, color: "#22c55e" },
    { z: "Z2", low: 0.6, high: 0.7, color: "#3b82f6" },
    { z: "Z3", low: 0.7, high: 0.8, color: "#f59e0b" },
    { z: "Z4", low: 0.8, high: 0.9, color: "#f97316" },
    { z: "Z5", low: 0.9, high: 1.0, color: "#ef4444" },
  ];
  return ranges.map((r) => {
    if (useKarvonen) {
      const reserve = max - rest;
      return {
        ...r,
        lowBpm: Math.round(rest + reserve * r.low),
        highBpm: Math.round(rest + reserve * r.high),
      };
    }
    return {
      ...r,
      lowBpm: Math.round(max * r.low),
      highBpm: Math.round(max * r.high),
    };
  });
};

function EvaluationView({ athletes, currentUserId, notify, athleteOnlyId = null }) {
  const S = styles;
  const canSelect = !athleteOnlyId;
  const athleteOptions = useMemo(
    () => (athleteOnlyId ? (athletes || []).filter((a) => String(a.id) === String(athleteOnlyId)) : athletes || []),
    [athletes, athleteOnlyId],
  );
  const [athleteId, setAthleteId] = useState(athleteOnlyId ? String(athleteOnlyId) : String(athleteOptions[0]?.id || ""));
  const [tab, setTab] = useState("race");
  const [raceDistance, setRaceDistance] = useState("10k");
  const [raceTime, setRaceTime] = useState("00:45:00");
  const [cooperDistance, setCooperDistance] = useState("2800");
  const [thresholdTime, setThresholdTime] = useState("00:30:00");
  const [thresholdDistance, setThresholdDistance] = useState("7000");
  const [fcMax, setFcMax] = useState("");
  const [fcRest, setFcRest] = useState("");
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [openHistoryId, setOpenHistoryId] = useState(null);

  const methodDescription =
    tab === "race"
      ? "Ingresa tu mejor tiempo reciente en una carrera oficial o entrenamiento de tiempo. Cuanto más reciente, más preciso será el cálculo."
      : tab === "cooper"
      ? "Corre durante exactamente 12 minutos al máximo esfuerzo sostenible e ingresa la distancia total recorrida en metros."
      : "Corre durante 30 minutos al máximo esfuerzo que puedas mantener de forma constante e ingresa la distancia total y tu FC promedio si tienes monitor.";

  useEffect(() => {
    if (!athleteOptions.length) return;
    if (!athleteId) setAthleteId(String(athleteOptions[0].id));
  }, [athleteOptions, athleteId]);

  const selectedAthlete = useMemo(
    () => athleteOptions.find((a) => String(a.id) === String(athleteId)) || null,
    [athleteOptions, athleteId],
  );

  useEffect(() => {
    if (!selectedAthlete) return;
    setFcMax(selectedAthlete.fc_max ? String(selectedAthlete.fc_max) : "");
    setFcRest(selectedAthlete.fc_reposo ? String(selectedAthlete.fc_reposo) : "");
  }, [selectedAthlete?.id]);

  const loadHistory = useCallback(async () => {
    if (!athleteId) {
      setHistory([]);
      return;
    }
    const { data, error } = await supabase
      .from("athlete_evaluations")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("load evaluations", error);
      setHistory([]);
      return;
    }
    setHistory(data || []);
  }, [athleteId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const calculate = () => {
    let vdot = null;
    let source = {};
    if (tab === "race") {
      const dist = EVAL_DISTANCES.find((d) => d.id === raceDistance)?.meters;
      const sec = parseHmsToSeconds(raceTime);
      vdot = vdotFromRace(dist, sec);
      source = { method: "race", distance_id: raceDistance, time: raceTime };
    } else if (tab === "cooper") {
      const dist = Number(cooperDistance);
      vdot = vdotFromCooper(dist);
      source = { method: "cooper", distance_m: dist };
    } else {
      const sec = parseHmsToSeconds(thresholdTime);
      const dist = Number(thresholdDistance);
      vdot = vdotFromRace(dist, sec);
      source = { method: "threshold", distance_m: dist, time: thresholdTime };
    }
    if (!Number.isFinite(vdot) || vdot <= 0) {
      notify?.("No se pudo calcular VDOT. Revisa los datos.");
      return;
    }

    const paceFractions = [
      { key: "Easy", frac: 0.74, color: "#22c55e" },
      { key: "Maratón", frac: 0.83, color: "#3b82f6" },
      { key: "Umbral", frac: 0.88, color: "#f59e0b" },
      { key: "Intervalos", frac: 0.98, color: "#ef4444" },
      { key: "Repeticiones", frac: 1.05, color: "#8b5cf6" },
    ];
    const paces = paceFractions.map((p) => {
      const v = velocityFromVo2(vdot * p.frac);
      const pace = v ? 1000 / v : null;
      return { ...p, paceMinKm: pace };
    });
    const predictions = EVAL_DISTANCES.map((d) => ({
      ...d,
      seconds: predictTimeFromVdot(vdot, d.meters),
    }));
    const zones = computeHrZones(fcMax, fcRest);
    setResults({
      vdot,
      source,
      paces,
      zones,
      predictions,
      fc_max: Number(fcMax) || null,
      fc_reposo: Number(fcRest) || null,
      method: tab,
    });
  };

  const saveAndApply = async () => {
    if (!results || !athleteId) {
      notify?.("Primero calcula la evaluación");
      return;
    }
    setSaving(true);
    const payload = {
      athlete_id: athleteId,
      coach_id: currentUserId,
      method: results.method,
      input_data: results.source,
      vdot: Number(results.vdot.toFixed(2)),
      paces: results.paces,
      hr_zones: results.zones,
      predicted_times: results.predictions.map((p) => ({ id: p.id, seconds: p.seconds })),
      fc_max: results.fc_max,
      fc_reposo: results.fc_reposo,
    };
    const { error: insErr } = await supabase.from("athlete_evaluations").insert(payload);
    if (insErr) {
      setSaving(false);
      console.error(insErr);
      notify?.(`No se pudo guardar evaluación: ${insErr.message}`);
      return;
    }
    const { error: updErr } = await supabase
      .from("athletes")
      .update({ fc_max: results.fc_max, fc_reposo: results.fc_reposo })
      .eq("id", athleteId);
    setSaving(false);
    if (updErr) {
      console.error(updErr);
      notify?.(`Evaluación guardada, pero no se pudo actualizar FC: ${updErr.message}`);
    } else {
      notify?.("Evaluación guardada y aplicada al atleta");
    }
    loadHistory();
  };

  const renderEvaluationCards = (dataObj) => {
    const paces = Array.isArray(dataObj?.paces) ? dataObj.paces : [];
    const zones = Array.isArray(dataObj?.zones) ? dataObj.zones : [];
    const predictions = Array.isArray(dataObj?.predictions) ? dataObj.predictions : [];
    const vdot = Number(dataObj?.vdot);
    return (
      <>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 16 }}>
          <div style={{ ...S.card, padding: 16 }}>
            <div style={{ color: "#64748b", fontSize: ".75em", fontWeight: 700 }}>VDOT</div>
            <div style={{ fontSize: "2em", fontWeight: 900, color: "#0f172a" }}>{Number.isFinite(vdot) ? vdot.toFixed(2) : "—"}</div>
          </div>
          {paces.map((p) => (
            <div key={p.key} style={{ ...S.card, padding: 16 }}>
              <div style={{ color: p.color || "#64748b", fontSize: ".75em", fontWeight: 700 }}>{p.key || "Ritmo"}</div>
              <div style={{ fontSize: "1.2em", fontWeight: 800, color: "#0f172a" }}>
                {p.paceMinKm != null ? formatPaceMinKm(p.paceMinKm) : "—"}
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>ZONAS DE FC</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {zones.map((z) => (
              <div key={z.z} style={{ border: `1px solid ${(z.color || "#94a3b8")}66`, borderRadius: 10, padding: "10px 12px", background: `${z.color || "#94a3b8"}14` }}>
                <div style={{ color: z.color || "#64748b", fontWeight: 800 }}>{z.z || "Z"}</div>
                <div style={{ color: "#0f172a", fontSize: ".9em" }}>
                  {z.lowBpm ?? "—"}-{z.highBpm ?? "—"} lpm
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>TIEMPOS PREDICHOS</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
            {predictions.map((p) => (
              <div key={p.id || p.label} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                <div style={{ color: "#64748b", fontSize: ".75em", fontWeight: 700 }}>{p.label || String(p.id || "").toUpperCase()}</div>
                <div style={{ color: "#0f172a", fontWeight: 800 }}>{formatSeconds(p.seconds)}</div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={S.pageTitle}>Evaluación</h1>
        <p style={{ color: "#64748b", fontSize: ".86em", marginTop: 4 }}>
          Calcula VDOT, ritmos y zonas para actualizar el plan del atleta.
        </p>
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Atleta</div>
            <select
              value={athleteId}
              disabled={!canSelect}
              onChange={(e) => setAthleteId(e.target.value)}
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}
            >
              {athleteOptions.map((a) => (
                <option key={a.id} value={String(a.id)}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>FC máxima</div>
            <input value={fcMax} onChange={(e) => setFcMax(e.target.value)} placeholder="Ej. 188" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>FC reposo</div>
            <input value={fcRest} onChange={(e) => setFcRest(e.target.value)} placeholder="Ej. 52" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {[
            { id: "race", label: "Carrera Reciente" },
            { id: "cooper", label: "Test Cooper" },
            { id: "threshold", label: "Test Umbral" },
          ].map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "8px 12px",
                background: tab === x.id ? "rgba(245,158,11,.14)" : "#fff",
                color: tab === x.id ? "#b45309" : "#475569",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, color: "#64748b", fontSize: ".84em", lineHeight: 1.35 }}>{methodDescription}</div>

        {tab === "race" && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 14 }}>
            <select value={raceDistance} onChange={(e) => setRaceDistance(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}>
              {EVAL_DISTANCES.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
            <input value={raceTime} onChange={(e) => setRaceTime(e.target.value)} placeholder="hh:mm:ss" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
        )}
        {tab === "cooper" && (
          <div style={{ marginTop: 14 }}>
            <input value={cooperDistance} onChange={(e) => setCooperDistance(e.target.value)} placeholder="Distancia en 12 minutos (m)" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
        )}
        {tab === "threshold" && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 14 }}>
            <input value={thresholdTime} onChange={(e) => setThresholdTime(e.target.value)} placeholder="Tiempo hh:mm:ss" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
            <input value={thresholdDistance} onChange={(e) => setThresholdDistance(e.target.value)} placeholder="Distancia (m)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={calculate} style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 16px", color: "#fff", fontFamily: "inherit", fontWeight: 800, cursor: "pointer" }}>
            Calcular
          </button>
          <button type="button" disabled={!results || saving} onClick={saveAndApply} style={{ background: !results || saving ? "#e2e8f0" : "#0ea5e9", border: "none", borderRadius: 10, padding: "10px 16px", color: !results || saving ? "#64748b" : "#fff", fontFamily: "inherit", fontWeight: 800, cursor: !results || saving ? "not-allowed" : "pointer" }}>
            Guardar y Aplicar al Atleta
          </button>
        </div>
      </div>

      {results && renderEvaluationCards(results)}

      <div style={{ ...S.card }}>
        <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>Historial de evaluaciones</div>
        {history.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: ".9em" }}>Sin evaluaciones previas.</div>
        ) : (
          history.map((h) => (
            <div key={h.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setOpenHistoryId((prev) => (prev === h.id ? null : h.id))}
                style={{ width: "100%", textAlign: "left", padding: "10px 12px", border: "none", background: "#f8fafc", fontFamily: "inherit", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
              >
                <span style={{ color: "#0f172a", fontWeight: 700 }}>
                  {new Date(h.created_at).toLocaleString("es")} · {String(h.method || "").toUpperCase()} · VDOT {Number(h.vdot || 0).toFixed(2)}
                </span>
                <span style={{ color: "#64748b" }}>{openHistoryId === h.id ? "▲" : "▼"}</span>
              </button>
              {openHistoryId === h.id && (
                <div style={{ padding: "10px 12px", background: "#fff" }}>
                  <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 10 }}>
                    Método: <strong style={{ color: "#0f172a" }}>{String(h.method || "").toUpperCase()}</strong>
                  </div>
                  {renderEvaluationCards({
                    vdot: h.vdot,
                    paces: h.paces,
                    zones: h.hr_zones,
                    predictions: (h.predicted_times || []).map((p) => ({
                      id: p.id,
                      label: EVAL_DISTANCES.find((d) => d.id === p.id)?.label || String(p.id || "").toUpperCase(),
                      seconds: p.seconds,
                    })),
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AdminCoachesProfilesPanel({ notify, adminUserId }) {
  const S = styles;
  const [rows, setRows] = useState([]);
  const [emailByUserId, setEmailByUserId] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profs, error } = await supabase
      .from("profiles")
      .select("user_id,name,email,plan_status,trial_started_at,plan_validated_at,plan_validated_by,role")
      .eq("role", "coach")
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      notify("No se pudieron cargar los coaches.");
      setRows([]);
      setLoading(false);
      return;
    }
    const list = profs || [];
    setRows(list);
    const uids = list.map((r) => r.user_id).filter(Boolean);
    if (uids.length === 0) {
      setEmailByUserId({});
      setLoading(false);
      return;
    }
    const em = {};
    for (const r of list) {
      if (r.email && String(r.email).trim()) em[r.user_id] = String(r.email).toLowerCase();
    }
    const needCp = uids.filter((id) => !em[id]);
    if (needCp.length > 0) {
      const { data: cps, error: cpErr } = await supabase.from("coach_profiles").select("user_id,email").in("user_id", needCp);
      if (cpErr) console.warn("coach_profiles emails:", cpErr);
      for (const r of cps || []) {
        if (r.email) em[r.user_id] = String(r.email).toLowerCase();
      }
    }
    setEmailByUserId(em);
    setLoading(false);
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const planBadge = (st) => {
    const s = st || "—";
    const colors =
      s === "trial"
        ? { bg: "#fef9c3", fg: "#854d0e", bd: "#fde047" }
        : s === "active"
          ? { bg: "#dcfce7", fg: "#166534", bd: "#86efac" }
          : s === "blocked"
            ? { bg: "#fee2e2", fg: "#991b1b", bd: "#fecaca" }
            : { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
    return (
      <span
        style={{
          fontSize: ".72em",
          fontWeight: 800,
          padding: "3px 8px",
          borderRadius: 6,
          background: colors.bg,
          color: colors.fg,
          border: `1px solid ${colors.bd}`,
        }}
      >
        {s}
      </span>
    );
  };

  const trialCol = (p) => {
    if (p.plan_status !== "trial" || !p.trial_started_at) return "—";
    const d = coachTrialDaysRemainingFromStart(p);
    return d == null ? "—" : String(d);
  };

  const validatedCol = (p) =>
    p.plan_validated_at ? new Date(p.plan_validated_at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";

  const runAction = async (key, uid, payload) => {
    setBusyKey(`${key}-${uid}`);
    const { error } = await supabase.from("profiles").update(payload).eq("user_id", uid);
    setBusyKey("");
    if (error) {
      notify(error.message || "Error al actualizar");
      return;
    }
    notify("Actualizado ✓");
    load();
  };

  const activateCoach = (uid) =>
    runAction("act", uid, {
      plan_status: "active",
      plan_validated_at: new Date().toISOString(),
      plan_validated_by: adminUserId,
    });

  const blockCoachProf = (uid) => {
    if (typeof window !== "undefined" && !window.confirm("¿Bloquear este coach?")) return;
    runAction("blk", uid, { plan_status: "blocked" });
  };

  const resetTrial = (uid) =>
    runAction("rst", uid, { plan_status: "trial", trial_started_at: new Date().toISOString() });

  const cell = { padding: "10px 12px", fontSize: ".78em", color: "#334155", borderBottom: "1px solid #e2e8f0" };
  const th = { ...cell, fontWeight: 800, color: "#64748b", background: "#f8fafc" };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Coaches</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 18 }}>
        Perfiles con rol coach: plan, trial y validación.
      </p>
      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#94a3b8" }}>No hay coaches.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Email</th>
                <th style={th}>Estado</th>
                <th style={th}>Días restantes trial</th>
                <th style={th}>Fecha validación</th>
                <th style={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const uid = p.user_id;
                const busy = busyKey === `act-${uid}` || busyKey === `blk-${uid}` || busyKey === `rst-${uid}`;
                return (
                  <tr key={uid}>
                    <td style={cell}>{(p.name && String(p.name).trim()) || "—"}</td>
                    <td style={cell}>{emailByUserId[uid] || "—"}</td>
                    <td style={cell}>{planBadge(p.plan_status || "—")}</td>
                    <td style={cell}>{trialCol(p)}</td>
                    <td style={cell}>{validatedCol(p)}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => activateCoach(uid)}
                        style={{
                          marginRight: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #bbf7d0",
                          background: busy ? "#e2e8f0" : "#f0fdf4",
                          color: "#15803d",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ✅ Activar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => blockCoachProf(uid)}
                        style={{
                          marginRight: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #fecaca",
                          background: busy ? "#e2e8f0" : "#fef2f2",
                          color: "#b91c1c",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔒 Bloquear
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resetTrial(uid)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          background: busy ? "#e2e8f0" : "#fff",
                          color: "#475569",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔄 Resetear trial
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminPanel({ notify }) {
  return <AdminPromoCodes notify={notify} />;
}

function AdminPromoCodes({ notify }) {
  const S = styles;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", discount: "10", maxUses: "100", expires: "" });
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("promo_codes").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      notify("No se pudieron cargar los códigos. Verifica la tabla promo_codes en Supabase.");
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [notify]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const submitCreate = async (e) => {
    e.preventDefault();
    const rawName = form.name.trim();
    if (!rawName) {
      notify("Indica el nombre del código");
      return;
    }
    const code = rawName.toUpperCase().replace(/\s+/g, "");
    const discount = Number(form.discount);
    const maxUses = Math.max(0, Math.floor(Number(form.maxUses)));
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      notify("El descuento debe estar entre 0 y 100%");
      return;
    }
    if (!Number.isFinite(maxUses)) {
      notify("Usos máximos inválidos");
      return;
    }
    setSaving(true);
    const expires_at =
      form.expires && String(form.expires).trim()
        ? new Date(`${form.expires}T23:59:59`).toISOString()
        : null;
    const { error } = await supabase.from("promo_codes").insert({
      code,
      discount_percent: discount,
      max_uses: maxUses,
      expires_at,
      active: true,
      uses_count: 0,
    });
    setSaving(false);
    if (error) {
      console.error(error);
      notify(error.message || "Error al crear código");
      return;
    }
    notify("Código creado");
    setForm((f) => ({ ...f, name: "" }));
    loadRows();
  };

  const toggleActive = async (row) => {
    const { error } = await supabase.from("promo_codes").update({ active: !row.active }).eq("id", row.id);
    if (error) {
      notify(error.message || "Error al actualizar");
      return;
    }
    notify(!row.active ? "Código activado" : "Código desactivado");
    loadRows();
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#0f172a",
    fontFamily: "inherit",
    fontSize: ".88em",
    boxSizing: "border-box",
  };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Admin · Códigos promocionales</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 22 }}>
        Crea y gestiona códigos de descuento para la vista Planes.
      </p>

      <div style={{ ...S.card, marginBottom: 22 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 14 }}>
          NUEVO CÓDIGO
        </div>
        <form onSubmit={submitCreate} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Nombre del código</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej. VERANO2026"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>% descuento</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.discount}
              onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Usos máximos</label>
            <input
              type="number"
              min={0}
              value={form.maxUses}
              onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Expira</label>
            <input type="date" value={form.expires} onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <button
              type="submit"
              disabled={saving}
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: 10,
                border: "none",
                background: saving ? "#e2e8f0" : "linear-gradient(135deg,#7c3aed,#a78bfa)",
                color: saving ? "#64748b" : "#fff",
                fontWeight: 800,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {saving ? "Guardando…" : "Crear código"}
            </button>
          </div>
        </form>
      </div>

      <div style={S.card}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 14 }}>
          CÓDIGOS CREADOS
        </div>
        {loading ? (
          <div style={{ color: "#64748b" }}>Cargando…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: ".9em" }}>Aún no hay códigos.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((row) => {
              const remaining = Math.max(0, (row.max_uses ?? 0) - (row.uses_count ?? 0));
              const expired = row.expires_at && new Date(row.expires_at) < new Date();
              const statusLabel = !row.active ? "Inactivo" : expired ? "Expirado" : "Activo";
              const statusColor = !row.active ? "#94a3b8" : expired ? "#ef4444" : "#16a34a";
              return (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "14px 16px",
                    background: "#f8fafc",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: "#0f172a", letterSpacing: ".04em" }}>{row.code}</div>
                    <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 4 }}>
                      {row.discount_percent}% desc. · {remaining} usos restantes
                      {row.expires_at ? ` · exp. ${new Date(row.expires_at).toLocaleDateString("es")}` : ""}
                    </div>
                    <div style={{ fontSize: ".75em", color: statusColor, fontWeight: 700, marginTop: 6 }}>{statusLabel}</div>
                  </div>
                  <div style={{ fontSize: ".85em", fontWeight: 700, color: "#f59e0b" }}>{row.discount_percent}%</div>
                  <button
                    type="button"
                    onClick={() => toggleActive(row)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      background: row.active ? "#fef2f2" : "#f0fdf4",
                      color: row.active ? "#b91c1c" : "#15803d",
                      fontWeight: 700,
                      fontSize: ".78em",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.active ? "Desactivar" : "Activar"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CoachSettings({ coachUserId, sessionEmail, profileName, athletes, setAthletes, stravaRefreshTick, notify, onSignOut }) {
  const S = styles;
  const athletesRef = useRef(athletes);
  athletesRef.current = athletes;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    avatar_url: "",
    full_name: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    timezone: "America/Bogota",
    language: "es",
    currency: "COP",
    notify_new_workouts: true,
    notify_reminders: true,
    is_public: false,
    subscription_plan: "",
    subscription_renews_at: "",
  });
  const [stravaByUserId, setStravaByUserId] = useState({});
  const [loadingStravaByAthlete, setLoadingStravaByAthlete] = useState(false);
  const [deviceOverrides, setDeviceOverrides] = useState({});
  const [stravaActivitiesByAthlete, setStravaActivitiesByAthlete] = useState({});
  const [loadingActivitiesByAthlete, setLoadingActivitiesByAthlete] = useState({});
  const [coachRequests, setCoachRequests] = useState([]);
  const [requestsBusyId, setRequestsBusyId] = useState("");

  const loadProfile = useCallback(async () => {
    if (!coachUserId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("coach_profiles").select("*").eq("user_id", coachUserId).maybeSingle();
    if (error) {
      console.error(error);
      notify("No se pudo cargar la configuración. ¿Existe la tabla coach_profiles?");
      setLoading(false);
      return;
    }
    if (data) {
      setForm({
        avatar_url: data.avatar_url || "",
        full_name: data.full_name || profileName || "",
        email: data.email || sessionEmail || "",
        phone: data.phone || "",
        country: data.country || "",
        city: data.city || "",
        timezone: data.timezone || "America/Bogota",
        language: data.language === "en" ? "en" : "es",
        currency: data.currency === "USD" ? "USD" : "COP",
        notify_new_workouts: data.notify_new_workouts !== false,
        notify_reminders: data.notify_reminders !== false,
        is_public: data.is_public === true,
        subscription_plan: data.subscription_plan || "",
        subscription_renews_at: data.subscription_renews_at || "",
      });
    } else {
      setForm({
        avatar_url: "",
        full_name: profileName || "",
        email: sessionEmail || "",
        phone: "",
        country: "",
        city: "",
        timezone: "America/Bogota",
        language: "es",
        currency: "COP",
        notify_new_workouts: true,
        notify_reminders: true,
        is_public: false,
        subscription_plan: athletesRef.current?.find((a) => a.plan)?.plan || "",
        subscription_renews_at: "",
      });
    }
    setLoading(false);
  }, [coachUserId, sessionEmail, profileName, notify]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    setDeviceOverrides({});
  }, [athletes]);

  const coachCode = useMemo(() => String(coachUserId || "").replace(/-/g, "").slice(0, 8).toUpperCase(), [coachUserId]);

  const loadCoachRequests = useCallback(async () => {
    if (!coachUserId) return;
    const { data, error } = await supabase
      .from("coach_requests")
      .select("id, athlete_id, coach_id, status, created_at")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error cargando coach_requests:", error);
      setCoachRequests([]);
      return;
    }
    setCoachRequests(data || []);
  }, [coachUserId]);

  useEffect(() => {
    loadCoachRequests();
  }, [loadCoachRequests]);

  const updateCoachRequestStatus = async (row, status) => {
    if (!row?.id || !coachUserId) return;
    setRequestsBusyId(row.id);
    const { error } = await supabase
      .from("coach_requests")
      .update({ status })
      .eq("id", row.id)
      .eq("coach_id", coachUserId);
    if (error) {
      console.error("Error actualizando solicitud:", error);
      notify(error.message || "No se pudo actualizar la solicitud");
      setRequestsBusyId("");
      return;
    }
    if (status === "accepted") {
      const { data: athleteRow } = await supabase.from("athletes").select("id, user_id").eq("id", row.athlete_id).maybeSingle();
      await supabase.from("athletes").update({ coach_id: coachUserId }).eq("id", row.athlete_id);
      if (athleteRow?.user_id) {
        await supabase.from("profiles").update({ coach_id: coachUserId }).eq("user_id", athleteRow.user_id);
      }
      if (typeof setAthletes === "function") {
        setAthletes((prev) => prev.map((a) => (String(a.id) === String(row.athlete_id) ? { ...a, coach_id: coachUserId } : a)));
      }
    }
    await loadCoachRequests();
    setRequestsBusyId("");
  };

  const setAthleteDeviceConnection = async (athleteId, deviceValue) => {
    const { error } = await supabase.from("athletes").update({ device: deviceValue }).eq("id", athleteId);
    if (error) {
      console.error("Error actualizando dispositivo:", error);
      notify(error.message || "No se pudo actualizar el dispositivo");
      return;
    }
    setDeviceOverrides((prev) => ({ ...prev, [athleteId]: deviceValue || "" }));
    notify("Dispositivo actualizado");
  };

  const disconnectStravaForAthlete = async (athleteId) => {
    const { error } = await supabase.from("strava_connections").delete().eq("athlete_id", athleteId);
    if (error) {
      console.error("Error desconectando Strava:", error);
      notify(error.message || "No se pudo desconectar Strava");
      return;
    }
    setStravaByUserId((prev) => {
      const next = { ...prev };
      delete next[athleteId];
      return next;
    });
    notify("Strava desconectado");
  };

  const loadStravaActivitiesForAthlete = async (athleteId, accessToken) => {
    if (!athleteId || !accessToken) return;
    setLoadingActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: true }));
    try {
      const r = await fetch("/api/strava?action=activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const data = await r.json();
      if (!r.ok || !Array.isArray(data)) {
        notify("No se pudieron cargar actividades de Strava");
        setStravaActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: [] }));
        return;
      }
      setStravaActivitiesByAthlete((prev) => ({
        ...prev,
        [athleteId]: data.slice(0, 10).map(normalizeStravaActivity).filter(Boolean),
      }));
    } catch (e) {
      console.error("Error cargando actividades Strava en settings:", e);
      notify("No se pudieron cargar actividades de Strava");
      setStravaActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: [] }));
    } finally {
      setLoadingActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: false }));
    }
  };

  useEffect(() => {
    const athleteIds = (athletes || []).map((a) => a?.id).filter(Boolean);
    if (!athleteIds.length) {
      setStravaByUserId({});
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingStravaByAthlete(true);
      const { data, error } = await supabase.from("strava_connections").select("*").in("athlete_id", athleteIds);
      if (cancelled) return;
      if (error) {
        console.error("Error cargando conexiones Strava en settings:", error);
        setStravaByUserId({});
        setLoadingStravaByAthlete(false);
        return;
      }
      const map = {};
      for (const row of data || []) map[row.athlete_id] = row;
      setStravaByUserId(map);
      setLoadingStravaByAthlete(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [athletes, stravaRefreshTick]);

  const onAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !coachUserId) return;
    setUploading(true);
    const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = `${coachUserId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("coach-avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (error) {
      console.error(error);
      notify(error.message || "Error subiendo la foto (bucket coach-avatars)");
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from("coach-avatars").getPublicUrl(path);
    setForm((f) => ({ ...f, avatar_url: pub.publicUrl }));
    setUploading(false);
    notify("Foto actualizada (guarda para persistir el perfil)");
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!coachUserId) return;
    setSaving(true);
    const payload = {
      user_id: coachUserId,
      avatar_url: form.avatar_url || null,
      full_name: form.full_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      country: form.country.trim() || null,
      city: form.city.trim() || null,
      timezone: form.timezone || null,
      language: form.language === "en" ? "en" : "es",
      currency: form.currency === "USD" ? "USD" : "COP",
      notify_new_workouts: form.notify_new_workouts,
      notify_reminders: form.notify_reminders,
      is_public: form.is_public === true,
      subscription_plan: form.subscription_plan.trim() || null,
      subscription_renews_at: form.subscription_renews_at ? form.subscription_renews_at : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("coach_profiles").upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      console.error(error);
      notify(error.message || "Error al guardar");
      return;
    }
    notify("Cambios guardados");
  };

  const field = (label, child) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>{label}</label>
      {child}
    </div>
  );

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#0f172a",
    fontFamily: "inherit",
    fontSize: ".88em",
    boxSizing: "border-box",
  };

  const athletePlanHint = athletes?.find((a) => a.plan)?.plan;

  if (!coachUserId) {
    return (
      <div style={S.page}>
        <p style={{ color: "#64748b" }}>Inicia sesión para ver la configuración.</p>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Configuración</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 22 }}>Perfil del coach y preferencias de {BRAND_NAME}.</p>

      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando…</div>
      ) : (
        <form onSubmit={saveProfile}>
          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              PERFIL
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "2px solid #e2e8f0",
                    background: "#f1f5f9",
                    margin: "0 auto 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "2em",
                  }}
                >
                  {form.avatar_url ? (
                    <img src={form.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "👤"
                  )}
                </div>
                <label style={{ cursor: uploading ? "wait" : "pointer" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "8px 14px",
                      borderRadius: 8,
                      background: "#eff6ff",
                      color: "#2563eb",
                      fontWeight: 700,
                      fontSize: ".78em",
                    }}
                  >
                    {uploading ? "Subiendo…" : "Subir foto"}
                  </span>
                  <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploading} onChange={onAvatarChange} />
                </label>
              </div>
              <div style={{ flex: "1 1 240px" }}>
                {field(
                  "Nombre completo",
                  <input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} style={inputStyle} />,
                )}
                {field(
                  "Email",
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />,
                )}
                {field(
                  "Teléfono",
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />,
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {field(
                    "País",
                    <input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} style={inputStyle} />,
                  )}
                  {field(
                    "Ciudad",
                    <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} style={inputStyle} />,
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 12 }}>
              CÓDIGO DE COACH
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ color: "#0f172a", fontWeight: 800, fontFamily: "monospace", fontSize: "1.1em" }}>{coachCode || "--------"}</div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(coachCode || "");
                    notify("Código copiado");
                  } catch {
                    notify("No se pudo copiar el código");
                  }
                }}
                style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 10px", color: "#1d4ed8", fontWeight: 700, fontSize: ".75em", cursor: "pointer", fontFamily: "inherit" }}
              >
                Copiar
              </button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: ".85em", color: "#0f172a" }}>
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))} />
              Mostrar mi perfil en "Encuentra tu coach"
            </label>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              PREFERENCIAS
            </div>
            {field(
              "Zona horaria",
              <select value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} style={inputStyle}>
                <option value="America/Bogota">America/Bogota</option>
                <option value="America/Mexico_City">America/Mexico_City</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Santiago">America/Santiago</option>
                <option value="Europe/Madrid">Europe/Madrid</option>
                <option value="UTC">UTC</option>
              </select>,
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {field(
                "Idioma",
                <select value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} style={inputStyle}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>,
              )}
              {field(
                "Moneda",
                <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} style={inputStyle}>
                  <option value="COP">COP</option>
                  <option value="USD">USD</option>
                </select>,
              )}
            </div>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              NOTIFICACIONES
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, cursor: "pointer", fontSize: ".9em", color: "#0f172a" }}>
              <input
                type="checkbox"
                checked={form.notify_new_workouts}
                onChange={(e) => setForm((f) => ({ ...f, notify_new_workouts: e.target.checked }))}
              />
              Emails de nuevos workouts
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: ".9em", color: "#0f172a" }}>
              <input type="checkbox" checked={form.notify_reminders} onChange={(e) => setForm((f) => ({ ...f, notify_reminders: e.target.checked }))} />
              Recordatorios por email
            </label>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              SOLICITUDES DE ATLETAS
            </div>
            {coachRequests.filter((r) => r.status === "pending").length === 0 ? (
              <div style={{ color: "#64748b", fontSize: ".84em" }}>No tienes solicitudes pendientes.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {coachRequests
                  .filter((r) => r.status === "pending")
                  .map((r) => {
                    const athlete = (athletes || []).find((a) => String(a.id) === String(r.athlete_id));
                    return (
                      <div key={r.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ color: "#0f172a", fontWeight: 700, fontSize: ".82em" }}>{athlete?.name || "Atleta"}</div>
                          <div style={{ color: "#64748b", fontSize: ".72em" }}>{athlete?.email || r.athlete_id}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" disabled={requestsBusyId === r.id} onClick={() => updateCoachRequestStatus(r, "accepted")} style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 8, padding: "6px 10px", color: "#15803d", fontSize: ".72em", fontWeight: 700, cursor: requestsBusyId === r.id ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Aceptar</button>
                          <button type="button" disabled={requestsBusyId === r.id} onClick={() => updateCoachRequestStatus(r, "rejected")} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 10px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: requestsBusyId === r.id ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Rechazar</button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              INTEGRACIONES
            </div>
            {!athletes || athletes.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".86em" }}>Aún no tienes atletas registrados.</div>
            ) : loadingStravaByAthlete ? (
              <div style={{ color: "#64748b", fontSize: ".86em" }}>Cargando conexiones de Strava…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {athletes.map((a) => {
                  const currentDeviceRaw = deviceOverrides[a.id] ?? a?.device ?? "";
                  const device = String(currentDeviceRaw).trim();
                  const stravaConn = a?.id ? stravaByUserId[a.id] : null;
                  const corosConnected = device.toLowerCase() === "coros";
                  const garminConnected = device.toLowerCase() === "garmin";
                  return (
                    <div key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                      <div style={{ color: "#0f172a", fontSize: ".84em", fontWeight: 700, marginBottom: 8 }}>{a.name || "Atleta"}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>COROS</div>
                          {corosConnected ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                                ✅ Conectado
                              </span>
                              <button type="button" onClick={() => setAthleteDeviceConnection(a.id, null)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setCorosModalOpen(true)} style={{ background: "linear-gradient(135deg,#2563eb,#3b82f6)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Conectar COROS</button>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>Garmin</div>
                          {garminConnected ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                                ✅ Conectado
                              </span>
                              <button type="button" onClick={() => setAthleteDeviceConnection(a.id, null)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setGarminModalOpen(true)} style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Conectar Garmin</button>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>Strava</div>
                          {stravaConn ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                                ✅ Conectado
                              </span>
                              <button
                                type="button"
                                onClick={() => loadStravaActivitiesForAthlete(a.id, stravaConn.access_token)}
                                style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 9px", color: "#1d4ed8", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                              >
                                {loadingActivitiesByAthlete[a.id] ? "Cargando..." : "Ver actividades"}
                              </button>
                              <button type="button" onClick={() => disconnectStravaForAthlete(a.id)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                console.log("[STRAVA CONNECT][Settings] opening authorize URL", {
                                  athlete_id: a.id,
                                  athlete_name: a.name,
                                  callback_url: STRAVA_CALLBACK_URL,
                                });
                                const authUrl = `https://www.strava.com/oauth/authorize?client_id=218467&redirect_uri=${encodeURIComponent(STRAVA_CALLBACK_URL)}&response_type=code&scope=activity:read_all&state=${encodeURIComponent(String(a.id))}`;
                                window.location.href = authUrl;
                              }}
                              style={{ background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}
                            >
                              🟠 Conectar Strava
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ color: "#64748b", fontSize: ".75em" }}>
                          {stravaConn?.strava_athlete_name ? `Cuenta: ${stravaConn.strava_athlete_name}` : "Sin cuenta Strava enlazada"}
                        </div>
                        <div style={{ color: "#94a3b8", fontSize: ".72em" }}>Atleta ID: {a.id}</div>
                      </div>
                      {Array.isArray(stravaActivitiesByAthlete[a.id]) && stravaActivitiesByAthlete[a.id].length > 0 ? (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                          {stravaActivitiesByAthlete[a.id].map((act) => (
                            <div key={act.id} style={{ border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 10px", background: "#fff7ed" }}>
                              <div style={{ color: "#9a3412", fontWeight: 700, fontSize: ".76em" }}>{act.name}</div>
                              <div style={{ color: "#7c2d12", fontSize: ".72em", marginTop: 2 }}>
                                {act.distanceKm.toFixed(2)} km · {formatDurationClock(act.movingTime)} · {act.pace}
                              </div>
                              <div style={{ color: "#9a3412", fontSize: ".7em", marginTop: 2 }}>
                                {act.dateIso ? new Date(act.dateIso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "Fecha no disponible"}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              SUSCRIPCIÓN
            </div>
            {athletePlanHint ? (
              <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 12 }}>
                Plan detectado en un atleta: <strong style={{ color: "#0f172a" }}>{athletePlanHint}</strong>
              </div>
            ) : null}
            {field(
              "Plan actual",
              <input
                value={form.subscription_plan}
                onChange={(e) => setForm((f) => ({ ...f, subscription_plan: e.target.value }))}
                placeholder="Starter, Pro, Equipo…"
                style={inputStyle}
              />,
            )}
            {field(
              "Fecha de renovación",
              <input type="date" value={form.subscription_renews_at} onChange={(e) => setForm((f) => ({ ...f, subscription_renews_at: e.target.value }))} style={inputStyle} />,
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "12px 24px",
              borderRadius: 10,
              border: "none",
              background: saving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
              color: saving ? "#64748b" : "#fff",
              fontWeight: 800,
              cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              marginBottom: 16,
            }}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </form>
      )}

      <div style={{ ...S.card, marginTop: 8 }}>
        <button
          type="button"
          onClick={onSignOut}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#dc2626",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: ".9em",
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function Plans({ athletes, notify }) {
  const S = styles;

  const WOMPI_PUBLIC_KEY = "pub_test_9yDINqJhS2WxJYpYtgzXkP5TKND5WQyf";
  const WompiCheckoutBase = "https://checkout.wompi.co/p/";
  const redirectUrl = "https://pace-forge-eta.vercel.app";

  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);

  const PLAN_CATALOG = useMemo(
    () => [
      {
        plan: "Basico",
        label: "Básico",
        priceCop: 100000,
        priceUsd: 24,
        maxAthletes: 15,
        description: "Para coaches independientes que quieren profesionalizar su trabajo.",
        benefits: [
          "✓ Hasta 15 atletas",
          "Generador de workouts con IA",
          "Plan 2 semanas renovable",
          "Biblioteca personal de entrenamientos",
          "Chat con atletas",
          "Evaluación VDOT y zonas FC",
          "Exportar PDF",
          "App móvil",
        ],
      },
      {
        plan: "Pro",
        label: "Pro",
        priceCop: 160000,
        priceUsd: 39,
        maxAthletes: null,
        description: "Para coaches y academias que quieren escalar sin límites.",
        benefits: [
          "✓ Atletas ilimitados",
          "Todo lo del Básico",
          "Integración Garmin y COROS",
          "Notificaciones push",
          "Sistema de logros y medallas",
          "Códigos promocionales",
          "Validación de pagos",
          "Soporte prioritario",
          "Panel de administración",
        ],
      },
    ],
    [],
  );

  const coachPlan = athletes?.[0]?.plan || "";

  const amountInCentsByPlan = (planName) => {
    if (planName === "Basico") return 10000000;
    if (planName === "Pro") return 16000000;
    return 0;
  };

  const applyPromo = async () => {
    const code = promoInput.trim();
    setPromoError("");
    if (!code) {
      setPromoError("Escribe un código");
      return;
    }
    setPromoLoading(true);
    const { data, error } = await supabase.rpc("validate_promo_code", { code_input: code });
    setPromoLoading(false);
    if (error) {
      console.error(error);
      setPromoError(error.message || "No se pudo validar el código");
      setAppliedPromo(null);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.discount_percent == null) {
      setPromoError("Código no válido o sin usos disponibles");
      setAppliedPromo(null);
      return;
    }
    setAppliedPromo({ code: code.toUpperCase().replace(/\s+/g, ""), discount_percent: Number(row.discount_percent) });
    notify(`Código aplicado: ${row.discount_percent}% de descuento`);
  };

  const clearPromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError("");
  };

  const openDirectWompiCheckout = async (planObj) => {
    const amountInCentsBase = amountInCentsByPlan(planObj.plan);
    if (!amountInCentsBase) return;

    let amountInCents = amountInCentsBase;
    if (appliedPromo?.discount_percent != null) {
      amountInCents = Math.max(0, Math.round((amountInCentsBase * (100 - appliedPromo.discount_percent)) / 100));
    }

    if (appliedPromo?.code) {
      const { data: ok, error: redeemErr } = await supabase.rpc("redeem_promo_code", { code_input: appliedPromo.code });
      if (redeemErr) {
        console.error(redeemErr);
        notify(redeemErr.message || "No se pudo registrar el uso del código");
        return;
      }
      if (!ok) {
        notify("El código ya no es válido o no tiene usos");
        setAppliedPromo(null);
        return;
      }
    }

    const reference = `runningapexflow-${planObj.plan}-${Date.now()}`;

    const params = new URLSearchParams({
      "public-key": WOMPI_PUBLIC_KEY,
      currency: "COP",
      "amount-in-cents": String(amountInCents),
      reference,
      "redirect-url": redirectUrl,
    });

    const checkoutUrl = `${WompiCheckoutBase}?${params.toString()}`;
    window.open(checkoutUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={S.pageTitle}>Planes</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>Elige un plan para tu coach</p>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>CÓDIGO PROMOCIONAL</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            placeholder="Ingresa tu código"
            disabled={!!appliedPromo}
            style={{
              flex: "1 1 200px",
              minWidth: 160,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: appliedPromo ? "#f1f5f9" : "#fff",
              color: "#0f172a",
              fontFamily: "inherit",
              fontSize: ".88em",
            }}
          />
          {appliedPromo ? (
            <button
              type="button"
              onClick={clearPromo}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#fff",
                color: "#64748b",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Quitar
            </button>
          ) : (
            <button
              type="button"
              onClick={applyPromo}
              disabled={promoLoading}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: promoLoading ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#3b82f6)",
                color: promoLoading ? "#64748b" : "#fff",
                fontWeight: 800,
                cursor: promoLoading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {promoLoading ? "…" : "Aplicar"}
            </button>
          )}
        </div>
        {promoError ? <div style={{ color: "#dc2626", fontSize: ".8em", marginTop: 8 }}>{promoError}</div> : null}
        {appliedPromo ? (
          <div style={{ color: "#15803d", fontSize: ".82em", marginTop: 8, fontWeight: 600 }}>
            Descuento del {appliedPromo.discount_percent}% aplicado a los precios mostrados.
          </div>
        ) : null}
      </div>

      <div className="pf-plans-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }}>
        {PLAN_CATALOG.map((p) => {
          const isCurrent = coachPlan === p.plan;
          const copPretty = Number(p.priceCop).toLocaleString("es-CO");
          const discountPct = appliedPromo?.discount_percent ?? 0;
          const priceAfter = Math.max(0, Math.round((p.priceCop * (100 - discountPct)) / 100));
          const copAfterPretty = Number(priceAfter).toLocaleString("es-CO");

          return (
            <div
              key={p.plan}
              style={{
                ...S.card,
                border: isCurrent ? "2px solid #f59e0b" : "1px solid #e2e8f0",
                background: isCurrent ? "rgba(245,158,11,.06)" : "#ffffff",
                padding: 18,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: "1.2em", fontWeight: 800, color: isCurrent ? "#f59e0b" : "#0f172a" }}>
                {p.label}
                <span style={{ fontSize: ".65em", color: "#64748b", fontWeight: 600, marginLeft: 8 }}>(${p.priceUsd} USD)</span>
              </div>
              <div style={{ fontSize: "2em", fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>
                {discountPct > 0 ? (
                  <>
                    <span style={{ textDecoration: "line-through", color: "#94a3b8", fontSize: ".55em", marginRight: 8 }}>${copPretty}</span>
                    <span>{`$${copAfterPretty}`}</span>
                  </>
                ) : (
                  `$${copPretty}`
                )}
                <span style={{ fontSize: ".55em", color: "#64748b", fontFamily: "inherit", marginLeft: 6 }}>COP</span>
              </div>
              <div style={{ fontSize: ".8em", color: "#64748b" }}>{p.description}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                {(p.benefits || []).map((benefit) => (
                  <div
                    key={benefit}
                    style={{ fontSize: ".78em", color: "#334155", display: "flex", alignItems: "flex-start", gap: 6, lineHeight: 1.35 }}
                  >
                    <span style={{ color: "#22c55e", fontWeight: 900 }}>✓</span>
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "auto" }}>
                <button
                  type="button"
                  onClick={() => openDirectWompiCheckout(p)}
                  style={{
                    width: "100%",
                    background: "linear-gradient(135deg,#b45309,#f59e0b)",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 14px",
                    color: "white",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: 900,
                    fontSize: ".85em",
                  }}
                >
                  Suscribirse
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
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
