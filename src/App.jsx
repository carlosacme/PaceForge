import React, { Fragment, useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import { jsPDF } from "jspdf";
import FitParser from "fit-file-parser";
import { supabase } from "./lib/supabase";
import {
  BRAND_NAME,
  STRAVA_CALLBACK_URL,
  WORKOUT_TYPES,
  EVAL_DISTANCES,
  PLAN_PREVIEW_FULL_DAYS,
  PLAN_SESSION_TYPE_OPTIONS,
  MARKETPLACE_AI_PACE_RANGES_BY_LEVEL,
  marketplacePreviewSessionType,
  marketplaceAiPaceBandKey,
  buildMarketplaceAiPacePromptSection,
  applyMarketplaceAiPaceDefaultsToPreviewRows,
  getMarketplacePlanWorkoutRows,
  normalizeAthlete,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_PLAN_OPTIONS,
  STRAVA_ACTIVITY_ICONS,
  WORKOUT_BLOCK_TYPES,
  WORKOUT_BLOCK_COLORS,
  FIT_IMPORT_STEP_TYPES,
  newFitImportStepKey,
  emptyFitImportStructureRow,
  normalizeStructureForFitImportModal,
  structureRowsForFitImportInsert,
  paymentStatusLabel,
  formatLocalYMD,
  calendarCellToIsoYmd,
  normalizeScheduledDateYmd,
  startOfWeekMonday,
  addDays,
  firstDayOfNextMonthYmd,
  lastDayOfNextMonthYmd,
  nextWeekMondayToSundayYmd,
  formatDurationMinutesTotal,
  startOfMonthWeekMonday,
  getMonthGrid,
  cellIsInViewMonth,
  daysBetweenYmd,
  RACE_DISTANCE_PRESETS,
  raceDistanceToFormFields,
  normalizeRaceRow,
  getNextRaceCountdown,
  extractJsonFromAnthropicText,
  formatDurationClock,
  formatStravaPace,
  normalizeStravaActivity,
  normalizeWorkoutStructure,
  emptyWorkoutStructureRow,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  normalizeLibraryRow,
  libraryRowToBuilderWorkout,
  parseFitFileToLibraryDraft,
  INVALID_JSON_WORKOUT_FORMAT_MSG,
  parseJsonFileToLibraryDrafts,
  ADMIN_EMAIL,
  PLATFORM_ADMIN_USER_ID,
  TAB_KEY_LIBRARY,
  formatCopInt,
  CHALLENGE_TYPE_OPTIONS,
  normalizeChallengeType,
  challengeUnitByType,
  formatChallengeMetricValue,
  challengeValueLabel,
  challengeProgressLabel,
  challengeProgressOpenText,
  challengeHasOpenTarget,
  computeWorkoutDayStreak,
  computeChallengeProgressForAthlete,
  achievementJoinMeta,
  computeAchievementProgress,
  ATHLETE_ACHIEVEMENT_DISPLAY_LIST,
  computeAthleteAchievementVisualProgress,
} from "./components/shared/appShared";
import {
  initMessaging,
  onMessage,
  refreshFcmTokenIfGranted,
  requestNotificationPermission,
} from "./firebase.js";
const CoachSettings = React.lazy(() => import("./components/CoachSettings"));
const WorkoutLibrary = React.lazy(() => import("./components/WorkoutLibrary"));
const MarketplaceHub = React.lazy(() => import("./components/MarketplaceHub"));
const ChallengesHub = React.lazy(() => import("./components/ChallengesHub"));
const AdminMarketplacePanel = React.lazy(() => import("./components/AdminMarketplacePanel"));
const AthleteHome = React.lazy(() => import("./components/AthleteHome"));
const Plan2Weeks = React.lazy(() => import("./components/Plan2Weeks"));
const Builder = React.lazy(() => import("./components/Builder"));




/** Persistencia del atleta seleccionado en la vista Atletas del coach. */
const RAF_SELECTED_ATHLETE_STORAGE_KEY = "raf_selected_athlete";


/** Días completos para planes marketplace (admin) y formulario de sesión. */


/** Ritmos (min/km) para generación IA de marketplace: pace_range = H:MM-H:MM con guión ASCII. */


/** easy/long/recovery/fartlek → banda "fácil"; tempo / interval según tipo. */



/** Sesiones para "Ver plan": plan completo en `plan_sessions` (o alias) si hay más filas que en `preview_workouts`. */

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


const pushBodySnippet = (text, max = 400) => {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
};

async function sendChatPushNotification({ token, title, body, data = null, logLabel = "chat push" }) {
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








const getCurrentMonthKey = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
};

async function loadAthleteAchievementSnapshot(athleteId) {
  if (!athleteId) return { achievements: [], earned: [] };
  try {
    const res = await fetch(`/api/achievements?athlete_id=${encodeURIComponent(String(athleteId))}`);
    const json = await res.json();
    if (!res.ok) {
      console.warn("loadAthleteAchievementSnapshot", json);
      return { achievements: [], earned: [] };
    }
    const catalogRaw = json.all;
    const earnedRaw = json.earned;
    const achievements = Array.isArray(catalogRaw) ? catalogRaw.filter((row) => row && typeof row.code === "string") : [];
    const earned = Array.isArray(earnedRaw) ? earnedRaw.filter((row) => row && typeof row.achievement_code === "string") : [];
    return { achievements, earned };
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


/** YYYY-MM-DD desde componentes locales (celdas del calendario); evita desfaces vs strings ISO del workout. */

/** Normaliza scheduled_date del workout a YYYY-MM-DD sin depender de Date cuando ya viene como fecha. */



/** Primer día del mes siguiente (YYYY-MM-DD, calendario local). */

/** Último día del mes siguiente (YYYY-MM-DD, calendario local). */

/** Lunes a domingo de la próxima semana (respecto a hoy), calendario local. */

/** Suma de minutos → texto legible (horas y minutos). */

/** Lunes de la semana que contiene el primer día del mes */

/** 42 celdas (6 semanas), vista mensual */






/** Carreras con fecha >= todayYmd, la primera es la más próxima */


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




/** Emoji por banda RPE (1–10). */
const rpeBandMeta = (rpe) => {
  if (rpe == null || rpe < 1 || rpe > 10) return { emoji: "", label: "" };
  if (rpe <= 3) return { emoji: "😌", label: "Muy fácil" };
  if (rpe <= 5) return { emoji: "🙂", label: "Moderado" };
  if (rpe <= 7) return { emoji: "😤", label: "Duro" };
  if (rpe <= 9) return { emoji: "😰", label: "Muy duro" };
  return { emoji: "🔥", label: "Máximo" };
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
    distance_km: Number.isFinite(Number(row.distance_km))
      ? Number(row.distance_km)
      : Number.isFinite(Number(row.total_km))
        ? Number(row.total_km)
        : 0,
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


/** Convierte structure del workout a filas editables (fases). */

/** Filas del formulario → JSON guardado en workouts.structure */



const fitTitleKeywords = {
  tempo: /\btempo\b/i,
  interval: /\b(interval|intervalos|repeats?|series)\b/i,
};

const getFitAvgSpeedChanges = (records) => {
  const speeds = (Array.isArray(records) ? records : [])
    .map((r) => Number(r?.enhanced_speed ?? r?.speed))
    .filter((s) => Number.isFinite(s) && s > 0);
  if (speeds.length < 3) return 0;
  let changes = 0;
  for (let i = 1; i < speeds.length; i += 1) {
    const prev = speeds[i - 1];
    const curr = speeds[i];
    if (prev <= 0 || curr <= 0) continue;
    const delta = Math.abs(curr - prev) / prev;
    if (delta >= 0.15) changes += 1;
  }
  return changes;
};

const mapFitWorkoutType = ({ sport, title, speedChanges, durationMin, distanceKm }) => {
  const sportKey = String(sport || "").toLowerCase();
  const safeTitle = String(title || "").trim();
  const hasTempoWord = fitTitleKeywords.tempo.test(safeTitle);
  const hasIntervalWord = fitTitleKeywords.interval.test(safeTitle);
  const isIntervalBySpeed = Number(speedChanges) > 3;
  const isLong = Number(durationMin) >= 80 || Number(distanceKm) >= 14;
  if (sportKey === "running") {
    if (hasTempoWord) return "tempo";
    if (hasIntervalWord || isIntervalBySpeed) return "interval";
    if (isLong) return "long";
    return "easy";
  }
  if (sportKey === "walking") return "recovery";
  return "easy";
};



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


/** Admin plataforma (Coaches, biblioteca global, prioridad en directorio). */

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
  { id: "training", icon: "💪", label: "Entrenamientos", shortLabel: "Entreno", color: "#ea580c" },
  { id: "library", icon: "◈", label: "Biblioteca", shortLabel: "Biblio", color: "#6366f1" },
  { id: "marketplace", icon: "🛒", label: "Marketplace", shortLabel: "Market", color: "#0ea5e9" },
];

const COACH_SUBSCRIPTION_NEQUI = "3233675434";
const COACH_SUBSCRIPTION_WA_E164 = "573233675434";
const TAB_KEY_ATHLETES = "raf_tab_atletas";
const TAB_KEY_TRAINING = "raf_tab_entrenamientos";

const TAB_KEY_CREATE_WORKOUT = "raf_tab_crear_workout";


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

  const readStoredTab = useCallback((key, allowed, fallback) => {
    if (typeof window === "undefined") return fallback;
    const saved = localStorage.getItem(key);
    return saved && allowed.has(saved) ? saved : fallback;
  }, []);
  const writeStoredTab = useCallback((key, value) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, value);
  }, []);
  const getAthletesViewFromTab = useCallback((tab) => {
    if (tab === "evaluacion") return "evaluation";
    if (tab === "retos") return "challenges";
    return "athletes";
  }, []);
  const getAthletesTabFromView = useCallback((v) => {
    if (v === "evaluation") return "evaluacion";
    if (v === "challenges") return "retos";
    return "lista";
  }, []);
  const getTrainingViewFromTab = useCallback((tab) => (tab === "crear_workout" ? "builder" : "plan12"), []);
  const getTrainingTabFromView = useCallback((v) => (v === "builder" ? "crear_workout" : "plan_2_semanas"), []);

  const notify = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const syncFcmTokenToProfile = useCallback(async () => {
    try {
      const uid = session?.user?.id;
      if (!uid) {
        return;
      }
      const token = await requestNotificationPermission();
      if (!token) {
        return;
      }
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
    items.push({ id: "settings", icon: "⚙", label: "Configuración", shortLabel: "Ajustes", color: "#64748b" });
    const em = session?.user?.email?.toLowerCase();
    if (role === "admin" || em === ADMIN_EMAIL) {
      items.push({ id: "admin", icon: "🔐", label: "Admin", shortLabel: "Admin", color: "#7c3aed" });
    }
    return items;
  }, [profile?.role, session?.user?.email]);
  const allowedCoachViews = useMemo(() => {
    const hiddenViews = ["evaluation", "plan12", "builder", "challenges", "plans"];
    return new Set([...coachNavItems.map((item) => item.id), ...hiddenViews]);
  }, [coachNavItems]);

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

  /** Código que el atleta puede ingresar al registrarse (coincide con `profiles.coach_id` o derivado del user_id). */
  const inviteCoachPublicCode = useMemo(() => {
    const raw = String(profile?.coach_id || "").trim();
    if (raw && !raw.includes("-")) return raw.toUpperCase();
    return coachCodeFromId(session?.user?.id);
  }, [profile?.coach_id, session?.user?.id, coachCodeFromId]);

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
      const codeHtml = `<p style="margin:12px 0"><strong>Tu código de coach</strong> (si te registras sin abrir el enlace): <code style="background:#f1f5f9;padding:4px 8px;border-radius:6px">${inviteCoachPublicCode}</code></p><p style="font-size:14px;color:#64748b">El atleta usará este código al registrarse.</p>`;
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          subject: "Invitación para entrenar en RunningApexFlow",
          html: `<div style="font-family:Arial,sans-serif"><h2>¡Tu coach te invitó! 🏃</h2><p>Haz clic aquí para registrarte y vincularte automáticamente:</p><p><a href="${inviteLink}">${inviteLink}</a></p>${codeHtml}</div>`,
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
  }, [inviteEmail, inviteCoachPublicCode, notify, session?.user?.id]);

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
          setProfile(await syncCoachPlanIfNeeded(saved));
        }
      } else {
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
    if (view === "admin-coaches") {
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
    if (view === "athletes" || view === "evaluation" || view === "challenges") {
      writeStoredTab(TAB_KEY_ATHLETES, getAthletesTabFromView(view));
    }
    if (view === "plan12" || view === "builder" || view === "training") {
      writeStoredTab(TAB_KEY_TRAINING, getTrainingTabFromView(view));
    }
  }, [view, writeStoredTab, getAthletesTabFromView, getTrainingTabFromView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("strava_code");
    const athleteIdFromState = params.get("state");
    if (!code) return;
    const currentAthlete =
      (athleteIdFromState
        ? (athletes || []).find((a) => String(a.id) === String(athleteIdFromState))
        : null) ||
      selectedAthlete ||
      (athletes || [])[0] ||
      null;
    if (!currentAthlete?.id) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/strava?code=${encodeURIComponent(code)}`);
        const data = await r.json();
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
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user) {
          console.error("Error obteniendo usuario para filtrar atletas:", userError);
          notify("Error cargando atletas");
          setAthletes([]);
          throw new Error("No user");
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
      } catch (error) {
        console.error("Error inesperado cargando atletas:", error);
        notify("Error cargando atletas");
        setAthletes([]);
      } finally {
        setLoadingAthletes(false);
      }
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
      if (authRole === "athlete" && !authCoachCode.trim()) {
        setAuthError("Debes ingresar el código de tu coach para registrarte como atleta");
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
          alert("Registro exitoso. Revisa tu correo si la verificación está habilitada.");
          setAuthMode("login");
          setAuthLandingStep("login");
          return;
        }

        let linkedCoachId = null;
        let inviteRow = null;
        const hasInviteCode = Boolean(inviteCodeFromUrl);
        const hasManualCoachCode = Boolean(authCoachCode.trim());
        if (hasInviteCode) {
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
        } else if (hasManualCoachCode) {
          const coachIdFromCode = await resolveCoachIdByCode(authCoachCode);
          if (!coachIdFromCode) {
            alert("No encontramos un coach con ese código.");
            setAuthSubmitting(false);
            return;
          }
          linkedCoachId = coachIdFromCode;
        }

        const roleForProfile = linkedCoachId ? "athlete" : "coach";
        const nowIso = new Date().toISOString();
        const profilePayload =
          roleForProfile === "coach"
            ? {
                user_id: newUserId,
                role: "coach",
                coach_id: newUserId,
                name: authName.trim(),
                plan_status: "trial",
                trial_started_at: nowIso,
              }
            : {
                user_id: newUserId,
                role: "athlete",
                coach_id: linkedCoachId,
                name: authName.trim(),
              };

        const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
        if (profileError) {
          console.error("Error insertando en profiles:", profileError, { profilePayload });
        } else {
          if (roleForProfile === "athlete") {
            setProfile({ user_id: newUserId, role: "athlete", name: authName.trim() });
          }
          await syncFcmTokenToProfile();
        }

        if (roleForProfile === "coach" || authRole === "admin") {
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

        if (roleForProfile === "athlete") {
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
                        onChange={(e) => {
                          setAuthCoachCode(e.target.value.toUpperCase());
                          if (authError) setAuthError("");
                        }}
                        placeholder="Ej: B5C9E44A"
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
                    {authSubmitting
                      ? "Procesando…"
                      : authRole === "athlete"
                        ? "Crear cuenta como Atleta"
                        : authRole === "coach"
                          ? "Crear cuenta como Coach"
                          : "Crear cuenta"}
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
    return (
      <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}><p>Cargando...</p></div>}>
        <AthleteHome profile={profile} />
      </Suspense>
    );
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
    if (id === "athletes") {
      const athletesTab = readStoredTab(TAB_KEY_ATHLETES, new Set(["lista", "evaluacion", "retos"]), "lista");
      setView(getAthletesViewFromTab(athletesTab));
      setShowAddAthleteForm(false);
      return;
    }
    if (id === "training") {
      const trainingTab = readStoredTab(TAB_KEY_TRAINING, new Set(["plan_2_semanas", "crear_workout"]), "plan_2_semanas");
      setView(getTrainingViewFromTab(trainingTab));
      setShowAddAthleteForm(false);
      return;
    }
    setView(id);
    setShowAddAthleteForm(false);
  };

  const selectAthletesTab = (tab) => {
    writeStoredTab(TAB_KEY_ATHLETES, tab);
    setView(getAthletesViewFromTab(tab));
  };

  const selectTrainingTab = (tab) => {
    writeStoredTab(TAB_KEY_TRAINING, tab);
    setView(getTrainingViewFromTab(tab));
  };

  return (
    <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}><p>Cargando...</p></div>}>
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
            <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 14, marginBottom: 4 }}>Código coach</div>
            <input
              type="text"
              readOnly
              value={inviteCoachPublicCode}
              aria-readonly="true"
              style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "ui-monospace,monospace", fontSize: ".9em", fontWeight: 700, boxSizing: "border-box" }}
            />
            <div style={{ fontSize: ".72em", color: "#94a3b8", marginTop: 6, lineHeight: 1.45 }}>El atleta usará este código al registrarse.</div>
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
          {coachNavItems.map((item) => {
            const active =
              view === item.id ||
              (item.id === "athletes" && (view === "evaluation" || view === "challenges")) ||
              (item.id === "training" && (view === "plan12" || view === "builder"));
            return (
            <button
              key={item.id}
              type="button"
              onClick={() => goCoachView(item.id)}
              style={{ ...S.navBtn, ...(active ? S.navBtnActive : {}) }}
            >
              <span style={{ fontSize: "1.15em", color: item.color, width: 22, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
            );
          })}
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
        {(view === "athletes" || view === "evaluation" || view === "challenges") && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 16px 10px" }}>
              <button type="button" onClick={() => selectAthletesTab("lista")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "athletes" ? "rgba(59,130,246,.12)" : "#fff", color: view === "athletes" ? "#1d4ed8" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>👥 Lista atletas</button>
              <button type="button" onClick={() => selectAthletesTab("evaluacion")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "evaluation" ? "rgba(14,165,233,.12)" : "#fff", color: view === "evaluation" ? "#0369a1" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📊 Evaluación</button>
              <button type="button" onClick={() => selectAthletesTab("retos")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "challenges" ? "rgba(168,85,247,.12)" : "#fff", color: view === "challenges" ? "#7e22ce" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🏆 Retos</button>
            </div>
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
            {view === "challenges" && (
              <ChallengesHub
                profileRole={profile?.role ?? ""}
                currentUserId={sessionUserId || null}
                athleteId={null}
                workouts={[]}
                coachAthletes={athletes}
                notify={notify}
                styles={styles}
                normalizeWorkoutRow={normalizeWorkoutRow}
              />
            )}
          </>
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
            styles={styles}
          />
        )}
        {view === "admin" && (profile?.role === "admin" || sessionEmailLower === ADMIN_EMAIL) && (
          <AdminPanel notify={notify} adminUserId={PLATFORM_ADMIN_USER_ID} />
        )}
        {(view === "plan12" || view === "builder" || view === "training") && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 16px 10px" }}>
              <button type="button" onClick={() => selectTrainingTab("plan_2_semanas")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: (view === "plan12" || view === "training") ? "rgba(139,92,246,.12)" : "#fff", color: (view === "plan12" || view === "training") ? "#6d28d9" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◇ Plan 2 Semanas</button>
              <button type="button" onClick={() => selectTrainingTab("crear_workout")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "builder" ? "rgba(234,88,12,.12)" : "#fff", color: view === "builder" ? "#c2410c" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◎ Crear Workout con IA</button>
            </div>
            {(view === "plan12" || view === "training") && (
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
          </>
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
            onOpenAdminMarketplaceDraft={() => setView("admin")}
            onAfterLibraryImportSuccess={() => {
              setView("library");
              try {
                if (typeof window !== "undefined") localStorage.setItem("raf_lastView", "library");
              } catch {
                /* ignore */
              }
              setLibraryRefresh((r) => r + 1);
            }}
            notify={notify}
            styles={styles}
            MarketplacePlanWorkoutsAccordion={MarketplacePlanWorkoutsAccordion}
            sendWorkoutAssignmentPushToAthlete={sendWorkoutAssignmentPushToAthlete}
          />
        )}
        {view === "marketplace" && (
          <MarketplaceHub
            profileRole={profile?.role ?? ""}
            currentUserId={sessionUserId || null}
            coachUserId={sessionUserId || null}
            notify={notify}
            styles={styles}
            MarketplacePlanWorkoutsAccordion={MarketplacePlanWorkoutsAccordion}
          />
        )}
          </>
        )}
      </main>

      <nav className="pf-bottom-nav" aria-label="Navegación principal">
        {coachNavItems.map((item) => {
          const active =
            view === item.id ||
            (item.id === "athletes" && (view === "evaluation" || view === "challenges")) ||
            (item.id === "training" && (view === "plan12" || view === "builder"));
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
    </Suspense>
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
  const [coachAthleteEvaluations, setCoachAthleteEvaluations] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
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

  useEffect(() => {
    if (!athlete?.id) {
      setCoachAthleteEvaluations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("athlete_evaluations")
        .select("vdot, created_at")
        .eq("athlete_id", athlete.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) console.warn("athlete_evaluations (coach):", error);
      setCoachAthleteEvaluations(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [athlete?.id]);

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

  const coachAchievementDisplayProgress = useMemo(
    () => computeAthleteAchievementVisualProgress(workouts, coachAthleteEvaluations),
    [workouts, coachAthleteEvaluations],
  );
  const coachEarnedAchievementDateByCode = useMemo(() => {
    const m = {};
    for (const row of earnedAchievements || []) {
      const code = String(row?.achievement_code || "");
      if (!code) continue;
      if (!m[code]) m[code] = row?.awarded_at || null;
    }
    return m;
  }, [earnedAchievements]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athlete?.id) {
        setEarnedAchievements([]);
        return;
      }
      const snapshot = await loadAthleteAchievementSnapshot(athlete.id);
      if (cancelled) return;
      setEarnedAchievements(snapshot.earned || []);
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
      const { newAwards, snapshot } = await evaluateAndAwardAthleteAchievements(athlete.id);
      setEarnedAchievements(snapshot.earned || []);
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
      const athleteUserId = athlete.user_id;
      let recipientFcmToken = null;
      if (athleteUserId) {
        const { data: prow } = await supabase.from("profiles").select("fcm_token").eq("user_id", athleteUserId).maybeSingle();
        recipientFcmToken = prow?.fcm_token ?? null;
      } else {
      }
      if (recipientFcmToken == null || String(recipientFcmToken).trim() === "") {
      }
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
            <div style={{ ...S.card }}>
              <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>LOGROS DEL ATLETA</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12 }}>
                {ATHLETE_ACHIEVEMENT_DISPLAY_LIST.map((a) => {
                  const currentValue = Number(coachAchievementDisplayProgress?.[a.metric] || 0);
                  const progressRatio = a.target > 0 ? Math.min(1, currentValue / a.target) : 0;
                  const progressPct = Math.round(progressRatio * 100);
                  const awardedAt = (a.codes || []).map((code) => coachEarnedAchievementDateByCode[code]).find(Boolean) || null;
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

/** Acordeón por semana para preview_workouts (modal Marketplace y Biblioteca admin). */
function MarketplacePlanWorkoutsAccordion({ previewWorkouts, resetKey, lockAfterWeek1 = false }) {
  const list = Array.isArray(previewWorkouts) ? previewWorkouts : [];
  const weekGroups = useMemo(() => {
    const arr = Array.isArray(previewWorkouts) ? previewWorkouts : [];
    const groups = new Map();
    for (let i = 0; i < arr.length; i++) {
      const w = arr[i];
      const wn = w?.week != null && w.week !== "" ? Number(w.week) : NaN;
      const key = Number.isFinite(wn) && wn > 0 ? wn : 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ w, i });
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 0) return 1;
      if (b[0] === 0) return -1;
      return a[0] - b[0];
    });
  }, [previewWorkouts]);

  const week1Groups = useMemo(() => weekGroups.filter(([k]) => k === 1), [weekGroups]);
  const lockedWeekGroups = useMemo(() => weekGroups.filter(([k]) => k !== 1), [weekGroups]);

  const [openWeeks, setOpenWeeks] = useState(() => new Set([1]));

  useEffect(() => {
    const arr = Array.isArray(previewWorkouts) ? previewWorkouts : [];
    const weekNums = [
      ...new Set(
        arr
          .map((w) => (w?.week != null && w.week !== "" ? Number(w.week) : NaN))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ].sort((a, b) => a - b);
    const defaultW = lockAfterWeek1 ? 1 : weekNums.includes(1) ? 1 : weekNums.length ? weekNums[0] : 1;
    setOpenWeeks(new Set([defaultW]));
  }, [resetKey, previewWorkouts, lockAfterWeek1]);

  const renderSessionCard = (w, i, weekKey) => {
    const struct = w.workout_structure || w.structure;
    const hasStructure = Array.isArray(struct) && struct.length > 0;
    const km =
      w.distance_km != null && w.distance_km !== "" && Number.isFinite(Number(w.distance_km))
        ? Number(w.distance_km)
        : w.total_km != null && w.total_km !== ""
          ? Number(w.total_km)
          : null;
    const mins = w.duration_min != null && w.duration_min !== "" ? Number(w.duration_min) : null;
    const metaParts = [];
    if (w.pace_range != null && String(w.pace_range).trim() !== "") metaParts.push(`${String(w.pace_range).trim()} min/km`);
    if (km != null && Number.isFinite(km)) metaParts.push(`${km} km`);
    if (mins != null && Number.isFinite(mins)) metaParts.push(`${mins} min`);
    return (
      <div
        key={w.id != null ? String(w.id) : `wk-${weekKey}-row-${i}`}
        style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#fff" }}
      >
        <div style={{ fontWeight: 800, fontSize: ".85em" }}>
          {w.day ? `${w.day} · ` : ""}
          {w.title || `Sesión ${i + 1}`}
        </div>
        {w.description ? <div style={{ fontSize: ".78em", color: "#475569", marginTop: 4, lineHeight: 1.4 }}>{w.description}</div> : null}
        {metaParts.length > 0 ? <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 4 }}>{metaParts.join(" · ")}</div> : null}
        {hasStructure ? (
          <div style={{ marginTop: 6 }}>
            <WorkoutStructureTable structure={struct} />
          </div>
        ) : null}
      </div>
    );
  };

  if (list.length === 0) {
    return <div style={{ color: "#94a3b8", fontSize: ".82em", marginBottom: 12 }}>No hay muestra de workouts.</div>;
  }

  const headerBtnStyle = {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    border: "none",
    background: "#fff",
    fontWeight: 800,
    fontSize: ".82em",
    color: "#0f172a",
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxSizing: "border-box",
  };

  const renderInteractiveWeek = ([weekKey, items]) => {
    const open = openWeeks.has(weekKey);
    const label = weekKey === 0 ? "Sin número de semana" : `Semana ${weekKey}`;
    return (
      <div key={weekKey} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() =>
            setOpenWeeks((prev) => {
              if (prev.has(weekKey) && prev.size === 1) return new Set();
              return new Set([weekKey]);
            })
          }
          style={{
            ...headerBtnStyle,
            background: open ? "#f1f5f9" : "#fff",
          }}
        >
          <span>
            {label}
            <span style={{ fontWeight: 600, color: "#64748b", marginLeft: 6 }}>
              ({items.length} {items.length === 1 ? "sesión" : "sesiones"})
            </span>
          </span>
          <span style={{ fontSize: ".75em", color: "#64748b" }}>{open ? "▾" : "▸"}</span>
        </button>
        {open ? (
          <div style={{ padding: "8px 10px 10px", background: "#fafafa", display: "grid", gap: 8 }}>
            {items.map(({ w, i }) => renderSessionCard(w, i, weekKey))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderLockedWeek = ([weekKey, items]) => {
    const label = weekKey === 0 ? "Sin número de semana" : `Semana ${weekKey}`;
    return (
      <div key={`locked-${weekKey}`} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginTop: 6 }}>
        <div
          style={{
            ...headerBtnStyle,
            background: "#f8fafc",
            cursor: "default",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <span>
            {label}
            <span style={{ marginLeft: 8 }} aria-hidden="true">
              🔒
            </span>
            <span style={{ fontWeight: 600, color: "#64748b", marginLeft: 6 }}>
              ({items.length} {items.length === 1 ? "sesión" : "sesiones"})
            </span>
          </span>
        </div>
        <div style={{ position: "relative", background: "#fafafa" }}>
          <div style={{ padding: "8px 10px 10px", display: "grid", gap: 8, filter: "blur(3px)", userSelect: "none", pointerEvents: "none" }}>
            {items.map(({ w, i }) => renderSessionCard(w, i, weekKey))}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(248,250,252,0.82)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              pointerEvents: "auto",
            }}
            aria-hidden="true"
          />
        </div>
      </div>
    );
  };

  if (lockAfterWeek1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        <div style={{ fontSize: ".72em", fontWeight: 800, color: "#0369a1", marginBottom: 2 }}>Muestra gratuita · Semana 1</div>
        {week1Groups.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: ".82em", padding: "10px 12px", border: "1px dashed #cbd5e1", borderRadius: 10, background: "#fff" }}>
            No hay sesiones numeradas como semana 1 en esta vista previa.
          </div>
        ) : (
          week1Groups.map(renderInteractiveWeek)
        )}
        {lockedWeekGroups.length > 0 ? (
          <>
            <div style={{ fontSize: ".72em", fontWeight: 800, color: "#64748b", marginTop: 8, marginBottom: 2 }}>Resto del plan</div>
            {lockedWeekGroups.map(renderLockedWeek)}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      {weekGroups.map(renderInteractiveWeek)}
    </div>
  );
}

function AdminPanel({ notify, adminUserId }) {
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
        <button type="button" onClick={() => setAdminTab("coaches")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "coaches" ? "rgba(99,102,241,.12)" : "#fff", color: adminTab === "coaches" ? "#4338ca" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>👥 Coaches</button>
      </div>
      {adminTab === "promo" ? (
        <AdminPromoCodes notify={notify} />
      ) : adminTab === "marketplace" ? (
        <AdminMarketplacePanel notify={notify} styles={styles} />
      ) : (
        <AdminCoachesProfilesPanel notify={notify} adminUserId={adminUserId} />
      )}
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


