import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import WeatherWidget, { useWeather } from "./WeatherWidget";
import InstallAppButton from "./InstallAppButton";
import CoachLinkActions from "./AthleteHome/CoachLinkActions";
import AchievementsGrid from "./AthleteHome/AchievementsGrid";
import AthleteFormaFatigaPanel from "./AthleteHome/AthleteFormaFatigaPanel";
import { AthleteHomeProgress, AthleteWeeklyStrip, AthleteMonthSummary } from "./AthleteHome/AthleteProgressPanel";
import AthletePaymentsView from "./AthleteHome/AthletePaymentsView";
import { useAthleteSideChat } from "./AthleteHome/useAthleteSideChat";
import AthleteChatSheet from "./AthleteHome/AthleteChatSheet";
import AthleteSettingsPanel, { useCoachDirectory, AthleteProfileSessionFooter } from "./AthleteHome/AthleteSettingsPanel";
import { useAthleteWorkoutOverlays } from "./AthleteHome/useAthleteWorkoutOverlays";
import AthleteWorkoutOverlays from "./AthleteHome/AthleteWorkoutOverlays";
import {
  formatLocalYMD,
  calendarCellToIsoYmd,
  getMonthGrid,
  cellIsInViewMonth,
  normalizeAthlete,
  DAYS,
  WORKOUT_TYPES,
  getRaceCountdownText,
  achievementJoinMeta,
  computeAchievementProgress,
  loadAthleteAchievementSnapshot,
  evaluateAndAwardAthleteAchievements,
  clampWorkoutRpe,
  normalizeWorkoutRow,
  resolveCoachUserIdFromPublicCode,
  resolveDefaultCoachUserId,
  sendChatPushNotification,
  notifyCoachWorkoutCompletedFromClient,
  registerFcmToken,
  normalizeScheduledDateYmd,
  normalizeWorkoutStructure,
  emptyWorkoutStructureRow,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  normalizeLibraryRow,
  libraryRowToBuilderWorkout,
  challengeHasOpenTarget,
  challengeValueLabel,
  challengeProgressLabel,
  challengeProgressOpenText,
  formatChallengeMetricValue,
  challengeUnitByType,
  computeWorkoutDayStreak,
  computeChallengeProgressForAthlete,
  getNextRaceCountdown,
  normalizeRaceRow,
  extractJsonFromAnthropicText,
  RACE_DISTANCE_PRESETS,
  raceDistanceToFormFields,
  TAB_KEY_LIBRARY,
  CHALLENGE_TYPE_OPTIONS,
  normalizeChallengeType,
} from "./shared/appShared";

/** Campos reales de public.workouts que AthleteHome / normalizeWorkoutRow leen.
 *  No incluir distance_km: esa columna no existe (PostgREST 400 y se vacía la lista). */
const ATHLETE_HOME_WORKOUT_COLUMNS = [
  "id",
  "athlete_id",
  "coach_id",
  "created_at",
  "scheduled_date",
  "type",
  "title",
  "total_km",
  "duration_min",
  "description",
  "structure",
  "done",
  "rpe",
  "manual_distance_km",
  "manual_duration_min",
  "manual_avg_hr",
  "manual_max_hr",
  "manual_calories",
  "athlete_notes",
  "completed_at",
  "actual_distance_km",
  "actual_duration_min",
  "actual_avg_pace_s",
  "actual_avg_hr",
  "actual_max_hr",
  "actual_elevation_m",
  "actual_synced_at",
  "intervals_activity_id",
].join(",");

const FEELING_CHOICES = ["😴 Muy cansado", "😕 Cansado", "😐 Normal", "🙂 Bien", "💪 Excelente"];

