import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  STRAVA_CALLBACK_URL,
  formatLocalYMD,
  calendarCellToIsoYmd,
  startOfWeekMonday,
  addDays,
  getMonthGrid,
  cellIsInViewMonth,
  normalizeAthlete,
  PLATFORM_ADMIN_USER_ID,
  DAYS,
  getRaceCountdownText,
  achievementJoinMeta,
  computeAchievementProgress,
  ATHLETE_ACHIEVEMENT_DISPLAY_LIST,
  computeAthleteAchievementVisualProgress,
  loadAthleteAchievementSnapshot,
  evaluateAndAwardAthleteAchievements,
  formatMessageTimestamp,
  clampWorkoutRpe,
  normalizeWorkoutRow,
  computeFormaFatigaWeeklyPoints,
  formaFatigaStatusFromPoint,
  resolveCoachUserIdFromPublicCode,
  sendChatPushNotification,
  normalizeScheduledDateYmd,
  formatDurationMinutesTotal,
  formatDurationClock,
  formatStravaPace,
  normalizeStravaActivity,
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
  STRAVA_ACTIVITY_ICONS,
  TAB_KEY_LIBRARY,
  CHALLENGE_TYPE_OPTIONS,
  normalizeChallengeType,
} from "./shared/appShared";
import { refreshFcmTokenIfGranted } from "../firebase.js";

const MarketplacePlanWorkoutsAccordion = () => null;
const ChallengesHub = lazy(() => import("./ChallengesHub"));
const MarketplaceHub = lazy(() => import("./MarketplaceHub"));

/** Pestaña inferior del atleta (inicio, market, retos, eval VDOT, perfil). */
const RAF_ATHLETE_NAV_TAB_KEY = "raf_athlete_tab";
/** Antes se reutilizaba `raf_athlete_tab` para el panel de evaluación legacy; ahora va aparte. */
const RAF_ATHLETE_EVAL_OPEN_KEY = "raf_athlete_eval_open";
const ATHLETE_NAV_TAB_IDS = ["home", "marketplace", "challenges", "eval", "profile"];

function readStoredAthleteNavTab() {
  if (typeof localStorage === "undefined") return "home";
  const raw = localStorage.getItem(RAF_ATHLETE_NAV_TAB_KEY);
  if (raw && ATHLETE_NAV_TAB_IDS.includes(raw)) return raw;
  return "home";
}

