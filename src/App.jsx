import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from "react";
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
/** Persistencia del atleta seleccionado en la vista Atletas del coach. */
const RAF_SELECTED_ATHLETE_STORAGE_KEY = "raf_selected_athlete";

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
  athlete_plan: typeof athlete?.athlete_plan === "string" ? athlete.athlete_plan : "",
});

const pushBodySnippet = (text, max = 400) => {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
};

async function sendChatPushNotification({ token, title, body, data = null, logLabel = "chat push" }) {
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
        data: data && typeof data === "object" ? data : undefined,
      }),
    });
    if (!res.ok) console.warn(`[${logLabel}] /api/send-notification respuesta no OK`, await res.text());
    else console.log(`[${logLabel}] /api/send-notification OK`, res.status);
  } catch (e) {
    console.warn(`[${logLabel}] /api/send-notification error`, e);
  }
}

async function sendWorkoutAssignmentPushToAthlete({ athleteUserId, workoutTitle, scheduledDate }) {
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
const WORKOUT_BLOCK_TYPES = ["Calentamiento", "Intervalo", "Recuperación", "Enfriamiento"];
const WORKOUT_BLOCK_COLORS = {
  Calentamiento: { bg: "rgba(245,158,11,.14)", border: "rgba(245,158,11,.45)", text: "#b45309" },
  Intervalo: { bg: "rgba(239,68,68,.12)", border: "rgba(239,68,68,.4)", text: "#b91c1c" },
  Recuperación: { bg: "rgba(34,197,94,.12)", border: "rgba(34,197,94,.38)", text: "#166534" },
  Enfriamiento: { bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.38)", text: "#1d4ed8" },
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

const ATHLETE_ACHIEVEMENT_DISPLAY_LIST = [
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
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const getWeekStartYmdFromDate = (d) => {
  if (!d || Number.isNaN(d.getTime())) return null;
  return formatLocalYMD(startOfWeekMonday(d));
};

const getLongestConsecutiveWeeks = (weekKeys) => {
  if (!Array.isArray(weekKeys) || weekKeys.length === 0) return 0;
  const uniq = [...new Set(weekKeys)].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < uniq.length; i++) {
    const prev = new Date(`${uniq[i - 1]}T12:00:00`);
    const now = new Date(`${uniq[i]}T12:00:00`);
    const diffDays = Math.round((now.getTime() - prev.getTime()) / 86400000);
    if (diffDays === 7) current += 1;
    else current = 1;
    if (current > best) best = current;
  }
  return best;
};

const computeAthleteAchievementVisualProgress = (allWorkouts, evaluations) => {
  const all = Array.isArray(allWorkouts) ? allWorkouts : [];
  const done = all.filter((w) => w?.done);
  const todayYmd = formatLocalYMD(new Date());
  const totalKm = done.reduce((sum, w) => sum + (Number(w.total_km) || 0), 0);
  const doneCount = done.length;
  const longestConsecutiveDays = getLongestConsecutiveDays(done.map((w) => normalizeScheduledDateYmd(w.scheduled_date || w.completed_at)).filter(Boolean));
  const intervalCount = done.filter((w) => String(w.type || "").toLowerCase() === "interval").length;
  const hrLoggedCount = done.filter((w) => {
    const candidates = [w.manual_avg_hr, w.manual_max_hr, w.avg_hr, w.average_heartrate, w.strava_avg_hr];
    return candidates.some((v) => Number(v) > 0);
  }).length;
  const earlyMorningDoneCount = done.filter((w) => {
    const d = getWorkoutReferenceDate(w);
    return d && d.getHours() < 8;
  }).length;

  const sortedScheduled = [...all]
    .filter((w) => normalizeScheduledDateYmd(w.scheduled_date || w.completed_at) && normalizeScheduledDateYmd(w.scheduled_date || w.completed_at) <= todayYmd)
    .sort((a, b) => {
      const ad = getWorkoutReferenceDate(a)?.getTime() || 0;
      const bd = getWorkoutReferenceDate(b)?.getTime() || 0;
      return ad - bd;
    });
  let streak = 0;
  let longestDoneNoFailStreak = 0;
  for (const w of sortedScheduled) {
    if (w?.done) streak += 1;
    else streak = 0;
    if (streak > longestDoneNoFailStreak) longestDoneNoFailStreak = streak;
  }

  const weekMap = {};
  for (const w of sortedScheduled) {
    const refDate = getWorkoutReferenceDate(w);
    const weekKey = getWeekStartYmdFromDate(refDate);
    if (!weekKey) continue;
    if (!weekMap[weekKey]) weekMap[weekKey] = { total: 0, done: 0 };
    weekMap[weekKey].total += 1;
    if (w?.done) weekMap[weekKey].done += 1;
  }
  const fullWeeksCompleted = Object.values(weekMap).filter((x) => x.total > 0 && x.done >= x.total).length;

  const doneWeekKeys = done
    .map((w) => getWeekStartYmdFromDate(getWorkoutReferenceDate(w)))
    .filter(Boolean);
  const consecutiveDoneWeeks = getLongestConsecutiveWeeks(doneWeekKeys);

  const evalRows = Array.isArray(evaluations) ? evaluations : [];
  const vdotValues = evalRows.map((r) => Number(r?.vdot)).filter((v) => Number.isFinite(v) && v > 0);
  let vdotImprovementStreak = 0;
  let vdotCurrent = 0;
  for (let i = 1; i < vdotValues.length; i++) {
    if (vdotValues[i] > vdotValues[i - 1]) vdotCurrent += 1;
    else vdotCurrent = 0;
    if (vdotCurrent > vdotImprovementStreak) vdotImprovementStreak = vdotCurrent;
  }

  return {
    totalKm,
    doneCount,
    longestConsecutiveDays,
    fullWeeksCompleted,
    intervalCount,
    hrLoggedCount,
    earlyMorningDoneCount,
    consecutiveDoneWeeks,
    longestDoneNoFailStreak,
    vdotImprovementStreak,
  };
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
const PLAN2_NEXT_BLOCK_FOCUSES = ["Base", "Construcción", "Desarrollo", "Pico", "Descarga"];
const PLAN2_TRAINING_DAY_OPTIONS = [
  { weekday: 2, label: "Mar" },
  { weekday: 3, label: "Mié" },
  { weekday: 4, label: "Jue" },
  { weekday: 6, label: "Sáb" },
  { weekday: 7, label: "Dom" },
];
const PLAN2_ATHLETE_STORAGE_KEY = "raf_plan2_athlete";

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

const normalizeWorkoutStructure = (rawStructure) => {
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

const WorkoutStructureTable = ({ structure = [] }) => {
  const rows = normalizeWorkoutStructure(structure);
  if (!rows.length) return null;
  return (
    <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8em" }}>
        <thead style={{ background: "#f8fafc" }}>
          <tr>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Paso</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Tipo</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Duración (min)</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Distancia (km)</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Ritmo</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>FC objetivo</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Descripción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((step, i) => {
            const c = WORKOUT_BLOCK_COLORS[step.block_type] || { bg: "#f8fafc", border: "#e2e8f0", text: "#334155" };
            return (
              <tr key={`${step.block_type}-${i}`}>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{i + 1}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 999, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontWeight: 800 }}>
                    {step.block_type}
                  </span>
                </td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.duration_min || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.distance_km || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.target_pace || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.target_hr || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.description || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const normalizeWorkoutRow = (row) => {
  let structure = row.workout_structure ?? row.structure;
  if (typeof structure === "string") {
    try { structure = JSON.parse(structure); } catch { structure = []; }
  }
  structure = normalizeWorkoutStructure(structure);
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
    workout_structure: Array.isArray(structure) ? structure : [],
    done: Boolean(row.done),
    rpe: clampWorkoutRpe(row.rpe),
    manual_distance_km: Number.isFinite(Number(row.manual_distance_km)) ? Number(row.manual_distance_km) : null,
    manual_duration_min: Number.isFinite(Number(row.manual_duration_min)) ? Number(row.manual_duration_min) : null,
    manual_avg_hr: Number.isFinite(Number(row.manual_avg_hr)) ? Math.round(Number(row.manual_avg_hr)) : null,
    manual_max_hr: Number.isFinite(Number(row.manual_max_hr)) ? Math.round(Number(row.manual_max_hr)) : null,
    manual_calories: Number.isFinite(Number(row.manual_calories)) ? Math.round(Number(row.manual_calories)) : null,
    athlete_notes: typeof row.athlete_notes === "string" ? row.athlete_notes : "",
    completed_at: row.completed_at || null,
  };
};

const emptyWorkoutStructureRow = () => ({ block_type: "Intervalo", duration_min: "", distance_km: "", target_pace: "", target_hr: "", description: "" });

/** Convierte structure del workout a filas editables (fases). */
const workoutStructureToEditableRows = (structure) => {
  return normalizeWorkoutStructure(structure);
};

/** Filas del formulario → JSON guardado en workouts.structure */
const editableRowsToWorkoutStructure = (rows) => {
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

const normalizeLibraryRow = (row) => {
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

const getNextMonday = (dateStr) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return formatLocalYMD(addDays(new Date(), 1));
  const day = d.getDay(); // 0=domingo, 1=lunes...
  const diff = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return formatLocalYMD(d);
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
  { id: "marketplace", icon: "🛒", label: "Marketplace", shortLabel: "Market", color: "#0ea5e9" },
  { id: "challenges", icon: "🏆", label: "Retos", shortLabel: "Retos", color: "#a855f7" },
];

const COACH_SUBSCRIPTION_NEQUI = "3233675434";
const COACH_SUBSCRIPTION_WA_E164 = "573233675434";

const formatCopInt = (n) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 }) : "—";

/** Precios COP según tablas del producto (mensual base; semestral −12%; anual −20%). */
const COACH_PLAN_PICKER_DEFS = {
  basico: {
    key: "basico",
    dbPlan: "Basico",
    title: "Básico",
    bullets: ["Hasta 15 atletas", "100 generaciones IA/mes"],
    prices: { monthly: 100000, semestral: 528000, anual: 960000 },
  },
  pro: {
    key: "pro",
    dbPlan: "Pro",
    title: "Pro",
    bullets: ["Atletas ilimitados", "Generaciones IA ilimitadas", "Acceso prioritario"],
    prices: { monthly: 160000, semestral: 844800, anual: 1536000 },
  },
};

const COACH_PLAN_PICKER_PERIODS = [
  { id: "monthly", label: "Mensual", discountPct: 0, badge: null },
  { id: "semestral", label: "Semestral", discountPct: 12, badge: "Ahorra 12%" },
  { id: "anual", label: "Anual", discountPct: 20, badge: "Ahorra 20%" },
];

const CHALLENGE_TYPE_OPTIONS = [
  { id: "distancia", label: "Distancia (km)" },
  { id: "tiempo", label: "Tiempo (min)" },
  { id: "workouts", label: "Workouts completados" },
  { id: "racha", label: "Racha (días)" },
];

const challengeValueLabel = (challenge) => {
  const unit = String(challenge?.unit || "").trim();
  const target = Number(challenge?.target_value || 0);
  if (!Number.isFinite(target) || target <= 0) return "Meta pendiente";
  if (unit) return `${target} ${unit}`;
  return String(target);
};

const normalizeChallengeType = (raw) => {
  const type = String(raw || "").trim().toLowerCase();
  if (type === "distance") return "distancia";
  if (type === "time") return "tiempo";
  return type;
};

const computeWorkoutDayStreak = (workouts, startYmd, endYmd) => {
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

const computeChallengeProgressForAthlete = (challenge, workouts) => {
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

function ChallengesHub({ profileRole, currentUserId, athleteId = null, workouts = [], notify }) {
  const S = styles;
  const isAdmin = profileRole === "admin" || String(currentUserId || "") === PLATFORM_ADMIN_USER_ID;
  const isAthlete = profileRole === "athlete";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [participantsByChallenge, setParticipantsByChallenge] = useState({});
  const [myChallengeIds, setMyChallengeIds] = useState(() => new Set());
  const [joiningChallengeId, setJoiningChallengeId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAiGenerateModal, setShowAiGenerateModal] = useState(false);
  const [aiContextPrompt, setAiContextPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [workoutsByAthlete, setWorkoutsByAthlete] = useState({});
  const [participantsModalChallenge, setParticipantsModalChallenge] = useState(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    challenge_type: "distancia",
    target_value: "",
    unit: "km",
    start_date: formatLocalYMD(new Date()),
    end_date: formatLocalYMD(addDays(new Date(), 30)),
    emoji: "🏁",
    color: "#a855f7",
  });

  const loadChallenges = useCallback(async () => {
    setLoading(true);
    const today = formatLocalYMD(new Date());
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .eq("is_active", true)
      .gte("end_date", today)
      .order("end_date", { ascending: true });
    if (error) {
      console.error("load challenges:", error);
      notify?.(error.message || "No se pudieron cargar los retos");
      setRows([]);
      setLoading(false);
      return;
    }
    const list = Array.isArray(data) ? data : [];
    setRows(list);
    const ids = list.map((c) => c.id).filter(Boolean);
    if (ids.length === 0) {
      setParticipantsByChallenge({});
      setMyChallengeIds(new Set());
      setLoading(false);
      return;
    }
    const { data: participants, error: pErr } = await supabase
      .from("challenge_participants")
      .select("id,challenge_id,user_id,athlete_id")
      .in("challenge_id", ids);
    if (pErr) {
      console.error("load challenge_participants:", pErr);
    }
    const userIds = [...new Set((participants || []).map((p) => p.user_id).filter(Boolean))];
    const athleteIds = [...new Set((participants || []).map((p) => p.athlete_id).filter(Boolean))];
    const profileNameByUserId = {};
    const athleteNameById = {};
    if (userIds.length > 0) {
      const { data: profileRows, error: profileErr } = await supabase
        .from("profiles")
        .select("user_id,name")
        .in("user_id", userIds);
      if (profileErr) {
        console.error("load participant profiles:", profileErr);
      } else {
        for (const row of profileRows || []) {
          profileNameByUserId[String(row.user_id)] = String(row.name || "").trim();
        }
      }
    }
    if (athleteIds.length > 0) {
      const { data: athleteRows, error: athleteErr } = await supabase
        .from("athletes")
        .select("id,name")
        .in("id", athleteIds);
      if (athleteErr) {
        console.error("load participant athletes:", athleteErr);
      } else {
        for (const row of athleteRows || []) {
          athleteNameById[String(row.id)] = String(row.name || "").trim();
        }
      }
    }
    let workoutsMap = {};
    if (athleteIds.length > 0) {
      const dateRangeStart = list
        .map((c) => String(c.start_date || ""))
        .filter(Boolean)
        .sort()[0];
      const dateRangeEnd = [...list.map((c) => String(c.end_date || "")).filter(Boolean)].sort().slice(-1)[0];
      const workoutsQuery = supabase
        .from("workouts")
        .select("id,athlete_id,scheduled_date,total_km,duration_min,done")
        .eq("done", true)
        .in("athlete_id", athleteIds);
      const boundedQuery =
        dateRangeStart && dateRangeEnd
          ? workoutsQuery.gte("scheduled_date", dateRangeStart).lte("scheduled_date", dateRangeEnd)
          : workoutsQuery;
      const { data: doneWorkouts, error: workoutsErr } = await boundedQuery;
      if (workoutsErr) {
        console.error("load challenge workouts:", workoutsErr);
      } else {
        for (const row of doneWorkouts || []) {
          const aid = String(row.athlete_id);
          if (!workoutsMap[aid]) workoutsMap[aid] = [];
          workoutsMap[aid].push(normalizeWorkoutRow(row));
        }
      }
    }
    const grouped = {};
    const mine = new Set();
    for (const p of participants || []) {
      const cid = p.challenge_id;
      if (!grouped[cid]) grouped[cid] = [];
      const profileName = profileNameByUserId[String(p.user_id)] || "";
      const athleteName = athleteNameById[String(p.athlete_id)] || "";
      const displayName = profileName || athleteName || "Participante";
      const initials =
        displayName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((chunk) => chunk[0])
          .join("")
          .toUpperCase() || "P";
      grouped[cid].push({ ...p, displayName, initials });
      if (
        String(p.user_id || "") === String(currentUserId || "") ||
        (athleteId != null && String(p.athlete_id || "") === String(athleteId))
      ) {
        mine.add(String(cid));
      }
    }
    setParticipantsByChallenge(grouped);
    setWorkoutsByAthlete(workoutsMap);
    setMyChallengeIds(mine);
    setLoading(false);
  }, [notify, currentUserId, athleteId]);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

  const joinChallenge = async (challengeId) => {
    if (!currentUserId || !athleteId) return;
    setJoiningChallengeId(String(challengeId));
    const { error } = await supabase.from("challenge_participants").insert({
      challenge_id: challengeId,
      user_id: currentUserId,
      athlete_id: athleteId,
    });
    setJoiningChallengeId("");
    if (error) {
      notify?.(error.message || "No se pudo unir al reto");
      return;
    }
    notify?.("Te uniste al reto ✅");
    loadChallenges();
  };

  const createChallenge = async () => {
    if (!isAdmin) return;
    const title = form.title.trim();
    const target = Number(form.target_value);
    if (!title || !Number.isFinite(target) || target <= 0 || !form.start_date || !form.end_date) {
      notify?.("Completa título, meta y rango de fechas válidos.");
      return;
    }
    setSavingCreate(true);
    const { error } = await supabase.from("challenges").insert({
      title,
      description: form.description.trim() || null,
      challenge_type: form.challenge_type,
      target_value: target,
      unit: form.unit.trim() || null,
      start_date: form.start_date,
      end_date: form.end_date,
      emoji: form.emoji.trim() || "🏁",
      color: form.color || "#a855f7",
      created_by: PLATFORM_ADMIN_USER_ID,
      is_active: true,
    });
    setSavingCreate(false);
    if (error) {
      notify?.(error.message || "No se pudo crear el reto");
      return;
    }
    setShowCreate(false);
    setForm((prev) => ({ ...prev, title: "", description: "", target_value: "" }));
    notify?.("Reto creado ✅");
    loadChallenges();
  };

  const applyAiChallengeDraftToForm = (draft) => {
    const typeRaw = String(draft?.type || "").trim().toLowerCase();
    const mappedType =
      typeRaw === "distance"
        ? "distancia"
        : typeRaw === "time"
          ? "tiempo"
          : typeRaw === "workouts"
            ? "workouts"
            : typeRaw === "streak"
              ? "racha"
              : "distancia";
    const unitRaw = String(draft?.goal_unit || "").trim().toLowerCase();
    const mappedUnit =
      unitRaw === "sesiones" ? "sesiones" : unitRaw === "días" ? "días" : unitRaw || (mappedType === "distancia" ? "km" : mappedType === "tiempo" ? "min" : "");
    const durationDays = Math.max(7, Math.min(30, Math.round(Number(draft?.duration_days) || 14)));
    const start = new Date();
    const end = addDays(start, durationDays);
    setForm((prev) => ({
      ...prev,
      title: String(draft?.title || "").trim(),
      description: String(draft?.description || "").trim(),
      challenge_type: mappedType,
      target_value: String(Number(draft?.goal_value) || ""),
      unit: mappedUnit,
      start_date: formatLocalYMD(start),
      end_date: formatLocalYMD(end),
      emoji: String(draft?.badge_emoji || "🏁").trim() || "🏁",
      color: String(draft?.badge_color || "#a855f7").trim() || "#a855f7",
    }));
    setShowCreate(true);
  };

  const generateChallengeWithAi = async () => {
    if (!isAdmin) return;
    if (!aiContextPrompt.trim()) {
      notify?.("Escribe un contexto para generar el reto.");
      return;
    }
    setAiGenerating(true);
    try {
      const system = `Eres un experto en coaching de running. Genera un reto de running motivador para una plataforma de coaching.
Responde SOLO con un JSON con esta estructura exacta, sin texto adicional:
{
  "title": "título corto y motivador del reto",
  "description": "descripción del reto en 1-2 oraciones que motive a participar",
  "type": "distance" | "time" | "workouts" | "streak",
  "goal_value": número,
  "goal_unit": "km" | "min" | "sesiones" | "días",
  "duration_days": número de días que dura el reto (entre 7 y 30),
  "badge_emoji": un emoji representativo,
  "badge_color": color hex motivador
}`;
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1800,
          system,
          messages: [{ role: "user", content: aiContextPrompt.trim() }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify?.(data?.error || "Error al generar reto con IA.");
        return;
      }
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const parsed = extractJsonFromAnthropicText(text);
      if (!parsed || typeof parsed !== "object") {
        notify?.("La IA no devolvió un JSON válido.");
        return;
      }
      applyAiChallengeDraftToForm(parsed);
      setShowAiGenerateModal(false);
      notify?.("Reto generado con IA. Revisa y guarda cuando quieras.");
    } catch (e) {
      console.error("generate challenge ai:", e);
      notify?.("No se pudo generar el reto con IA.");
    } finally {
      setAiGenerating(false);
    }
  };

  const deleteChallenge = async (challengeId) => {
    if (!isAdmin) return;
    if (typeof window !== "undefined" && !window.confirm("¿Eliminar este reto?")) return;
    setDeletingId(String(challengeId));
    const { error } = await supabase.from("challenges").delete().eq("id", challengeId);
    setDeletingId("");
    if (error) {
      notify?.(error.message || "No se pudo eliminar el reto");
      return;
    }
    notify?.("Reto eliminado");
    loadChallenges();
  };

  return (
    <div style={{ ...S.card, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a" }}>🏆 Retos</div>
          <div style={{ color: "#64748b", fontSize: ".8em", marginTop: 3 }}>Retos activos de la comunidad</div>
        </div>
        {isAdmin ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setShowAiGenerateModal(true)}
              style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)", border: "none", borderRadius: 10, padding: "9px 14px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: ".78em" }}
            >
              ✨ Generar con IA
            </button>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", borderRadius: 10, padding: "9px 14px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: ".78em" }}
            >
              ➕ Crear reto
            </button>
          </div>
        ) : null}
      </div>

      {isAdmin && showAiGenerateModal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10020, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 560, margin: 0 }}>
            <div style={{ fontSize: "1.02em", fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>✨ Generar reto con IA</div>
            <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 10 }}>
              Describe el contexto del reto y la IA pre-rellenará el formulario de creación.
            </div>
            <textarea
              rows={4}
              value={aiContextPrompt}
              onChange={(e) => setAiContextPrompt(e.target.value)}
              placeholder='Ej: "Reto de abril para motivar corredores principiantes"'
              style={{ width: "100%", border: "1px solid #dbe2ea", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" disabled={aiGenerating} onClick={() => setShowAiGenerateModal(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "8px 12px", color: "#475569", fontFamily: "inherit", fontWeight: 700, cursor: aiGenerating ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                Cerrar
              </button>
              <button type="button" disabled={aiGenerating} onClick={generateChallengeWithAi} style={{ border: "none", background: aiGenerating ? "#cbd5e1" : "linear-gradient(135deg,#0ea5e9,#6366f1)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontFamily: "inherit", fontWeight: 800, cursor: aiGenerating ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                {aiGenerating ? "Generando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin && showCreate ? (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "#f8fafc", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Título" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <select value={form.challenge_type} onChange={(e) => setForm((f) => ({ ...f, challenge_type: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }}>
              {CHALLENGE_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <input type="number" min="1" value={form.target_value} onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))} placeholder="Meta" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="Unidad" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <input value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))} placeholder="Emoji" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "4px", background: "#fff", height: 36 }} />
          </div>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Descripción" rows={3} style={{ marginTop: 10, width: "100%", border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              disabled={savingCreate}
              onClick={createChallenge}
              style={{ background: savingCreate ? "#cbd5e1" : "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 700, fontFamily: "inherit", cursor: savingCreate ? "not-allowed" : "pointer", fontSize: ".78em" }}
            >
              {savingCreate ? "Guardando…" : "Guardar reto"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "#64748b", fontSize: ".85em" }}>Cargando retos…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: ".84em" }}>No hay retos activos por ahora.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((challenge) => {
            const participants = participantsByChallenge[challenge.id] || [];
            const isMine = myChallengeIds.has(String(challenge.id));
            const progress = computeChallengeProgressForAthlete(challenge, workouts);
            return (
              <div key={challenge.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: "1.25em" }}>{challenge.emoji || "🏁"}</span>
                      <span style={{ fontWeight: 900, color: challenge.color || "#0f172a", fontSize: ".95em" }}>{challenge.title || "Reto"}</span>
                    </div>
                    <div style={{ color: "#64748b", fontSize: ".82em", marginTop: 4, lineHeight: 1.4 }}>{challenge.description || "Sin descripción"}</div>
                  </div>
                  <div style={{ color: "#475569", fontSize: ".76em", fontWeight: 700 }}>Meta: {challengeValueLabel(challenge)}</div>
                </div>
                <div style={{ marginTop: 10, color: "#64748b", fontSize: ".76em" }}>
                  Fecha límite: {challenge.end_date ? new Date(`${challenge.end_date}T12:00:00`).toLocaleDateString("es-CO") : "—"} · Participantes: {participants.length}
                </div>
                <div style={{ marginTop: 10, borderTop: "1px dashed #e2e8f0", paddingTop: 10 }}>
                  <div style={{ fontSize: ".74em", color: "#475569", fontWeight: 800, marginBottom: 8 }}>👥 Participantes</div>
                  {participants.length === 0 ? (
                    <div style={{ color: "#94a3b8", fontSize: ".78em" }}>Sé el primero en unirte</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                        {participants.slice(0, 5).map((participant) => (
                          <div key={participant.id} style={{ width: 64, textAlign: "center" }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                margin: "0 auto 4px",
                                borderRadius: "50%",
                                background: "#e2e8f0",
                                color: "#334155",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 900,
                                fontSize: ".78em",
                              }}
                            >
                              {participant.initials}
                            </div>
                            <div style={{ fontSize: ".67em", color: "#475569", lineHeight: 1.25 }}>
                              {participant.displayName}
                            </div>
                          </div>
                        ))}
                        {participants.length > 5 ? (
                          <div style={{ alignSelf: "center", color: "#64748b", fontSize: ".74em", fontWeight: 700 }}>
                            +{participants.length - 5} más
                          </div>
                        ) : null}
                      </div>
                      {participants.length > 5 ? (
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => setParticipantsModalChallenge(challenge)}
                            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", fontSize: ".75em", padding: 0, textDecoration: "underline" }}
                          >
                            Ver todos
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                {isAthlete ? (
                  <>
                    <div style={{ marginTop: 10, fontSize: ".76em", color: "#475569", fontWeight: 700 }}>
                      Progreso: {progress.value.toFixed(1)} / {progress.target || 0}
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", marginTop: 6 }}>
                      <div style={{ width: `${progress.pct}%`, height: "100%", background: challenge.color || "#a855f7" }} />
                    </div>
                  </>
                ) : null}
                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {isAthlete ? (
                    isMine ? (
                      <span style={{ fontSize: ".72em", fontWeight: 800, color: "#15803d", border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.14)", borderRadius: 999, padding: "4px 10px" }}>
                        Participando
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={joiningChallengeId === String(challenge.id) || !athleteId}
                        onClick={() => joinChallenge(challenge.id)}
                        style={{ background: joiningChallengeId === String(challenge.id) ? "#cbd5e1" : "linear-gradient(135deg,#2563eb,#3b82f6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: joiningChallengeId === String(challenge.id) ? "not-allowed" : "pointer", fontSize: ".75em" }}
                      >
                        {joiningChallengeId === String(challenge.id) ? "Uniendo…" : "Unirse"}
                      </button>
                    )
                  ) : <span />}
                  {isAdmin ? (
                    <button
                      type="button"
                      disabled={deletingId === String(challenge.id)}
                      onClick={() => deleteChallenge(challenge.id)}
                      style={{ background: deletingId === String(challenge.id) ? "#e2e8f0" : "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 10px", color: "#b91c1c", fontWeight: 700, cursor: deletingId === String(challenge.id) ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".72em" }}
                    >
                      🗑️ Eliminar
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {participantsModalChallenge ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10030, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 560, margin: 0, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: "1.02em", fontWeight: 900, color: "#0f172a" }}>👥 Participantes · {participantsModalChallenge.title || "Reto"}</div>
              <button type="button" onClick={() => setParticipantsModalChallenge(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontFamily: "inherit", fontWeight: 700, cursor: "pointer", fontSize: ".76em" }}>
                Cerrar
              </button>
            </div>
            {(participantsByChallenge[participantsModalChallenge.id] || []).length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".82em" }}>Sin participantes</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(participantsByChallenge[participantsModalChallenge.id] || []).map((participant) => {
                  const participantWorkouts = workoutsByAthlete[String(participant.athlete_id)] || [];
                  const participantProgress =
                    participant.athlete_id != null
                      ? computeChallengeProgressForAthlete(participantsModalChallenge, participantWorkouts)
                      : null;
                  return (
                    <div key={participant.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 10px", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#e2e8f0", color: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: ".75em" }}>
                          {participant.initials}
                        </div>
                        <div style={{ fontSize: ".82em", color: "#0f172a", fontWeight: 700 }}>{participant.displayName}</div>
                      </div>
                      <div style={{ fontSize: ".75em", color: "#64748b", fontWeight: 700 }}>
                        {participantProgress ? `${participantProgress.value.toFixed(1)} / ${participantProgress.target || 0}` : "Sin progreso"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  /** Pantalla dentro del flujo de auth: elección inicial, login o registro. */
  const [authLandingStep, setAuthLandingStep] = useState("choice");
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
  const [pendingCoachRequestId, setPendingCoachRequestId] = useState("");
  const [viewRestored, setViewRestored] = useState(false);
  const [coachPlanPickerVoluntary, setCoachPlanPickerVoluntary] = useState(false);
  const [coachPickerPlan, setCoachPickerPlan] = useState(null);
  const [coachPickerPeriod, setCoachPickerPeriod] = useState(null);
  const [coachPaymentModalOpen, setCoachPaymentModalOpen] = useState(false);
  const [coachSubscriptionSaving, setCoachSubscriptionSaving] = useState(false);

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
    const items = [...COACH_NAV_BASE_ITEMS].filter((item) => item.id !== "plans" || role === "coach");
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

  const persistCoachSubscriptionSelection = useCallback(
    async (planKey, periodId) => {
      const def = COACH_PLAN_PICKER_DEFS[planKey];
      const amount = def?.prices?.[periodId];
      const uid = session?.user?.id;
      if (!def || amount == null || !uid) return false;
      setCoachSubscriptionSaving(true);
      const periodDb = periodId === "monthly" ? "mensual" : periodId;
      const { error } = await supabase
        .from("profiles")
        .update({
          subscription_plan: def.dbPlan,
          subscription_period: periodDb,
          subscription_amount: amount,
        })
        .eq("user_id", uid);
      setCoachSubscriptionSaving(false);
      if (error) {
        console.error("persistCoachSubscriptionSelection", error);
        notify(error.message || "No se pudo guardar tu selección de plan.");
        return false;
      }
      setProfile((p) =>
        p && String(p.user_id) === String(uid)
          ? { ...p, subscription_plan: def.dbPlan, subscription_period: periodDb, subscription_amount: amount }
          : p,
      );
      return true;
    },
    [session?.user?.id, notify],
  );

  const handleCoachPlanPagarAhora = useCallback(async () => {
    if (!coachPickerPlan || !coachPickerPeriod) {
      notify("Elige un plan y un período de pago.");
      return;
    }
    const ok = await persistCoachSubscriptionSelection(coachPickerPlan, coachPickerPeriod);
    if (ok) setCoachPaymentModalOpen(true);
  }, [coachPickerPlan, coachPickerPeriod, persistCoachSubscriptionSelection, notify]);

  const coachPlanPickerWhatsAppHref = useMemo(() => {
    if (!coachPickerPlan || !coachPickerPeriod) return `https://wa.me/${COACH_SUBSCRIPTION_WA_E164}`;
    const def = COACH_PLAN_PICKER_DEFS[coachPickerPlan];
    const amount = def?.prices?.[coachPickerPeriod];
    const periodLabel = COACH_PLAN_PICKER_PERIODS.find((p) => p.id === coachPickerPeriod)?.label || coachPickerPeriod;
    const planTitle = def?.title || coachPickerPlan;
    const amountStr = formatCopInt(amount);
    const text = `Hola, realicé el pago del plan ${planTitle} ${periodLabel} por $${amountStr} COP de RunningApexFlow`;
    return `https://wa.me/${COACH_SUBSCRIPTION_WA_E164}?text=${encodeURIComponent(text)}`;
  }, [coachPickerPlan, coachPickerPeriod]);

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
    setAuthLandingStep("register");
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

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (selectedAthlete?.id != null) {
      localStorage.setItem(RAF_SELECTED_ATHLETE_STORAGE_KEY, String(selectedAthlete.id));
    }
  }, [selectedAthlete?.id]);

  useEffect(() => {
    if (!athletes.length || typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
    const foundByLs = raw ? athletes.find((a) => String(a.id) === String(raw)) : null;
    if (raw && !foundByLs) {
      localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
    }
    setSelectedAthlete((prev) => {
      if (prev && athletes.some((a) => String(a.id) === String(prev.id))) {
        return prev;
      }
      return foundByLs || null;
    });
  }, [athletes]);

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
          setAuthLandingStep("login");
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
        setAuthLandingStep("login");
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
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
    }
    setSelectedAthlete(null);
    setLandingAuthOpen(false);
    setDemoModalOpen(false);
    setAuthMode("login");
    setAuthLandingStep("choice");
  };

  const handleForgotPasswordClick = async () => {
    let email = authEmail.trim();
    if (!email && typeof window !== "undefined") {
      email = (window.prompt("Ingresa el correo de tu cuenta:") || "").trim();
    }
    if (!email) {
      alert("Indica un correo válido.");
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin ? `${origin}/` : undefined,
    });
    if (error) {
      alert(error.message || "No se pudo enviar el correo de recuperación.");
      return;
    }
    alert("Si el correo existe en el sistema, recibirás un enlace para restablecer tu contraseña.");
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
    setSelectedAthlete((prev) => {
      if (prev && String(prev.id) === String(id) && typeof localStorage !== "undefined") {
        localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
        return null;
      }
      return prev;
    });
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
      const inputBase = {
        width: "100%",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "10px 12px",
        color: "#0f172a",
        fontFamily: "inherit",
        fontSize: ".85em",
        outline: "none",
        boxSizing: "border-box",
      };
      const bigBtn = {
        width: "100%",
        padding: "14px 18px",
        borderRadius: 12,
        border: "none",
        fontFamily: "inherit",
        fontWeight: 800,
        fontSize: ".95em",
        cursor: "pointer",
      };

      return (
        <div style={S.root}>
          <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: "70vh", padding: "20px 16px" }}>
            {authLandingStep === "choice" ? (
              <div style={{ ...S.card, width: "100%", maxWidth: 440, padding: "32px 28px 36px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22 }}>
                  <span style={{ fontSize: "2.4em", color: "#f59e0b", lineHeight: 1 }} aria-hidden>
                    ▲
                  </span>
                  <div style={{ fontSize: "1.35em", fontWeight: 900, letterSpacing: ".04em", color: "#0f172a" }}>
                    RUNNING<span style={{ color: "#f59e0b" }}>APEX</span>FLOW
                  </div>
                </div>
                <h1 style={{ ...S.pageTitle, fontSize: "1.45em", textAlign: "center", marginBottom: 10, lineHeight: 1.25 }}>
                  Bienvenido a {BRAND_NAME}
                </h1>
                <p style={{ textAlign: "center", color: "#64748b", fontSize: ".9em", lineHeight: 1.5, marginBottom: 28 }}>
                  Entrena con datos, IA y seguimiento real. Elige cómo quieres continuar.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAuthError("");
                      setAuthMode("login");
                      setAuthLandingStep("login");
                      setLandingAuthOpen(true);
                    }}
                    style={{
                      ...bigBtn,
                      background: "linear-gradient(135deg,#0f172a,#334155)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(15,23,42,.2)",
                    }}
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAuthError("");
                      setAuthMode("register");
                      setAuthLandingStep("register");
                      setLandingAuthOpen(true);
                    }}
                    style={{
                      ...bigBtn,
                      background: "linear-gradient(135deg,#b45309,#f59e0b)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(245,158,11,.25)",
                    }}
                  >
                    Registrarse
                  </button>
                </div>
              </div>
            ) : authLandingStep === "login" ? (
              <div style={{ ...S.card, width: "100%", maxWidth: 400, padding: "28px 24px 32px" }}>
                <h1 style={{ ...S.pageTitle, fontSize: "1.25em", marginBottom: 18 }}>Iniciar sesión</h1>
                <form onSubmit={handleAuthSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Email</div>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      style={inputBase}
                    />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Contraseña</div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      style={inputBase}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    style={{
                      width: "100%",
                      ...bigBtn,
                      marginBottom: 12,
                      background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                      color: authSubmitting ? "#334155" : "white",
                      cursor: authSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {authSubmitting ? "Procesando…" : "Iniciar sesión"}
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError("");
                      setAuthMode("register");
                      setAuthLandingStep("register");
                    }}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿No tienes cuenta? Regístrate
                  </button>
                  <button
                    type="button"
                    onClick={handleForgotPasswordClick}
                    style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthLandingStep("choice")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", marginTop: 4 }}
                  >
                    ← Volver
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ ...S.card, width: "100%", maxWidth: 420, padding: "28px 24px 32px" }}>
                <h1 style={{ ...S.pageTitle, fontSize: "1.25em", marginBottom: 18 }}>Crear cuenta</h1>
                <form onSubmit={handleAuthSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Nombre completo</div>
                    <input
                      type="text"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Tu nombre completo"
                      style={inputBase}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Rol</div>
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
                        Coach
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
                        Atleta
                      </button>
                    </div>
                  </div>
                  {authRole === "athlete" && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Código de coach</div>
                      <input
                        type="text"
                        value={authCoachCode}
                        onChange={(e) => setAuthCoachCode(e.target.value.toUpperCase())}
                        placeholder="Ej: A1B2C3D4 (opcional si vienes por invitación)"
                        style={inputBase}
                      />
                      {inviteCodeFromUrl ? (
                        <div style={{ marginTop: 6, fontSize: ".7em", color: "#b45309", fontWeight: 700 }}>
                          Invitación detectada por link: se priorizará esa vinculación.
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Email</div>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      style={inputBase}
                    />
                    {authError ? <div style={{ marginTop: 6, fontSize: ".74em", color: "#dc2626", fontWeight: 600 }}>{authError}</div> : null}
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Contraseña</div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      style={inputBase}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    style={{
                      width: "100%",
                      ...bigBtn,
                      background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                      color: authSubmitting ? "#334155" : "white",
                      cursor: authSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {authSubmitting ? "Procesando…" : "Crear cuenta"}
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError("");
                      setAuthMode("login");
                      setAuthLandingStep("login");
                    }}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿Ya tienes cuenta? Inicia sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthLandingStep("choice")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
                  >
                    ← Volver
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      );
    }

    return (
      <div style={S.root}>
        <main style={{ ...S.page, width: "100%", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 8,
              paddingBottom: 16,
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "2em", color: "#f59e0b", lineHeight: 1 }} aria-hidden>
                ▲
              </span>
              <div style={{ fontSize: "1.2em", fontWeight: 900, letterSpacing: ".04em", color: "#0f172a" }}>
                RUNNING<span style={{ color: "#f59e0b" }}>APEX</span>FLOW
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthMode("login");
                setAuthLandingStep("login");
                setLandingAuthOpen(true);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                background: "#fff",
                color: "#0f172a",
                fontWeight: 800,
                fontSize: ".85em",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthMode("register");
                setAuthRole("athlete");
                setAuthLandingStep("register");
                setLandingAuthOpen(true);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#b45309,#f59e0b)",
                color: "#fff",
                fontWeight: 800,
                fontSize: ".85em",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Crear cuenta gratis
            </button>
            </div>
          </header>

          <div
            style={{
              marginTop: 8,
              marginBottom: 32,
              padding: "32px 0 8px",
              textAlign: "center",
              maxWidth: 720,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div style={{ fontSize: "0.78em", color: "#f59e0b", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, marginBottom: 10 }}>
              Plataforma de coaching para runners
            </div>
            <h1 style={{ fontSize: "clamp(1.75rem, 4vw, 2.45rem)", fontWeight: 900, color: "#0f172a", margin: "0 0 14px", lineHeight: 1.15 }}>
              Entrena con datos. Mejora con inteligencia.
            </h1>
            <p style={{ color: "#64748b", fontSize: "1.05em", margin: "0 0 26px", lineHeight: 1.6 }}>
              {BRAND_NAME} conecta coaches y atletas con IA, evaluaciones VDOT, zonas de FC y sincronización con Strava para llevar el rendimiento al siguiente nivel.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("register");
                  setAuthRole("athlete");
                  setAuthLandingStep("register");
                  setLandingAuthOpen(true);
                }}
                style={{
                  background: "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 12,
                  padding: "14px 28px",
                  color: "white",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: "1em",
                  boxShadow: "0 8px 24px rgba(245,158,11,.3)",
                }}
              >
                Crear cuenta gratis
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("login");
                  setAuthLandingStep("login");
                  setLandingAuthOpen(true);
                }}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "14px 28px",
                  color: "#0f172a",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: "1em",
                }}
              >
                Iniciar sesión
              </button>
            </div>
          </div>

          <section style={{ marginBottom: 44, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%", padding: "0 4px" }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".14em", color: "#475569", textTransform: "uppercase", marginBottom: 16, fontWeight: 800 }}>
              Características
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {[
                {
                  title: "Evaluación VDOT",
                  body: "Calcula VDOT, ritmos y zonas FC con 3 métodos: carrera reciente, test Cooper o umbral.",
                },
                {
                  title: "Workouts con IA",
                  body: "Genera sesiones personalizadas en segundos basadas en el VDOT y objetivos del atleta.",
                },
                {
                  title: "Plan flexible",
                  body: "Planes de 2 semanas renovables con 3, 4 o 5 sesiones semanales según la disponibilidad del atleta.",
                },
                {
                  title: "Análisis IA",
                  body: "Seguimiento inteligente del rendimiento con ajuste automático de entrenamientos para mejores resultados.",
                },
                {
                  title: "Sincronización",
                  body: "Conecta Strava para sincronizar actividades de Garmin, COROS y Apple Watch automáticamente.",
                },
                {
                  title: "Chat en tiempo real",
                  body: "Comunicación directa coach-atleta con notificaciones push dentro de la plataforma.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: "18px 16px",
                    background: "#fff",
                    boxShadow: "0 1px 3px rgba(15,23,42,.06)",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".98em", marginBottom: 8 }}>{f.title}</div>
                  <div style={{ color: "#64748b", fontSize: ".88em", lineHeight: 1.5 }}>{f.body}</div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginBottom: 48, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%", padding: "0 4px" }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".14em", color: "#475569", textTransform: "uppercase", marginBottom: 16, fontWeight: 800 }}>
              Coaches y atletas
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: "20px 18px",
                  background: "linear-gradient(145deg,#fffbeb,#fff7ed)",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 900, color: "#b45309", fontSize: "1.1em", marginBottom: 8 }}>Coach</div>
                <div style={{ fontSize: ".82em", fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>7 días de prueba gratis</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: ".88em", lineHeight: 1.55 }}>
                  <li>Dashboard en vivo</li>
                  <li>Biblioteca de workouts</li>
                  <li>Evaluación VDOT</li>
                  <li>Generación IA</li>
                  <li>Chat con atletas</li>
                </ul>
              </div>
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: "20px 18px",
                  background: "#f8fafc",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 900, color: "#0ea5e9", fontSize: "1.1em", marginBottom: 8 }}>Atleta</div>
                <div style={{ fontSize: ".82em", fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>Plan Premium disponible</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: ".88em", lineHeight: 1.55 }}>
                  <li>Calendario personalizado</li>
                  <li>Evaluación VDOT propia</li>
                  <li>Análisis IA de rendimiento</li>
                  <li>Historial de evaluaciones</li>
                  <li>Logros avanzados</li>
                </ul>
              </div>
            </div>
          </section>

          <footer style={{ marginTop: "auto", paddingTop: 22, borderTop: "1px solid #e2e8f0", color: "#64748b", fontSize: ".85em" }}>
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
  const showCoachPlanPickerScreen =
    profile?.role === "coach" && !isProfilesAdmin && (coachPlanBlockedUi || coachPlanPickerVoluntary);

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
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>
              ⏳ Período de prueba: {trialBannerDays} día{trialBannerDays === 1 ? "" : "s"} restantes
            </span>
            <button
              type="button"
              onClick={() => {
                setCoachPlanPickerVoluntary(true);
                setCoachPaymentModalOpen(false);
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid rgba(180,83,9,.45)",
                background: "#fff",
                color: "#b45309",
                fontWeight: 800,
                fontSize: ".78em",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Ver planes
            </button>
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
            onSelect={(a) => {
              setSelectedAthlete(a);
              setView("athletes");
              setShowAddAthleteForm(false);
            }}
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
            profileRole={profile?.role ?? ""}
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
            profileRole={profile?.role ?? ""}
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
        {view === "challenges" && (
          <ChallengesHub
            profileRole={profile?.role ?? ""}
            currentUserId={sessionUserId || null}
            athleteId={null}
            workouts={[]}
            notify={notify}
          />
        )}
        {view === "marketplace" && (
          <MarketplaceHub
            profileRole={profile?.role ?? ""}
            currentUserId={sessionUserId || null}
            coachUserId={sessionUserId || null}
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

      {showCoachPlanPickerScreen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4000,
            background: "linear-gradient(165deg, #f8fafc 0%, #e2e8f0 45%, #f1f5f9 100%)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            boxSizing: "border-box",
          }}
        >
          <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 18px 48px", position: "relative" }}>
            {!coachPlanBlockedUi ? (
              <button
                type="button"
                onClick={() => {
                  setCoachPlanPickerVoluntary(false);
                  setCoachPaymentModalOpen(false);
                }}
                style={{
                  position: "absolute",
                  top: 18,
                  right: 12,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#64748b",
                  fontWeight: 700,
                  fontSize: ".78em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cerrar
              </button>
            ) : null}
            <h1
              style={{
                fontSize: "clamp(1.35rem, 3.5vw, 1.85rem)",
                fontWeight: 900,
                color: "#0f172a",
                textAlign: "center",
                margin: "8px 0 10px",
                lineHeight: 1.2,
              }}
            >
              Elige tu plan RunningApexFlow
            </h1>
            <p style={{ textAlign: "center", color: "#64748b", fontSize: ".95em", maxWidth: 560, margin: "0 auto 28px", lineHeight: 1.45 }}>
              Comienza a transformar el rendimiento de tus atletas
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 20,
                alignItems: "stretch",
              }}
            >
              {["basico", "pro"].map((planKey) => {
                const def = COACH_PLAN_PICKER_DEFS[planKey];
                const selectedPlan = coachPickerPlan === planKey;
                return (
                  <div
                    key={planKey}
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: "22px 18px 20px",
                      border: selectedPlan ? "2px solid #f59e0b" : "1px solid #e2e8f0",
                      boxShadow: selectedPlan ? "0 12px 40px rgba(245,158,11,.12)" : "0 4px 20px rgba(15,23,42,.06)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    <div style={{ fontSize: "1.25em", fontWeight: 900, color: "#0f172a" }}>{def.title}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: ".86em", lineHeight: 1.55 }}>
                      {def.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                      {COACH_PLAN_PICKER_PERIODS.map((per) => {
                        const amount = def.prices[per.id];
                        const selected = selectedPlan && coachPickerPeriod === per.id;
                        const priceLine =
                          per.id === "monthly"
                            ? `$${formatCopInt(amount)} COP/mes`
                            : `$${formatCopInt(amount)} COP`;
                        return (
                          <button
                            key={per.id}
                            type="button"
                            onClick={() => {
                              setCoachPickerPlan(planKey);
                              setCoachPickerPeriod(per.id);
                            }}
                            style={{
                              textAlign: "left",
                              padding: "12px 14px",
                              borderRadius: 12,
                              border: selected ? "2px solid #ea580c" : "1px solid #e2e8f0",
                              background: selected ? "rgba(251,146,60,.08)" : "#f8fafc",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>{per.label}</div>
                              <div style={{ fontSize: ".82em", color: "#64748b", marginTop: 4 }}>{priceLine}</div>
                            </div>
                            {per.badge ? (
                              <span
                                style={{
                                  fontSize: ".68em",
                                  fontWeight: 800,
                                  color: "#15803d",
                                  background: "rgba(34,197,94,.14)",
                                  border: "1px solid rgba(34,197,94,.35)",
                                  borderRadius: 999,
                                  padding: "4px 10px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {per.badge}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                disabled={!coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving}
                onClick={handleCoachPlanPagarAhora}
                style={{
                  padding: "14px 28px",
                  borderRadius: 12,
                  border: "none",
                  background:
                    !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                  color: !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "#94a3b8" : "#fff",
                  fontWeight: 900,
                  fontSize: ".95em",
                  cursor: !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 6px 20px rgba(245,158,11,.25)",
                }}
              >
                {coachSubscriptionSaving ? "Guardando…" : "Pagar ahora"}
              </button>
              {coachPlanBlockedUi ? (
                <p style={{ fontSize: ".78em", color: "#64748b", textAlign: "center", maxWidth: 420 }}>
                  Tu cuenta está bloqueada hasta que se verifique el pago. Si necesitas ayuda, contacta al administrador.
                </p>
              ) : null}
            </div>
          </div>

          {coachPaymentModalOpen ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 4100,
                background: "rgba(15,23,42,.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                boxSizing: "border-box",
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="coach-pay-modal-title"
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 460,
                  background: "#fff",
                  borderRadius: 16,
                  padding: "24px 22px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 20px 50px rgba(15,23,42,.2)",
                }}
              >
                <h2 id="coach-pay-modal-title" style={{ margin: "0 0 14px", fontSize: "1.1em", fontWeight: 900, color: "#0f172a" }}>
                  Instrucciones de pago
                </h2>
                <div style={{ color: "#334155", fontSize: ".88em", lineHeight: 1.65, marginBottom: 18 }}>
                  <div>Realiza tu pago a:</div>
                  <div style={{ marginTop: 10 }}>
                    📱 Nequi: <strong>{COACH_SUBSCRIPTION_NEQUI}</strong>
                  </div>
                  <div style={{ marginTop: 10 }}>📸 Envía el comprobante por WhatsApp al mismo número</div>
                  <div style={{ marginTop: 10 }}>✅ Tu cuenta será activada en menos de 24 horas</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <a
                    href={coachPlanPickerWhatsAppHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "block",
                      textAlign: "center",
                      padding: "12px 16px",
                      borderRadius: 10,
                      background: "linear-gradient(135deg,#22c55e,#16a34a)",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: ".88em",
                      textDecoration: "none",
                      fontFamily: "inherit",
                    }}
                  >
                    Enviar comprobante por WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => setCoachPaymentModalOpen(false)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      color: "#64748b",
                      fontWeight: 700,
                      fontSize: ".82em",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
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
  const [expandedWorkoutLogs, setExpandedWorkoutLogs] = useState({});

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
      workout_structure: structure,
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
                      const expanded = Boolean(expandedWorkoutLogs[w.id]);
                      const feelingMatch = String(w.athlete_notes || "").match(/^Cómo me sentí:\s*(.+)$/m);
                      const feelingText = feelingMatch ? feelingMatch[1] : "";
                      const notesText = String(w.athlete_notes || "")
                        .replace(/^Cómo me sentí:\s*.+$/m, "")
                        .trim();
                      return (
                        <div key={w.id} style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                          <button
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
                          {w.done ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setExpandedWorkoutLogs((prev) => ({ ...prev, [w.id]: !prev[w.id] }))}
                                style={{ border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", color: "#334155", padding: "3px 6px", fontSize: ".56em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                              >
                                {expanded ? "Ocultar registro" : "Ver registro"}
                              </button>
                              {expanded ? (
                                <div style={{ border: "1px solid #e2e8f0", borderRadius: 7, background: "#fff", padding: "6px 7px", fontSize: ".54em", color: "#334155", textAlign: "left", lineHeight: 1.35 }}>
                                  <div><strong>Distancia:</strong> {w.manual_distance_km != null ? `${w.manual_distance_km} km` : "—"}</div>
                                  <div><strong>Duración:</strong> {w.manual_duration_min != null ? `${w.manual_duration_min} min` : "—"}</div>
                                  <div><strong>FC prom/máx:</strong> {w.manual_avg_hr != null ? w.manual_avg_hr : "—"} / {w.manual_max_hr != null ? w.manual_max_hr : "—"} lpm</div>
                                  <div><strong>Calorías:</strong> {w.manual_calories != null ? w.manual_calories : "—"}</div>
                                  <div><strong>Cómo se sintió:</strong> {feelingText || "—"}</div>
                                  <div><strong>Notas:</strong> {notesText || "—"}</div>
                                  <div><strong>Completado:</strong> {w.completed_at ? new Date(w.completed_at).toLocaleString("es-CO") : "—"}</div>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
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
                  <WorkoutStructureTable structure={workoutEditForm.structureRows} />
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
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Tipo de bloque</div>
                            <select
                              value={row.block_type}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], block_type: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            >
                              {WORKOUT_BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración (min)</div>
                            <input
                              value={row.duration_min}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], duration_min: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Ej: 12"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Distancia (km)</div>
                            <input
                              value={row.distance_km}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], distance_km: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Opcional"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Ritmo objetivo</div>
                            <input
                              value={row.target_pace}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], target_pace: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="MM:SS /km"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>FC objetivo (lpm)</div>
                            <input
                              value={row.target_hr}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], target_hr: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Ej: 140-160"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Descripción</div>
                            <input
                              value={row.description}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], description: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Notas del bloque"
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
  const [athletePremiumModalOpen, setAthletePremiumModalOpen] = useState(false);
  const [athleteNotRegistered, setAthleteNotRegistered] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [athleteActiveTab, setAthleteActiveTab] = useState("");
  const [athleteProfileTab, setAthleteProfileTab] = useState("logros");
  const [athleteChatOpen, setAthleteChatOpen] = useState(false);
  const [athleteTabRestored, setAthleteTabRestored] = useState(false);
  const [achievementsCatalog, setAchievementsCatalog] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [achProgress, setAchProgress] = useState(null);
  const [athleteEvaluations, setAthleteEvaluations] = useState([]);
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
  const [workoutSummaryModal, setWorkoutSummaryModal] = useState(null);
  const [manualSummaryForm, setManualSummaryForm] = useState({
    distanceKm: "",
    durationMin: "",
    rpe: "",
    avgHr: "",
    maxHr: "",
    calories: "",
    feeling: "😐 Normal",
    notes: "",
  });
  const [manualSummarySaving, setManualSummarySaving] = useState(false);

  const profileUserId = profile?.user_id ?? null;

  useEffect(() => {
    if (typeof localStorage === "undefined") {
      setAthleteTabRestored(true);
      return;
    }
    const savedTab = localStorage.getItem(ATHLETE_TAB_STORAGE_KEY);
    if (savedTab === "evaluation") setShowEvaluation(true);
    if (savedTab === "home") setShowEvaluation(false);
    setAthleteTabRestored(true);
  }, []);

  useEffect(() => {
    if (!athleteTabRestored || typeof localStorage === "undefined") return;
    localStorage.setItem(ATHLETE_TAB_STORAGE_KEY, showEvaluation ? "evaluation" : "home");
  }, [showEvaluation, athleteTabRestored]);

  useEffect(() => {
    if (!athleteTabRestored) return undefined;
    if (typeof document === "undefined" || typeof localStorage === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      localStorage.setItem(ATHLETE_TAB_STORAGE_KEY, showEvaluation ? "evaluation" : "home");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [showEvaluation, athleteTabRestored]);

  /** Último `profileUserId` para el que ya se completó la carga inicial (evita loop si `profile` del padre se recrea). */
  const prevProfileUserIdRef = useRef(null);

  useEffect(() => {
    if (profileUserId == null) {
      prevProfileUserIdRef.current = null;
      setAthleteInfo(null);
      setWorkouts([]);
      setAthleteEvaluations([]);
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
        setAthleteEvaluations([]);
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
        setAthleteEvaluations([]);
        setLoading(false);
        return;
      }

      const athleteRow = athleteRows?.[0];
      if (!athleteRow) {
        setAthleteInfo(null);
        setWorkouts([]);
        setAthleteEvaluations([]);
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
      const { data: evalRows } = await supabase
        .from("athlete_evaluations")
        .select("vdot, created_at")
        .eq("athlete_id", athleteRow.id)
        .order("created_at", { ascending: true });

      console.log("[AthleteHome] consulta workouts (athlete_id)", {
        athlete_id: athleteRow.id,
        data: workoutsRows,
        error: workoutsErr,
      });

      if (cancelled) return;

      if (workoutsErr) {
        console.error("Error cargando workouts atleta:", workoutsErr);
        setWorkouts([]);
        setAthleteEvaluations(evalRows || []);
      } else {
        const normalizedWorkouts = (workoutsRows || []).map(normalizeWorkoutRow);
        setWorkouts(normalizedWorkouts);
        setAthleteEvaluations(evalRows || []);
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
  const achievementDisplayProgress = useMemo(
    () => computeAthleteAchievementVisualProgress(workouts, athleteEvaluations),
    [workouts, athleteEvaluations],
  );
  const earnedAchievementDateByCode = useMemo(() => {
    const m = {};
    for (const row of earnedAchievements || []) {
      const code = String(row?.achievement_code || "");
      if (!code) continue;
      if (!m[code]) m[code] = row?.awarded_at || null;
    }
    return m;
  }, [earnedAchievements]);

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
  const weeklyProgressPct = useMemo(() => {
    if (!weeklyTotalKm || weeklyTotalKm <= 0) return 0;
    return Math.max(0, Math.min(100, (weeklyDoneKm / weeklyTotalKm) * 100));
  }, [weeklyDoneKm, weeklyTotalKm]);
  const last4WeeksSummary = useMemo(() => {
    const rows = [];
    const currentStart = startOfWeekMonday(new Date());
    for (let i = 0; i < 4; i += 1) {
      const start = addDays(currentStart, -(i * 7));
      const end = addDays(start, 6);
      const startYmd = formatLocalYMD(start);
      const endYmd = formatLocalYMD(end);
      const weekRows = workouts.filter((w) => {
        const ymd = normalizeScheduledDateYmd(w.scheduled_date);
        return ymd && ymd >= startYmd && ymd <= endYmd;
      });
      const kmTotal = weekRows.reduce((sum, w) => sum + (Number(w.total_km) || 0), 0);
      const completed = weekRows.filter((w) => w.done).length;
      const adherence = weekRows.length > 0 ? Math.round((completed / weekRows.length) * 100) : 0;
      rows.push({
        key: `${startYmd}-${endYmd}`,
        label: i === 0 ? "Semana actual" : `Hace ${i} semana${i === 1 ? "" : "s"}`,
        range: `${startYmd} → ${endYmd}`,
        kmTotal,
        completed,
        total: weekRows.length,
        adherence,
      });
    }
    return rows;
  }, [workouts]);

  const workoutsAchSyncKey = useMemo(
    () => (workouts || []).map((w) => `${w.id}:${w.done ? 1 : 0}:${w.rpe ?? ""}`).join("|"),
    [workouts],
  );

  const openWorkoutSummaryModal = async (workoutRow) => {
    if (!workoutRow?.scheduled_date) return;
    const isStravaConnected = Boolean(stravaConnection?.access_token);
    if (isStravaConnected && athleteInfo?.id) {
      const dayStart = `${workoutRow.scheduled_date}T00:00:00`;
      const dayEnd = `${formatLocalYMD(addDays(new Date(`${workoutRow.scheduled_date}T12:00:00`), 1))}T00:00:00`;
      const { data, error } = await supabase
        .from("strava_activities")
        .select("*")
        .eq("athlete_id", athleteInfo.id)
        .gte("start_date_local", dayStart)
        .lt("start_date_local", dayEnd)
        .order("start_date_local", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn("No se pudo cargar actividad strava_activities:", error);
      }
      setManualSummaryForm({
        distanceKm: data?.distance != null ? (Number(data.distance) / 1000).toFixed(2) : (workoutRow.total_km ? String(workoutRow.total_km) : ""),
        durationMin: data?.moving_time != null ? String(Math.max(0, Math.round(Number(data.moving_time) / 60))) : (workoutRow.duration_min ? String(workoutRow.duration_min) : ""),
        rpe: workoutRow.rpe != null ? String(workoutRow.rpe) : "",
        avgHr: data?.average_heartrate != null ? String(Math.round(Number(data.average_heartrate))) : "",
        maxHr: data?.max_heartrate != null ? String(Math.round(Number(data.max_heartrate))) : "",
        calories: data?.calories != null ? String(Math.round(Number(data.calories))) : data?.kilojoules != null ? String(Math.round(Number(data.kilojoules))) : "",
        feeling: "😐 Normal",
        notes: workoutRow.athlete_notes || "",
      });
      setWorkoutSummaryModal({ workout: workoutRow, stravaConnected: true, activity: data || null });
      return;
    }
    setManualSummaryForm({
      distanceKm: workoutRow.total_km ? String(workoutRow.total_km) : "",
      durationMin: workoutRow.duration_min ? String(workoutRow.duration_min) : "",
      rpe: workoutRow.rpe != null ? String(workoutRow.rpe) : "",
      avgHr: workoutRow.manual_avg_hr != null ? String(workoutRow.manual_avg_hr) : "",
      maxHr: workoutRow.manual_max_hr != null ? String(workoutRow.manual_max_hr) : "",
      calories: workoutRow.manual_calories != null ? String(workoutRow.manual_calories) : "",
      feeling: "😐 Normal",
      notes: workoutRow.athlete_notes || "",
    });
    setWorkoutSummaryModal({ workout: workoutRow, stravaConnected: false, activity: null });
  };

  const saveManualWorkoutSummary = async () => {
    const workoutRow = workoutSummaryModal?.workout;
    if (!workoutRow?.id) return;
    const parsedDistance = Number(manualSummaryForm.distanceKm);
    const durationMin = Math.round(Number(manualSummaryForm.durationMin) || 0);
    const parsedRpe = clampWorkoutRpe(manualSummaryForm.rpe);
    const avgHr = Math.round(Number(manualSummaryForm.avgHr) || 0);
    const maxHr = Math.round(Number(manualSummaryForm.maxHr) || 0);
    const calories = Math.round(Number(manualSummaryForm.calories) || 0);
    const feelings = ["😴 Muy cansado", "😕 Cansado", "😐 Normal", "🙂 Bien", "💪 Excelente"];
    const feelingText = feelings.includes(manualSummaryForm.feeling) ? manualSummaryForm.feeling : "😐 Normal";
    const notesBody = manualSummaryForm.notes.trim();
    const athleteNotes = [`Cómo me sentí: ${feelingText}`, notesBody].filter(Boolean).join("\n");
    const payload = {
      manual_distance_km: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : null,
      manual_duration_min: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : null,
      manual_avg_hr: Number.isFinite(avgHr) && avgHr > 0 ? avgHr : null,
      manual_max_hr: Number.isFinite(maxHr) && maxHr > 0 ? maxHr : null,
      manual_calories: Number.isFinite(calories) && calories > 0 ? calories : null,
      athlete_notes: athleteNotes,
      total_km: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : workoutRow.total_km,
      duration_min: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : workoutRow.duration_min,
      rpe: parsedRpe ?? workoutRow.rpe ?? null,
      completed_at: new Date().toISOString(),
      done: true,
    };
    setManualSummarySaving(true);
    const { error } = await supabase.from("workouts").update(payload).eq("id", workoutRow.id);
    setManualSummarySaving(false);
    if (error) {
      setMessage(error.message || "No se pudo guardar el resumen.");
      return;
    }
    setWorkouts((prev) =>
      prev.map((w) => (String(w.id) === String(workoutRow.id) ? normalizeWorkoutRow({ ...w, ...payload }) : w)),
    );
    setWorkoutSummaryModal(null);
  };

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
      try {
        if (athleteInfo?.coach_id) {
          const { data: coachProf } = await supabase.from("profiles").select("fcm_token").eq("user_id", athleteInfo.coach_id).maybeSingle();
          const coachToken = coachProf?.fcm_token ?? null;
          if (coachToken && String(coachToken).trim() !== "") {
            await sendChatPushNotification({
              token: coachToken,
              title: "✅ Workout completado",
              body: `${athleteInfo.name || "Atleta"} completó: ${w.title || "Workout"}`,
              data: { type: "workout_done", athlete_id: athleteInfo.id, workout_id: w.id },
              logLabel: "workout done athlete→coach",
            });
          }
        }
      } catch (_) {
        // diagnóstico silencioso para no bloquear UX de marcado completado
      }
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
      await openWorkoutSummaryModal({ ...w, done: true, rpe: next ? w.rpe : null });
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

  const hasPremiumAccess = useMemo(() => {
    const isAthleteOfAdminCoach = athleteInfo?.coach_id === "b5c9e44a-6695-4800-99bd-f19b05d2f66f";
    return isAthleteOfAdminCoach || String(athleteInfo?.athlete_plan).toLowerCase() === "premium";
  }, [athleteInfo?.coach_id, athleteInfo?.athlete_plan]);

  useEffect(() => {
    if (!athleteTabRestored || !athleteInfo?.id) return;
    if (!hasPremiumAccess) setShowEvaluation(false);
  }, [athleteInfo?.id, athleteInfo?.athlete_plan, athleteInfo?.coach_id, athleteTabRestored, hasPremiumAccess]);

  const athleteFormaFatigaPoints = useMemo(() => computeFormaFatigaWeeklyPoints(workouts), [workouts]);
  const athleteFormaFatigaChronological = useMemo(() => [...athleteFormaFatigaPoints].reverse(), [athleteFormaFatigaPoints]);
  const athleteFormaFatigaStatus = useMemo(() => formaFatigaStatusFromPoint(athleteFormaFatigaPoints[0]), [athleteFormaFatigaPoints]);
  const athleteFormaFatigaTableRows = useMemo(() => athleteFormaFatigaPoints.slice(0, 4), [athleteFormaFatigaPoints]);

  const openAthletePremiumWa = (periodLabel, amountCopText) => {
    const text = `Hola, quiero activar el plan Premium Atleta ${periodLabel} por ${amountCopText} COP`;
    window.open(`https://wa.me/573233675434?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const athleteName = profile?.name || athleteInfo?.name || "Atleta";
  const handleAthleteNavTabChange = (tabId) => {
    setAthleteChatOpen(false);
    setAthleteActiveTab(tabId);
  };
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
    <div style={{ ...S.page, paddingBottom: 96, overflow: "visible", position: "relative" }}>
      {message ? (
        <div style={{ ...S.card, border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", color: "#fecaca", marginBottom: 14 }}>
          {message}
        </div>
      ) : null}
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 4 }}>Hola, {athleteName}</h1>
      </div>

      <div style={{ ...S.card, marginBottom: 14, overflow: "visible" }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 8 }}>PROGRESO SEMANAL</div>
        <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>
          {weeklyDoneKm.toFixed(1)} / {weeklyTotalKm.toFixed(1)} km
        </div>
        <div style={{ color: "#64748b", fontSize: ".8em", marginTop: 6 }}>
          Semana {thisWeekStartYmd} → {thisWeekEndYmd}
        </div>
        <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
          <div style={{ width: `${weeklyProgressPct}%`, height: "100%", background: "linear-gradient(90deg,#22c55e,#16a34a)" }} />
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
            CALENDARIO · {calendarMonthLabel}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>←</button>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>→</button>
          </div>
        </div>
        {loading ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, overflow: "visible" }}>
            {DAYS.map((d) => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {calendarCells.map((cellDate, i) => {
              const ymd = calendarCellToIsoYmd(cellDate);
              const dayWorkouts = workoutsByDate[ymd] || [];
              const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
              const hasDoneWorkout = dayWorkouts.some((w) => w.done);
              return (
                <div key={i} style={{ minHeight: 68, border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 3px", opacity: inViewMonth ? 1 : 0.42, background: hasDoneWorkout ? "rgba(34,197,94,.08)" : "#fff" }}>
                  <div style={{ fontSize: ".58em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                  {dayWorkouts.slice(0, 2).map((w) => (
                    <button key={w.id} type="button" onClick={(e) => openAthleteWorkoutMenu(e, w)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 3px", marginTop: 3, background: w.done ? "rgba(34,197,94,.15)" : "#f8fafc", fontSize: ".5em", color: "#334155", cursor: "pointer", fontFamily: "inherit", textAlign: "center", position: "relative", zIndex: 1 }}>
                      {w.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {athleteCalendarCtxMenu && ctxMenuAthleteWorkout ? (
        <>
          <div
            ref={athleteCalendarCtxMenuRef}
            style={{
              position: "fixed",
              left: athleteCalendarCtxMenu.x,
              top: athleteCalendarCtxMenu.y,
              zIndex: 10002,
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
              onClick={async (e) => {
                e.stopPropagation();
                await toggleDone(ctxMenuAthleteWorkout);
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
        </>
      ) : null}

      <div style={{ ...S.card, marginBottom: 18 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>Resumen últimas 4 semanas</div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
          {last4WeeksSummary.map((week) => (
            <div key={week.key} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
              <div style={{ color: "#0f172a", fontWeight: 800, fontSize: ".82em" }}>{week.label}</div>
              <div style={{ color: "#94a3b8", fontSize: ".68em", marginTop: 2 }}>{week.range}</div>
              <div style={{ marginTop: 8, fontSize: ".75em", color: "#334155" }}>{week.kmTotal.toFixed(1)} km totales</div>
              <div style={{ fontSize: ".75em", color: "#334155" }}>{week.completed} workouts completados</div>
              <div style={{ fontSize: ".75em", color: "#334155" }}>Adherencia {week.adherence}%</div>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAthleteChatOpen(true)}
        style={{ position: "fixed", right: 18, bottom: 104, width: 52, height: 52, borderRadius: "50%", border: "none", background: "linear-gradient(135deg,#f59e0b,#ea580c)", color: "#fff", fontSize: "1.3em", boxShadow: "0 8px 20px rgba(234,88,12,.35)", cursor: "pointer", zIndex: 9000 }}
      >
        💬
      </button>

      <nav
        aria-label="Navegación atleta"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-around",
          alignItems: "center",
          background: "white",
          borderTop: "1px solid #e2e8f0",
          padding: "8px 0 12px 0",
          height: "60px",
        }}
      >
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "" ? "#c2410c" : "#64748b", background: athleteActiveTab === "" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("")}><span className="pf-bnav-icon">🏠</span><span style={{ fontSize: "10px" }}>Inicio</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "marketplace" ? "#c2410c" : "#64748b", background: athleteActiveTab === "marketplace" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "marketplace" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("marketplace")}><span className="pf-bnav-icon">🛒</span><span style={{ fontSize: "10px" }}>Market</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "challenges" ? "#c2410c" : "#64748b", background: athleteActiveTab === "challenges" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "challenges" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("challenges")}><span className="pf-bnav-icon">🏆</span><span style={{ fontSize: "10px" }}>Retos</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "eval" ? "#c2410c" : "#64748b", background: athleteActiveTab === "eval" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "eval" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("eval")}><span className="pf-bnav-icon">⚡</span><span style={{ fontSize: "10px" }}>Eval</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "profile" ? "#c2410c" : "#64748b", background: athleteActiveTab === "profile" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "profile" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("profile")}><span className="pf-bnav-icon">👤</span><span style={{ fontSize: "10px" }}>Perfil</span></button>
      </nav>

      {athleteActiveTab ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9988, background: "rgba(15,23,42,.4)", display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", height: "100%", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", padding: 16, paddingBottom: 94 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, color: "#0f172a" }}>
                {athleteActiveTab === "marketplace" ? "🛒 Marketplace" : athleteActiveTab === "challenges" ? "🏆 Retos" : athleteActiveTab === "eval" ? "⚡ Evaluación VDOT" : "👤 Perfil"}
              </div>
              <button type="button" onClick={() => setAthleteActiveTab("")} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>

            {athleteActiveTab === "marketplace" ? (
              <MarketplaceHub
                profileRole="athlete"
                currentUserId={profile?.user_id ?? null}
                coachUserId={null}
                notify={(msg) => setMessage(msg)}
              />
            ) : null}

            {athleteActiveTab === "challenges" ? (
              <ChallengesHub profileRole="athlete" currentUserId={profile?.user_id ?? null} athleteId={athleteInfo?.id ?? null} workouts={workouts} notify={(msg) => setMessage(msg)} />
            ) : null}

            {athleteActiveTab === "eval" ? (
              hasPremiumAccess ? (
                <EvaluationView athletes={[normalizeAthlete(athleteInfo)]} currentUserId={profile?.user_id ?? null} notify={(msg) => setMessage(msg)} athleteOnlyId={athleteInfo?.id} />
              ) : (
                <div style={{ ...S.card, textAlign: "center" }}>
                  <p style={{ color: "#64748b" }}>La evaluación VDOT requiere Plan Premium Atleta.</p>
                  <button type="button" onClick={() => setAthletePremiumModalOpen(true)} style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Actualizar plan</button>
                </div>
              )
            ) : null}

            {athleteActiveTab === "profile" ? (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setAthleteProfileTab("logros")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "logros" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🏅 Logros</button>
                  <button type="button" onClick={() => setAthleteProfileTab("forma")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "forma" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📊 Forma</button>
                  <button type="button" onClick={() => setAthleteProfileTab("config")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "config" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>⚙️ Config</button>
                  <button type="button" onClick={() => setAthleteProfileTab("pagos")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "pagos" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>💳 Pagos</button>
                </div>
                {athleteProfileTab === "logros" ? (
                  <div style={{ ...S.card }}>
                    <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>MIS LOGROS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12 }}>
                      {ATHLETE_ACHIEVEMENT_DISPLAY_LIST.map((a) => {
                        const currentValue = Number(achievementDisplayProgress?.[a.metric] || 0);
                        const progressRatio = a.target > 0 ? Math.min(1, currentValue / a.target) : 0;
                        const progressPct = Math.round(progressRatio * 100);
                        const awardedAt = (a.codes || []).map((code) => earnedAchievementDateByCode[code]).find(Boolean) || null;
                        const earnedByProgress = currentValue >= a.target;
                        const earned = Boolean(awardedAt || earnedByProgress);
                        const formattedDate = awardedAt ? new Date(awardedAt).toLocaleDateString("es-CO") : "Sin fecha registrada";
                        const currentLabel =
                          a.metric === "totalKm"
                            ? `${currentValue.toFixed(1)} / ${a.target} km`
                            : `${Math.round(currentValue)} / ${a.target}`;
                        return (
                          <div key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: earned ? "linear-gradient(145deg,#fffbeb,#fff7ed)" : "#f8fafc" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ fontSize: "1.9rem", lineHeight: 1 }}>{a.icon}</div>
                              {earned ? (
                                <span style={{ fontSize: ".66em", fontWeight: 800, color: "#166534", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>
                                  ✅ Ganado
                                </span>
                              ) : (
                                <span style={{ fontSize: ".66em", fontWeight: 700, color: "#64748b", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>
                                  🔒 Bloqueado
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: ".87em", fontWeight: 900, marginTop: 8, color: "#0f172a" }}>{a.name}</div>
                            <div style={{ fontSize: ".77em", color: "#475569", marginTop: 6, lineHeight: 1.45 }}>{a.requirement}</div>
                            {earned ? (
                              <div style={{ marginTop: 10, fontSize: ".72em", color: "#166534", fontWeight: 700 }}>
                                Fecha de logro: {formattedDate}
                              </div>
                            ) : (
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 5 }}>{a.requirement}</div>
                                <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                                  <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg,#f59e0b,#f97316)" }} />
                                </div>
                                <div style={{ marginTop: 5, fontSize: ".7em", color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                                  <span>{currentLabel}</span>
                                  <span>{progressPct}%</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {athleteProfileTab === "forma" ? (
                  hasPremiumAccess ? (
                    <div style={{ ...S.card }}>
                      <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, lineHeight: 1.45 }}>
                        Basado en sesiones completadas con RPE: carga aguda = promedio (RPE × km) últimos 7 días; carga crónica = promedio (RPE × km) últimos 28 días; forma = crónica − aguda.
                      </div>
                      <div style={{ marginBottom: 12, fontWeight: 800, color: athleteFormaFatigaStatus.kind === "forma" ? "#22c55e" : athleteFormaFatigaStatus.kind === "fatiga" ? "#f87171" : "#94a3b8" }}>
                        Estado actual: {athleteFormaFatigaStatus.label}
                      </div>
                      <FormaFatigaLineChart chronological={athleteFormaFatigaChronological} />
                    </div>
                  ) : (
                    <div style={{ ...S.card, textAlign: "center" }}>
                      <p style={{ color: "#64748b" }}>Esta sección requiere Plan Premium Atleta.</p>
                      <button type="button" onClick={() => setAthletePremiumModalOpen(true)} style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Actualizar plan</button>
                    </div>
                  )
                ) : null}
                {athleteProfileTab === "config" ? <div style={{ ...S.card }}>{/* Config existente simplificada */}<div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>MI CONFIGURACIÓN</div><div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 8 }}>Gestiona conexiones y preferencias.</div><button type="button" onClick={openAthleteStravaOAuth} style={{ background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>Conectar Strava</button></div> : null}
                {athleteProfileTab === "pagos" ? <div style={{ ...S.card }}><div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Mis Pagos</div>{loadingAthletePayments ? <div style={{ color: "#64748b", fontSize: ".84em" }}>Cargando pagos…</div> : athletePayments.length === 0 ? <div style={{ color: "#64748b", fontSize: ".84em" }}>Tu coach aún no ha registrado pagos.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{athletePayments.map((p) => <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}><div style={{ fontWeight: 700, fontSize: ".84em" }}>${Number(p.amount || 0).toLocaleString("es-CO")} {p.currency || "COP"} · {p.plan}</div><div style={{ marginTop: 4, color: "#64748b", fontSize: ".74em" }}>{new Date(p.payment_date).toLocaleDateString("es-CO")} · {p.payment_method}</div></div>)}</div>}</div> : null}
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
                    marginTop: 12,
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
            ) : null}
          </div>
        </div>
      ) : null}

      {athleteChatOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9989, background: "rgba(15,23,42,.4)", display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", height: "100%", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", padding: 16, paddingBottom: 94 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900 }}>💬 Chat con tu coach</div>
              <button type="button" onClick={() => setAthleteChatOpen(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            {!coachIdForChat ? (
              <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos de coach. Contacta a soporte si esto continúa.</div>
            ) : (
              <>
                <div ref={athleteChatScrollRef} style={{ maxHeight: 420, overflowY: "auto", padding: "10px 8px", borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {athleteChatMessages.length === 0 ? <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div> : athleteChatMessages.map((m) => { const isCoach = m.sender_role === "coach"; return <div key={m.id} style={{ alignSelf: isCoach ? "flex-end" : "flex-start", maxWidth: "88%", padding: "8px 12px", borderRadius: 10, background: isCoach ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(245,158,11,.75))" : "#eff6ff", border: `1px solid ${isCoach ? "rgba(245,158,11,.5)" : "rgba(59,130,246,.35)"}`, color: isCoach ? "#f8fafc" : "#0f172a", fontSize: ".82em", lineHeight: 1.45 }}><div>{m.body}</div><div style={{ fontSize: ".65em", color: isCoach ? "rgba(255,255,255,.85)" : "#64748b", marginTop: 6 }}>{formatMessageTimestamp(m.created_at)}</div></div>; })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" value={athleteChatDraft} onChange={(e) => setAthleteChatDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAthleteChat()} placeholder="Escribe un mensaje a tu coach…" style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em" }} />
                  <button type="button" onClick={sendAthleteChat} disabled={athleteChatSending || !athleteChatDraft.trim()} style={{ background: athleteChatSending || !athleteChatDraft.trim() ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "10px 16px", color: athleteChatSending || !athleteChatDraft.trim() ? "#64748b" : "#fff", fontWeight: 800, cursor: athleteChatSending || !athleteChatDraft.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}>Enviar</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {workoutSummaryModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
            <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Resumen del entrenamiento</div>
            <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 12 }}>
              {(workoutSummaryModal.workout?.title || "Workout")} · {workoutSummaryModal.workout?.scheduled_date || "—"}
            </div>
            <WorkoutStructureTable structure={workoutSummaryModal.workout?.workout_structure || workoutSummaryModal.workout?.structure || []} />
            {workoutSummaryModal.stravaConnected ? (
              workoutSummaryModal.activity ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Distancia</div><div style={{ fontWeight: 800 }}>{((Number(workoutSummaryModal.activity.distance) || 0) / 1000).toFixed(2)} km</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Tiempo total</div><div style={{ fontWeight: 800 }}>{formatDurationClock(Number(workoutSummaryModal.activity.elapsed_time || workoutSummaryModal.activity.moving_time || 0))}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Ritmo promedio</div><div style={{ fontWeight: 800 }}>{formatStravaPace(Number(workoutSummaryModal.activity.distance || 0), Number(workoutSummaryModal.activity.moving_time || 0))}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>FC prom / máx</div><div style={{ fontWeight: 800 }}>{Number(workoutSummaryModal.activity.average_heartrate || 0) > 0 ? Math.round(Number(workoutSummaryModal.activity.average_heartrate)) : "—"} / {Number(workoutSummaryModal.activity.max_heartrate || 0) > 0 ? Math.round(Number(workoutSummaryModal.activity.max_heartrate)) : "—"} lpm</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Elevación</div><div style={{ fontWeight: 800 }}>{Math.round(Number(workoutSummaryModal.activity.total_elevation_gain || 0))} m</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Calorías</div><div style={{ fontWeight: 800 }}>{Math.round(Number(workoutSummaryModal.activity.calories || workoutSummaryModal.activity.kilojoules || 0))}</div></div>
                </div>
              ) : <div style={{ color: "#64748b", fontSize: ".86em", marginBottom: 14 }}>No encontramos una actividad de Strava para ese día.</div>
            ) : (
              <></>
            )}
            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              {!workoutSummaryModal.stravaConnected ? (
                <>
                  <input type="number" min="0" step="0.1" value={manualSummaryForm.distanceKm} onChange={(e) => setManualSummaryForm((f) => ({ ...f, distanceKm: e.target.value }))} placeholder="Distancia (km)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                  <input type="number" min="0" step="1" value={manualSummaryForm.durationMin} onChange={(e) => setManualSummaryForm((f) => ({ ...f, durationMin: e.target.value }))} placeholder="Tiempo (minutos)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                  <input type="number" min="1" max="10" value={manualSummaryForm.rpe} onChange={(e) => setManualSummaryForm((f) => ({ ...f, rpe: e.target.value }))} placeholder="RPE (1-10)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                  <input type="number" min="0" step="1" value={manualSummaryForm.avgHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, avgHr: e.target.value }))} placeholder="FC promedio (lpm)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                  <input type="number" min="0" step="1" value={manualSummaryForm.maxHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, maxHr: e.target.value }))} placeholder="FC máxima (lpm)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                  <input type="number" min="0" step="1" value={manualSummaryForm.calories} onChange={(e) => setManualSummaryForm((f) => ({ ...f, calories: e.target.value }))} placeholder="Calorías" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                </>
              ) : null}
              <select value={manualSummaryForm.feeling} onChange={(e) => setManualSummaryForm((f) => ({ ...f, feeling: e.target.value }))} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", background: "#fff" }}>
                {["😴 Muy cansado", "😕 Cansado", "😐 Normal", "🙂 Bien", "💪 Excelente"].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <textarea rows={3} value={manualSummaryForm.notes} onChange={(e) => setManualSummaryForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Describe tu entrenamiento..." style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" disabled={manualSummarySaving} onClick={saveManualWorkoutSummary} style={{ background: manualSummarySaving ? "#cbd5e1" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: manualSummarySaving ? "not-allowed" : "pointer", fontSize: ".78em" }}>{manualSummarySaving ? "Guardando…" : workoutSummaryModal.stravaConnected ? "Guardar notas" : "Guardar registro"}</button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" onClick={() => setWorkoutSummaryModal(null)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {athletePremiumModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 9986,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setAthletePremiumModalOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setAthletePremiumModalOpen(false)}
          role="presentation"
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 24,
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 20px 60px rgba(15,23,42,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="athlete-premium-modal-title"
          >
            <h3 id="athlete-premium-modal-title" style={{ margin: "0 0 16px", fontSize: "1.25em", fontWeight: 800, color: "#0f172a" }}>
              Plan Premium Atleta
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { period: "Mensual", amount: "$20,000", note: null },
                { period: "Semestral", amount: "$105,600", note: "Ahorra 12%" },
                { period: "Anual", amount: "$192,000", note: "Ahorra 20%" },
              ].map((row) => (
                <div
                  key={row.period}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: "#0f172a" }}>{row.period}</div>
                    <div style={{ fontSize: ".95em", color: "#334155", marginTop: 4 }}>
                      {row.amount} COP
                      {row.note ? <span style={{ color: "#15803d", fontSize: ".82em", marginLeft: 8 }}>{row.note}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAthletePremiumWa(row.period, row.amount)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: "linear-gradient(135deg,#0d9488,#14b8a6)",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: ".8em",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Suscribirme
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAthletePremiumModalOpen(false)}
              style={{
                marginTop: 18,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                color: "#64748b",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".85em",
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
  if (athleteSection === "challenges") {
    return (
      <div style={{ ...S.page, paddingBottom: 88 }}>
        {message ? (
          <div style={{ ...S.card, border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", color: "#fecaca", marginBottom: 14 }}>
            {message}
          </div>
        ) : null}
        <ChallengesHub
          profileRole="athlete"
          currentUserId={profile?.user_id ?? null}
          athleteId={athleteInfo?.id ?? null}
          workouts={workouts}
          notify={(msg) => setMessage(msg)}
        />
        <nav className="pf-bottom-nav" aria-label="Navegación atleta">
          <button type="button" onClick={() => setAthleteSection("home")}>
            <span className="pf-bnav-icon">🏠</span>
            <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>Inicio</span>
          </button>
          <button type="button" style={{ color: "#c2410c", background: "rgba(245, 158, 11, 0.14)", fontWeight: 800 }}>
            <span className="pf-bnav-icon">🏆</span>
            <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>Retos</span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div style={{ ...S.page, paddingBottom: 88 }}>
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

      {!athleteNotRegistered && null}
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
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
            FORMA Y FATIGA · EXPORTAR PDF
          </div>
          {!hasPremiumAccess ? (
            <span
              style={{
                fontSize: ".68em",
                fontWeight: 800,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                padding: "4px 10px",
                borderRadius: 999,
                background: "linear-gradient(135deg,#f59e0b,#ea580c)",
                color: "#fff",
              }}
            >
              Premium
            </span>
          ) : null}
        </div>
        {hasPremiumAccess ? (
          <>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, lineHeight: 1.45 }}>
              Basado en sesiones completadas con RPE: carga aguda = promedio (RPE × km) últimos 7 días; carga crónica = promedio (RPE × km) últimos 28 días; forma = crónica − aguda.
            </div>
            {loading ? (
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
                      athleteFormaFatigaStatus.kind === "forma"
                        ? "#22c55e"
                        : athleteFormaFatigaStatus.kind === "fatiga"
                          ? "#f87171"
                          : athleteFormaFatigaStatus.kind === "fresco"
                            ? "#facc15"
                            : "#94a3b8",
                  }}
                >
                  Estado actual: {athleteFormaFatigaStatus.label}
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
                <FormaFatigaLineChart chronological={athleteFormaFatigaChronological} />
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
                      {athleteFormaFatigaTableRows.map((row) => (
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
                <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        exportAthletePlanToPdf({
                          athlete: normalizeAthlete(athleteInfo),
                          workouts,
                          coachDisplayName: profile?.name || "Coach",
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
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
            <p style={{ color: "#64748b", fontSize: ".88em", marginBottom: 14, lineHeight: 1.5 }}>
              Estadísticas de forma y fatiga y exportación del plan en PDF están incluidas en el Plan Premium Atleta.
            </p>
            <button
              type="button"
              onClick={() => setAthletePremiumModalOpen(true)}
              style={{
                background: "linear-gradient(135deg,#b45309,#f59e0b)",
                border: "none",
                borderRadius: 10,
                padding: "10px 20px",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".85em",
              }}
            >
              Actualizar plan
            </button>
          </div>
        )}
      </div>

      {hasPremiumAccess ? (
        <>
          <div style={{ ...S.card, marginBottom: 18, order: 7 }}>
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
            <div style={{ marginBottom: 18, order: 8 }}>
              <EvaluationView
                athletes={[normalizeAthlete(athleteInfo)]}
                currentUserId={profile?.user_id ?? null}
                notify={(msg) => setMessage(msg)}
                athleteOnlyId={athleteInfo.id}
              />
            </div>
          )}
        </>
      ) : (
        <div style={{ ...S.card, marginBottom: 18, order: 7 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>EVALUACIÓN</div>
            <span
              style={{
                fontSize: ".68em",
                fontWeight: 800,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                padding: "4px 10px",
                borderRadius: 999,
                background: "linear-gradient(135deg,#f59e0b,#ea580c)",
                color: "#fff",
              }}
            >
              Premium
            </span>
          </div>
          <p style={{ color: "#64748b", fontSize: ".88em", lineHeight: 1.5, margin: "0 0 14px" }}>
            La evaluación VDOT, el historial de evaluaciones y el seguimiento avanzado requieren Plan Premium Atleta.
          </p>
          <button
            type="button"
            onClick={() => setAthletePremiumModalOpen(true)}
            style={{
              width: "100%",
              background: "linear-gradient(135deg,#b45309,#f59e0b)",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            Actualizar plan
          </button>
        </div>
      )}

      {!athleteNotRegistered && (
      <div style={{ ...S.card, marginTop: 20, order: 9 }}>
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

      <div style={{ ...S.card, marginBottom: 18, order: 10 }}>
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
              order: 11,
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

      <div style={{ ...S.card, marginBottom: 18, order: 12 }}>
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
      <nav className="pf-bottom-nav" aria-label="Navegación atleta">
        <button type="button" style={{ color: "#c2410c", background: "rgba(245, 158, 11, 0.14)", fontWeight: 800 }}>
          <span className="pf-bnav-icon">🏠</span>
          <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>Inicio</span>
        </button>
        <button type="button" onClick={() => setAthleteSection("challenges")}>
          <span className="pf-bnav-icon">🏆</span>
          <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>Retos</span>
        </button>
      </nav>
      {workoutSummaryModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
            <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Resumen del entrenamiento</div>
            <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 12 }}>
              {(workoutSummaryModal.workout?.title || "Workout")} · {workoutSummaryModal.workout?.scheduled_date || "—"}
            </div>
            {workoutSummaryModal.stravaConnected ? (
              workoutSummaryModal.activity ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Distancia</div><div style={{ fontWeight: 800 }}>{((Number(workoutSummaryModal.activity.distance) || 0) / 1000).toFixed(2)} km</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Tiempo total</div><div style={{ fontWeight: 800 }}>{formatDurationClock(Number(workoutSummaryModal.activity.elapsed_time || workoutSummaryModal.activity.moving_time || 0))}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Ritmo prom.</div><div style={{ fontWeight: 800 }}>{formatStravaPace(Number(workoutSummaryModal.activity.distance || 0), Number(workoutSummaryModal.activity.moving_time || 0))}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>FC prom.</div><div style={{ fontWeight: 800 }}>{Number(workoutSummaryModal.activity.average_heartrate || 0) > 0 ? `${Math.round(Number(workoutSummaryModal.activity.average_heartrate))} lpm` : "—"}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>FC máxima</div><div style={{ fontWeight: 800 }}>{Number(workoutSummaryModal.activity.max_heartrate || 0) > 0 ? `${Math.round(Number(workoutSummaryModal.activity.max_heartrate))} lpm` : "—"}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Elevación</div><div style={{ fontWeight: 800 }}>{Number(workoutSummaryModal.activity.total_elevation_gain || 0).toFixed(0)} m</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Calorías</div><div style={{ fontWeight: 800 }}>{Number(workoutSummaryModal.activity.calories || workoutSummaryModal.activity.kilojoules || 0).toFixed(0)}</div></div>
                </div>
              ) : (
                <div style={{ color: "#64748b", fontSize: ".86em", marginBottom: 14 }}>No encontramos una actividad de Strava para ese día.</div>
              )
            ) : (
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                  <input type="number" min="0" step="0.1" value={manualSummaryForm.distanceKm} onChange={(e) => setManualSummaryForm((f) => ({ ...f, distanceKm: e.target.value }))} placeholder="Distancia (km)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                  <input value={manualSummaryForm.timeHms} onChange={(e) => setManualSummaryForm((f) => ({ ...f, timeHms: e.target.value }))} placeholder="Tiempo (HH:MM:SS)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                </div>
                <input type="number" min="1" max="10" value={manualSummaryForm.rpe} onChange={(e) => setManualSummaryForm((f) => ({ ...f, rpe: e.target.value }))} placeholder="RPE (1-10)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
                <textarea rows={3} value={manualSummaryForm.notes} onChange={(e) => setManualSummaryForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notas" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" disabled={manualSummarySaving} onClick={saveManualWorkoutSummary} style={{ background: manualSummarySaving ? "#cbd5e1" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: manualSummarySaving ? "not-allowed" : "pointer", fontSize: ".78em" }}>{manualSummarySaving ? "Guardando…" : "Guardar resumen"}</button>
                </div>
              </div>
            )}
            {workoutSummaryModal.activity?.id ? (
              <a href={`https://www.strava.com/activities/${workoutSummaryModal.activity.id}`} target="_blank" rel="noreferrer" style={{ color: "#ea580c", fontWeight: 700, fontSize: ".82em", textDecoration: "underline" }}>
                Ver en Strava
              </a>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" onClick={() => setWorkoutSummaryModal(null)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {athletePremiumModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setAthletePremiumModalOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setAthletePremiumModalOpen(false)}
          role="presentation"
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 24,
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 20px 60px rgba(15,23,42,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="athlete-premium-modal-title"
          >
            <h3 id="athlete-premium-modal-title" style={{ margin: "0 0 16px", fontSize: "1.25em", fontWeight: 800, color: "#0f172a" }}>
              Plan Premium Atleta
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { period: "Mensual", amount: "$20,000", note: null },
                { period: "Semestral", amount: "$105,600", note: "Ahorra 12%" },
                { period: "Anual", amount: "$192,000", note: "Ahorra 20%" },
              ].map((row) => (
                <div
                  key={row.period}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: "#0f172a" }}>{row.period}</div>
                    <div style={{ fontSize: ".95em", color: "#334155", marginTop: 4 }}>
                      {row.amount} COP
                      {row.note ? <span style={{ color: "#15803d", fontSize: ".82em", marginLeft: 8 }}>{row.note}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAthletePremiumWa(row.period, row.amount)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: "linear-gradient(135deg,#0d9488,#14b8a6)",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: ".8em",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Suscribirme
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAthletePremiumModalOpen(false)}
              style={{
                marginTop: 18,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                color: "#64748b",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".85em",
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
      {corosModalOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:10003,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
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
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:10003,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
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

function Plan2Weeks({ athletes, notify, coachUserId, coachPlan, profileRole, onGoToPlans, onPlanAssigned }) {
  const S = styles;
  const [athleteId, setAthleteId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("raf_plan2_athlete") || "";
  });
  const [competition, setCompetition] = useState("Maratón");
  const [targetTime, setTargetTime] = useState("");
  const [levelId, setLevelId] = useState("intermedio");
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [startDate, setStartDate] = useState(() => formatLocalYMD(addDays(new Date(), 14)));
  const startDateRef = useRef(startDate);
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
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [blockHistory, setBlockHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [openHistoryRows, setOpenHistoryRows] = useState(() => new Set());
  const [showNextBlockPanel, setShowNextBlockPanel] = useState(false);
  const [currentBlock, setCurrentBlock] = useState(1);
  const [nextBlockParams, setNextBlockParams] = useState({
    vdot: "",
    trainingDays: [2, 3, 6],
    focus: PLAN2_NEXT_BLOCK_FOCUSES[0],
    notes: "",
  });
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const isBasicPlan = useMemo(() => {
    const p = String(coachPlan || "").toLowerCase();
    return p === "basico" || p === "básico" || p === "starter" || p === "";
  }, [coachPlan]);
  const isAdminRole = profileRole === "admin";
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
  const selectedAthlete = useMemo(
    () => (athletes || []).find((a) => String(a.id) === String(athleteId)) || null,
    [athletes, athleteId],
  );
  const selectedTrainingDaysText = useMemo(() => {
    const selected = PLAN2_TRAINING_DAY_OPTIONS.filter((d) => nextBlockParams.trainingDays.includes(d.weekday));
    return selected.map((d) => `${d.label}(${d.weekday})`).join(", ");
  }, [nextBlockParams.trainingDays]);
  const levelLabel = useMemo(
    () => PLAN_12_LEVELS.find((l) => l.id === levelId)?.label || levelId,
    [levelId],
  );

  useEffect(() => {
    startDateRef.current = startDate;
  }, [startDate]);

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

  const loadBlockHistory = useCallback(async () => {
    if (!athleteId) {
      setBlockHistory([]);
      setOpenHistoryRows(new Set());
      return;
    }
    const athleteNumericId = Number(athleteId);
    if (!Number.isFinite(athleteNumericId)) {
      setBlockHistory([]);
      setOpenHistoryRows(new Set());
      return;
    }
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from("plan_drafts")
      .select("*")
      .eq("athlete_id", athleteNumericId)
      .eq("status", "assigned")
      .order("block_number", { ascending: true });
    setHistoryLoading(false);
    if (error) {
      console.error("plan_drafts history:", error);
      return;
    }
    setBlockHistory(Array.isArray(data) ? data : []);
    setOpenHistoryRows(new Set());
  }, [athleteId]);

  const incrementGenerationCounter = useCallback(async () => {
    if (!coachUserId) return;
    const { data: existing, error: selErr } = await supabase
      .from("ai_generations")
      .select("count")
      .eq("coach_id", coachUserId)
      .eq("month", monthKey)
      .maybeSingle();
    if (selErr) {
      console.error("ai_generations increment load (plan2):", selErr);
      return;
    }
    const current = Number(existing?.count) || 0;
    const nextCount = current + 1;
    if (existing) {
      const { error: updErr } = await supabase
        .from("ai_generations")
        .update({ count: nextCount, updated_at: new Date().toISOString() })
        .eq("coach_id", coachUserId)
        .eq("month", monthKey);
      if (updErr) {
        console.error("ai_generations increment update (plan2):", updErr);
        return;
      }
    } else {
      const { error: insErr } = await supabase.from("ai_generations").insert({
        coach_id: coachUserId,
        month: monthKey,
        count: 1,
        updated_at: new Date().toISOString(),
      });
      if (insErr) {
        console.error("ai_generations increment insert (plan2):", insErr);
        return;
      }
    }
    setMonthGenerations(nextCount);
    await loadGenerationCounter();
  }, [coachUserId, monthKey, loadGenerationCounter]);

  useEffect(() => {
    loadGenerationCounter();
  }, [loadGenerationCounter]);

  useEffect(() => {
    if (!athletes?.length || athleteId) return;
    let saved = "";
    if (typeof window !== "undefined") {
      saved = String(localStorage.getItem(PLAN2_ATHLETE_STORAGE_KEY) || "").trim();
    }
    if (saved && athletes.some((a) => String(a.id) === saved)) {
      setAthleteId(saved);
      return;
    }
    setAthleteId(String(athletes[0].id));
  }, [athletes, athleteId]);

  useEffect(() => {
    if (!athleteId || typeof window === "undefined") return;
    localStorage.setItem(PLAN2_ATHLETE_STORAGE_KEY, String(athleteId));
  }, [athleteId]);

  useEffect(() => {
    setPlanAssignedSuccess(false);
    setShowNextBlockPanel(false);
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

  const persistPlanDraft = useCallback(
    async ({ status = "draft", planJson, startDateValue, blockNumber } = {}) => {
      if (!coachUserId || !athleteId) return;
      const athleteNumericId = Number(athleteId);
      if (!Number.isFinite(athleteNumericId)) return;
      console.log("[plan_drafts] guardando draft:", { status, athleteId, coachUserId });
      const payload = {
        coach_id: coachUserId,
        athlete_id: athleteNumericId,
        plan_json: planJson || generatedPlan || { plan_title: "Plan 2 semanas", weeks: [] },
        race_date: startDateValue || startDateRef.current || null,
        block_number: Number.isFinite(Number(blockNumber)) ? Number(blockNumber) : Number(currentBlock) || 1,
        competition: competition || null,
        target_time: targetTime || null,
        level: levelId || null,
        status,
        updated_at: new Date().toISOString(),
      };
      const { data: upsertData, error: upsertError } = await supabase
        .from("plan_drafts")
        .upsert(payload, { onConflict: "coach_id,athlete_id,block_number" })
        .select("*");
      console.log("[persistPlanDraft] resultado upsert:", { data: upsertData, error: upsertError });
      if (upsertError) {
        console.error("plan_drafts upsert:", upsertError);
      }
    },
    [coachUserId, athleteId, generatedPlan, currentBlock, competition, targetTime, levelId],
  );

  const loadDraftForAthlete = useCallback(async () => {
    if (!coachUserId || !athleteId) return;
    const athleteNumericId = Number(athleteId);
    if (!Number.isFinite(athleteNumericId)) return;
    console.log("[loadDraft DEBUG]", { coachUserId, athleteId, athleteNumericId });
    console.log("[plan_drafts] cargando draft para:", { coachUserId, athleteId, athleteNumericId });
    setDraftLoading(true);
    const { data, error } = await supabase
      .from("plan_drafts")
      .select("*")
      .eq("athlete_id", athleteNumericId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    console.log("[plan_drafts] resultado:", { data, error });
    setDraftLoading(false);
    if (error) {
      console.error("plan_drafts load:", error);
      return;
    }
    if (data?.competition) setCompetition(String(data.competition));
    if (data?.target_time) setTargetTime(String(data.target_time));
    if (data?.level) setLevelId(String(data.level));
    if (data?.plan_json) {
      setGeneratedPlan(data.plan_json);
      setTimeout(() => setOpenWeeks(new Set([1, 2])), 100);
      setDraftStatus(String(data.status || ""));
      const weeks = Array.isArray(data.plan_json?.weeks) ? data.plan_json.weeks : [];
      if (data.race_date) {
        const loadedStartDate = String(data.race_date);
        startDateRef.current = loadedStartDate;
        setStartDate(loadedStartDate);
      }
      setCurrentBlock(Number(data.block_number) || 1);
      const firstWeek = weeks.find((w) => Number(w.week_number) === 1);
      const inferredSessions = Math.min(5, Math.max(3, Array.isArray(firstWeek?.workouts) ? firstWeek.workouts.length : 3));
      setDaysPerWeek(inferredSessions);
      const inferredDays = Array.isArray(firstWeek?.workouts)
        ? firstWeek.workouts
            .map((wo) => Number(wo?.weekday))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
            .sort((a, b) => a - b)
        : [];
      if (inferredDays.length) {
        setNextBlockParams((prev) => ({ ...prev, trainingDays: inferredDays }));
      }
    } else {
      setGeneratedPlan(null);
      setDraftStatus("");
      setOpenWeeks(new Set());
      setCurrentBlock(1);
    }
  }, [coachUserId, athleteId]);

  useEffect(() => {
    if (!coachUserId || !athleteId || athleteId === "") return;
    const numId = Number(athleteId);
    if (!Number.isFinite(numId) || numId <= 0) return;
    loadDraftForAthlete();
  }, [coachUserId, athleteId, loadDraftForAthlete]);

  useEffect(() => {
    loadBlockHistory();
  }, [loadBlockHistory]);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("athlete_evaluations")
        .select("vdot")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || error) return;
      const vdotVal = Number(data?.vdot);
      if (!Number.isFinite(vdotVal) || vdotVal <= 0) return;
      setNextBlockParams((prev) => {
        if (prev.vdot && String(prev.vdot).trim() !== "") return prev;
        return { ...prev, vdot: vdotVal.toFixed(2) };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const handleToggleTrainingDay = (weekday) => {
    setNextBlockParams((prev) => {
      const exists = prev.trainingDays.includes(weekday);
      if (exists && prev.trainingDays.length <= 3) {
        notify("Debes mantener al menos 3 días de entrenamiento.");
        return prev;
      }
      const nextDays = exists
        ? prev.trainingDays.filter((d) => d !== weekday)
        : [...prev.trainingDays, weekday].sort((a, b) => a - b);
      const nextSessions = Math.min(5, Math.max(3, nextDays.length || 3));
      setDaysPerWeek(nextSessions);
      return { ...prev, trainingDays: nextDays };
    });
  };

  const handleStartNextBlock = async () => {
    const athleteNumericId = Number(athleteId);
    if (!Number.isFinite(athleteNumericId) || athleteNumericId <= 0) {
      notify("Selecciona un atleta válido para avanzar de bloque.");
      return;
    }
    const { data: lastAssigned, error: lastAssignedError } = await supabase
      .from("plan_drafts")
      .select("block_number")
      .eq("athlete_id", athleteNumericId)
      .eq("status", "assigned")
      .order("block_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastAssignedError) {
      console.error("plan_drafts assigned block load:", lastAssignedError);
      notify("No se pudo obtener el último bloque asignado.");
      return;
    }
    const assignedBlock = Number(lastAssigned?.block_number);
    const nextBlock = Number.isFinite(assignedBlock) && assignedBlock > 0 ? assignedBlock + 1 : 1;
    const nextDate = getNextMonday(formatLocalYMD(addDays(new Date(`${startDateRef.current || startDate}T12:00:00`), 14)));
    const nextSessions = Math.min(5, Math.max(3, Number(nextBlockParams.trainingDays?.length) || 3));
    startDateRef.current = nextDate;
    setStartDate(nextDate);
    setCurrentBlock(nextBlock);
    setDaysPerWeek(nextSessions);
    setPlanAssignedSuccess(false);
    setDraftStatus("draft");
    setShowNextBlockPanel(true);
    setGeneratedPlan(null);
    setOpenWeeks(new Set());
    const blankPlan = { plan_title: `Bloque ${nextBlock}`, weeks: [] };
    await persistPlanDraft({
      status: "draft",
      planJson: blankPlan,
      startDateValue: nextDate,
      blockNumber: nextBlock,
    });
    notify(`Bloque ${nextBlock} listo: fecha de inicio avanzada 2 semanas. Ajusta parámetros y genera con IA.`);
  };

  const handleDaysPerWeekChange = (nextValue) => {
    const requested = Number(nextValue);
    if (!Number.isFinite(requested)) return;
    const expected = getPlan2ExpectedSlots(requested).map((slot) => slot.weekday);
    setDaysPerWeek(requested);
    setNextBlockParams((prev) => ({ ...prev, trainingDays: expected }));
  };

  const plan2SystemPrompt = `You are an elite running coach for ${BRAND_NAME} specializing in periodized training plans based on Jack Daniels VDOT methodology. Output ONLY compact valid JSON. No markdown, no code fences, no extra text. weekday: always 1=Monday .. 7=Sunday.`;

  const plan2UserPrompt = useMemo(() => {
    const vdot = Number(nextBlockParams.vdot) || 40;
    const blockNumber = Number(currentBlock) || 1;
    const blockStartDate = startDate;
    // Obtener resumen del bloque anterior del historial
    const prevBlockSummary = blockHistory?.length > 0
      ? (() => {
          const prev = blockHistory[blockHistory.length - 1];
          const weeks = prev?.plan_json?.weeks || [];
          const totalKm = weeks.flatMap((w) => w.workouts || []).reduce((sum, wo) => sum + (Number(wo.total_km) || 0), 0);
          const avgKm = weeks.length ? (totalKm / weeks.length).toFixed(1) : 0;
          return `Previous block ${prev.block_number}: ${prev.plan_json?.plan_title || "N/A"}, avg ${avgKm}km/week, focus: ${weeks[0]?.focus || "N/A"}`;
        })()
      : "This is the first block - start conservative";

    // Calcular ritmos Jack Daniels según VDOT
    const paces = {
      easy: vdot < 35 ? "7:30-8:00 min/km" : vdot < 40 ? "6:45-7:15 min/km" : vdot < 45 ? "6:10-6:40 min/km" : vdot < 50 ? "5:45-6:10 min/km" : vdot < 55 ? "5:20-5:45 min/km" : "5:00-5:20 min/km",
      tempo: vdot < 35 ? "6:30 min/km" : vdot < 40 ? "5:55 min/km" : vdot < 45 ? "5:20 min/km" : vdot < 50 ? "4:55 min/km" : vdot < 55 ? "4:35 min/km" : "4:15 min/km",
      interval: vdot < 35 ? "6:00 min/km" : vdot < 40 ? "5:25 min/km" : vdot < 45 ? "4:55 min/km" : vdot < 50 ? "4:30 min/km" : vdot < 55 ? "4:10 min/km" : "3:50 min/km",
      recovery: vdot < 35 ? "8:30 min/km" : vdot < 40 ? "7:45 min/km" : vdot < 45 ? "7:00 min/km" : vdot < 50 ? "6:30 min/km" : vdot < 55 ? "6:00 min/km" : "5:40 min/km",
    };

    // Volumen base según distancia objetivo
    const competitionText = String(competition || "").toLowerCase();
    const baseKmWeekly = competitionText.includes("maratón") || competitionText.includes("maraton") ? 50
      : competitionText.includes("media") ? 35
      : competitionText.includes("10") ? 25
      : competitionText.includes("5") ? 18 : 25;

    // Fase del plan según número de bloque
    const phase = blockNumber <= 2 ? "BASE (aerobic foundation, easy runs dominate, build volume gradually)"
      : blockNumber <= 4 ? "BUILDING (introduce tempo runs, increase volume 10% from previous block)"
      : blockNumber <= 6 ? "DEVELOPMENT (threshold work, interval sessions, peak volume)"
      : blockNumber <= 8 ? "PEAK (race-specific workouts, highest intensity, maintain volume)"
      : "TAPER (reduce volume 20-30%, maintain intensity, prepare for race)";

    // Semana 2 es race week solo en el último bloque
    const week2Type = blockNumber >= 8 ? "RACE WEEK: reduce volume 40%, only easy runs + strides, race on race date"
      : "CONSOLIDATION WEEK: same focus as week 1 but slightly higher volume (+10%) or higher quality";

    return `Generate a 2-week running training block as JSON only.
IMPORTANT: Respond entirely in Spanish. All fields including plan_title, focus, title, and description MUST be in Spanish. Do not use English in any field.

ATHLETE PROFILE:
- Goal race: ${competition}
- Target time: ${targetTime}
- Current VDOT: ${vdot}
- Level: ${levelLabel}
- Training days per week: ${daysPerWeek}
- Block start date: ${blockStartDate}. Week 1 starts on this date, week 2 starts 7 days later.
- Previous block summary: ${prevBlockSummary}
- PROGRESSION REQUIREMENT: Week 1 volume MUST be ${blockNumber <= 2 ? "25-35" : blockNumber <= 4 ? "35-45" : blockNumber <= 6 ? "45-55" : "55-65"}km total. Each session km MUST be higher than previous block by 10-15%.
- Preferred weekdays (1=Mon..7=Sun): ${selectedTrainingDaysText || "2,3,4,6,7"}

CRITICAL: This is block number ${blockNumber}. Each block MUST be progressively harder than the previous one:
- Block 1-2: Base phase, easy runs dominate (70% easy, 30% quality), low volume
- Block 3-4: Building phase, introduce tempo (60% easy, 40% quality), +10% volume
- Block 5-6: Development phase, threshold + intervals (50% easy, 50% quality), +20% volume
- Block 7-8: Peak phase, race-specific work (40% easy, 60% quality), +25% volume
- Block 9+: Taper phase, reduce volume 30%, maintain intensity
For a ${levelLabel} athlete targeting ${competition} in ${targetTime}:
- Beginner: start week 1 at 60% of race distance total, increase 10% per block
- Intermediate: start at 80% of race distance total, increase 8% per block
- Advanced: start at 100% of race distance total, increase 5% per block
Block ${blockNumber} volume target per session: adjust ALL km values according to block progression above.
VOLUME CAP by level and distance:
- Beginner 5K: max 15km/week block 1, +2km per block
- Beginner 10K: max 20km/week block 1, +3km per block
- Beginner Half: max 25km/week block 1, +4km per block
- Beginner Marathon: max 30km/week block 1, +5km per block
- Intermediate 10K: max 30km/week block 1, +3km per block
- Advanced 10K: max 40km/week block 1, +3km per block

TRAINING PACES (use these EXACTLY in descriptions):
- Easy/Recovery pace: ${paces.easy}
- Tempo/Threshold pace: ${paces.tempo}
- Interval pace: ${paces.interval}
- Recovery run pace: ${paces.recovery}

PERIODIZATION:
- Block number: ${blockNumber} of ~10 total blocks
- Current phase: ${phase}
- Weekly volume target: ~${baseKmWeekly} km (adjust ±15% based on phase)
- Week 1: ${nextBlockParams.focus || phase}
- Week 2: ${week2Type}
- Coach notes: ${nextBlockParams.notes || "none"}

VOLUME RULES:
- Easy/Long runs: 30-40% of weekly km, pace ${paces.easy}
- Tempo runs: 20-25% of weekly km at ${paces.tempo}
- Intervals: 15-20% of weekly km at ${paces.interval} (e.g. 6x800m, 5x1000m)
- Recovery runs: remaining km at ${paces.recovery}
- NEVER assign 10km to a beginner first session. Start conservative.

SESSION STRUCTURE (fixed weekdays):
weekday 2 (Tuesday): type "long" — Rodaje largo at easy pace
weekday 3 (Wednesday): type "tempo" — Tempo run
weekday 4 (Thursday): type "recovery" — Recuperación suave
weekday 6 (Saturday): type "interval" — Intervalos
weekday 7 (Sunday): type "long" — Largo suave
If N<5 sessions, drop in order: Sunday(7), Thursday(4), Wednesday(3).

OUTPUT JSON SCHEMA:
{"plan_title":"string","weeks":[{"week_number":1,"focus":"string","workouts":[{"weekday":2,"title":"string","type":"long|tempo|recovery|interval","total_km":0,"duration_min":0,"description":"Include specific pace, sets/reps for intervals, warmup/cooldown"}]}]}

Rules: exactly 2 weeks, exactly ${daysPerWeek} workouts each week, same weekdays both weeks, all numeric fields must be numbers, description must include specific paces from above.`;
  }, [competition, targetTime, levelLabel, daysPerWeek, startDate, currentBlock, nextBlockParams, selectedTrainingDaysText, blockHistory]);

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
    if (profileRole === "admin") {
      // admin no tiene límite, saltar verificación
    } else {
      // verificar límite normal según plan
      if (isBasicPlan && monthGenerations >= 100) {
        setGenerationLimitMsg("Has alcanzado el límite de 100 generaciones del plan Básico. Actualiza al plan Pro para generaciones ilimitadas.");
        return;
      }
    }
    setGenerationLimitMsg("");
    setPlanAssignedSuccess(false);
    setPlanEditModal(null);
    setPlanLoading(true);
    try {
      console.log("[PROMPT DEBUG] currentBlock:", currentBlock, "levelLabel:", levelLabel, "blockNumber en prompt:", Number(currentBlock) || 1);
      console.log("[PROMPT DEBUG] userPrompt primeros 500 chars:", plan2UserPrompt.substring(0, 500));
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
      const normalizedPlan = { ...parsed, weeks: orderedWeeks };
      setGeneratedPlan(normalizedPlan);
      setShowNextBlockPanel(false);
      setTimeout(() => setOpenWeeks(new Set([1, 2])), 100);
      await persistPlanDraft({
        status: "draft",
        planJson: normalizedPlan,
        startDateValue: startDate,
        blockNumber: currentBlock,
      });
      await incrementGenerationCounter();
      await loadGenerationCounter();
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
    if (!startDate) {
      alert("Indica la fecha de inicio del bloque.");
      return;
    }
    if (!selectedAthlete?.id) {
      alert("No se encontró el atleta.");
      return;
    }

    const blockStart = new Date(`${startDate}T12:00:00`);

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
        const sessionDate = addDays(blockStart, offsetDays);
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
          workout_structure: structure,
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

      await persistPlanDraft({
        status: "assigned",
        planJson: generatedPlan,
        startDateValue: startDate,
        blockNumber: currentBlock,
      });

      const expectedDays = getPlan2ExpectedSlots(daysPerWeek).map((slot) => slot.weekday);
      setNextBlockParams((prev) => ({
        ...prev,
        trainingDays: expectedDays.length ? expectedDays : prev.trainingDays,
      }));
      setPlanAssignedSuccess(true);
      onPlanAssigned?.();
      await loadBlockHistory();

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
                <strong>Inicio de bloque:</strong> ${startDate}</p>
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
      for (const wk of rows) {
        await sendWorkoutAssignmentPushToAthlete({
          athleteUserId: selectedAthlete?.user_id,
          workoutTitle: wk.title,
          scheduledDate: wk.scheduled_date,
        });
      }
    } finally {
      setAssignLoading(false);
    }
  };

  const deletePlanWorkout = (weekNumber, workoutIndex, e) => {
    e?.stopPropagation?.();
    if (!generatedPlan?.weeks) return;
    const updated = {
      ...generatedPlan,
      weeks: generatedPlan.weeks.map((w) => {
        if (Number(w.week_number) !== weekNumber) return w;
        return { ...w, workouts: (w.workouts || []).filter((_, i) => i !== workoutIndex) };
      }),
    };
    setGeneratedPlan(updated);
    persistPlanDraft({ status: "draft", planJson: updated, startDateValue: startDate, blockNumber: currentBlock });
  };

  const savePlanEditModal = () => {
    if (!planEditModal || !generatedPlan) return;
    const { weekNumber, workoutIdx } = planEditModal;
    const updated = {
      ...generatedPlan,
      weeks: generatedPlan.weeks.map((w) => {
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
    persistPlanDraft({ status: "draft", planJson: updated, startDateValue: startDate, blockNumber: currentBlock });
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
  const clearBlockHistory = async () => {
    if (!athleteId) return;
    const athleteNumericId = Number(athleteId);
    if (!Number.isFinite(athleteNumericId) || athleteNumericId <= 0) return;
    const { error } = await supabase
      .from("plan_drafts")
      .delete()
      .eq("athlete_id", athleteNumericId);
    if (error) {
      console.error("plan_drafts clear history:", error);
      notify("No se pudo limpiar el historial.");
      return;
    }
    setCurrentBlock(1);
    setGeneratedPlan(null);
    setDraftStatus("");
    setPlanAssignedSuccess(false);
    setShowNextBlockPanel(false);
    setOpenWeeks(new Set());
    setOpenHistoryRows(new Set());
    await loadBlockHistory();
    notify("Historial de bloques limpiado.");
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.pageTitle}>Plan 2 Semanas</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          Distribución fija: mar largo · mié tempo · jue recuperación · sáb intervalos · dom largo. Con menos de 5 sesiones se quitan primero domingo, luego jueves y miércoles. Semana 2 = semana de carrera.
        </p>
        <div style={{ marginTop: 8, color: isAdminRole ? "#16a34a" : "#64748b", fontSize: ".8em", fontWeight: 600 }}>
          {isAdminRole ? "Generaciones ilimitadas ∞" : isBasicPlan ? `${loadingGenerations ? "…" : monthGenerations} / 100 generaciones usadas este mes` : "Ilimitado"}
        </div>
        <div style={{ marginTop: 4, color: "#64748b", fontSize: ".78em", fontWeight: 600 }}>
          Bloque actual: {currentBlock}
        </div>
        {draftLoading ? <div style={{ marginTop: 4, color: "#94a3b8", fontSize: ".76em" }}>Cargando draft guardado…</div> : null}
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
              <select
                value={athleteId}
                onChange={(e) => {
                  const nextAthleteId = e.target.value;
                  setAthleteId(nextAthleteId);
                  if (typeof window !== "undefined" && nextAthleteId) {
                    localStorage.setItem(PLAN2_ATHLETE_STORAGE_KEY, String(nextAthleteId));
                  }
                }}
                style={inputStyle}
              >
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
              <select value={String(daysPerWeek)} onChange={(e) => handleDaysPerWeekChange(e.target.value)} style={inputStyle}>
                {[3, 4, 5].map((d) => (
                  <option key={d} value={String(d)}>{d} sesiones</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Fecha de inicio del bloque</div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(getNextMonday(e.target.value))}
                style={inputStyle}
              />
              <div style={{ marginTop: 6, color: "#64748b", fontSize: ".72em" }}>Los bloques inician siempre el lunes.</div>
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
            {(planAssignedSuccess || draftStatus === "assigned") ? (
              <button
                type="button"
                onClick={handleStartNextBlock}
                style={{
                  width: "100%",
                  marginTop: 4,
                  background: "rgba(34,197,94,.12)",
                  border: "1px solid rgba(34,197,94,.4)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  color: "#15803d",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontSize: ".85em",
                  fontFamily: "inherit",
                }}
              >
                ⚡ Generar Siguiente Bloque
              </button>
            ) : null}
          </div>
        </div>

        <div style={S.card}>
          {showNextBlockPanel ? (
            <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: "1px solid rgba(14,116,144,.35)", background: "rgba(14,116,144,.08)" }}>
              <div style={{ color: "#0f172a", fontSize: ".86em", fontWeight: 800, marginBottom: 10 }}>
                ⚙️ Parámetros del Bloque {currentBlock}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={labelStyle}>VDOT actual</div>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={nextBlockParams.vdot}
                    onChange={(e) => setNextBlockParams((prev) => ({ ...prev, vdot: e.target.value }))}
                    placeholder="Ej: 48.2"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>Días de entrenamiento</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                    {PLAN2_TRAINING_DAY_OPTIONS.map((day) => {
                      const checked = nextBlockParams.trainingDays.includes(day.weekday);
                      return (
                        <label
                          key={day.weekday}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #cbd5e1",
                            background: checked ? "rgba(14,116,144,.12)" : "#fff",
                            color: checked ? "#0e7490" : "#475569",
                            fontSize: ".78em",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleTrainingDay(day.weekday)}
                          />
                          {day.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Enfoque del bloque</div>
                  <select
                    value={nextBlockParams.focus}
                    onChange={(e) => setNextBlockParams((prev) => ({ ...prev, focus: e.target.value }))}
                    style={inputStyle}
                  >
                    {PLAN2_NEXT_BLOCK_FOCUSES.map((focus) => (
                      <option key={focus} value={focus}>
                        {focus}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={labelStyle}>Notas del coach</div>
                  <textarea
                    value={nextBlockParams.notes}
                    onChange={(e) => setNextBlockParams((prev) => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    placeholder="Contexto extra para el siguiente bloque"
                    style={{ ...inputStyle, resize: "vertical", minHeight: 88 }}
                  />
                </div>
                <button
                  type="button"
                  onClick={generatePlan2}
                  disabled={planLoading || !athletes?.length}
                  style={{
                    width: "100%",
                    background: planLoading || !athletes?.length ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)",
                    border: "none",
                    borderRadius: 8,
                    padding: "12px 16px",
                    color: planLoading || !athletes?.length ? "#334155" : "white",
                    fontWeight: 800,
                    cursor: planLoading || !athletes?.length ? "not-allowed" : "pointer",
                    fontSize: ".88em",
                    fontFamily: "inherit",
                  }}
                >
                  {planLoading ? "⏳ Generando bloque…" : "🤖 Generar Bloque con IA"}
                </button>
              </div>
            </div>
          ) : null}
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
          {athleteId ? (
            <div style={{ marginTop: 18, borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: ".9em", fontWeight: 800, color: "#0f172a" }}>📋 Historial de bloques</div>
                <button
                  type="button"
                  onClick={clearBlockHistory}
                  style={{
                    border: "1px solid rgba(239,68,68,.45)",
                    background: "rgba(239,68,68,.12)",
                    color: "#f87171",
                    borderRadius: 6,
                    padding: "5px 9px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: ".75em",
                    fontFamily: "inherit",
                  }}
                >
                  🗑 Limpiar historial
                </button>
              </div>
              {historyLoading ? (
                <div style={{ color: "#94a3b8", fontSize: ".8em" }}>Cargando historial…</div>
              ) : !blockHistory.length ? (
                <div style={{ color: "#64748b", fontSize: ".8em" }}>Sin bloques guardados para este atleta.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".76em", color: "#e2e8f0" }}>
                    <thead>
                      <tr style={{ background: "rgba(148,163,184,.12)" }}>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Bloque #</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Competencia</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Fase</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Semanas</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Fecha inicio</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Km/semana</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockHistory.map((row, idx) => {
                        const weeks = Array.isArray(row.plan_json?.weeks) ? row.plan_json.weeks : [];
                        const focusText = String(weeks?.[0]?.focus || "—");
                        const totalKm = weeks
                          .flatMap((w) => (Array.isArray(w?.workouts) ? w.workouts : []))
                          .reduce((sum, wo) => sum + (Number(wo?.total_km) || 0), 0);
                        const weeklyKm = (totalKm / 2).toFixed(1);
                        const startDateText = row.race_date ? String(row.race_date) : "—";
                        return (
                          <tr key={row.id || `hist-${idx}`}>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{Number(row.block_number) || idx + 1}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{row.competition || "—"}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{focusText}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{weeks.length || 0}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{startDateText}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{weeklyKm}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid rgba(148,163,184,.2)" }}>{row.status || "assigned"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
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
  const [assigningWorkoutRow, setAssigningWorkoutRow] = useState(null);
  const [assignSelectedAthleteIds, setAssignSelectedAthleteIds] = useState([]);
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
    if (!Array.isArray(assignSelectedAthleteIds) || assignSelectedAthleteIds.length === 0) {
      notify("Selecciona al menos un atleta");
      return;
    }
    if (!assignDate) {
      notify("Selecciona la fecha");
      return;
    }
    const athleteRows = (athletes || []).filter((a) => assignSelectedAthleteIds.includes(String(a.id)));
    if (athleteRows.length === 0) {
      notify("No se encontraron atletas seleccionados.");
      return;
    }
    setAssignSaving(true);
    const payload = athleteRows.map((a) => ({
      athlete_id: a.id,
      coach_id: coachUserId,
      title: row.title,
      type: row.type,
      total_km: Number(row.total_km) || 0,
      duration_min: Number(row.duration_min) || 0,
      description: row.description || "",
      structure: Array.isArray(row.structure) ? row.structure : [],
      workout_structure: Array.isArray(row.structure) ? row.structure : [],
      done: false,
      scheduled_date: assignDate,
    }));
    const { error } = await supabase.from("workouts").insert(payload);
    setAssignSaving(false);
    if (error) {
      console.error(error);
      notify(`Error al asignar: ${error.message}`);
      return;
    }
    await Promise.all(
      athleteRows.map((a) =>
        sendWorkoutAssignmentPushToAthlete({
          athleteUserId: a?.user_id,
          workoutTitle: row.title,
          scheduledDate: assignDate,
        }),
      ),
    );
    notify(`Workout asignado a ${athleteRows.length} atletas`);
    setAssigningWorkoutRow(null);
    setAssignSelectedAthleteIds([]);
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
      workout_structure: structure,
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
                      setAssigningWorkoutRow(row);
                      setAssignDate(formatLocalYMD(new Date()));
                      setAssignSelectedAthleteIds([]);
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
                    📋 Asignar
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
              </div>
            );
          })}
        </div>
      )}
      {assigningWorkoutRow ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 540, margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: ".95em", fontWeight: 900, color: "#0f172a" }}>📋 Asignar workout</div>
              <button type="button" onClick={() => setAssigningWorkoutRow(null)} disabled={assignSaving} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 10 }}>
              {assigningWorkoutRow.title}
            </div>
            <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setAssignSelectedAthleteIds((athletes || []).map((a) => String(a.id)))} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                Seleccionar todos
              </button>
              <button type="button" onClick={() => setAssignSelectedAthleteIds([])} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#475569", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                Deseleccionar todos
              </button>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
              {(athletes || []).map((a) => {
                const checked = assignSelectedAthleteIds.includes(String(a.id));
                return (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", cursor: "pointer", fontSize: ".82em", color: "#0f172a" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAssignSelectedAthleteIds((prev) =>
                          prev.includes(String(a.id)) ? prev.filter((x) => x !== String(a.id)) : [...prev, String(a.id)],
                        )
                      }
                    />
                    <span>{a.name}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del workout</div>
              <input type="date" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setAssigningWorkoutRow(null)} disabled={assignSaving} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "8px 12px", color: "#475569", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                Cancelar
              </button>
              <button type="button" onClick={() => assignDirectly(assigningWorkoutRow)} disabled={assignSaving} style={{ border: "none", background: assignSaving ? "#cbd5e1" : "linear-gradient(135deg,#b45309,#f59e0b)", borderRadius: 8, padding: "8px 12px", color: "#fff", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800 }}>
                {assignSaving ? "Asignando…" : "Asignar a seleccionados"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Builder({ athletes, aiPrompt, setAiPrompt, aiWorkout, setAiWorkout, aiLoading, setAiLoading, notify, coachUserId, coachPlan, profileRole, onGoToPlans, onWorkoutAssigned, onSavedToLibrary }) {
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
  const [assignEnabledOnSave, setAssignEnabledOnSave] = useState(true);
  const [assignAthleteIds, setAssignAthleteIds] = useState([]);
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
  const isAdminRole = profileRole === "admin";

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
    setAssignEnabledOnSave(true);
    setAssignAthleteIds((athletes || []).map((a) => String(a.id)));
    setShowAssignModal(true);
  };

  const saveAssignedWorkout = async () => {
    const w = previewWorkout;
    if (!w) return;
    if (!assignEnabledOnSave) {
      alert("Activa la opción de asignación para guardar este workout.");
      return;
    }
    const selectedAthletes = (athletes || []).filter((a) => assignAthleteIds.includes(String(a.id)));
    if (selectedAthletes.length === 0) {
      alert("Selecciona al menos un atleta.");
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
      const payload = selectedAthletes.map((selectedAthlete) => ({
        ...w,
        workout_structure: Array.isArray(w.structure) ? w.structure : [],
        athlete_id: selectedAthlete.id,
        coach_id: userData.user.id,
        scheduled_date: assignDate,
        done: false,
      }));
      const { error } = await supabase.from("workouts").insert(payload);
      if (error) {
        console.error("Error guardando workout asignado:", error);
        alert(`Error: ${error.message}\n${error.details || ""}\n${error.hint || ""}`);
        return;
      }

      await Promise.all(
        selectedAthletes.map(async (selectedAthlete) => {
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
          await sendWorkoutAssignmentPushToAthlete({
            athleteUserId: selectedAthlete?.user_id,
            workoutTitle: w.title,
            scheduledDate: assignDate,
          });
        }),
      );

      setShowAssignModal(false);
      onWorkoutAssigned?.();
      notify(`Workout asignado a ${selectedAthletes.length} atletas`);
    } finally {
      setAssignSaving(false);
    }
  };

  const generateWorkout = async () => {
    if (!aiPrompt.trim()) return;
    if (profileRole === "admin") {
      // admin no tiene límite, saltar verificación
    } else {
      // verificar límite normal según plan
      if (isBasicPlan && monthGenerations >= 100) {
        setGenerationLimitMsg("Has alcanzado el límite de 100 generaciones del plan Básico. Actualiza al plan Pro para generaciones ilimitadas.");
        return;
      }
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
      workout_structure: Array.isArray(w.structure) ? w.structure : [],
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
          <div style={{ marginTop: 10, color: isAdminRole ? "#16a34a" : "#64748b", fontSize: ".8em", fontWeight: 600 }}>
            {isAdminRole ? "Generaciones ilimitadas ∞" : isBasicPlan ? `${loadingGenerations ? "…" : monthGenerations} / 100 generaciones usadas este mes` : "Ilimitado"}
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
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>ESTRUCTURA DEL WORKOUT</div>
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
                      <span style={{ fontSize: ".75em", fontWeight: 800, color: "#334155" }}>Paso {idx + 1}</span>
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
                          🗑️
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Tipo de bloque</div>
                        <select
                          value={row.block_type}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], block_type: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        >
                          {WORKOUT_BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración (minutos)</div>
                        <input
                          value={row.duration_min}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], duration_min: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Ej: 12"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Distancia (km)</div>
                        <input
                          value={row.distance_km}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], distance_km: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Opcional"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Ritmo objetivo (MM:SS /km)</div>
                        <input
                          value={row.target_pace}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], target_pace: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Ej: 4:30"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>FC objetivo (lpm)</div>
                        <input
                          value={row.target_hr}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], target_hr: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Ej: 140-160"
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Descripción</div>
                        <input
                          value={row.description}
                          onChange={(e) =>
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], description: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          placeholder="Texto libre"
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
                ➕ Agregar bloque
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
                <WorkoutStructureTable structure={previewWorkout.structure} />
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
                  📤 Guardar y asignar
                </button>
              </div>
              {showAssignModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
                  <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
                    <div style={{ fontSize: ".85em", fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>📋 Asignar a atletas</div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 14 }}>
                      Se guardará en Supabase con los datos del workout y se creará un registro por cada atleta seleccionado.
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".82em", color: "#0f172a", fontWeight: 700, cursor: "pointer" }}>
                        <input type="checkbox" checked={assignEnabledOnSave} onChange={(e) => setAssignEnabledOnSave(e.target.checked)} />
                        Asignar a atletas al guardar
                      </label>
                    </div>
                    {assignEnabledOnSave ? (
                      <>
                        <div style={{ marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => setAssignAthleteIds((athletes || []).map((a) => String(a.id)))} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                            Seleccionar todos
                          </button>
                          <button type="button" onClick={() => setAssignAthleteIds([])} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#475569", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                            Deseleccionar todos
                          </button>
                        </div>
                        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, maxHeight: 190, overflowY: "auto", marginBottom: 14 }}>
                          {(athletes || []).map((a) => {
                            const checked = assignAthleteIds.includes(String(a.id));
                            return (
                              <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", cursor: "pointer", fontSize: ".82em", color: "#0f172a" }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setAssignAthleteIds((prev) =>
                                      prev.includes(String(a.id)) ? prev.filter((x) => x !== String(a.id)) : [...prev, String(a.id)],
                                    )
                                  }
                                />
                                <span>{a.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
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
                        {assignSaving ? "Guardando..." : "Asignar a seleccionados"}
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
  const EVAL_FORM_STORAGE_KEY = "raf_eval_form";
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

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(EVAL_FORM_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.athleteId === "string" && parsed.athleteId) setAthleteId(parsed.athleteId);
      if (typeof parsed.tab === "string") setTab(parsed.tab);
      if (typeof parsed.raceDistance === "string") setRaceDistance(parsed.raceDistance);
      if (typeof parsed.raceTime === "string") setRaceTime(parsed.raceTime);
      if (typeof parsed.cooperDistance === "string") setCooperDistance(parsed.cooperDistance);
      if (typeof parsed.thresholdTime === "string") setThresholdTime(parsed.thresholdTime);
      if (typeof parsed.thresholdDistance === "string") setThresholdDistance(parsed.thresholdDistance);
      if (typeof parsed.fcMax === "string") setFcMax(parsed.fcMax);
      if (typeof parsed.fcRest === "string") setFcRest(parsed.fcRest);
    } catch (err) {
      console.warn("No se pudo restaurar raf_eval_form", err);
    }
  }, []);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const payload = {
      athleteId,
      tab,
      raceDistance,
      raceTime,
      cooperDistance,
      thresholdTime,
      thresholdDistance,
      fcMax,
      fcRest,
    };
    localStorage.setItem(EVAL_FORM_STORAGE_KEY, JSON.stringify(payload));
  }, [athleteId, tab, raceDistance, raceTime, cooperDistance, thresholdTime, thresholdDistance, fcMax, fcRest]);

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
      { key: "Easy", frac: 0.65, color: "#22c55e" },
      { key: "Maratón", frac: 0.76, color: "#3b82f6" },
      { key: "Umbral", frac: 0.84, color: "#f59e0b" },
      { key: "Intervalos", frac: 0.95, color: "#ef4444" },
      { key: "Repeticiones", frac: 1.0, color: "#8b5cf6" },
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
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(EVAL_FORM_STORAGE_KEY);
    }
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
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {predictions.map((p) => {
              const pid = String(p.id || "").toLowerCase();
              const totalSec = Number(p.seconds) || 0;
              const palette =
                pid === "5k"
                  ? { border: "#22c55e55", bg: "#f0fdf4", accent: "#15803d" }
                  : pid === "10k"
                    ? { border: "#3b82f655", bg: "#eff6ff", accent: "#1d4ed8" }
                    : pid === "21k"
                      ? { border: "#f59e0b55", bg: "#fffbeb", accent: "#b45309" }
                      : { border: "#ef444455", bg: "#fef2f2", accent: "#b91c1c" };
              const level = (() => {
                if (pid === "5k") {
                  if (totalSec <= 1080) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                  if (totalSec <= 1320) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                  if (totalSec <= 1620) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                  return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
                }
                if (pid === "10k") {
                  if (totalSec <= 2280) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                  if (totalSec <= 2820) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                  if (totalSec <= 3480) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                  return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
                }
                if (pid === "21k") {
                  if (totalSec <= 4800) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                  if (totalSec <= 6000) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                  if (totalSec <= 7500) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                  return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
                }
                if (totalSec <= 10200) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                if (totalSec <= 12600) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                if (totalSec <= 15600) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
              })();
              const hhmmss = formatDurationClock(totalSec);
              return (
                <div key={p.id || p.label} style={{ border: `1px solid ${palette.border}`, borderRadius: 12, padding: "12px 10px", background: palette.bg, textAlign: "center" }}>
                  <div style={{ color: palette.accent, fontSize: ".98em", fontWeight: 900, letterSpacing: ".02em", marginBottom: 8 }}>
                    {p.label || String(p.id || "").toUpperCase()}
                  </div>
                  <div style={{ color: "#0f172a", fontWeight: 900, fontSize: "1.26em", marginBottom: 10, fontFamily: "monospace" }}>{hhmmss}</div>
                  <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, fontSize: ".68em", fontWeight: 800, background: level.bg, color: level.color }}>
                    {level.label}
                  </span>
                </div>
              );
            })}
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
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const [rows, setRows] = useState([]);
  const [emailByUserId, setEmailByUserId] = useState({});
  const [generationsByCoachId, setGenerationsByCoachId] = useState({});
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [activateMonthsChoice, setActivateMonthsChoice] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profs, error } = await supabase
      .from("profiles")
      .select(
        "user_id,name,email,plan_status,trial_started_at,plan_validated_at,plan_validated_by,role,subscription_plan,subscription_period,subscription_amount,subscription_expires_at",
      )
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
      setGenerationsByCoachId({});
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
    setLoadingGenerations(true);
    const { data: generationRows, error: generationsErr } = await supabase
      .from("ai_generations")
      .select("coach_id,count")
      .eq("month", monthKey)
      .in("coach_id", uids);
    if (generationsErr) console.error("ai_generations admin list:", generationsErr);
    const generationMap = {};
    for (const row of generationRows || []) {
      generationMap[row.coach_id] = Number(row.count) || 0;
    }
    setGenerationsByCoachId(generationMap);
    setLoadingGenerations(false);
    setEmailByUserId(em);
    setLoading(false);
  }, [notify, monthKey]);

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

  /** Días hasta subscription_expires_at; si no hay fecha, muestra días de trial cuando aplica. */
  const subscriptionDaysRemainingCol = (p) => {
    const raw = p.subscription_expires_at;
    if (raw) {
      const end = new Date(raw);
      if (Number.isNaN(end.getTime())) return "—";
      const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days < 0) return "Vencido";
      return `Vence en ${days} día${days === 1 ? "" : "s"}`;
    }
    if (p.plan_status === "trial" && p.trial_started_at) {
      const d = coachTrialDaysRemainingFromStart(p);
      return d == null ? "—" : `${d} día${d === 1 ? "" : "s"} (trial)`;
    }
    return "—";
  };

  const validatedCol = (p) =>
    p.plan_validated_at ? new Date(p.plan_validated_at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";

  const chosenPlanBadge = (planRaw) => {
    const p = String(planRaw || "").trim();
    if (!p) return <span style={{ color: "#94a3b8" }}>—</span>;
    const low = p.toLowerCase();
    const isPro = low === "pro";
    const label = low === "basico" || low === "básico" ? "Básico" : isPro ? "Pro" : p;
    const colors = isPro
      ? { bg: "#fffbeb", fg: "#b45309", bd: "#fcd34d" }
      : { bg: "#eff6ff", fg: "#1d4ed8", bd: "#93c5fd" };
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
        {label}
      </span>
    );
  };

  const subscriptionPeriodLabel = (per) => {
    const k = String(per || "").trim().toLowerCase();
    const map = { mensual: "Mensual", monthly: "Mensual", semestral: "Semestral", anual: "Anual", yearly: "Anual" };
    return map[k] || (per ? String(per) : "—");
  };

  const formatSubscriptionAmountCop = (amt) => {
    if (amt == null || amt === "") return "—";
    const n = Number(amt);
    if (!Number.isFinite(n)) return "—";
    return `$${n.toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`;
  };

  const addCalendarMonths = (fromDate, months) => {
    const d = new Date(fromDate.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  };

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

  /** Activa / renueva suscripción admin: siempre sobrescribe vencimiento y período desde HOY (no acumula ni compara con el período anterior). */
  const activateCoachWithMonths = (uid, months) => {
    const m = Number(months);
    if (![1, 6, 12].includes(m)) return;
    const now = new Date();
    const subscription_expires_at = addCalendarMonths(now, m).toISOString();
    const subscription_period = m === 1 ? "mensual" : m === 6 ? "semestral" : "anual";
    runAction("act", uid, {
      subscription_expires_at,
      subscription_period,
      plan_status: "active",
      plan_validated_at: now.toISOString(),
      plan_validated_by: adminUserId,
    });
  };

  const blockCoachProf = (uid) => {
    if (typeof window !== "undefined" && !window.confirm("¿Bloquear este coach?")) return;
    runAction("blk", uid, { plan_status: "blocked" });
  };

  const resetTrial = (uid) =>
    runAction("rst", uid, { plan_status: "trial", trial_started_at: new Date().toISOString() });

  const resetCoachGenerations = async (uid, coachName) => {
    const displayName = (coachName && String(coachName).trim()) || "coach";
    if (typeof window !== "undefined" && !window.confirm(`¿Resetear generaciones de ${displayName}?`)) return;
    setBusyKey(`gen-${uid}`);
    const { error } = await supabase
      .from("ai_generations")
      .delete()
      .eq("coach_id", uid)
      .eq("month", monthKey);
    setBusyKey("");
    if (error) {
      notify(error.message || "Error al resetear generaciones");
      return;
    }
    setGenerationsByCoachId((prev) => ({ ...prev, [uid]: 0 }));
    notify("Generaciones reseteadas ✓");
  };

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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Email</th>
                <th style={th}>Estado</th>
                <th style={th}>Plan elegido</th>
                <th style={th}>Período</th>
                <th style={th}>Monto</th>
                <th style={th}>Días restantes</th>
                <th style={th}>Fecha validación</th>
                <th style={th}>Generaciones</th>
                <th style={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const uid = p.user_id;
                const busy = busyKey === `act-${uid}` || busyKey === `blk-${uid}` || busyKey === `rst-${uid}` || busyKey === `gen-${uid}`;
                const generationsThisMonth = Number(generationsByCoachId[uid]) || 0;
                return (
                  <tr key={uid}>
                    <td style={cell}>{(p.name && String(p.name).trim()) || "—"}</td>
                    <td style={cell}>{emailByUserId[uid] || "—"}</td>
                    <td style={cell}>{planBadge(p.plan_status || "—")}</td>
                    <td style={cell}>{chosenPlanBadge(p.subscription_plan)}</td>
                    <td style={cell}>{subscriptionPeriodLabel(p.subscription_period)}</td>
                    <td style={cell}>{formatSubscriptionAmountCop(p.subscription_amount)}</td>
                    <td style={cell}>{subscriptionDaysRemainingCol(p)}</td>
                    <td style={cell}>{validatedCol(p)}</td>
                    <td style={cell}>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                        {loadingGenerations ? "…" : `${generationsThisMonth} este mes`}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resetCoachGenerations(uid, p.name)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #bfdbfe",
                          background: busy ? "#e2e8f0" : "#eff6ff",
                          color: "#1d4ed8",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔄 Resetear
                      </button>
                    </td>
                    <td style={{ ...cell, verticalAlign: "top" }}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 6,
                          marginBottom: 8,
                          padding: "8px 0",
                          borderBottom: "1px dashed #e2e8f0",
                        }}
                      >
                        <span style={{ fontSize: ".68em", fontWeight: 800, color: "#64748b" }}>Activar por:</span>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <select
                            value={activateMonthsChoice[uid] ?? "1"}
                            onChange={(e) =>
                              setActivateMonthsChoice((prev) => ({ ...prev, [uid]: e.target.value }))
                            }
                            disabled={busy}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: "1px solid #e2e8f0",
                              fontSize: ".72em",
                              fontFamily: "inherit",
                              color: "#0f172a",
                              background: "#fff",
                              minWidth: 110,
                            }}
                          >
                            <option value="1">1 mes</option>
                            <option value="6">6 meses</option>
                            <option value="12">1 año</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const raw = activateMonthsChoice[uid] ?? "1";
                              const months =
                                raw === "12" || raw === 12 ? 12 : raw === "6" || raw === 6 ? 6 : 1;
                              activateCoachWithMonths(uid, months);
                            }}
                            style={{
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
                            Activar
                          </button>
                        </div>
                      </div>
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

function MarketplaceHub({ profileRole, currentUserId, coachUserId = null, notify }) {
  const S = styles;
  const isCoach = profileRole === "coach";
  const isAthlete = profileRole === "athlete";
  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [coachLibraryRows, setCoachLibraryRows] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [planForm, setPlanForm] = useState({
    title: "",
    description: "",
    level: "intermedio",
    duration_weeks: "8",
    sessions_per_week: "4",
    price_cop: "120000",
    preview_workouts: [],
  });
  const [salesByPlanId, setSalesByPlanId] = useState({});
  const [ratingsByPlanId, setRatingsByPlanId] = useState({});

  const loadMarketplace = useCallback(async () => {
    setLoadingPlans(true);
    const { data, error } = await supabase
      .from("plan_marketplace")
      .select("*")
      .order("created_at", { ascending: false });
    setLoadingPlans(false);
    if (error) {
      console.error("plan_marketplace load:", error);
      setPlans([]);
      return;
    }
    setPlans(data || []);
  }, []);

  const loadSales = useCallback(async () => {
    const { data, error } = await supabase
      .from("plan_purchases")
      .select("plan_id, payment_status, rating")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("plan_purchases load:", error);
      setSalesByPlanId({});
      setRatingsByPlanId({});
      return;
    }
    const salesMap = {};
    const ratingAcc = {};
    for (const row of data || []) {
      const pid = String(row.plan_id || "");
      if (!pid) continue;
      if (String(row.payment_status || "").toLowerCase() === "confirmed") {
        salesMap[pid] = (salesMap[pid] || 0) + 1;
      }
      if (row.rating != null && Number.isFinite(Number(row.rating))) {
        if (!ratingAcc[pid]) ratingAcc[pid] = { sum: 0, count: 0 };
        ratingAcc[pid].sum += Number(row.rating);
        ratingAcc[pid].count += 1;
      }
    }
    const ratingsMap = {};
    for (const [pid, acc] of Object.entries(ratingAcc)) {
      ratingsMap[pid] = acc.count > 0 ? acc.sum / acc.count : 0;
    }
    setSalesByPlanId(salesMap);
    setRatingsByPlanId(ratingsMap);
  }, []);

  const loadCoachLibrary = useCallback(async () => {
    if (!coachUserId) return;
    setLoadingLibrary(true);
    const { data, error } = await supabase
      .from("workout_library")
      .select("id,title,type,total_km,duration_min,description,structure,workout_structure")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    setLoadingLibrary(false);
    if (error) {
      console.error("workout_library for marketplace:", error);
      setCoachLibraryRows([]);
      return;
    }
    setCoachLibraryRows(data || []);
  }, [coachUserId]);

  useEffect(() => {
    loadMarketplace();
    loadSales();
  }, [loadMarketplace, loadSales]);

  useEffect(() => {
    if (!showPublishModal || !isCoach) return;
    loadCoachLibrary();
  }, [showPublishModal, isCoach, loadCoachLibrary]);

  const plansVisible = useMemo(() => {
    const all = plans || [];
    return all.filter((p) => {
      const active = Boolean(p.is_active);
      const approved = Boolean(p.is_approved);
      if (isCoach && String(p.coach_user_id || "") === String(coachUserId || "")) return active;
      return active && approved;
    });
  }, [plans, isCoach, coachUserId]);

  const coachOwnPlans = useMemo(
    () => (plans || []).filter((p) => String(p.coach_user_id || "") === String(coachUserId || "")),
    [plans, coachUserId],
  );

  const openPurchaseInstructions = (plan) => {
    setSelectedPlan(plan);
  };

  const purchaseWhatsappHref = useMemo(() => {
    if (!selectedPlan) return "https://wa.me/573233675434";
    const txt = encodeURIComponent(
      `Hola, pagué el plan ${selectedPlan.title || "Plan"} por $${formatCopInt(selectedPlan.price_cop)} COP`,
    );
    return `https://wa.me/573233675434?text=${txt}`;
  }, [selectedPlan]);

  const submitCoachPlan = async () => {
    if (!coachUserId) return;
    const title = String(planForm.title || "").trim();
    if (!title) {
      notify?.("Ingresa un título");
      return;
    }
    const description = String(planForm.description || "").trim();
    const durationWeeks = Math.max(1, Math.round(Number(planForm.duration_weeks) || 0));
    const sessionsPerWeek = Math.max(1, Math.round(Number(planForm.sessions_per_week) || 0));
    const priceCop = Math.max(0, Math.round(Number(String(planForm.price_cop).replace(/[^\d]/g, "")) || 0));
    const selectedPreview = (coachLibraryRows || []).filter((w) => planForm.preview_workouts.includes(String(w.id)));
    const previewWorkouts = selectedPreview.map((w) => ({
      id: w.id,
      title: w.title,
      type: w.type,
      total_km: Number(w.total_km || 0),
      duration_min: Number(w.duration_min || 0),
      description: w.description || "",
      workout_structure: Array.isArray(w.workout_structure) ? w.workout_structure : Array.isArray(w.structure) ? w.structure : [],
    }));
    setSavingPlan(true);
    const { error } = await supabase.from("plan_marketplace").insert({
      coach_user_id: coachUserId,
      coach_name: "",
      title,
      description,
      level: String(planForm.level || "intermedio"),
      duration_weeks: durationWeeks,
      sessions_per_week: sessionsPerWeek,
      price_cop: priceCop,
      preview_workouts: previewWorkouts,
      is_active: true,
      is_approved: false,
    });
    setSavingPlan(false);
    if (error) {
      console.error("plan_marketplace insert:", error);
      notify?.(error.message || "No se pudo publicar el plan");
      return;
    }
    notify?.("Plan enviado. Quedó pendiente de aprobación.");
    setShowPublishModal(false);
    setPlanForm({
      title: "",
      description: "",
      level: "intermedio",
      duration_weeks: "8",
      sessions_per_week: "4",
      price_cop: "120000",
      preview_workouts: [],
    });
    loadMarketplace();
    loadSales();
  };

  const cardStyle = {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "12px 14px",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(15,23,42,.04)",
  };

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>🛒 Marketplace</h1>
        {isCoach ? (
          <button type="button" onClick={() => setShowPublishModal(true)} style={{ background: "linear-gradient(135deg,#0ea5e9,#0284c7)", border: "none", borderRadius: 9, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
            ➕ Publicar plan
          </button>
        ) : null}
      </div>

      {isCoach ? (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ fontSize: ".72em", letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>
            Mis planes publicados
          </div>
          {coachOwnPlans.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: ".85em" }}>Aún no has publicado planes.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {coachOwnPlans.map((p) => {
                const sales = Number(salesByPlanId[String(p.id)] || 0);
                const price = Number(p.price_cop || 0);
                const coachEarnings = Math.round(price * sales * 0.8);
                return (
                  <div key={p.id} style={{ ...cardStyle, background: "#f8fafc" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{p.title}</div>
                        <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 4 }}>
                          {p.duration_weeks} semanas · {p.sessions_per_week} sesiones/sem
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 800, color: p.is_approved ? "#16a34a" : "#b45309" }}>
                          {p.is_approved ? "Aprobado" : "Pendiente de aprobación"}
                        </div>
                        <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 4 }}>Ventas: {sales}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: ".82em", color: "#0f172a", fontWeight: 700 }}>
                      Ganancia estimada: ${formatCopInt(coachEarnings)} COP
                    </div>
                    <div style={{ marginTop: 4, fontSize: ".75em", color: "#64748b" }}>
                      Tu ganancia: ${formatCopInt(Math.round(price * 0.8))} COP (80% del precio)
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {loadingPlans ? (
        <div style={{ color: "#64748b" }}>Cargando planes…</div>
      ) : plansVisible.length === 0 ? (
        <div style={{ color: "#94a3b8" }}>No hay planes disponibles por ahora.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {plansVisible.map((p) => {
            const rating = Number(ratingsByPlanId[String(p.id)] || 0);
            const ratingStars = "★".repeat(Math.round(Math.min(5, Math.max(0, rating)))) + "☆".repeat(5 - Math.round(Math.min(5, Math.max(0, rating))));
            return (
              <div key={p.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 800, color: "#0f172a" }}>{p.title}</div>
                  <span style={{ fontSize: ".7em", borderRadius: 999, padding: "3px 8px", background: "rgba(14,165,233,.12)", color: "#0369a1", fontWeight: 800 }}>
                    {String(p.level || "intermedio")}
                  </span>
                </div>
                <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 4 }}>Coach: {p.coach_name || "Coach"}</div>
                <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 2 }}>{p.duration_weeks} semanas · {p.sessions_per_week} sesiones/semana</div>
                <div style={{ marginTop: 8, fontSize: ".95em", fontWeight: 800, color: "#0f172a" }}>${formatCopInt(p.price_cop)} COP</div>
                <div style={{ marginTop: 6, fontSize: ".78em", color: "#f59e0b", fontWeight: 700 }}>{ratingStars} {rating > 0 ? rating.toFixed(1) : "0.0"}</div>
                <button type="button" onClick={() => setSelectedPlan(p)} style={{ marginTop: 10, width: "100%", background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 10px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>
                  Ver plan
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedPlan ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10030, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 720, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900 }}>{selectedPlan.title}</div>
              <button type="button" onClick={() => setSelectedPlan(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ color: "#475569", fontSize: ".86em", marginBottom: 10 }}>{selectedPlan.description || "Sin descripción."}</div>
            <div style={{ fontSize: ".78em", fontWeight: 800, color: "#334155", marginBottom: 8 }}>Workouts de muestra</div>
            {(selectedPlan.preview_workouts || []).length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".82em", marginBottom: 12 }}>No hay muestra de workouts.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {(selectedPlan.preview_workouts || []).map((w, idx) => (
                  <div key={`${w.id || idx}`} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#f8fafc" }}>
                    <div style={{ fontWeight: 800, fontSize: ".85em" }}>{w.title || `Workout ${idx + 1}`}</div>
                    <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>{w.total_km || 0} km · {w.duration_min || 0} min</div>
                    <div style={{ marginTop: 6 }}>
                      <WorkoutStructureTable structure={w.workout_structure || w.structure || []} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => openPurchaseInstructions(selectedPlan)} style={{ width: "100%", background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 10, padding: "10px 14px", color: "#fff", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>
              Comprar - ${formatCopInt(selectedPlan.price_cop)} COP
            </button>
            <div style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fff7ed" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Realiza tu pago a:</div>
              <div style={{ fontSize: ".84em", lineHeight: 1.5 }}>
                📱 Nequi: 3233675434
                <br />
                📸 Envía comprobante por WhatsApp indicando el plan: {selectedPlan.title}
                <br />
                ✅ Recibirás el plan en menos de 24 horas
              </div>
              <a href={purchaseWhatsappHref} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, background: "#16a34a", color: "#fff", textDecoration: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 800, fontSize: ".8em" }}>
                Enviar comprobante
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {showPublishModal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10031, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 760, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "1.02em", fontWeight: 900, marginBottom: 10 }}>➕ Publicar plan</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <input value={planForm.title} onChange={(e) => setPlanForm((f) => ({ ...f, title: e.target.value }))} placeholder="Título" style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <textarea value={planForm.description} onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descripción" style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              <select value={planForm.level} onChange={(e) => setPlanForm((f) => ({ ...f, level: e.target.value }))} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                <option value="principiante">principiante</option>
                <option value="intermedio">intermedio</option>
                <option value="avanzado">avanzado</option>
              </select>
              <input type="number" value={planForm.duration_weeks} onChange={(e) => setPlanForm((f) => ({ ...f, duration_weeks: e.target.value }))} placeholder="Duración semanas" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <input type="number" value={planForm.sessions_per_week} onChange={(e) => setPlanForm((f) => ({ ...f, sessions_per_week: e.target.value }))} placeholder="Sesiones/semana" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <input type="number" value={planForm.price_cop} onChange={(e) => setPlanForm((f) => ({ ...f, price_cop: e.target.value }))} placeholder="Precio COP" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <div style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: ".78em", fontWeight: 800, marginBottom: 8 }}>Workouts de muestra (biblioteca)</div>
                {loadingLibrary ? (
                  <div style={{ color: "#64748b", fontSize: ".82em" }}>Cargando biblioteca…</div>
                ) : coachLibraryRows.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: ".82em" }}>No tienes workouts en tu biblioteca.</div>
                ) : (
                  <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                    {coachLibraryRows.map((w) => {
                      const checked = planForm.preview_workouts.includes(String(w.id));
                      return (
                        <label key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: ".82em", color: "#334155" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPlanForm((f) => ({
                                ...f,
                                preview_workouts: checked
                                  ? f.preview_workouts.filter((id) => id !== String(w.id))
                                  : [...f.preview_workouts, String(w.id)],
                              }))
                            }
                          />
                          <span>{w.title} · {w.total_km || 0} km · {w.duration_min || 0} min</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: ".8em", color: "#334155", fontWeight: 700 }}>
              Tu ganancia: ${formatCopInt(Math.round((Number(planForm.price_cop || 0) || 0) * 0.8))} COP (80% del precio)
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => setShowPublishModal(false)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "8px 12px", cursor: "pointer", fontFamily: "inherit" }}>Cancelar</button>
              <button type="button" onClick={submitCoachPlan} disabled={savingPlan} style={{ border: "none", borderRadius: 8, background: savingPlan ? "#cbd5e1" : "linear-gradient(135deg,#0ea5e9,#0284c7)", padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: savingPlan ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{savingPlan ? "Guardando…" : "Publicar plan"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminMarketplacePanel({ notify }) {
  const S = styles;
  const [plans, setPlans] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    level: "intermedio",
    duration_weeks: "12",
    sessions_per_week: "4",
    price_cop: "120000",
    preview_workouts_text: "",
  });
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiLevel, setAiLevel] = useState("principiante");
  const [aiGoal, setAiGoal] = useState("42K");
  const [aiDurationWeeks, setAiDurationWeeks] = useState("16");
  const [showPreviewTable, setShowPreviewTable] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [plansRes, purchasesRes] = await Promise.all([
      supabase.from("plan_marketplace").select("*").order("created_at", { ascending: false }),
      supabase.from("plan_purchases").select("*").order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (plansRes.error) {
      console.error("admin marketplace plans:", plansRes.error);
      notify?.(plansRes.error.message || "No se pudieron cargar planes");
      setPlans([]);
    } else setPlans(plansRes.data || []);
    if (purchasesRes.error) {
      console.error("admin marketplace purchases:", purchasesRes.error);
      setPurchases([]);
    } else setPurchases(purchasesRes.data || []);
  }, [notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const confirmedCountByPlan = useMemo(() => {
    const m = {};
    for (const p of purchases || []) {
      if (String(p.payment_status || "").toLowerCase() !== "confirmed") continue;
      const pid = String(p.plan_id || "");
      if (!pid) continue;
      m[pid] = (m[pid] || 0) + 1;
    }
    return m;
  }, [purchases]);

  const approvePlan = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").update({ is_approved: true, is_active: true }).eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo aprobar");
      return;
    }
    notify?.("Plan aprobado");
    loadAll();
  };
  const rejectPlan = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").update({ is_active: false }).eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo rechazar");
      return;
    }
    notify?.("Plan rechazado");
    loadAll();
  };
  const deletePlan = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").delete().eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo eliminar");
      return;
    }
    notify?.("Plan eliminado");
    loadAll();
  };
  const confirmPayment = async (purchaseId) => {
    const { error } = await supabase.from("plan_purchases").update({ payment_status: "confirmed" }).eq("id", purchaseId);
    if (error) {
      notify?.(error.message || "No se pudo confirmar pago");
      return;
    }
    notify?.("Pago confirmado");
    loadAll();
  };

  const pendingPurchases = (purchases || []).filter((p) => String(p.payment_status || "").toLowerCase() !== "confirmed");

  const parsePreviewWorkoutsText = (txt) => {
    const raw = String(txt || "").trim();
    if (!raw) return [];
    const parsed = extractJsonFromAnthropicText(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  };
  const previewRows = useMemo(() => parsePreviewWorkoutsText(createForm.preview_workouts_text), [createForm.preview_workouts_text]);

  const createAdminPlan = async () => {
    const title = String(createForm.title || "").trim();
    if (!title) {
      notify?.("Indica un título para el plan");
      return;
    }
    const payload = {
      coach_user_id: PLATFORM_ADMIN_USER_ID,
      coach_name: "Admin",
      title,
      description: String(createForm.description || "").trim(),
      level: String(createForm.level || "intermedio"),
      duration_weeks: Math.max(1, Math.round(Number(createForm.duration_weeks) || 0)),
      sessions_per_week: Math.max(1, Math.round(Number(createForm.sessions_per_week) || 0)),
      price_cop: Math.max(50000, Math.min(300000, Math.round(Number(String(createForm.price_cop || "0").replace(/[^\d]/g, "")) || 0))),
      preview_workouts: parsePreviewWorkoutsText(createForm.preview_workouts_text),
      is_active: true,
      is_approved: true,
    };
    setCreatingPlan(true);
    const { error } = await supabase.from("plan_marketplace").insert(payload);
    setCreatingPlan(false);
    if (error) {
      notify?.(error.message || "No se pudo crear el plan");
      return;
    }
    notify?.("Plan creado y aprobado automáticamente.");
    setCreateForm({
      title: "",
      description: "",
      level: "intermedio",
      duration_weeks: "12",
      sessions_per_week: "4",
      price_cop: "120000",
      preview_workouts_text: "",
    });
    loadAll();
  };

  const generatePlanWithAi = async () => {
    const systemPrompt =
      'Eres un experto en coaching de running. Genera un plan de entrenamiento completo para vender en un marketplace. Responde SOLO con JSON sin texto adicional:\n{\n  "title": "título comercial atractivo",\n  "description": "descripción de venta de 2-3 oraciones que convenza al atleta",\n  "level": "principiante|intermedio|avanzado",\n  "duration_weeks": número,\n  "sessions_per_week": número,\n  "price_cop": precio sugerido entre 50000 y 300000,\n  "preview_workouts": [\n    {"week": 1, "day": "Martes", "title": "título sesión", "description": "descripción", "duration_min": número, "distance_km": número},\n    {"week": 1, "day": "Jueves", "title": "título sesión", "description": "descripción", "duration_min": número, "distance_km": número},\n    {"week": 1, "day": "Sábado", "title": "título sesión", "description": "descripción", "duration_min": número, "distance_km": número}\n  ]\n}';
    const userPrompt = [
      `Describe el plan: ${aiContext || "Plan de running para marketplace"}`,
      `Nivel: ${aiLevel}`,
      `Objetivo: ${aiGoal}`,
      `Duración: ${aiDurationWeeks} semanas`,
    ].join("\n");
    setAiGenerating(true);
    try {
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2200,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify?.("Error al generar plan con IA");
        return;
      }
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const parsed = extractJsonFromAnthropicText(text);
      if (!parsed || typeof parsed !== "object") {
        notify?.("La IA no devolvió un JSON válido.");
        return;
      }
      setCreateForm((prev) => ({
        ...prev,
        title: String(parsed.title || prev.title || ""),
        description: String(parsed.description || prev.description || ""),
        level: String(parsed.level || aiLevel || "intermedio"),
        duration_weeks: String(parsed.duration_weeks || aiDurationWeeks || "12"),
        sessions_per_week: String(parsed.sessions_per_week || prev.sessions_per_week || "4"),
        price_cop: String(parsed.price_cop || prev.price_cop || "120000"),
        preview_workouts_text: JSON.stringify(Array.isArray(parsed.preview_workouts) ? parsed.preview_workouts : [], null, 2),
      }));
      notify?.("Plan generado con IA y formulario prellenado.");
      setAiModalOpen(false);
    } catch (e) {
      console.error("generatePlanWithAi:", e);
      notify?.("No se pudo generar con IA");
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>🛒 Admin · Marketplace</h1>
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: ".78em", letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b", fontWeight: 800 }}>
            Crear plan (admin)
          </div>
          <button
            type="button"
            onClick={() => setAiModalOpen(true)}
            style={{ border: "none", borderRadius: 8, padding: "8px 12px", background: "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
          >
            ✨ Generar plan con IA
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Título del plan</label>
            <input value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} placeholder="Título comercial del plan" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Descripción comercial</label>
            <textarea value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descripción de venta (2-3 oraciones)" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Nivel</label>
            <select value={createForm.level} onChange={(e) => setCreateForm((f) => ({ ...f, level: e.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
              <option value="principiante">Principiante</option>
              <option value="intermedio">Intermedio</option>
              <option value="avanzado">Avanzado</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Duración (semanas)</label>
            <input type="number" value={createForm.duration_weeks} onChange={(e) => setCreateForm((f) => ({ ...f, duration_weeks: e.target.value }))} placeholder="ej: 12" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Sesiones por semana</label>
            <input type="number" value={createForm.sessions_per_week} onChange={(e) => setCreateForm((f) => ({ ...f, sessions_per_week: e.target.value }))} placeholder="ej: 4" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Precio (COP)</label>
            <input type="text" value={createForm.price_cop} onChange={(e) => setCreateForm((f) => ({ ...f, price_cop: e.target.value }))} placeholder="ej: 120,000" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Workouts de muestra (JSON)</label>
            <div style={{ fontSize: ".7em", color: "#64748b", marginBottom: 6 }}>
              {'Formato: [{"week":1,"day":"Martes","title":"Rodaje suave","description":"...","duration_min":45,"distance_km":8}]'}
            </div>
            <textarea value={createForm.preview_workouts_text} onChange={(e) => setCreateForm((f) => ({ ...f, preview_workouts_text: e.target.value }))} rows={8} placeholder='[{"week":1,"day":"Martes","title":"Rodaje suave","description":"...","duration_min":45,"distance_km":8}]' style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "monospace", fontSize: ".78em", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setShowPreviewTable((v) => !v)} style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 12px", background: "#f8fafc", color: "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", marginRight: 8 }}>
              👁️ Vista previa
            </button>
            <button type="button" onClick={createAdminPlan} disabled={creatingPlan} style={{ border: "none", borderRadius: 8, padding: "9px 14px", background: creatingPlan ? "#cbd5e1" : "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff", fontWeight: 800, cursor: creatingPlan ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {creatingPlan ? "Guardando…" : "Guardar plan (auto-aprobado)"}
            </button>
          </div>
          {showPreviewTable ? (
            <div style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginTop: 2 }}>
              {previewRows.length === 0 ? (
                <div style={{ padding: "10px 12px", fontSize: ".8em", color: "#64748b", background: "#f8fafc" }}>No hay workouts parseables en el JSON.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: ".72em", color: "#475569", textTransform: "uppercase", letterSpacing: ".05em" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Semana</th>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Día</th>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Título</th>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Duración</th>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Distancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((w, idx) => (
                        <tr key={`${idx}-${w?.title || ""}`} style={{ borderBottom: "1px solid #f1f5f9", fontSize: ".8em", color: "#334155" }}>
                          <td style={{ padding: "8px 10px" }}>{w?.week ?? "-"}</td>
                          <td style={{ padding: "8px 10px" }}>{w?.day || "-"}</td>
                          <td style={{ padding: "8px 10px", fontWeight: 700 }}>{w?.title || "-"}</td>
                          <td style={{ padding: "8px 10px" }}>{w?.duration_min != null ? `${w.duration_min} min` : "-"}</td>
                          <td style={{ padding: "8px 10px" }}>{w?.distance_km != null ? `${w.distance_km} km` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando marketplace…</div>
      ) : (
        <>
          <div style={{ ...S.card, marginBottom: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: ".74em", textTransform: "uppercase", letterSpacing: ".08em" }}>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Coach</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Título</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Nivel</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Precio</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Estado</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Ventas</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Comisión</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(plans || []).map((p) => {
                  const sales = Number(confirmedCountByPlan[String(p.id)] || 0);
                  const commission = Math.round(Number(p.price_cop || 0) * sales * 0.2);
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>{p.coach_name || p.coach_user_id || "Coach"}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em", fontWeight: 700 }}>{p.title}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>{p.level}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>${formatCopInt(p.price_cop)}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em", fontWeight: 700, color: p.is_active ? (p.is_approved ? "#16a34a" : "#b45309") : "#ef4444" }}>
                        {!p.is_active ? "Inactivo" : p.is_approved ? "Aprobado" : "Pendiente"}
                      </td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>{sales}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>
                        Comisión plataforma: ${formatCopInt(commission)} COP (20%)
                      </td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => approvePlan(p.id)} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", borderRadius: 7, padding: "5px 8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}>✅ Aprobar</button>
                        <button type="button" onClick={() => rejectPlan(p.id)} style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 7, padding: "5px 8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}>🚫 Rechazar</button>
                        <button type="button" onClick={() => deletePlan(p.id)} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#334155", borderRadius: 7, padding: "5px 8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}>🗑️ Eliminar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={S.card}>
            <div style={{ fontSize: ".72em", letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b", marginBottom: 10 }}>
              Compras pendientes de confirmar
            </div>
            {pendingPurchases.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".84em" }}>No hay compras pendientes.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {pendingPurchases.map((p) => (
                  <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontSize: ".82em", color: "#334155" }}>
                      Plan: <strong>{p.plan_title || p.plan_id}</strong> · ${formatCopInt(p.amount_cop || 0)} COP · {p.buyer_name || p.buyer_user_id || "Comprador"}
                    </div>
                    <button type="button" onClick={() => confirmPayment(p.id)} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", borderRadius: 8, padding: "7px 10px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                      ✅ Confirmar pago
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {aiModalOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10040, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 620, margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: "1em", fontWeight: 900 }}>✨ Generar plan con IA</div>
              <button type="button" onClick={() => setAiModalOpen(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <textarea value={aiContext} onChange={(e) => setAiContext(e.target.value)} rows={3} placeholder='Describe el plan (ej: "Plan maratón 16 semanas para principiante con 4 sesiones semanales")' style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              <select value={aiLevel} onChange={(e) => setAiLevel(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                <option value="principiante">Principiante</option>
                <option value="intermedio">Intermedio</option>
                <option value="avanzado">Avanzado</option>
              </select>
              <select value={aiGoal} onChange={(e) => setAiGoal(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                <option value="5K">5K</option>
                <option value="10K">10K</option>
                <option value="21K">21K</option>
                <option value="42K">42K</option>
                <option value="Trail">Trail</option>
              </select>
              <select value={aiDurationWeeks} onChange={(e) => setAiDurationWeeks(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                {["8", "12", "16", "20", "24"].map((w) => <option key={w} value={w}>{w} semanas</option>)}
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" onClick={generatePlanWithAi} disabled={aiGenerating} style={{ border: "none", borderRadius: 8, padding: "9px 14px", background: aiGenerating ? "#cbd5e1" : "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "#fff", fontWeight: 800, cursor: aiGenerating ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {aiGenerating ? "Generando…" : "Generar con IA"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminPanel({ notify }) {
  const [adminTab, setAdminTab] = useState(() => {
    if (typeof localStorage === "undefined") return "promo";
    const saved = localStorage.getItem("raf_admin_tab");
    return saved || "promo";
  });
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("raf_admin_tab", adminTab);
  }, [adminTab]);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 10px 0", padding: "0 16px" }}>
        <button type="button" onClick={() => setAdminTab("promo")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "promo" ? "rgba(124,58,237,.12)" : "#fff", color: adminTab === "promo" ? "#6d28d9" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🎟️ Promo</button>
        <button type="button" onClick={() => setAdminTab("marketplace")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "marketplace" ? "rgba(14,165,233,.12)" : "#fff", color: adminTab === "marketplace" ? "#0369a1" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🛒 Marketplace</button>
      </div>
      {adminTab === "promo" ? <AdminPromoCodes notify={notify} /> : <AdminMarketplacePanel notify={notify} />}
    </div>
  );
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