function stripFeelingLines(notes) {
  return String(notes || "").replace(/^Cómo me sentí:\s*.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function feelingFromNotes(notes) {
  const matches = [...String(notes || "").matchAll(/^Cómo me sentí:\s*(.+)$/gm)];
  const raw = matches.at(-1)?.[1]?.trim();
  return FEELING_CHOICES.includes(raw) ? raw : "😐 Normal";
}

function composeAthleteNotes(feelingText, notes) {
  const feeling = FEELING_CHOICES.includes(feelingText) ? feelingText : "😐 Normal";
  const body = stripFeelingLines(notes);
  return [`Cómo me sentí: ${feeling}`, body].filter(Boolean).join("\n");
}

import { refreshFcmTokenIfGranted } from "../firebase.js";
import { Capacitor } from "@capacitor/core";
import { registerNativePush, consumePendingDeepLink, subscribeDeepLink } from "../lib/nativePush";
import { useAppResumeRefresh } from "../hooks/useAppResumeRefresh";
import { setResumeUiBusy } from "../lib/resumeGuard";
import WorkoutDetailBreakdown from "./WorkoutDetailBreakdown";

const ChallengesHub = lazy(() => import("./ChallengesHub"));
const MarketplaceHub = lazy(() => import("./MarketplaceHub"));
const EvaluationView = lazy(() => import("./EvaluationView"));

const RAF_ATHLETE_NAV_TAB_KEY = "raf_athlete_tab";
const RAF_ATHLETE_EVAL_OPEN_KEY = "raf_athlete_eval_open";
const ATHLETE_NAV_TAB_IDS = ["home", "marketplace", "challenges", "eval", "profile"];

function readStoredAthleteNavTab() {
  if (typeof localStorage === "undefined") return "home";
  const raw = localStorage.getItem(RAF_ATHLETE_NAV_TAB_KEY);
  if (raw && ATHLETE_NAV_TAB_IDS.includes(raw)) return raw;
  return "home";
}

const RAF_ATHLETE_PROFILE_TAB_KEY = "raf_athlete_profile_tab";
const ATHLETE_PROFILE_TAB_IDS = ["logros", "forma", "mes", "config", "pagos"];
function readStoredAthleteProfileTab() {
  if (typeof localStorage === "undefined") return "logros";
  const raw = localStorage.getItem(RAF_ATHLETE_PROFILE_TAB_KEY);
  if (raw && ATHLETE_PROFILE_TAB_IDS.includes(raw)) return raw;
  return "logros";
}

const styles = {
  // maxWidth 100% + overflowX hidden: el coach contiene el overflow en <main overflowY:auto>;
  // el atleta no tiene ese main, y sin esto el grid 7-col (chips nowrap) ensancha el documento y desplaza Lun fuera de vista.
  page: { padding: "28px 32px", maxWidth: 1120, width: "100%", margin: "0 auto", boxSizing: "border-box", overflowX: "hidden", minWidth: 0 },
  pageTitle: { fontSize: "1.65em", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" },
  card: {
    background: "#ffffff",
    border: "1px solid #f1f5f9",
    borderRadius: 12,
    padding: 22,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
};

export default function AthleteHome({ profile }) {
  const S = styles;
  const EMPTY_ARRAY = useMemo(() => [], []);
  const notifyCallback = useCallback((msg) => setMessage(msg), []);
  // Aviso pasajero para las push que llegan con la app abierta: se borra solo,
  // y solo si sigue siendo el mismo texto (no pisa un mensaje posterior).
  const notifyPush = useCallback((msg) => {
    setMessage(msg);
    setTimeout(() => setMessage((cur) => (cur === msg ? "" : cur)), 4200);
  }, []);
  const normalizeWorkoutRowStable = useCallback(normalizeWorkoutRow, []);
  const [athleteInfo, setAthleteInfo] = useState(null);
  const [authFullName, setAuthFullName] = useState("");
  const [coachName, setCoachName] = useState(null);
  const [coachAvatarUrl, setCoachAvatarUrl] = useState("");
  // Se guarda la URL que fallo, no un booleano, para que una foto nueva vuelva
  // a intentarse en vez de quedarse con el emoji.
  const [coachAvatarFailedUrl, setCoachAvatarFailedUrl] = useState("");
  const [coachCodeInput, setCoachCodeInput] = useState("");
  const [coachCodeSaving, setCoachCodeSaving] = useState(false);
  const [coachCodeMsg, setCoachCodeMsg] = useState("");
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [athleteNotRegistered, setAthleteNotRegistered] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [athleteActiveTab, setAthleteActiveTab] = useState(() => readStoredAthleteNavTab());
  const [athleteProfileTab, setAthleteProfileTab] = useState(() => readStoredAthleteProfileTab());
  const [athleteChatOpen, setAthleteChatOpen] = useState(false);
  const [athleteTabRestored, setAthleteTabRestored] = useState(false);
  const [achievementsCatalog, setAchievementsCatalog] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [achProgress, setAchProgress] = useState(null);
  const [athleteEvaluations, setAthleteEvaluations] = useState([]);
  const [medalToast, setMedalToast] = useState("");
  const [pushInviteDismissed, setPushInviteDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("raf_push_invite_dismissed") === "1",
  );
  const [athleteCalendarCtxMenu, setAthleteCalendarCtxMenu] = useState(null);
  const athleteCalendarCtxMenuRef = useRef(null);
  const toggleDoneBusyIdRef = useRef(null);
  const { weather, getWorkoutWeatherNote } = useWeather();
  const [intervalsConnected, setIntervalsConnected] = useState(false);
  const [intervalsRefreshNonce, setIntervalsRefreshNonce] = useState(0);
  const [forceManualFields, setForceManualFields] = useState(false);
  const [findCoachCodeInput, setFindCoachCodeInput] = useState("");
  const [findCoachCodeBusy, setFindCoachCodeBusy] = useState(false);
  const [coachRequestBusy, setCoachRequestBusy] = useState(false);
  const [coachRequestPending, setCoachRequestPending] = useState(false);
  const [coachRequestMsg, setCoachRequestMsg] = useState("");
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
    let evalOpen = localStorage.getItem(RAF_ATHLETE_EVAL_OPEN_KEY);
    if (evalOpen == null) {
      const legacy = localStorage.getItem(RAF_ATHLETE_NAV_TAB_KEY);
      if (legacy === "evaluation" || legacy === "home") {
        localStorage.setItem(RAF_ATHLETE_EVAL_OPEN_KEY, legacy);
        evalOpen = legacy;
        if (legacy === "evaluation") {
          localStorage.setItem(RAF_ATHLETE_NAV_TAB_KEY, "home");
        }
      }
    }
    if (evalOpen === "evaluation") setShowEvaluation(true);
    if (evalOpen === "home") setShowEvaluation(false);
    setAthleteTabRestored(true);
  }, []);

  useEffect(() => {
    if (!athleteTabRestored || typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_EVAL_OPEN_KEY, showEvaluation ? "evaluation" : "home");
  }, [showEvaluation, athleteTabRestored]);

  useEffect(() => {
    if (!athleteTabRestored) return undefined;
    if (typeof document === "undefined" || typeof localStorage === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      localStorage.setItem(RAF_ATHLETE_EVAL_OPEN_KEY, showEvaluation ? "evaluation" : "home");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [showEvaluation, athleteTabRestored]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_PROFILE_TAB_KEY, athleteProfileTab);
  }, [athleteProfileTab]);

  // Tras OAuth de intervals.icu el callback vuelve con ?tab=profile&profile_tab=config
  // (y ?intervals=...) para mostrar IntervalsConnect y el aviso del reloj.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab !== "profile") return;
    setAthleteActiveTab("profile");
    const profileTab = params.get("profile_tab");
    if (profileTab && ATHLETE_PROFILE_TAB_IDS.includes(profileTab)) {
      setAthleteProfileTab(profileTab);
    }
    params.delete("tab");
    params.delete("profile_tab");
    // Dejar ?intervals=... para que IntervalsConnect muestre el banner.
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  const prevProfileUserIdRef = useRef(null);

  /**
   * Trae y normaliza los workouts del atleta.
   *
   * SILENCIOSA a proposito: no toca setLoading ni la pestaña abierta, porque
   * tambien corre al volver a la app y taparle la pantalla al atleta cada vez
   * que sale y entra seria peor que no refrescar.
   *
   * Si la consulta falla NO vacia la lista: quedarse con lo ultimo bueno es
   * mejor que dejar el calendario en blanco por un fallo de red.
   *
   * @returns {Promise<{ok: boolean, rows: Array|null}>}
   */
  const refreshWorkouts = useCallback(async (athleteId) => {
    if (!athleteId) return { ok: false, rows: null };
    const { data, error } = await supabase
      .from("workouts")
      .select(ATHLETE_HOME_WORKOUT_COLUMNS)
      .eq("athlete_id", athleteId)
      .order("scheduled_date", { ascending: true });
    if (error) {
      console.error("Error cargando workouts atleta:", error);
      return { ok: false, rows: null };
    }
    const rows = (data || []).map(normalizeWorkoutRow);
    setWorkouts(rows);
    return { ok: true, rows };
  }, []);

  useEffect(() => {
    if (profileUserId == null) {
      prevProfileUserIdRef.current = null;
      setAthleteInfo(null);
      setWorkouts([]);
      setAthleteEvaluations([]);
      setLoading(false);
      return;
    }
    if (prevProfileUserIdRef.current === profileUserId) return;
    let cancelled = false;
    const markInitialLoadFinished = () => { if (!cancelled) prevProfileUserIdRef.current = profileUserId; };
    const load = async () => {
      setLoading(true);
      setMessage("");
      setAthleteNotRegistered(false);
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (cancelled) return;
      const metaName =
        (typeof authData?.user?.user_metadata?.full_name === "string" &&
          authData.user.user_metadata.full_name.trim()) ||
        "";
      if (!cancelled) setAuthFullName(metaName);
      const userEmail = authData?.user?.email?.trim();
      if (authErr || !userEmail) {
        console.error("Error obteniendo sesión:", authErr);
        setAthleteInfo(null); setWorkouts([]); setAthleteEvaluations([]); setLoading(false);
        if (!userEmail) setMessage("No se pudo obtener el email de tu cuenta.");
        return;
      }
      const { data: athleteRows, error: athleteErr } = await supabase.from("athletes").select("*").ilike("email", userEmail).limit(1);
      if (cancelled) return;
      if (athleteErr) {
        console.error("Error cargando atleta:", athleteErr);
        setAthleteInfo(null); setWorkouts([]); setAthleteEvaluations([]); setLoading(false);
        return;
      }
      const athleteRow = athleteRows?.[0];
      if (!athleteRow) {
        setAthleteInfo(null); setWorkouts([]); setAthleteEvaluations([]);
        setAthleteNotRegistered(true); setLoading(false);
        markInitialLoadFinished();
        return;
      }
      setAthleteInfo(athleteRow);
      if (authData?.user?.id) {
        const { error: linkErr } = await supabase.from("athletes").update({ user_id: authData.user.id }).eq("id", athleteRow.id);
        if (linkErr) console.warn("[AthleteHome] link user_id:", linkErr);
        // El backend limpia el token de otros perfiles antes de asignarlo. En
        // la APK el token sale del plugin nativo: la Notification API del web
        // no existe dentro del WebView.
        if (Capacitor.isNativePlatform()) {
          await registerNativePush({ notify: notifyPush });
        } else {
          const tok = await refreshFcmTokenIfGranted();
          if (tok) await registerFcmToken(tok);
        }
      }
      const [wOut, eRes] = await Promise.all([
        refreshWorkouts(athleteRow.id),
        supabase.from("athlete_evaluations").select("vdot, created_at").eq("athlete_id", athleteRow.id).order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      const evalRows = eRes.data;
      if (eRes.error) console.warn("[AthleteHome] athlete_evaluations:", eRes.error);
      if (!wOut.ok) {
        // En la carga inicial no hay nada que preservar, y dejar la lista vacia
        // es lo que hace que se pinte el estado "sin entrenos" en vez de nada.
        setWorkouts([]); setAthleteEvaluations(evalRows || []);
      } else {
        const normalizedWorkouts = wOut.rows;
        setAthleteEvaluations(evalRows || []);
        if ((normalizedWorkouts || []).some((w) => w.done)) {
          setTimeout(() => {
            if (cancelled) return;
            (async () => {
              try {
                const { snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteRow.id);
                if (cancelled) return;
                setAchievementsCatalog(snapshot.achievements || []);
                setEarnedAchievements(snapshot.earned || []);
                setAchProgress(progress || computeAchievementProgress(normalizedWorkouts.filter((w) => w.done)));
              } catch (e) { console.warn("[AthleteHome] evaluateAndAwardAthleteAchievements (fondo):", e); }
            })();
          }, 0);
        }
      }
      setLoading(false);
      markInitialLoadFinished();
    };
    load();
    return () => { cancelled = true; };
  }, [profileUserId, notifyPush, refreshWorkouts]);

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
  const calendarCells = useMemo(() => getMonthGrid(calendarViewMonth.y, calendarViewMonth.m), [calendarViewMonth.y, calendarViewMonth.m]);
  const calendarMonthLabel = useMemo(() => new Date(calendarViewMonth.y, calendarViewMonth.m, 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" }), [calendarViewMonth.y, calendarViewMonth.m]);

  const [races, setRaces] = useState([]);
  useEffect(() => {
    if (!athleteInfo?.id) { setRaces([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("races").select("*").eq("athlete_id", athleteInfo.id).order("date", { ascending: true });
      if (cancelled) return;
      if (error) { console.error("Error cargando carreras (atleta):", error); setRaces([]); return; }
      setRaces((data || []).map(normalizeRaceRow));
    })();
    return () => { cancelled = true; };
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

  const athleteTodayYmd = calendarCellToIsoYmd(new Date());
  const nextRaceCountdownAthlete = useMemo(() => getNextRaceCountdown(races, athleteTodayYmd), [races, athleteTodayYmd]);
  const closeAthleteCalendarCtxMenu = () => setAthleteCalendarCtxMenu(null);
  const ctxMenuWorkoutId = athleteCalendarCtxMenu?.workoutId ?? null;
  const ctxMenuAthleteWorkout = useMemo(() => ctxMenuWorkoutId ? workouts.find((x) => String(x.id) === String(ctxMenuWorkoutId)) || null : null, [workouts, ctxMenuWorkoutId]);
  const ctxMenuView = athleteCalendarCtxMenu?.view || "actions";
  const athleteLatestVdot = useMemo(() => {
    const rows = athleteEvaluations || [];
    if (!rows.length) return 42.5;
    const last = rows[rows.length - 1];
    const v = Number(last?.vdot);
    return Number.isFinite(v) && v > 0 ? v : 42.5;
  }, [athleteEvaluations]);

  const openAthleteWorkoutMenu = (e, w) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8; const mw = 280; const mh = 160;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.max(pad, Math.min(e.clientX, vw - mw - pad));
    const y = Math.max(pad, Math.min(e.clientY, vh - mh - pad));
    setAthleteCalendarCtxMenu({ x, y, workoutId: w.id, view: "actions" });
  };

  const openAthleteWorkoutDetail = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAthleteCalendarCtxMenu((prev) => {
      if (!prev) return prev;
      const pad = 8;
      const mw = Math.min(typeof window !== "undefined" ? window.innerWidth * 0.92 : 320, 340);
      const mh = Math.min(typeof window !== "undefined" ? window.innerHeight * 0.7 : 400, 420);
      const vw = typeof window !== "undefined" ? window.innerWidth : 800;
      const vh = typeof window !== "undefined" ? window.innerHeight : 600;
      const x = Math.max(pad, Math.min(prev.x, vw - mw - pad));
      const y = Math.max(pad, Math.min(prev.y, vh - mh - pad));
      return { ...prev, view: "detail", x, y };
    });
  };

  const ctxMenuListenerKey = athleteCalendarCtxMenu ? `${athleteCalendarCtxMenu.workoutId}:${athleteCalendarCtxMenu.x}:${athleteCalendarCtxMenu.y}` : "";
  useEffect(() => {
    if (!ctxMenuListenerKey) return;
    const onDown = (ev) => { if (athleteCalendarCtxMenuRef.current?.contains(ev.target)) return; closeAthleteCalendarCtxMenu(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [ctxMenuListenerKey]);

  const workoutsAchSyncKey = useMemo(() => (workouts || []).map((w) => `${w.id}:${w.done ? 1 : 0}:${w.rpe ?? ""}`).join("|"), [workouts]);

  const openWorkoutSummaryModal = (workoutRow) => {
    if (!workoutRow?.id) {
      console.warn("[rpe-modal] open skipped: no workout id", workoutRow);
      return;
    }
    console.info("[rpe-modal] open", {
      id: workoutRow.id,
      done: workoutRow.done,
      scheduled_date: workoutRow.scheduled_date ?? null,
    });
    void loadIntervalsConnected();
    const baseManual = {
      distanceKm: (!intervalsConnected && workoutRow.total_km) ? String(workoutRow.total_km) : "",
      durationMin: (!intervalsConnected && workoutRow.duration_min) ? String(workoutRow.duration_min) : "",
      rpe: workoutRow.rpe != null ? String(workoutRow.rpe) : "",
      avgHr: workoutRow.manual_avg_hr != null ? String(workoutRow.manual_avg_hr) : "",
      maxHr: workoutRow.manual_max_hr != null ? String(workoutRow.manual_max_hr) : "",
      calories: workoutRow.manual_calories != null ? String(workoutRow.manual_calories) : "",
      feeling: feelingFromNotes(workoutRow.athlete_notes),
      notes: stripFeelingLines(workoutRow.athlete_notes),
    };
    setManualSummaryForm(baseManual);
    setWorkoutSummaryModal({ workout: workoutRow });
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
    const athleteNotes = composeAthleteNotes(manualSummaryForm.feeling, manualSummaryForm.notes);
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
    // Sin .single()/.maybeSingle(): 0 filas no debe ser 406. El aviso al coach
    // ya salió en toggleDone; repetirlo aquí reclamaba 0 filas (columna ya llena).
    const { data: savedRows, error } = await supabase
      .from("workouts")
      .update(payload)
      .eq("id", workoutRow.id)
      .select("id");
    setManualSummarySaving(false);
    if (error) {
      setMessage(error.message || "No se pudo guardar el resumen.");
      return;
    }
    if (!Array.isArray(savedRows) || !savedRows.length) {
      setMessage("No se pudo guardar el resumen (sin permiso o fila no encontrada).");
      return;
    }
    setWorkouts((prev) => prev.map((w) => (String(w.id) === String(workoutRow.id) ? normalizeWorkoutRow({ ...w, ...payload }) : w)));
    closeWorkoutModal();
  };

  const toggleDone = async (w) => {
    if (!w?.id) {
      console.warn("[rpe-modal] toggleDone skipped: no workout");
      return;
    }
    const busyKey = String(w.id);
    if (toggleDoneBusyIdRef.current === busyKey) return;
    toggleDoneBusyIdRef.current = busyKey;
    try {
    const next = !w.done;
    console.info("[rpe-modal] toggleDone", {
      id: w.id,
      next,
      scheduled_date: w.scheduled_date ?? null,
      athleteId: athleteInfo?.id ?? null,
    });
    const payload = next ? { done: true } : { done: false, rpe: null };
    const nextWorkouts = workouts.map((x) => (x.id === w.id ? { ...x, done: next, rpe: next ? x.rpe : null } : x));
    setWorkouts(nextWorkouts);
    if (next) {
      openWorkoutSummaryModal({ ...w, done: true, rpe: w.rpe ?? null });
    } else {
      setWorkoutSummaryModal(null);
    }
    const { error } = await supabase.from("workouts").update(payload).eq("id", w.id);
    console.info("[rpe-modal] update done", { id: w.id, next, ok: !error, message: error?.message || null });
    if (error) {
      console.error("Error actualizando workout:", error);
      setWorkouts(prev => prev.map(x => (x.id === w.id ? { ...x, done: !next, rpe: w.rpe } : x)));
      if (next) setWorkoutSummaryModal(null);
      setMessage(`Error actualizando workout: ${error.message}`);
      return;
    }
    if (next && athleteInfo?.id) {
      if (athleteInfo?.coach_id) {
        void notifyCoachWorkoutCompletedFromClient({
          workout: { ...w, done: true },
          athlete: athleteInfo,
        });
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          fetch("/api/integrations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: "pull-activity",
              athlete_id: athleteInfo.id,
              workout_id: w.id,
            }),
          }).catch(() => {});
        }
      } catch {}
      void evaluateAndAwardAthleteAchievements(athleteInfo.id).then(({ newAwards, snapshot, progress }) => {
        setAchievementsCatalog(snapshot.achievements || []);
        setEarnedAchievements(snapshot.earned || []);
        setAchProgress(progress || computeAchievementProgress(nextWorkouts.filter((x) => x.done)));
        if (newAwards.length > 0) {
          const first = achievementJoinMeta(newAwards[0]);
          setMedalToast(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
          setTimeout(() => setMedalToast(""), 4200);
        }
      }).catch((e) => {
        console.warn("[AthleteHome] evaluateAndAward after done:", e);
      });
    }
    // Notificar coach cuando el atleta desmarca un workout (sesion perdida)
    if (!next && athleteInfo?.coach_id) {
      try {
        await sendChatPushNotification({
          toUserId: athleteInfo.coach_id,
          title: "⚠️ Sesion no completada",
          body: `${athleteInfo.name || "Atleta"} no completo: ${w.title || "Entreno"} (${w.total_km || 0} km). Puede requerir ajuste de plan.`,
          data: { type: "coach_athlete", athlete_id: athleteInfo.id },
          logLabel: "workout missed athlete→coach",
        });
      } catch (_) {}
    }
    } finally {
      if (toggleDoneBusyIdRef.current === busyKey) toggleDoneBusyIdRef.current = null;
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
    // Opcion C: 1 evaluacion gratis, despues requiere premium
    if (!hasPremiumAccess && athleteEvaluations.length >= 1) setShowEvaluation(false);
  }, [athleteInfo?.id, athleteInfo?.athlete_plan, athleteInfo?.coach_id, athleteTabRestored, hasPremiumAccess]);

  // Nombre y foto del coach asignado, en la misma consulta a coach_public.
  useEffect(() => {
    if (!profile?.coach_id) {
      setCoachName(null);
      setCoachAvatarUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("coach_public")
        .select("name, avatar_url")
        .eq("user_id", profile.coach_id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.name) setCoachName(data.name);
      setCoachAvatarUrl(data?.avatar_url || "");
    })();
    return () => { cancelled = true; };
  }, [profile?.coach_id]);

  const athleteName = useMemo(() => {
    const looksLikeEmail = (s) => /@/.test(String(s || ""));
    const pick = (s) => {
      const t = String(s || "").trim();
      if (!t || looksLikeEmail(t)) return "";
      return t;
    };
    return (
      pick(profile?.name) ||
      pick(athleteInfo?.name) ||
      pick(authFullName) ||
      "Atleta"
    );
  }, [profile?.name, athleteInfo?.name, authFullName]);
  const handleAthleteNavTabChange = useCallback((tabId) => {
    setAthleteChatOpen(false);
    setAthleteActiveTab(tabId);
    if (typeof localStorage !== "undefined") localStorage.setItem(RAF_ATHLETE_NAV_TAB_KEY, tabId);
  }, []);

  /**
   * Salta al destino de un aviso push. La web lo recibe en la URL y la APK en
   * el `data` de la notificacion, pero la navegacion es la misma. Usa
   * handleAthleteNavTabChange para que el tab persista igual que un cambio
   * manual.
   */
  const applyAthleteDeepLink = useCallback((type) => {
    if (type === "athlete_calendar") {
      handleAthleteNavTabChange("home");
    } else if (type === "athlete_chat") {
      handleAthleteNavTabChange("home");
      setAthleteChatOpen(true);
    }
  }, [handleAthleteNavTabChange]);

  const [nativeDeepLinkTick, setNativeDeepLinkTick] = useState(0);

  // Un tap con la app ya montada no vuelve a ejecutar el efecto de abajo por si
  // solo (en la APK no hay recarga ni cambio de URL): el plugin avisa y este
  // contador lo despierta.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    return subscribeDeepLink(() => setNativeDeepLinkTick((n) => n + 1));
  }, []);

  // Deep link desde notificaciones push (tipos athlete_*). El destino se
  // consume una sola vez para no reprocesarlo al recargar ni al re-renderizar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    if (open && open.startsWith("athlete_")) {
      applyAthleteDeepLink(open);
      params.delete("open"); params.delete("athlete_id"); params.delete("workout_id");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      return;
    }
    // En la APK la URL nunca cambia al tocar la notificacion: el destino lo
    // dejo el listener nativo.
    const pending = consumePendingDeepLink("athlete_");
    if (pending) applyAthleteDeepLink(String(pending.type));
  }, [nativeDeepLinkTick, applyAthleteDeepLink]);
  const nextRaceText = athleteInfo?.next_race ? `🏁 ${getRaceCountdownText(athleteInfo.next_race)}` : "🏁 Próxima carrera · fecha pendiente";
  const coachIdForChat = athleteInfo?.coach_id || null;
  const athleteChat = useAthleteSideChat({
    athleteId: athleteInfo?.id ?? null,
    coachId: coachIdForChat,
    athleteName,
    panelOpen: athleteChatOpen,
    notify: notifyCallback,
  });

  const loadIntervalsConnected = useCallback(async () => {
    if (!athleteInfo?.id) { setIntervalsConnected(false); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setIntervalsConnected(false); return; }
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "status", athlete_id: athleteInfo.id }),
      });
      const d = await res.json().catch(() => ({}));
      setIntervalsConnected(Boolean(res.ok && d?.connected));
    } catch { setIntervalsConnected(false); }
  }, [athleteInfo?.id]);

  // Al volver: workouts + ficha (nombre/avatar/coach/plan) + intervals.
  // El perfil (profiles) lo refresca App.jsx en el mismo resume.
  useAppResumeRefresh(() => {
    if (prevProfileUserIdRef.current !== profileUserId) return;
    const athleteId = athleteInfo?.id;
    if (!athleteId) return;
    void (async () => {
      await Promise.all([
        refreshWorkouts(athleteId),
        loadIntervalsConnected(),
        (async () => {
          const { data, error } = await supabase
            .from("athletes")
            .select("*")
            .eq("id", athleteId)
            .maybeSingle();
          if (error) {
            console.warn("[AthleteHome] resume athlete:", error);
            return;
          }
          if (data) setAthleteInfo(data);
        })(),
      ]);
      setIntervalsRefreshNonce((n) => n + 1);
    })();
  }, Boolean(athleteInfo?.id));

  useEffect(() => {
    setResumeUiBusy(Boolean(athleteChatOpen) || Boolean(String(athleteChat.chatDraft || "").trim()));
    return () => setResumeUiBusy(false);
  }, [athleteChatOpen, athleteChat.chatDraft]);

  useEffect(() => { loadIntervalsConnected(); }, [loadIntervalsConnected]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteInfo?.id) { setAchievementsCatalog([]); setEarnedAchievements([]); setAchProgress(null); return; }
      const snapshot = await loadAthleteAchievementSnapshot(athleteInfo.id);
      if (cancelled) return;
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(computeAchievementProgress((workouts || []).filter((w) => w.done)));
    };
    load();
    return () => { cancelled = true; };
  }, [athleteInfo?.id, workoutsAchSyncKey]);


  // Solicitud de entrenador: la tabla coach_requests y el panel del coach ya
  // existian, faltaba que el atleta pudiera crear la fila.
  const requestCoach = useCallback(async () => {
    if (!athleteInfo?.id || !profile?.user_id) {
      setCoachRequestMsg("Aún estamos cargando tu ficha. Inténtalo en unos segundos.");
      return;
    }
    setCoachRequestBusy(true);
    setCoachRequestMsg("");
    try {
      const { data: existing, error: exErr } = await supabase
        .from("coach_requests")
        .select("id")
        .eq("athlete_user_id", profile.user_id)
        .eq("status", "pending")
        .limit(1);
      if (exErr) { console.error("[AthleteHome] solicitudes previas:", exErr); }
      if (existing?.length) {
        setCoachRequestPending(true);
        setCoachRequestMsg("Ya tienes una solicitud pendiente.");
        return;
      }
      const coachId = await resolveDefaultCoachUserId();
      if (!coachId) {
        setCoachRequestMsg("No hay entrenadores disponibles ahora mismo. Inténtalo más tarde.");
        return;
      }
      const { error } = await supabase.from("coach_requests").insert({
        athlete_user_id: profile.user_id,
        athlete_id: athleteInfo.id,
        coach_id: coachId,
        status: "pending",
      });
      if (error) {
        console.error("[AthleteHome] solicitar entrenador:", error);
        setCoachRequestMsg(error.message || "No se pudo enviar la solicitud.");
        return;
      }
      setCoachRequestPending(true);
      setCoachRequestMsg("Solicitud enviada. Tu entrenador la revisará pronto.");
      sendChatPushNotification({
        toUserId: coachId,
        title: "Nueva solicitud de atleta",
        body: `${athleteName} quiere entrenar contigo`,
        data: { type: "coach_request", athlete_id: athleteInfo.id },
        logLabel: "solicitud de entrenador",
      }).catch(() => {});
    } finally {
      setCoachRequestBusy(false);
    }
  }, [athleteInfo?.id, profile?.user_id, athleteName]);


  const athleteNeedsCoachLink = Boolean(athleteInfo) && !athleteNotRegistered && (athleteInfo.coach_id == null || athleteInfo.coach_id === "");

  // Solo se consulta si al atleta le falta coach, para no cargar nada de mas.
  useEffect(() => {
    if (!athleteNeedsCoachLink || !profile?.user_id) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("coach_requests")
        .select("id")
        .eq("athlete_user_id", profile.user_id)
        .eq("status", "pending")
        .limit(1);
      if (cancelled || error) return;
      if (data?.length) setCoachRequestPending(true);
    })();
    return () => { cancelled = true; };
  }, [athleteNeedsCoachLink, profile?.user_id]);

  const linkAthleteToCoach = async (coachUserId) => {
    if (!athleteInfo?.id || !profile?.user_id || !coachUserId) return false;
    setMessage("");
    const { error: eAth } = await supabase.from("athletes").update({ coach_id: coachUserId }).eq("id", athleteInfo.id);
    if (eAth) { setMessage(eAth.message || "No se pudo vincular el coach."); return false; }
    const { error: eProf } = await supabase.from("profiles").update({ coach_id: coachUserId }).eq("user_id", profile.user_id);
    if (eProf) { setMessage(eProf.message || "No se pudo actualizar tu perfil. Revisa permisos o contacta soporte."); return false; }
    setAthleteInfo((prev) => (prev ? { ...prev, coach_id: coachUserId } : prev));
    const { data: wRows, error: wErr } = await supabase.from("workouts").select(ATHLETE_HOME_WORKOUT_COLUMNS).eq("athlete_id", athleteInfo.id).order("scheduled_date", { ascending: true });
    if (!wErr && wRows) setWorkouts((wRows || []).map(normalizeWorkoutRow));
    return true;
  };

  const connectCoachByCode = async () => {
    const code = findCoachCodeInput.trim().toUpperCase();
    if (!code) { setCoachCodeMsg("Ingresa el codigo de tu coach."); return; }
    setFindCoachCodeBusy(true);
    setCoachCodeMsg("");
    try {
      const coachId = await resolveCoachUserIdFromPublicCode(code);
      if (!coachId) { setCoachCodeMsg("No encontramos un coach con ese codigo. Verifica e intenta de nuevo."); return; }
      await linkAthleteToCoach(coachId);
      const { data: coachProf } = await supabase
        .from("coach_public")
        .select("name, avatar_url")
        .eq("user_id", coachId)
        .maybeSingle();
      if (coachProf?.name) setCoachName(coachProf.name);
      setCoachAvatarUrl(coachProf?.avatar_url || "");
      setCoachCodeMsg("Conectado con " + (coachProf?.name || "tu coach") + "!");
      setFindCoachCodeInput("");
    } catch (e) {
      setCoachCodeMsg("Error inesperado. Intenta de nuevo.");
    } finally { setFindCoachCodeBusy(false); }
  };

  const coachDir = useCoachDirectory({
    enabled: athleteProfileTab === "config",
    excludeCoachUserId: athleteInfo?.coach_id ?? null,
  });

  const closeWorkoutModal = () => {
    setWorkoutSummaryModal(null);
    setForceManualFields(false);
  };

  const workoutOverlays = useAthleteWorkoutOverlays({
    athleteId: athleteInfo?.id ?? null,
    athleteName: athleteInfo?.name,
    athleteGoal: athleteInfo?.goal,
    athleteFcMax: athleteInfo?.fc_max,
    coachId: athleteInfo?.coach_id ?? null,
    notify: notifyCallback,
  });


  return (
    <div style={{ ...S.page, paddingBottom: 96, overflowX: "hidden", overflowY: "visible", position: "relative" }}>
      {message ? (
        <div style={{ ...S.card, border: `1px solid ${message.startsWith("✅") ? "rgba(34,197,94,.45)" : "rgba(239,68,68,.35)"}`, background: message.startsWith("✅") ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.08)", color: message.startsWith("✅") ? "#166534" : "#fecaca", marginBottom: 14 }}>
          {message}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Hola, {athleteName}</h1>
        <img src="/pwa-192.png" alt="RAF" style={{ width: 38, height: 38, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
      </div>
      <InstallAppButton />
{/* Con el boton flotante fuera, esta tarjeta es el unico acceso al chat, asi
    que se muestra en cuanto hay coach aunque su nombre aun no haya cargado. */}
{coachName || coachIdForChat ? (
        <div
          id="banner-coach-name"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(255,138,61,.1), rgba(251,191,36,.08))",
            border: "1px solid rgba(255,138,61,.3)",
            marginBottom: 12,
          }}
        >
          {coachAvatarUrl && coachAvatarFailedUrl !== coachAvatarUrl ? (
            <img
              src={coachAvatarUrl}
              alt=""
              loading="lazy"
              onError={() => setCoachAvatarFailedUrl(coachAvatarUrl)}
              style={{ width: 34, height: 34, flexShrink: 0, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,138,61,.45)", display: "block" }}
            />
          ) : (
            <span style={{ fontSize: "1.2em", flexShrink: 0 }}>🏃</span>
          )}
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ fontSize: ".68em", color: "#b45309", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>Tu coach</div>
            {/* El nombre se trunca para que el boton de chat no se salga de la
                tarjeta en pantallas estrechas. */}
            <div style={{ fontSize: ".9em", fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{coachName || "Coach asignado"}</div>
          </div>
          <button
            type="button"
            onClick={() => setAthleteChatOpen(true)}
            aria-label="Abrir chat con tu coach"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "linear-gradient(135deg,#ff8a3d,#ea580c)",
              border: "none",
              borderRadius: 999,
              padding: "7px 14px",
              color: "#fff",
              fontWeight: 800,
              fontSize: ".78em",
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(234,88,12,.28)",
            }}
          >
            <span aria-hidden="true">💬</span> Chat
          </button>
        </div>
      ) : null}
      {athleteNeedsCoachLink ? (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(255,138,61,.1), rgba(251,191,36,.08))",
            border: "1px solid rgba(255,138,61,.3)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: ".95em", fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>Aún no tienes entrenador</div>
          <div style={{ fontSize: ".82em", color: "#475569", marginBottom: 12, lineHeight: 1.45 }}>
            Conéctate con tu coach para recibir tus entrenamientos personalizados.
          </div>
          <CoachLinkActions
            code={findCoachCodeInput}
            onCodeChange={(v) => { setFindCoachCodeInput(v); setCoachCodeMsg(""); }}
            onConnect={connectCoachByCode}
            connecting={findCoachCodeBusy}
            codeMsg={coachCodeMsg}
            onRequest={requestCoach}
            requesting={coachRequestBusy}
            requestPending={coachRequestPending}
            requestMsg={coachRequestMsg}
          />
        </div>
      ) : null}
      {athleteNotRegistered ? (
        <div style={{ padding: "14px 16px", borderRadius: 12, background: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: 12 }}>
          <div style={{ fontSize: ".95em", fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>Estamos preparando tu ficha</div>
          <div style={{ fontSize: ".82em", color: "#475569", lineHeight: 1.45 }}>
            Tu cuenta existe, pero todavía no encontramos tu ficha de atleta, así que aún no podemos mostrarte entrenamientos.
            Si acabas de registrarte, recarga la app en unos segundos. Si sigue igual, escríbenos y lo resolvemos.
          </div>
        </div>
      ) : null}
      <WeatherWidget />
{(() => {
        const weatherNote = getWorkoutWeatherNote();
        const todayYmd2 = formatLocalYMD(new Date());
        const hasTodayWorkout = workouts.some((w) => w.scheduled_date === todayYmd2 && !w.done);
        if (!weatherNote || !hasTodayWorkout) return null;
        const isWarning = weather?.intensity === "warning";
        return (
          <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: isWarning ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)", border: isWarning ? "1px solid rgba(239,68,68,.3)" : "1px solid rgba(245,158,11,.3)" }}>
            <div style={{ fontWeight: 800, fontSize: ".82em", color: isWarning ? "#991b1b" : "#92400e", marginBottom: 4 }}>
              {isWarning ? "⚠️ Alerta clima" : "🌡️ Precaucion clima"}
            </div>
            <div style={{ fontSize: ".78em", color: isWarning ? "#b91c1c" : "#b45309", lineHeight: 1.5 }}>{weatherNote}</div>
          </div>
        );
      })()}

      <AthleteHomeProgress cardStyle={S.card} workouts={workouts} />

      <div style={{ ...S.card, marginBottom: 14, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>CALENDARIO · {calendarMonthLabel}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>←</button>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>→</button>
          </div>
        </div>
        {loading ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
            {DAYS.map((d) => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {calendarCells.map((cellDate, i) => {
              const ymd = calendarCellToIsoYmd(cellDate);
              const dayWorkouts = workoutsByDate[ymd] || [];
              const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
              const hasDoneWorkout = dayWorkouts.some((w) => w.done);
              return (
                <div key={i} style={{ minHeight: 72, minWidth: 0, maxWidth: "100%", boxSizing: "border-box", overflow: "hidden", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 2px", opacity: inViewMonth ? 1 : 0.42, background: hasDoneWorkout ? "rgba(34,197,94,.08)" : "#fff", display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: ".62em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                  {dayWorkouts.slice(0, 2).map((w) => {
                    const wt = WORKOUT_TYPES.find((t) => t.id === w.type) || WORKOUT_TYPES[0];
                    const kmNum = Number(w.total_km);
                    const kmLabel = Number.isFinite(kmNum) && kmNum > 0
                      ? `${Number.isInteger(kmNum) ? kmNum : kmNum.toFixed(1)} km`
                      : "";
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={(e) => openAthleteWorkoutMenu(e, w)}
                        title={`${w.title || "Entreno"}${kmLabel ? ` · ${kmLabel}` : ""}${w.done ? " · Hecho" : " · Pendiente"}`}
                        style={{
                          width: "100%",
                          minWidth: 0,
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          border: `1px solid ${w.done ? "rgba(34,197,94,.4)" : "#e2e8f0"}`,
                          borderRadius: 5,
                          padding: "3px 4px",
                          background: w.done ? "rgba(34,197,94,.14)" : "#f8fafc",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                          position: "relative",
                          zIndex: 1,
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              flexShrink: 0,
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: w.done ? "#22c55e" : (wt?.color || "#94a3b8"),
                            }}
                          />
                          <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: ".62em", lineHeight: 1.15, color: "#334155", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {w.title}
                          </span>
                          {w.done ? <span style={{ flexShrink: 0, fontSize: ".55em", color: "#16a34a", fontWeight: 800 }}>✓</span> : null}
                        </div>
                        {kmLabel ? (
                          <div style={{ fontSize: ".5em", color: "#64748b", fontWeight: 600, marginTop: 1, paddingLeft: 11, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {kmLabel}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {athleteCalendarCtxMenu && ctxMenuAthleteWorkout ? (
        <div
          ref={athleteCalendarCtxMenuRef}
          style={{
            position: "fixed",
            left: athleteCalendarCtxMenu.x,
            top: athleteCalendarCtxMenu.y,
            zIndex: 10002,
            minWidth: ctxMenuView === "detail" ? 260 : 240,
            width: ctxMenuView === "detail" ? "min(92vw, 340px)" : undefined,
            maxWidth: "min(92vw, 340px)",
            maxHeight: ctxMenuView === "detail" ? "min(70vh, 420px)" : undefined,
            overflowY: ctxMenuView === "detail" ? "auto" : "visible",
            background: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(15,23,42,.2)",
            border: "1px solid #e2e8f0",
            padding: ctxMenuView === "detail" ? 12 : 6,
          }}
        >
          {ctxMenuView === "detail" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAthleteCalendarCtxMenu((prev) => (prev ? { ...prev, view: "actions" } : prev));
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#64748b",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: ".78em",
                    padding: "4px 0",
                  }}
                >
                  ← Menú
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); closeAthleteCalendarCtxMenu(); }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: ".78em",
                    padding: "4px 0",
                  }}
                >
                  Cerrar
                </button>
              </div>
              <WorkoutDetailBreakdown workout={ctxMenuAthleteWorkout} vdot={athleteLatestVdot} />
            </>
          ) : (
            <>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); const row = ctxMenuAthleteWorkout; closeAthleteCalendarCtxMenu(); void toggleDone(row); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                {ctxMenuAthleteWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho"}
              </button>
              {!ctxMenuAthleteWorkout.done && (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); workoutOverlays.openNot100(ctxMenuAthleteWorkout); closeAthleteCalendarCtxMenu(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#ff8a3d", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                  😓 No estoy al 100%
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openAthleteWorkoutDetail}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#0d1f38", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
              >
                📋 Ver detalle
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); workoutOverlays.openBriefing(ctxMenuAthleteWorkout); closeAthleteCalendarCtxMenu(); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#6366f1", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                ⚡ Briefing IA
              </button>
            </>
          )}
        </div>
      ) : null}

      <AthleteWeeklyStrip cardStyle={S.card} workouts={workouts} />

      <AthleteWorkoutOverlays
        briefingModal={workoutOverlays.briefingModal}
        briefingText={workoutOverlays.briefingText}
        briefingLoading={workoutOverlays.briefingLoading}
        onRegenerateBriefing={workoutOverlays.generateBriefing}
        onCloseBriefing={workoutOverlays.closeBriefing}
        not100Modal={workoutOverlays.not100Modal}
        not100Form={workoutOverlays.not100Form}
        setNot100Form={workoutOverlays.setNot100Form}
        not100Sending={workoutOverlays.not100Sending}
        onSendNot100={workoutOverlays.sendNot100Report}
        onCloseNot100={workoutOverlays.closeNot100}
      />


      <nav aria-label="Navegación atleta" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999, display: "flex", flexDirection: "row", justifyContent: "space-around", alignItems: "center", background: "white", borderTop: "1px solid #e2e8f0", padding: "8px 0 12px 0", height: "60px" }}>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "home" ? "#c2410c" : "#64748b", background: athleteActiveTab === "home" ? "rgba(255,138,61,.14)" : "transparent", fontWeight: athleteActiveTab === "home" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("home")}><span className="pf-bnav-icon">🏠</span><span style={{ fontSize: "10px" }}>Inicio</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "marketplace" ? "#c2410c" : "#64748b", background: athleteActiveTab === "marketplace" ? "rgba(255,138,61,.14)" : "transparent", fontWeight: athleteActiveTab === "marketplace" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("marketplace")}><span className="pf-bnav-icon">🛒</span><span style={{ fontSize: "10px" }}>Market</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "challenges" ? "#c2410c" : "#64748b", background: athleteActiveTab === "challenges" ? "rgba(255,138,61,.14)" : "transparent", fontWeight: athleteActiveTab === "challenges" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("challenges")}><span className="pf-bnav-icon">🏆</span><span style={{ fontSize: "10px" }}>Retos</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "eval" ? "#c2410c" : "#64748b", background: athleteActiveTab === "eval" ? "rgba(255,138,61,.14)" : "transparent", fontWeight: athleteActiveTab === "eval" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("eval")}><span className="pf-bnav-icon">⚡</span><span style={{ fontSize: "10px" }}>Eval</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "profile" ? "#c2410c" : "#64748b", background: athleteActiveTab === "profile" ? "rgba(255,138,61,.14)" : "transparent", fontWeight: athleteActiveTab === "profile" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("profile")}><span className="pf-bnav-icon">👤</span><span style={{ fontSize: "10px" }}>Perfil</span></button>
      </nav>

      {athleteActiveTab !== "home" ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9988, background: "rgba(15,23,42,.4)", display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", height: "100%", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", padding: 16, paddingBottom: 94 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, color: "#0f172a" }}>
                {athleteActiveTab === "marketplace" ? "🛒 Marketplace" : athleteActiveTab === "challenges" ? "🏆 Retos" : athleteActiveTab === "eval" ? "⚡ Evaluación VDOT" : "👤 Perfil"}
              </div>
              <button type="button" onClick={() => handleAthleteNavTabChange("home")} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>

            {athleteActiveTab === "marketplace" ? (
              <Suspense fallback={<div>Cargando...</div>}>
                <MarketplaceHub profileRole="athlete" currentUserId={profile?.user_id ?? null} coachUserId={null} notify={notifyCallback} styles={styles} />
              </Suspense>
            ) : null}

            {athleteActiveTab === "challenges" ? (
              <Suspense fallback={<div style={{ padding: 20 }}>Cargando retos...</div>}>
                <ChallengesHub profileRole="athlete" currentUserId={profile?.user_id ?? null} athleteId={athleteInfo?.id ?? null} isAthlete coachAthletes={EMPTY_ARRAY} workouts={workouts} notify={notifyCallback} styles={styles} normalizeWorkoutRow={normalizeWorkoutRowStable} />
              </Suspense>
            ) : null}

            {athleteActiveTab === "eval" ? (
              hasPremiumAccess ? (
                <Suspense fallback={<div style={{ padding: 20, color: "#64748b" }}>Cargando evaluación…</div>}>
                  {!hasPremiumAccess && athleteEvaluations.length === 0 ? (
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,138,61,.1)", border: "1px solid rgba(255,138,61,.3)", marginBottom: 14, fontSize: ".82em", color: "#b45309", fontWeight: 600 }}>
                  Tienes 1 evaluacion VDOT gratuita. Para evaluaciones ilimitadas, conecta un coach o activa Premium.
                </div>
              ) : null}
              <EvaluationView athletes={[normalizeAthlete(athleteInfo)]} currentUserId={profile?.user_id ?? null} notify={(msg) => setMessage(msg)} athleteOnlyId={athleteInfo?.id} />
                </Suspense>
              ) : (
                <div style={{ ...S.card, textAlign: "center" }}>
                  <p style={{ color: "#64748b" }}>La evaluación VDOT requiere Plan Premium Atleta.</p>
                  <button type="button" onClick={() => { setAthleteProfileTab("pagos"); handleAthleteNavTabChange("profile"); }} style={{ background: "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Ir a Pagos para suscribirme</button>
                </div>
              )
            ) : null}

            {athleteActiveTab === "profile" ? (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setAthleteProfileTab("logros")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "logros" ? "rgba(255,138,61,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🏅 Logros</button>
                  <button type="button" onClick={() => setAthleteProfileTab("forma")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "forma" ? "rgba(255,138,61,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📊 Forma</button>
                  <button type="button" onClick={() => setAthleteProfileTab("mes")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "mes" ? "rgba(255,138,61,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📅 Mes</button>
                  <button type="button" onClick={() => setAthleteProfileTab("config")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "config" ? "rgba(255,138,61,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>⚙️ Config</button>
                  <button type="button" onClick={() => setAthleteProfileTab("pagos")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "pagos" ? "rgba(255,138,61,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>💳 Pagos</button>
                </div>

                {athleteProfileTab === "logros" ? (
                  <AchievementsGrid
                    cardStyle={S.card}
                    workouts={workouts}
                    evaluations={athleteEvaluations}
                    earnedAchievements={earnedAchievements}
                  />
                ) : null}

                {athleteProfileTab === "forma" ? (
                  <AthleteFormaFatigaPanel
                    cardStyle={S.card}
                    workouts={workouts}
                    hasPremiumAccess={hasPremiumAccess}
                    onGoToPagos={() => { setAthleteProfileTab("pagos"); handleAthleteNavTabChange("profile"); }}
                  />
                ) : null}

                {athleteProfileTab === "config" ? (
                  <AthleteSettingsPanel
                    cardStyle={S.card}
                    athleteId={athleteInfo?.id}
                    avatarUrl={athleteInfo?.avatar_url}
                    onAvatarSaved={(url) => setAthleteInfo((prev) => prev ? { ...prev, avatar_url: url } : prev)}
                    notify={notifyCallback}
                    coachName={coachName}
                    coachLink={{
                      code: findCoachCodeInput,
                      onCodeChange: (v) => { setFindCoachCodeInput(v); setCoachCodeMsg(""); },
                      onConnect: connectCoachByCode,
                      connecting: findCoachCodeBusy,
                      codeMsg: coachCodeMsg,
                      onRequest: requestCoach,
                      requesting: coachRequestBusy,
                      requestPending: coachRequestPending,
                      requestMsg: coachRequestMsg,
                      showRequest: athleteNeedsCoachLink,
                    }}
                    availableCoaches={coachDir.availableCoaches}
                    coachDirLoading={coachDir.coachDirLoading}
                    onRefreshDirectory={coachDir.loadCoachDirectory}
                    onSelectCoachCode={(code) => { setFindCoachCodeInput(code); setCoachCodeMsg(""); }}
                    intervalsRefreshNonce={intervalsRefreshNonce}
                  />
                ) : null}


                {athleteProfileTab === "mes" ? (
                  <AthleteMonthSummary cardStyle={S.card} workouts={workouts} />
                ) : null}

                {athleteProfileTab === "pagos" ? (
                  <AthletePaymentsView
                    cardStyle={S.card}
                    athleteId={athleteInfo?.id}
                    athletePlan={profile?.athlete_plan ?? athleteInfo?.athlete_plan}
                    subscriptionPeriod={profile?.subscription_period ?? athleteInfo?.subscription_period}
                    subscriptionExpiresAt={profile?.subscription_expires_at}
                    profileUserId={profile?.user_id}
                    profileCoachId={profile?.coach_id}
                    notify={notifyCallback}
                  />
                ) : null}

                <AthleteProfileSessionFooter notify={notifyCallback} cardStyle={S.card} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <AthleteChatSheet
        open={athleteChatOpen}
        onClose={() => setAthleteChatOpen(false)}
        coachId={coachIdForChat}
        chatMessages={athleteChat.chatMessages}
        chatDraft={athleteChat.chatDraft}
        setChatDraft={athleteChat.setChatDraft}
        chatSending={athleteChat.chatSending}
        sendAthleteChat={athleteChat.sendAthleteChat}
      />


      {/* ── Modal resumen workout + análisis Claude */}
      {workoutSummaryModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Resumen del entrenamiento</div>
            <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 12 }}>
              {(workoutSummaryModal.workout?.title || "Entreno")} · {workoutSummaryModal.workout?.scheduled_date || "—"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: "#f8fafc", borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>PROGRAMADO</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>📏 {workoutSummaryModal?.workout?.total_km || "—"} km</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>⏱ {workoutSummaryModal?.workout?.duration_min || "—"} min</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>🏃 {workoutSummaryModal?.workout?.type || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 700, color: "#0d9488", marginBottom: 6 }}>LO QUE HICISTE</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>📏 {manualSummaryForm.distanceKm || "—"} km</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>⏱ {manualSummaryForm.durationMin || "—"} min</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>RPE {manualSummaryForm.rpe || "—"} / 10</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
          {intervalsConnected ? (
            <div style={{ fontSize: ".8em", color: "#0d9488", background: "rgba(13,148,136,.08)", border: "1px solid rgba(13,148,136,.25)", borderRadius: 8, padding: "9px 11px" }}>
              ⌚ Los datos de tu carrera (distancia, tiempo, FC) llegan automáticamente desde tu reloj. Solo cuéntanos cómo te sentiste.
              {!forceManualFields ? (
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setForceManualFields(true)}
                    style={{ background: "none", border: "none", color: "#64748b", fontSize: ".74em", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                  >
                    ¿No llegaron los datos? Escríbelos a mano
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {(!intervalsConnected || forceManualFields) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Distancia (km)</div>
                <input type="number" min="0" step="0.1" value={manualSummaryForm.distanceKm} onChange={(e) => setManualSummaryForm((f) => ({ ...f, distanceKm: e.target.value }))} placeholder="0.0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Duracion (min)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.durationMin} onChange={(e) => setManualSummaryForm((f) => ({ ...f, durationMin: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Esfuerzo percibido (RPE)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[1,2,3,4,5,6,7,8,9,10].map((n) => {
                const selected = Number(manualSummaryForm.rpe) === n;
                const color = n <= 3 ? "#16a34a" : n <= 6 ? "#d97706" : n <= 8 ? "#ea580c" : "#dc2626";
                const label = n <= 3 ? "Suave" : n <= 6 ? "Mod." : n <= 8 ? "Duro" : "Max";
                return (
                  <button key={n} type="button" onClick={() => setManualSummaryForm((f) => ({ ...f, rpe: String(n) }))}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: 40, padding: "5px 0", borderRadius: 8, border: selected ? ("2px solid " + color) : "1px solid #e2e8f0", background: selected ? color : "#f8fafc", color: selected ? "#fff" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                    <span style={{ fontSize: ".9em" }}>{n}</span>
                    <span style={{ fontSize: ".5em", fontWeight: 600 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Como te sentiste?</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["Muy cansado","Muy cansado"],["Cansado","Cansado"],["Normal","Normal"],["Bien","Bien"],["Excelente","Excelente"]].map(([label, val]) => {
                const emoji = label === "Muy cansado" ? "Muy cansado" : label === "Cansado" ? "Cansado" : label === "Normal" ? "Normal" : label === "Bien" ? "Bien" : "Excelente";
                const fullVal = label === "Muy cansado" ? "\uD83D\uDE34 Muy cansado" : label === "Cansado" ? "\uD83D\uDE15 Cansado" : label === "Normal" ? "\uD83D\uDE10 Normal" : label === "Bien" ? "\uD83D\uDE42 Bien" : "\uD83D\uDCAA Excelente";
                const selected = manualSummaryForm.feeling === fullVal;
                return (
                  <button key={val} type="button" onClick={() => setManualSummaryForm((f) => ({ ...f, feeling: fullVal }))}
                    style={{ padding: "6px 12px", borderRadius: 20, border: selected ? "2px solid #0d9488" : "1px solid #e2e8f0", background: selected ? "rgba(13,148,136,.1)" : "#f8fafc", color: selected ? "#0d9488" : "#475569", fontWeight: selected ? 800 : 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>
                    {fullVal}
                  </button>
                );
              })}
            </div>
          </div>

          {(!intervalsConnected || forceManualFields) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>FC prom (lpm)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.avgHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, avgHr: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>FC max (lpm)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.maxHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, maxHr: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>Calorias</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.calories} onChange={(e) => setManualSummaryForm((f) => ({ ...f, calories: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Notas del entreno</div>
            <textarea rows={3} value={manualSummaryForm.notes} onChange={(e) => setManualSummaryForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Como fue? Algo importante para tu coach?" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box", resize: "none" }} />
          </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" disabled={manualSummarySaving} onClick={saveManualWorkoutSummary} style={{ background: manualSummarySaving ? "#cbd5e1" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: manualSummarySaving ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                  {manualSummarySaving ? "Guardando…" : intervalsConnected ? "Guardar notas" : "Guardar registro"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" onClick={closeWorkoutModal} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