const styles = {
  page: { padding: "28px 32px", maxWidth: 1120, width: "100%" },
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
  const normalizeWorkoutRowStable = useCallback(normalizeWorkoutRow, []);
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
  const [athleteActiveTab, setAthleteActiveTab] = useState(() => readStoredAthleteNavTab());
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
  const [athleteProgressTab, setAthleteProgressTab] = useState("week");

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

      const [wRes, eRes] = await Promise.all([
        supabase
          .from("workouts")
          .select("*")
          .eq("athlete_id", athleteRow.id)
          .order("scheduled_date", { ascending: true }),
        supabase
          .from("athlete_evaluations")
          .select("vdot, created_at")
          .eq("athlete_id", athleteRow.id)
          .order("created_at", { ascending: true }),
      ]);
      const workoutsRows = wRes.data;
      const workoutsErr = wRes.error;
      const evalRows = eRes.data;
      if (eRes.error) console.warn("[AthleteHome] athlete_evaluations:", eRes.error);

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
          setTimeout(() => {
            if (cancelled) return;
            (async () => {
              try {
                const { snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteRow.id);
                if (cancelled) return;
                setAchievementsCatalog(snapshot.achievements || []);
                setEarnedAchievements(snapshot.earned || []);
                setAchProgress(progress || computeAchievementProgress(normalizedWorkouts.filter((w) => w.done)));
              } catch (e) {
                console.warn("[AthleteHome] evaluateAndAwardAthleteAchievements (fondo):", e);
              }
            })();
          }, 0);
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

  const athleteProgressRangeYmd = useMemo(() => {
    const now = new Date();
    if (athleteProgressTab === "week") {
      const start = startOfWeekMonday(now);
      return { startYmd: formatLocalYMD(start), endYmd: formatLocalYMD(addDays(start, 6)) };
    }
    if (athleteProgressTab === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startYmd: formatLocalYMD(start), endYmd: formatLocalYMD(end) };
    }
    return {
      startYmd: formatLocalYMD(new Date(now.getFullYear(), 0, 1)),
      endYmd: formatLocalYMD(new Date(now.getFullYear(), 11, 31)),
    };
  }, [athleteProgressTab, athleteTodayYmd]);

  const athleteProgressStats = useMemo(() => {
    const { startYmd, endYmd } = athleteProgressRangeYmd;
    const doneInRange = workouts.filter((w) => {
      const ymd = normalizeScheduledDateYmd(w.scheduled_date);
      return ymd && ymd >= startYmd && ymd <= endYmd && w.done;
    });
    const totalKm = doneInRange.reduce((s, w) => s + (Number(w.distance_km) || 0), 0);
    const totalMin = doneInRange.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
    return {
      sessions: doneInRange.length,
      totalKm,
      totalMin,
      rangeLabel: `${startYmd} → ${endYmd}`,
    };
  }, [workouts, athleteProgressRangeYmd]);

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

  const openWorkoutSummaryModal = (workoutRow) => {
    if (!workoutRow?.scheduled_date) return;
    const isStravaConnected = Boolean(stravaConnection?.access_token);
    const baseManual = {
      distanceKm: workoutRow.total_km ? String(workoutRow.total_km) : "",
      durationMin: workoutRow.duration_min ? String(workoutRow.duration_min) : "",
      rpe: workoutRow.rpe != null ? String(workoutRow.rpe) : "",
      avgHr: workoutRow.manual_avg_hr != null ? String(workoutRow.manual_avg_hr) : "",
      maxHr: workoutRow.manual_max_hr != null ? String(workoutRow.manual_max_hr) : "",
      calories: workoutRow.manual_calories != null ? String(workoutRow.manual_calories) : "",
      feeling: "😐 Normal",
      notes: workoutRow.athlete_notes || "",
    };
    setManualSummaryForm(baseManual);
    if (isStravaConnected && athleteInfo?.id) {
      setWorkoutSummaryModal({
        workout: workoutRow,
        stravaConnected: true,
        activity: null,
        stravaActivityPending: true,
      });
      return;
    }
    setWorkoutSummaryModal({ workout: workoutRow, stravaConnected: false, activity: null, stravaActivityPending: false });
  };

  useEffect(() => {
    const modal = workoutSummaryModal;
    if (!modal?.stravaActivityPending || !modal.stravaConnected || !athleteInfo?.id || !stravaConnection?.access_token) {
      return undefined;
    }
    const workoutRow = modal.workout;
    if (!workoutRow?.scheduled_date) return undefined;
    let cancelled = false;
    const dayStart = `${workoutRow.scheduled_date}T00:00:00`;
    const dayEnd = `${formatLocalYMD(addDays(new Date(`${workoutRow.scheduled_date}T12:00:00`), 1))}T00:00:00`;
    (async () => {
      const { data, error } = await supabase
        .from("strava_activities")
        .select("*")
        .eq("athlete_id", athleteInfo.id)
        .gte("start_date_local", dayStart)
        .lt("start_date_local", dayEnd)
        .order("start_date_local", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.warn("No se pudo cargar actividad strava_activities:", error);
      const activity = data || null;
      setWorkoutSummaryModal((prev) => {
        if (!prev || String(prev.workout?.id) !== String(workoutRow.id)) return prev;
        if (!prev.stravaActivityPending) return prev;
        return { ...prev, stravaActivityPending: false, activity };
      });
      if (activity) {
        setManualSummaryForm((f) => ({
          ...f,
          distanceKm: activity.distance != null ? (Number(activity.distance) / 1000).toFixed(2) : f.distanceKm,
          durationMin: activity.moving_time != null ? String(Math.max(0, Math.round(Number(activity.moving_time) / 60))) : f.durationMin,
          avgHr: activity.average_heartrate != null ? String(Math.round(Number(activity.average_heartrate))) : f.avgHr,
          maxHr: activity.max_heartrate != null ? String(Math.round(Number(activity.max_heartrate))) : f.maxHr,
          calories:
            activity.calories != null
              ? String(Math.round(Number(activity.calories)))
              : activity.kilojoules != null
                ? String(Math.round(Number(activity.kilojoules)))
                : f.calories,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    workoutSummaryModal?.workout?.id,
    workoutSummaryModal?.workout?.scheduled_date,
    workoutSummaryModal?.stravaActivityPending,
    workoutSummaryModal?.stravaConnected,
    athleteInfo?.id,
    stravaConnection?.access_token,
  ]);

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
      const { newAwards, snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteInfo.id);
      const hayLogroNuevo = newAwards.length > 0;
      if (progress) void progress;
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(progress || computeAchievementProgress(nextWorkouts.filter((x) => x.done)));
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        setMedalToast(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
        setTimeout(() => setMedalToast(""), 4200);
      }
      openWorkoutSummaryModal({ ...w, done: true, rpe: next ? w.rpe : null });
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
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RAF_ATHLETE_NAV_TAB_KEY, tabId);
    }
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

  const renderAthleteProgressCard = (marginBottom) => (
    <div style={{ ...S.card, marginBottom, overflow: "visible" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {[
          { id: "week", label: "Semana" },
          { id: "month", label: "Mes" },
          { id: "year", label: "Año" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAthleteProgressTab(t.id)}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "8px 12px",
              background: athleteProgressTab === t.id ? "rgba(245,158,11,.14)" : "#fff",
              fontWeight: athleteProgressTab === t.id ? 800 : 600,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".78em",
              color: athleteProgressTab === t.id ? "#c2410c" : "#64748b",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ color: "#64748b", fontSize: ".8em", marginBottom: 12 }}>{athleteProgressStats.rangeLabel}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🏃 Kilometraje total</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{athleteProgressStats.totalKm.toFixed(1)} km</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>⏱️ Tiempo total</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>
            {formatDurationMinutesTotal(athleteProgressStats.totalMin)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🗓️ Sesiones completadas</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{athleteProgressStats.sessions}</span>
        </div>
      </div>
    </div>
  );

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

      {renderAthleteProgressCard(14)}

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
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "home" ? "#c2410c" : "#64748b", background: athleteActiveTab === "home" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "home" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("home")}><span className="pf-bnav-icon">🏠</span><span style={{ fontSize: "10px" }}>Inicio</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "marketplace" ? "#c2410c" : "#64748b", background: athleteActiveTab === "marketplace" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "marketplace" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("marketplace")}><span className="pf-bnav-icon">🛒</span><span style={{ fontSize: "10px" }}>Market</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "challenges" ? "#c2410c" : "#64748b", background: athleteActiveTab === "challenges" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "challenges" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("challenges")}><span className="pf-bnav-icon">🏆</span><span style={{ fontSize: "10px" }}>Retos</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "eval" ? "#c2410c" : "#64748b", background: athleteActiveTab === "eval" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "eval" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("eval")}><span className="pf-bnav-icon">⚡</span><span style={{ fontSize: "10px" }}>Eval</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "profile" ? "#c2410c" : "#64748b", background: athleteActiveTab === "profile" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "profile" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("profile")}><span className="pf-bnav-icon">👤</span><span style={{ fontSize: "10px" }}>Perfil</span></button>
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
                <MarketplaceHub
                  profileRole="athlete"
                  currentUserId={profile?.user_id ?? null}
                  coachUserId={null}
                  notify={notifyCallback}
                  styles={styles}
                  MarketplacePlanWorkoutsAccordion={MarketplacePlanWorkoutsAccordion}
                />
              </Suspense>
            ) : null}

            {athleteActiveTab === "challenges" ? (
              <Suspense fallback={<div style={{ padding: 20 }}>Cargando retos...</div>}>
                <ChallengesHub
                  profileRole="athlete"
                  currentUserId={profile?.user_id ?? null}
                  athleteId={athleteInfo?.id ?? null}
                  isAthlete
                  coachAthletes={EMPTY_ARRAY}
                  workouts={workouts}
                  notify={notifyCallback}
                  styles={styles}
                  normalizeWorkoutRow={normalizeWorkoutRowStable}
                />
              </Suspense>
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
              workoutSummaryModal.stravaActivityPending ? (
                <div style={{ color: "#64748b", fontSize: ".86em", marginBottom: 14 }}>Cargando datos de Strava…</div>
              ) : workoutSummaryModal.activity ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Distancia</div><div style={{ fontWeight: 800 }}>{((Number(workoutSummaryModal.activity.distance) || 0) / 1000).toFixed(2)} km</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Tiempo total</div><div style={{ fontWeight: 800 }}>{formatDurationClock(Number(workoutSummaryModal.activity.elapsed_time || workoutSummaryModal.activity.moving_time || 0))}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Ritmo promedio</div><div style={{ fontWeight: 800 }}>{formatStravaPace(Number(workoutSummaryModal.activity.distance || 0), Number(workoutSummaryModal.activity.moving_time || 0))}</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>FC prom / máx</div><div style={{ fontWeight: 800 }}>{Number(workoutSummaryModal.activity.average_heartrate || 0) > 0 ? Math.round(Number(workoutSummaryModal.activity.average_heartrate)) : "—"} / {Number(workoutSummaryModal.activity.max_heartrate || 0) > 0 ? Math.round(Number(workoutSummaryModal.activity.max_heartrate)) : "—"} lpm</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Elevación</div><div style={{ fontWeight: 800 }}>{Math.round(Number(workoutSummaryModal.activity.total_elevation_gain || 0))} m</div></div>
                  <div style={{ ...S.card, margin: 0, padding: 12 }}><div style={{ fontSize: ".72em", color: "#64748b" }}>Calorías</div><div style={{ fontWeight: 800 }}>{Math.round(Number(workoutSummaryModal.activity.calories || workoutSummaryModal.activity.kilojoules || 0))}</div></div>
                </div>
              ) : (
                <div style={{ color: "#64748b", fontSize: ".86em", marginBottom: 14 }}>No encontramos una actividad de Strava para ese día.</div>
              )
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

}
