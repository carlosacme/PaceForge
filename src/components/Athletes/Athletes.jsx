import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { exportAthletePlanToPdf } from "../../lib/exportAthletePlanPdf";
import WeatherWidget from "../WeatherWidget";
import PushToWatchButton from "../PushToWatchButton";
import WorkoutDetailBreakdown from "../WorkoutDetailBreakdown";
import WorkoutStructureTable from "../shared/WorkoutStructureTable";
import FormaFatigaLineChart from "../shared/FormaFatigaLineChart";
import StatusBadge from "./StatusBadge";
import { AthleteListAvatar, DeviceConnectionBadges, UnreadMessagesBadge, WeeklyLoadLine } from "./listBadges";
import { useAthletePayments } from "./useAthletePayments";
import AthletePaymentsPanel, { AthletePaymentModal } from "./AthletePaymentsPanel";
import { readStructure } from "../../lib/workoutStructure";
import { compareBlocks } from "../../lib/blockComparison";
import { fmtPace } from "../../lib/vdot";
import { setResumeUiBusy } from "../../lib/resumeGuard";
import {
  WORKOUT_TYPES,
  WORKOUT_BLOCK_TYPES,
  formatLocalYMD,
  getMonthGrid,
  cellIsInViewMonth,
  RACE_DISTANCE_PRESETS,
  RACE_PRIORITY_OPTIONS,
  racePriorityMeta,
  raceDistanceToFormFields,
  normalizeRaceRow,
  getNextRaceCountdown,
  emptyWorkoutStructureRow,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  formatDurationMinutesTotal,
  computeGarminLoadMetricsFromWorkouts,
  achievementJoinMeta,
  computeAthleteAchievementVisualProgress,
  sendChatPushNotification,
  PUSH_INACTIVE_REASONS,
  computeHrZones,
  RESTING_HR_MIN,
  RESTING_HR_MAX,
  MIN_HR_RESERVE,
  formatMessageTimestamp,
  loadAthleteAchievementSnapshot,
  evaluateAndAwardAthleteAchievements,
  fetchActiveDeviceConnections,
  fetchUnreadMessageCounts,
  fetchWeeklyKmByAthlete,
  markConversationRead,
  normalizeWorkoutRow,
  deleteIntervalsEvents,
  styles,
  computeFormaFatigaWeeklyPoints,
  formaFatigaStatusFromPoint,
} from "../shared/appShared";

const WorkoutRouteMap = React.lazy(() => import("../WorkoutRouteMap"));

/** Same labels as App calendar headers (accented). */
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function Athletes({ athletes, selected, onSelect, workoutsRefresh, openRegistroWorkoutId, onRegistroOpened, onAthleteWorkoutsDoneSync, onAthleteFcSync, coachDisplayName, onDeleteAthlete, notify, onOpenInviteModal }) {
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
  /** Atletas a los que ya se avisó de que no tienen push, para no repetirlo. */
  const pushWarnedAthletesRef = useRef(new Set());
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
  const athletePaymentsApi = useAthletePayments({
    athleteId: athlete?.id ?? null,
    athleteEmail: athlete?.email,
    athleteName: athlete?.name,
    coachId,
    notify,
  });
  const chatScrollRef = useRef(null);
  const normalized = searchQuery.trim().toLowerCase();
  const filteredAthletes = normalized
    ? athletes.filter(a => (a.name || "").toLowerCase().includes(normalized) || (a.goal || "").toLowerCase().includes(normalized))
    : athletes;

  // Conexiones de dispositivo de TODA la lista en una sola consulta. La clave
  // en las dependencias es la lista de ids, no el array: asi no se repite la
  // consulta cada vez que el padre reconstruye el array de atletas.
  const [deviceConnections, setDeviceConnections] = useState({});
  const [deviceConnectionsReady, setDeviceConnectionsReady] = useState(false);
  const athleteIdsKey = athletes
    .map((a) => Number(a.id))
    .filter((n) => Number.isFinite(n))
    .sort((x, y) => x - y)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = athleteIdsKey ? athleteIdsKey.split(",").map(Number) : [];
    if (!ids.length) {
      setDeviceConnections({});
      setDeviceConnectionsReady(true);
      return undefined;
    }
    setDeviceConnectionsReady(false);
    fetchActiveDeviceConnections(ids).then(({ ok, byAthlete }) => {
      if (cancelled) return;
      setDeviceConnections(byAthlete);
      // Si la consulta falla no se pinta nada: decir "sin conectar" cuando en
      // realidad no pudimos leerlo seria mentir en la ficha del atleta.
      setDeviceConnectionsReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteIdsKey, workoutsRefresh]);

  // Carga de la semana (programado vs corrido) de toda la lista, en una sola
  // consulta. Se recalcula al cambiar la lista y cuando se tocan los workouts.
  const [weekLoadByAthlete, setWeekLoadByAthlete] = useState({});
  const [weekLoadReady, setWeekLoadReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = athleteIdsKey ? athleteIdsKey.split(",").map(Number) : [];
    if (!ids.length) {
      setWeekLoadByAthlete({});
      setWeekLoadReady(true);
      return undefined;
    }
    setWeekLoadReady(false);
    fetchWeeklyKmByAthlete(ids).then(({ ok, byAthlete }) => {
      if (cancelled) return;
      setWeekLoadByAthlete(byAthlete);
      setWeekLoadReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteIdsKey, workoutsRefresh]);

  // Mensajes sin leer de toda la lista, tambien en una sola consulta. El
  // contador se refresca al marcar leido y al llegar un mensaje por realtime.
  const [unreadByAthlete, setUnreadByAthlete] = useState({});
  const [unreadRefresh, setUnreadRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ids = athleteIdsKey ? athleteIdsKey.split(",").map(Number) : [];
    if (!coachId || !ids.length) {
      setUnreadByAthlete({});
      return undefined;
    }
    fetchUnreadMessageCounts({ coachId, athleteIds: ids }).then(({ ok, byAthlete }) => {
      if (cancelled || !ok) return;
      setUnreadByAthlete(byAthlete);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteIdsKey, coachId, unreadRefresh]);

  // Un mensaje nuevo del atleta enciende el punto sin recargar la lista. Si el
  // coach tiene ese chat abierto no se cuenta: lo esta leyendo ahora mismo y el
  // efecto de marcar leido lo dejaria en cero un instante despues.
  useEffect(() => {
    if (!coachId) return undefined;
    const channel = supabase
      .channel(`unread-coach-${coachId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `coach_id=eq.${coachId}` },
        (payload) => {
          const row = payload?.new;
          if (!row || row.sender_role !== "athlete" || row.read) return;
          const key = String(row.athlete_id ?? "");
          if (!key || key === String(athlete?.id ?? "")) return;
          setUnreadByAthlete((prev) => ({ ...prev, [key]: (Number(prev[key]) || 0) + 1 }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [coachId, athlete?.id]);

  // Con que atleta se esta pintando el calendario ahora mismo. Lo consulta
  // refreshWorkouts al recibir la respuesta: si el coach cambio de atleta
  // mientras llegaba, pintar esos workouts seria mostrarle el plan de otro.
  const shownAthleteIdRef = useRef(null);
  useEffect(() => {
    shownAthleteIdRef.current = athlete?.id ?? null;
  }, [athlete?.id]);

  /**
   * Carga los workouts del atleta seleccionado.
   *
   * En modo `silent` no toca el spinner ni vacia la lista si falla: se usa al
   * volver a la app, donde ya hay un calendario en pantalla y hacerlo parpadear
   * (o borrarlo por un fallo de red) seria peor que dejarlo como estaba.
   */
  const refreshWorkouts = useCallback(async (athleteId, { silent = false } = {}) => {
    if (!athleteId) return false;
    if (!silent) setLoadingWorkouts(true);
    const { data, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("scheduled_date", { ascending: true });
    const stale = String(shownAthleteIdRef.current ?? "") !== String(athleteId);
    if (stale) return false;
    if (error) {
      console.error("Error cargando workouts:", error);
      if (!silent) {
        setWorkouts([]);
        setLoadingWorkouts(false);
      }
      return false;
    }
    setWorkouts((data || []).map(normalizeWorkoutRow));
    if (!silent) setLoadingWorkouts(false);
    return true;
  }, []);

  const calendarLoadedAthleteRef = useRef(null);
  useEffect(() => {
    if (!athlete?.id) {
      setWorkouts([]);
      setCoachWorkoutAnalysis({});
      calendarLoadedAthleteRef.current = null;
      return;
    }
    // Primera carga del atleta: con spinner. Resume / workoutsRefresh: silencioso.
    const sameAthlete = String(calendarLoadedAthleteRef.current ?? "") === String(athlete.id);
    calendarLoadedAthleteRef.current = athlete.id;
    refreshWorkouts(athlete.id, { silent: sameAthlete });
  }, [athlete?.id, workoutsRefresh, refreshWorkouts]);

  useEffect(() => {
    setResumeUiBusy(Boolean(String(chatDraft || "").trim()) || Boolean(workoutPanel));
    return () => setResumeUiBusy(false);
  }, [chatDraft, workoutPanel]);

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

  // Cargar análisis guardados desde localStorage al cambiar de atleta o workouts
  useEffect(() => {
    if (!workouts.length) return;
    const loaded = {};
    for (const w of workouts) {
      try {
        const saved = localStorage.getItem(`raf_analysis_${w.id}`);
        if (saved) loaded[w.id] = saved;
      } catch {}
    }
    if (Object.keys(loaded).length > 0) {
      setCoachWorkoutAnalysis((prev) => ({ ...loaded, ...prev }));
    }
  }, [workouts]);

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
    priority: "A",
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
    priority: "A",
  });
  const [raceMoveDate, setRaceMoveDate] = useState("");
  const [raceActionBusy, setRaceActionBusy] = useState(false);
  const [rangeDeleteOpen, setRangeDeleteOpen] = useState(false);
  const [rangeDeleteFrom, setRangeDeleteFrom] = useState("");
  const [rangeDeleteTo, setRangeDeleteTo] = useState("");
  const [rangeDeleteBusy, setRangeDeleteBusy] = useState(false);
  const [chatClearing, setChatClearing] = useState(false);
const [expandedWorkoutLogs, setExpandedWorkoutLogs] = useState({});
const [coachAnalysisModal, setCoachAnalysisModal] = useState(null);
const [registroModal, setRegistroModal] = useState(null);
const [registroLaps, setRegistroLaps] = useState(null);       // array de laps | null
const [registroLapsLoading, setRegistroLapsLoading] = useState(false);
const [registroLapsError, setRegistroLapsError] = useState(false);

  // Deep link coach_workout_completed: abrir "Ver registro" de ese workout.
  useEffect(() => {
    if (!openRegistroWorkoutId || !workouts.length) return;
    const w = workouts.find((x) => String(x.id) === String(openRegistroWorkoutId));
    if (!w) return;
    setRegistroModal(w);
    onRegistroOpened?.();
  }, [openRegistroWorkoutId, workouts, onRegistroOpened]);

// Al abrir el modal, si el workout tiene actividad de intervals.icu y
// estructura, traemos los laps para la comparacion por bloque.
useEffect(() => {
  const w = registroModal;
  setRegistroLaps(null);
  setRegistroLapsError(false);
  setRegistroLapsLoading(false);
  if (!w || !w.intervals_activity_id) return;
  const structure = readStructure(w);
  if (!Array.isArray(structure) || structure.length === 0) return;

  let cancelled = false;
  (async () => {
    setRegistroLapsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch("/api/integrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "activity-intervals",
          athlete_id: w.athlete_id,
          activity_id: w.intervals_activity_id,
        }),
      });
      const data = await resp.json();
      if (cancelled) return;
      setRegistroLaps(resp.ok && Array.isArray(data.icu_intervals) ? data.icu_intervals : []);
    } catch (e) {
      if (!cancelled) { setRegistroLaps([]); setRegistroLapsError(true); }
    } finally {
      if (!cancelled) setRegistroLapsLoading(false);
    }
  })();
  return () => { cancelled = true; };
}, [registroModal]);

// VDOT del atleta desde la evaluacion mas reciente (normalizeAthlete no lo
// arrastra, por eso athlete.vdot es undefined). coachAthleteEvaluations solo
// trae { vdot, created_at }, asi que ordenamos por test_date||created_at.
const athleteVdot = useMemo(() => {
  const evals = coachAthleteEvaluations || [];
  if (!evals.length) return null;
  const latest = [...evals].sort(
    (a, b) => new Date(b.test_date || b.created_at) - new Date(a.test_date || a.created_at)
  )[0];
  const v = Number(latest?.vdot);
  return Number.isFinite(v) && v > 0 ? v : null;
}, [coachAthleteEvaluations]);

// Comparacion plan vs ejecutado por bloque (null si aun no hay laps).
const registroBlocks = useMemo(() => {
  const w = registroModal;
  if (!w || !Array.isArray(registroLaps) || registroLaps.length === 0) return null;
  const structure = readStructure(w);
  if (!Array.isArray(structure) || structure.length === 0) return null;
  try {
    return compareBlocks({ structure, laps: registroLaps, vdot: athleteVdot });
  } catch { return null; }
}, [registroModal, registroLaps, athleteVdot]);
const [adjustProposalModal, setAdjustProposalModal] = useState(null);
const [adjustLoading, setAdjustLoading] = useState(false);
const [coachWorkoutAnalysis, setCoachWorkoutAnalysis] = useState({});
const [coachWorkoutAnalysisLoading, setCoachWorkoutAnalysisLoading] = useState({});
const analyzeWorkoutAsCoach = async (w, athleteName) => {
  if (coachWorkoutAnalysisLoading[w.id]) return;
  setCoachWorkoutAnalysisLoading((prev) => ({ ...prev, [w.id]: true }));
  setCoachWorkoutAnalysis((prev) => ({ ...prev, [w.id]: "" }));
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/analyze-workout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        workout: w,
        athleteName: athleteName || "el atleta",
        role: "coach",
        laps: registroModal && String(registroModal.id) === String(w.id) ? registroLaps : undefined,
      }),
    });
    const data = await response.json();
    if (data?.analysis) {
      setCoachWorkoutAnalysis((prev) => ({ ...prev, [w.id]: data.analysis }));
      try { localStorage.setItem(`raf_analysis_${w.id}`, data.analysis); } catch {}
    }
  } catch (e) {
    console.error("analyzeWorkoutAsCoach error:", e);
  } finally {
    setCoachWorkoutAnalysisLoading((prev) => ({ ...prev, [w.id]: false }));
  }
};
  const adjustPlanWithAI = async (completedWorkout) => {
    if (adjustLoading || !completedWorkout?.id) return;
    const today = formatLocalYMD(new Date());
    const future = workouts
      .filter((w) => !w.done && w.scheduled_date >= today)
      .slice(0, 7);
    if (future.length === 0) {
      notify("No hay entrenamientos futuros para ajustar.");
      return;
    }
    setAdjustLoading(true);
    setCoachAnalysisModal(null);
    notify(`Analizando plan con ${future.length} entrenamientos futuros…`);
    try {
      const recent = workouts
        .filter((w) => w.done && String(w.id) !== String(completedWorkout.id))
        .slice(-5);
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/analyze-workout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "adjust",
          workout: completedWorkout,
          athleteName: athlete?.name,
          recentWorkouts: recent,
          futureWorkouts: future,
          role: "coach",
        }),
      });
      const data = await response.json();
      if (!response.ok) { notify(data?.error || "Error al ajustar plan."); return; }
      const adjCount = (data.adjustments || []).length;
      notify(`IA detectó: ${data.signal || "sin señal"} · ${adjCount} cambio(s) propuesto(s)`);
      setAdjustProposalModal({
        signal: data.signal,
        summary: data.summary,
        adjustments: data.adjustments || [],
        futureWorkouts: future,
        completedWorkout,
      });
    } catch (e) {
      console.error("adjustPlanWithAI error:", e);
      notify("Error al conectar con IA.");
    } finally {
      setAdjustLoading(false);
    }
  };

  const applyAdjustment = async (adjustment) => {
    const chg = {};
    if (adjustment.changes.total_km != null) chg.total_km = adjustment.changes.total_km;
    if (adjustment.changes.duration_min != null) chg.duration_min = adjustment.changes.duration_min;
    if (adjustment.changes.type != null) chg.type = adjustment.changes.type;
    if (adjustment.changes.description != null) chg.description = adjustment.changes.description;
    if (adjustment.changes.title != null) chg.title = adjustment.changes.title;
    // Si la IA no dio título pero cambió km o tipo, generar título automático
    if (chg.title == null && (chg.total_km != null || chg.type != null)) {
      const newType = chg.type || (workouts.find(w => String(w.id) === String(adjustment.workout_id))?.type);
      const newKm = chg.total_km ?? workouts.find(w => String(w.id) === String(adjustment.workout_id))?.total_km;
      const typeLabel = WORKOUT_TYPES.find(t => t.id === newType)?.label || newType || "Entrenamiento";
      chg.title = newKm ? `${typeLabel} ${newKm}km` : typeLabel;
    }
    if (Object.keys(chg).length === 0) return;
    const { error } = await supabase.from("workouts").update(chg).eq("id", adjustment.workout_id);
    if (error) { notify("Error aplicando cambio: " + error.message); return; }

    if (chg.type != null || chg.total_km != null || chg.duration_min != null) {
      const originalWorkout = workouts.find(w => String(w.id) === String(adjustment.workout_id));
      const finalType = chg.type || originalWorkout?.type;
      const finalKm = chg.total_km ?? originalWorkout?.total_km ?? 0;
      const finalDuration = chg.duration_min ?? originalWorkout?.duration_min ?? 30;
      const originalKm = originalWorkout?.total_km || finalKm;
      const originalDuration = originalWorkout?.duration_min || finalDuration;

      const simpleTypes = ["easy", "long", "recovery", "tempo", "progression"];
      const isSimple = simpleTypes.includes(finalType);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const stepsRes = await fetch("/api/analyze-workout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            action: "adjust-steps",
            workout_id: adjustment.workout_id,
            isSimple,
            finalType,
            finalKm,
            finalDuration,
            originalKm,
            originalDuration,
            description: chg.description,
            title: chg.title,
          })
        });
        const stepsData = await stepsRes.json();
        if (stepsData?.structure) chg.structure = stepsData.structure;
      } catch (e) {
        console.error("adjust-steps error:", e);
      }
    }

    setWorkouts((prev) => prev.map((w) =>
      String(w.id) === String(adjustment.workout_id) ? { ...w, ...chg } : w
    ));
  };

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
      priority: race.priority || "A",
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
        priority: raceEditForm.priority || "A",
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
  const coachGarminLoadMetrics = useMemo(() => computeGarminLoadMetricsFromWorkouts(workouts), [workouts]);

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
    const mh = 320;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setCalendarCtxMenu({ x, y, workoutId: w.id, view: "actions" });
  };

  const openCalendarWorkoutDetail = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCalendarCtxMenu((prev) => {
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

  /**
   * ¿Merece la pena preguntar a intervals.icu por este atleta?
   *
   * Solo se ahorra la llamada cuando SABEMOS que no hay conexion. Si el mapa de
   * conexiones no se pudo leer, se llama: dejar un evento huerfano en el reloj
   * por una consulta que fallo es peor que una peticion de mas, y el servidor ya
   * responde "sin conexión" sin tocar nada.
   */
  const mayHaveIntervals = (athleteId) => {
    if (!deviceConnectionsReady) return true;
    const conns = deviceConnections[String(athleteId)] || [];
    return conns.some((c) => c.provider === "intervals_icu");
  };

  /**
   * Retira los eventos de intervals.icu de unos workouts ya borrados. Best
   * effort y sin await: el borrado local ya termino y no se bloquea al usuario
   * por el reloj. Si falla, queda el aviso en consola y el evento huerfano.
   */
  const forgetIntervalsEvents = (athleteId, ids) => {
    if (!athleteId || !ids.length || !mayHaveIntervals(athleteId)) return;
    deleteIntervalsEvents(athleteId, ids).then((r) => {
      if (r.ok) return;
      notify?.(ids.length === 1
        ? "El entreno se eliminó, pero no pudimos quitarlo del reloj del atleta."
        : "Los entrenos se eliminaron, pero no pudimos quitarlos del reloj del atleta.");
    });
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
    // El .select() confirma que la fila se borro de verdad: la RLS filtra en
    // silencio (200 y cero filas), y ahi no hay que tocar el reloj ni decir que
    // se elimino algo que sigue en el calendario.
    const { data, error } = await supabase.from("workouts").delete().eq("id", id).select("id");
    setWorkoutFormSaving(false);
    if (error) {
      console.error("Error eliminando workout:", error);
      setWorkouts(prev);
      notify?.(`Error eliminando workout: ${error.message}`);
      return;
    }
    if (!(data || []).length) {
      setWorkouts(prev);
      notify?.("No se eliminó el workout (no tienes permiso sobre esa fila)");
      return;
    }
    notify?.("Workout eliminado");
    // Ya no esta en la app: que tampoco siga llegando al reloj.
    forgetIntervalsEvents(w.athlete_id ?? athlete?.id, [id]);
  };

  /** Fecha legible a partir de un YYYY-MM-DD, sin desfase de zona horaria. */
  const rangeDayLabel = (ymd) => {
    if (!ymd) return "";
    const d = new Date(`${ymd}T12:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
  };

  const openRangeDeleteModal = () => {
    // Arranca con el mes que el coach esta viendo: es el rango que va a querer
    // limpiar el 90% de las veces.
    const { y, m } = calendarViewMonth;
    setRangeDeleteFrom(formatLocalYMD(new Date(y, m, 1)));
    setRangeDeleteTo(formatLocalYMD(new Date(y, m + 1, 0)));
    setRangeDeleteOpen(true);
  };

  const rangeDeleteValid = Boolean(rangeDeleteFrom && rangeDeleteTo && rangeDeleteFrom <= rangeDeleteTo);

  /** Entrenos del atleta actual dentro del rango (scheduled_date es YYYY-MM-DD). */
  const rangeDeleteWorkouts = useMemo(() => {
    if (!rangeDeleteValid) return [];
    return workouts.filter((w) => {
      const d = String(w?.scheduled_date || "");
      return d && d >= rangeDeleteFrom && d <= rangeDeleteTo;
    });
  }, [workouts, rangeDeleteFrom, rangeDeleteTo, rangeDeleteValid]);

  /** Carreras en el rango: solo para avisar de que NO se van a tocar. */
  const rangeDeleteRaces = useMemo(() => {
    if (!rangeDeleteValid) return [];
    return (races || []).filter((r) => {
      const d = String(r?.date || "");
      return d && d >= rangeDeleteFrom && d <= rangeDeleteTo;
    });
  }, [races, rangeDeleteFrom, rangeDeleteTo, rangeDeleteValid]);

  const rangeDeleteDoneCount = useMemo(
    () => rangeDeleteWorkouts.filter((w) => w.done).length,
    [rangeDeleteWorkouts],
  );

  const deleteWorkoutsInRange = async () => {
    if (!athlete?.id) return;
    if (!rangeDeleteFrom || !rangeDeleteTo) {
      notify?.("Elige las dos fechas del rango");
      return;
    }
    if (rangeDeleteFrom > rangeDeleteTo) {
      notify?.('La fecha "Desde" es posterior a "Hasta"');
      return;
    }
    const ids = rangeDeleteWorkouts.map((w) => w.id).filter((id) => id != null);
    if (!ids.length) {
      notify?.("No hay entrenos en ese rango");
      return;
    }
    const lines = [
      `Se eliminarán ${ids.length} ${ids.length === 1 ? "entreno" : "entrenos"} entre ` +
        `${rangeDayLabel(rangeDeleteFrom)} y ${rangeDayLabel(rangeDeleteTo)}. ` +
        "Esta acción no se puede deshacer.",
    ];
    if (rangeDeleteRaces.length) lines.push("Las carreras en este rango NO se eliminarán.");
    if (!window.confirm(lines.join("\n\n"))) return;

    setRangeDeleteBusy(true);
    const prev = workouts;
    const requested = new Set(ids.map(String));
    setWorkouts((rows) => rows.filter((x) => !requested.has(String(x.id))));
    // El .eq("athlete_id") es un cinturon de seguridad: los ids ya salen del
    // atleta seleccionado, pero asi ni un estado obsoleto puede tocar a otro.
    const { data, error } = await supabase
      .from("workouts")
      .delete()
      .in("id", ids)
      .eq("athlete_id", athlete.id)
      .select("id");
    setRangeDeleteBusy(false);
    if (error) {
      console.error("Error eliminando entrenos por rango:", error);
      setWorkouts(prev);
      notify?.(`Error eliminando entrenos: ${error.message}`);
      return;
    }
    // La RLS filtra en silencio lo que no es del coach: se borra sin error pero
    // con menos filas. Se reconstruye el estado con lo que REALMENTE se borro,
    // para no dejar en pantalla un calendario que miente.
    const deletedIds = new Set((data || []).map((r) => String(r.id)));
    setWorkouts(prev.filter((x) => !deletedIds.has(String(x.id))));
    if (deletedIds.size === 0) {
      notify?.("No se eliminó ningún entreno (no tienes permiso sobre esas filas)");
      return;
    }
    if (deletedIds.size < ids.length) {
      notify?.(`Se eliminaron ${deletedIds.size} de ${ids.length} entrenos (el resto no se pudo borrar por permisos).`);
    } else {
      notify?.(`${deletedIds.size} ${deletedIds.size === 1 ? "entreno eliminado" : "entrenos eliminados"}`);
    }
    // Solo los que REALMENTE se borraron: los que la RLS bloqueo siguen en la
    // app, asi que su evento debe seguir en el reloj.
    forgetIntervalsEvents(athlete.id, [...deletedIds]);
    setRangeDeleteOpen(false);
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
    const rows = data || [];
    // Fusiona: conserva los optimistas que aun NO tienen su fila real en la BD
    // (evita el parpadeo de duplicado entre el optimista y el reload).
    setChatMessages((prev) => {
      const pendientes = prev.filter((m) => {
        if (!m._pending) return false;
        return !rows.some((r) => r.body === m.body && r.sender_role === m.sender_role);
      });
      return [...rows, ...pendientes];
    });
  }, [athlete?.id, coachId]);

  const openRaceModal = () => {
    setRaceForm({
      name: "",
      date: formatLocalYMD(new Date()),
      distance: "21K",
      distanceOther: "",
      city: "",
      priority: "A",
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
        priority: raceForm.priority || "A",
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

  // El chat vive en la ficha del atleta, asi que abrir la ficha ES abrir la
  // conversacion: se marcan leidos los mensajes del atleta y se apaga el punto
  // al instante. chatMessages.length en las dependencias cubre los mensajes que
  // llegan mientras la ficha esta abierta.
  useEffect(() => {
    if (!athlete?.id || !coachId) return undefined;
    let cancelled = false;
    markConversationRead({ coachId, athleteId: athlete.id, readerRole: "coach" }).then((marked) => {
      if (cancelled || !marked) return;
      setUnreadByAthlete((prev) => ({ ...prev, [String(athlete.id)]: 0 }));
      setUnreadRefresh((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [athlete?.id, coachId, chatMessages.length]);

  useEffect(() => {
    if (!athlete?.id || !coachId) return undefined;
    const channel = supabase
      .channel(`chat-coach-${coachId}-${athlete.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `athlete_id=eq.${athlete.id}` },
        () => loadCoachChat(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [athlete?.id, coachId, loadCoachChat]);

  // Respaldo por si Realtime se cae o el navegador suspende la conexion.
  useEffect(() => {
    const t = setInterval(() => loadCoachChat(), 60000);
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
    if (fcr != null && (!Number.isFinite(fcr) || fcr < RESTING_HR_MIN || fcr > RESTING_HR_MAX)) {
      alert(`FC reposo: indica un valor entre ${RESTING_HR_MIN} y ${RESTING_HR_MAX} lpm, o déjalo vacío. Por encima de ${RESTING_HR_MAX} lpm suele ser la FC media de esfuerzo, no la de reposo.`);
      return;
    }
    if (fcr != null && fcmax != null && fcmax - fcr < MIN_HR_RESERVE) {
      alert(`La diferencia entre la FC máxima (${fcmax}) y la FC en reposo (${fcr}) es muy pequeña. Revisa ambos datos.`);
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

  const sendCoachChat = async () => {
    const body = chatDraft.trim();
    if (!body || !athlete?.id || !coachId || chatSending) return;
    setChatSending(true);
    // Optimistic: limpiar el input y mostrar el mensaje al instante.
    setChatDraft("");
    const optimistic = {
      id: `tmp-${Date.now()}`,
      athlete_id: athlete.id,
      coach_id: coachId,
      sender_role: "coach",
      body,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    setChatMessages((prev) => [...prev, optimistic]);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: athlete.id,
        coach_id: coachId,
        sender_role: "coach",
        body,
      });
      if (error) {
        console.error(error);
        // Revertir el optimista y restaurar el texto en el input.
        setChatMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setChatDraft(body);
        alert(`No se pudo enviar: ${error.message}`);
        return;
      }
      // Notificar sin bloquear la UI (fire and forget).
      sendChatPushNotification({
        toUserId: athlete.user_id,
        title: "Nuevo mensaje de tu coach",
        body,
        data: { type: "athlete_chat" },
        logLabel: "chat coach→atleta",
      })
        .then((r) => {
          // Una vez por atleta: el coach necesita saber que ese mensaje no va a
          // sonar en el telefono del atleta, sin que se lo repitan cada linea.
          if (r.sent || !PUSH_INACTIVE_REASONS.has(r.reason)) return;
          if (pushWarnedAthletesRef.current.has(String(athlete.id))) return;
          pushWarnedAthletesRef.current.add(String(athlete.id));
          notify(`${athlete.name || "El atleta"} no tiene las notificaciones activas: verá el mensaje al abrir la app.`);
        })
        .catch(() => {});
      // Reconciliar el id real del mensaje optimista, sin await bloqueante.
      loadCoachChat();
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
                  border: `1px solid ${athlete.id === a.id ? "rgba(255,138,61,.45)" : "#e2e8f0"}`,
                  background: athlete.id === a.id ? "rgba(255,138,61,.1)" : "#ffffff",
                  marginBottom: 8,
                  boxShadow: athlete.id === a.id ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                <AthleteListAvatar url={a.avatar_url} fallback={a.avatar} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: ".85em", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <UnreadMessagesBadge count={unreadByAthlete[String(a.id)]} />
                  </div>
                  <div style={{ fontSize: ".7em", color: "#64748b" }}>
                    {a.pace}
                    {weekLoadReady ? <> · <WeeklyLoadLine load={weekLoadByAthlete[String(a.id)]} /></> : null}
                  </div>
                  {deviceConnectionsReady ? <DeviceConnectionBadges connections={deviceConnections[String(a.id)]} /> : null}
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
            <PushToWatchButton athleteId={athlete?.id} athleteName={athlete?.name} />
            <StatusBadge status={athlete.status} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            {[{ label: "Ritmo", value: athlete.pace, icon: "⚡" }, { label: "Km/Semana", value: `${athlete.weekly_km}km`, icon: "📍" }, { label: "Adherencia", value: `${Math.round(athlete.workouts_done/athlete.workouts_total*100)}%`, icon: "✅" }].map((m,i) => (
              <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 12px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "1.3em" }}>{m.icon}</div>
                <div style={{ fontSize: "1.2em", fontWeight: 700, color: "#ff8a3d", fontFamily: "monospace" }}>{m.value}</div>
                <div style={{ fontSize: ".7em", color: "#64748b" }}>{m.label}</div>
              </div>
            ))}
          </div>
          </div>
<div style={{ order: 2, marginBottom: 14 }}>
  <WeatherWidget compact />
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
                  min={RESTING_HR_MIN}
                  max={RESTING_HR_MAX}
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
                  background: fcSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
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
              const { zones, warning } = computeHrZones(athlete.fc_max, athlete.fc_reposo);
              return zones.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {warning ? (
                  <div style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", fontSize: ".72em", lineHeight: 1.45 }}>
                    {warning}
                  </div>
                ) : null}
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

          <AthletePaymentsPanel
            athletePayments={athletePaymentsApi.athletePayments}
            loadingPayments={athletePaymentsApi.loadingPayments}
            paymentActionBusyId={athletePaymentsApi.paymentActionBusyId}
            openPaymentModal={athletePaymentsApi.openPaymentModal}
            updatePaymentStatus={athletePaymentsApi.updatePaymentStatus}
          />

          <div style={{ order: 6, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
              FORMA Y FATIGA
            </div>
            {!loadingWorkouts ? (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: ".72em", marginBottom: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>
                  Carga por volumen (completados · 4 semanas)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 12 }}>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Estado de entrenamiento</div>
                    <div style={{ fontSize: "1.2em", fontWeight: 900, color: coachGarminLoadMetrics.statusColor }}>{coachGarminLoadMetrics.statusLabel}</div>
                    <div style={{ fontSize: ".7em", color: "#64748b", marginTop: 8, lineHeight: 1.45 }}>
                      Ratio 7 días / promedio semanal (4 sem): &lt; 0.8 desentrenado · 0.8–1.3 óptimo · &gt; 1.3 sobreentrenado
                    </div>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga aguda (7 días)</div>
                    <div style={{ fontSize: "1.35em", fontWeight: 900, color: coachGarminLoadMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{coachGarminLoadMetrics.acuteKm.toFixed(1)} km</div>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga crónica (prom. semanal)</div>
                    <div style={{ fontSize: "1.35em", fontWeight: 900, color: coachGarminLoadMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{coachGarminLoadMetrics.chronicWeeklyAvgKm.toFixed(1)} km/sem</div>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa", gridColumn: "1 / -1", minWidth: 0 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Ratio carga aguda / crónica</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "1.35em", fontWeight: 900, fontFamily: "monospace", color: coachGarminLoadMetrics.ratioIndicatorColor }}>
                        {coachGarminLoadMetrics.hasRatio ? coachGarminLoadMetrics.ratio.toFixed(2) : "—"}
                      </span>
                      <span style={{ fontSize: ".72em", color: "#64748b" }}>verde = óptimo · rojo = extremos</span>
                    </div>
                    <div style={{ position: "relative", marginTop: 10, height: 14, borderRadius: 7, background: "linear-gradient(90deg, #dc2626 0%, #dc2626 40%, #16a34a 40%, #16a34a 65%, #dc2626 65%, #dc2626 100%)" }}>
                      {coachGarminLoadMetrics.hasRatio ? (
                        <div
                          style={{
                            position: "absolute",
                            top: -2,
                            width: 4,
                            height: 18,
                            marginLeft: -2,
                            left: `${Math.min(100, Math.max(0, (coachGarminLoadMetrics.ratio / 2) * 100))}%`,
                            background: "#0f172a",
                            borderRadius: 2,
                            boxShadow: "0 0 0 2px #fff",
                          }}
                        />
                      ) : null}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65em", color: "#94a3b8", marginTop: 4 }}>
                      <span>0</span>
                      <span>Óptimo 0.8–1.3</span>
                      <span>2+</span>
                    </div>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Sesiones / semana (prom.)</div>
                    <div style={{ fontSize: "1.35em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{coachGarminLoadMetrics.avgSessionsPerWeek.toFixed(1)}</div>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Tiempo total (4 sem)</div>
                    <div style={{ fontSize: "1.15em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{formatDurationMinutesTotal(coachGarminLoadMetrics.totalMin4w)}</div>
                  </div>
                  <div style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>Km por semana (lun–dom, más antigua → actual)</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, minHeight: 120, paddingTop: 4 }}>
                      {coachGarminLoadMetrics.weekBarsOldestFirst.map((b) => {
                        const hPct = Math.max(6, (b.km / coachGarminLoadMetrics.maxBarKm) * 100);
                        return (
                          <div key={b.key} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                            <div style={{ width: "100%", height: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "#f1f5f9", borderRadius: 8, padding: "0 6px", boxSizing: "border-box" }}>
                              <div
                                style={{
                                  width: "72%",
                                  height: `${hPct}%`,
                                  maxHeight: "100%",
                                  background: coachGarminLoadMetrics.COLOR_ORANGE,
                                  borderRadius: "6px 6px 2px 2px",
                                  boxShadow: "0 0 10px rgba(249,115,22,.35)",
                                }}
                              />
                            </div>
                            <div style={{ fontSize: ".62em", color: "#64748b", textAlign: "center", lineHeight: 1.2 }}>{b.label}</div>
                            <div style={{ fontSize: ".68em", fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>{b.km.toFixed(1)} km</div>
                            <div style={{ fontSize: ".58em", color: "#94a3b8", textAlign: "center" }}>{b.rangeLabel}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
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

          <div style={{ order: 3, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
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
                  border: "1px solid rgba(255,138,61,.45)",
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
              <button
                type="button"
                onClick={openRangeDeleteModal}
                title="Eliminar todos los entrenos de un rango de fechas"
                style={{
                  background: "#fff",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "#b91c1c",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: ".78em",
                }}
              >
                🗑 Eliminar rango
              </button>
            </div>
          </div>
          {loadingWorkouts ? (
            <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, width: "100%", minWidth: 0 }}>
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
                if (hasRace) borderColor = "rgba(255,138,61,.55)";
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
                      minHeight: 64,
                      minWidth: 0,
                      maxWidth: "100%",
                      boxSizing: "border-box",
                      overflow: "hidden",
                      border: `1px solid ${borderColor}`,
                      borderRadius: 6,
                      padding: "3px 2px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 2,
                      background: cellBackground,
                      opacity: inViewMonth ? 1 : 0.42,
                    }}
                  >
                    <div style={{ fontSize: ".58em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                    {dayRaces.map((race) => {
                      const pri = racePriorityMeta(race.priority);
                      return (
                        <button
                          key={race.id}
                          type="button"
                          onClick={(e) => openRaceCalendarMenu(e, race)}
                          title={`${race.name} · ${race.distance} · Prioridad ${pri.id} (${pri.short})${race.city ? ` · ${race.city}` : ""}`}
                          style={{
                            fontSize: ".48em",
                            fontWeight: 800,
                            color: pri.color,
                            textAlign: "center",
                            lineHeight: 1.15,
                            padding: "2px 2px",
                            borderRadius: 4,
                            background: "rgba(255,255,255,.65)",
                            border: `1px solid ${pri.color}59`,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            width: "100%",
                            boxSizing: "border-box",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          🏁 {pri.id} · {race.name}
                        </button>
                      );
                    })}
                    {dayWorkouts.slice(0, 3).map((w) => {
                      const wt = WORKOUT_TYPES.find((t) => t.id === w.type) || WORKOUT_TYPES[0];
                      const kmNum = Number(w.total_km);
                      const kmLabel = Number.isFinite(kmNum) && kmNum > 0
                        ? `${Number.isInteger(kmNum) ? kmNum : kmNum.toFixed(1)} km`
                        : "";
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
                          title={`${w.title || "Entreno"}${kmLabel ? ` · ${kmLabel}` : ""}${w.done ? " · Hecho" : " · Pendiente"}`}
                          style={{
                            border: `1px solid ${w.done ? "rgba(34,197,94,.45)" : `${wt.color}44`}`,
                            borderRadius: 5,
                            padding: "3px 4px",
                            background: w.done ? "rgba(34,197,94,.14)" : `${wt.color}10`,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textAlign: "left",
                            width: "100%",
                            minWidth: 0,
                            maxWidth: "100%",
                            boxSizing: "border-box",
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                            <span
                              aria-hidden="true"
                              title={w.done ? "Hecho" : "Pendiente"}
                              style={{
                                flexShrink: 0,
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: w.done ? "#22c55e" : wt.color,
                                boxShadow: w.done ? "0 0 0 1px rgba(34,197,94,.35)" : "none",
                              }}
                            />
                            <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: ".62em", color: wt.color, fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {w.title}
                            </span>
                            {w.done ? <span style={{ flexShrink: 0, fontSize: ".55em", color: "#16a34a", fontWeight: 800 }}>✓</span> : null}
                          </div>
                          {kmLabel ? (
                            <div style={{ fontSize: ".52em", color: "#64748b", fontWeight: 600, marginTop: 1, paddingLeft: 11, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {kmLabel}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                    {dayWorkouts.length > 3 ? (
                      <div style={{ fontSize: ".5em", color: "#94a3b8", textAlign: "center", fontWeight: 700 }}>+{dayWorkouts.length - 3}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          </div>

          <div style={{ order: 4, marginTop: 22 }}>
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
                          ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(255,138,61,.75))"
                          : "#eff6ff",
                        border: `1px solid ${isCoach ? "rgba(255,138,61,.5)" : "rgba(59,130,246,.35)"}`,
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
                  background: chatSending || !chatDraft.trim() ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
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
            minWidth: (calendarCtxMenu.view || "actions") === "detail" ? 260 : 240,
            width: (calendarCtxMenu.view || "actions") === "detail" ? "min(92vw, 340px)" : undefined,
            maxWidth: "min(92vw, 340px)",
            maxHeight: (calendarCtxMenu.view || "actions") === "detail" ? "min(70vh, 420px)" : undefined,
            overflowY: (calendarCtxMenu.view || "actions") === "detail" ? "auto" : "visible",
            background: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(15,23,42,.2)",
            border: "1px solid #e2e8f0",
            padding: (calendarCtxMenu.view || "actions") === "detail" ? 12 : 6,
          }}
        >
          {(calendarCtxMenu.view || "actions") === "detail" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCalendarCtxMenu((prev) => (prev ? { ...prev, view: "actions" } : prev));
                  }}
                  style={{ background: "transparent", border: "none", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", padding: "4px 0" }}
                >
                  ← Menú
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); closeCalendarCtxMenu(); }}
                  style={{ background: "transparent", border: "none", color: "#94a3b8", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", padding: "4px 0" }}
                >
                  Cerrar
                </button>
              </div>
              <WorkoutDetailBreakdown workout={ctxMenuWorkout} vdot={athleteVdot || 42.5} />
            </>
          ) : (
            <>
              {[
                {
                  label: ctxMenuWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho",
                  onClick: () => {
                    toggleWorkoutDone(ctxMenuWorkout);
                    closeCalendarCtxMenu();
                  },
                },
                {
                  label: "📋 Ver detalle",
                  onClick: null,
                },
                ...(ctxMenuWorkout.done
                  ? [
                      {
                        label: "📊 Ver registro",
                        onClick: () => {
                          setRegistroModal(ctxMenuWorkout);
                          closeCalendarCtxMenu();
                        },
                      },
                      {
                        label: coachWorkoutAnalysisLoading[ctxMenuWorkout.id]
                          ? "🤖 Analizando…"
                          : "🤖 Analizar IA",
                        disabled: Boolean(coachWorkoutAnalysisLoading[ctxMenuWorkout.id]),
                        onClick: () => {
                          void analyzeWorkoutAsCoach(ctxMenuWorkout, athlete?.name);
                        },
                      },
                      ...(coachWorkoutAnalysis[ctxMenuWorkout.id]
                        ? [
                            {
                              label: "📄 Ver análisis",
                              onClick: () => {
                                setCoachAnalysisModal({
                                  text: coachWorkoutAnalysis[ctxMenuWorkout.id],
                                  title: ctxMenuWorkout.title,
                                  workout: ctxMenuWorkout,
                                });
                                closeCalendarCtxMenu();
                              },
                            },
                          ]
                        : []),
                    ]
                  : []),
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
                  disabled={item.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.disabled) return;
                    if (item.label === "📋 Ver detalle") {
                      openCalendarWorkoutDetail(e);
                      return;
                    }
                    item.onClick?.();
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: item.disabled ? "#94a3b8" : item.danger ? "#b91c1c" : "#0f172a",
                    fontWeight: 600,
                    cursor: item.disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontSize: ".82em",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </>
          )}
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
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Prioridad</div>
                  <select
                    value={raceEditForm.priority}
                    onChange={(e) => setRaceEditForm((f) => ({ ...f, priority: e.target.value }))}
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                  >
                    {RACE_PRIORITY_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
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
                    style={{ background: raceActionBusy ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: raceActionBusy ? "#64748b" : "#fff", cursor: raceActionBusy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
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
                    style={{ background: raceActionBusy ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: raceActionBusy ? "#64748b" : "#fff", cursor: raceActionBusy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
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
                  <button type="button" disabled={workoutFormSaving} onClick={saveWorkoutEdits} style={{ background: workoutFormSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: workoutFormSaving ? "#64748b" : "#fff", cursor: workoutFormSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}>{workoutFormSaving ? "Guardando…" : "Guardar cambios"}</button>
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
                    style={{ background: workoutFormSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: workoutFormSaving ? "#64748b" : "#fff", cursor: workoutFormSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
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
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Prioridad</div>
                <select
                  value={raceForm.priority}
                  onChange={(e) => setRaceForm((f) => ({ ...f, priority: e.target.value }))}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                >
                  {RACE_PRIORITY_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: ".68em", color: "#64748b", marginTop: 5, lineHeight: 1.4 }}>
                  La prioridad decide el afinamiento que el generador mete en el plan de 2 semanas.
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
                style={{ background: raceSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: raceSaving ? "#64748b" : "#fff", cursor: raceSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
              >
                {raceSaving ? "Guardando…" : "Guardar carrera"}
              </button>
            </div>
          </div>
        </div>
      )}
      {rangeDeleteOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 215, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 460, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>🗑 Eliminar entrenos por rango</div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12 }}>
              Solo se eliminan los entrenos de {athlete?.name || "este atleta"}. Las carreras no se tocan.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Desde</div>
                <input
                  type="date"
                  value={rangeDeleteFrom}
                  onChange={(e) => setRangeDeleteFrom(e.target.value)}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Hasta</div>
                <input
                  type="date"
                  value={rangeDeleteTo}
                  onChange={(e) => setRangeDeleteTo(e.target.value)}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: rangeDeleteWorkouts.length ? "#fef2f2" : "#f8fafc",
                border: `1px solid ${rangeDeleteWorkouts.length ? "#fecaca" : "#e2e8f0"}`,
                fontSize: ".82em",
                color: "#334155",
                lineHeight: 1.5,
              }}
            >
              {!rangeDeleteValid ? (
                <span>Elige un rango válido: la fecha «Desde» no puede ser posterior a «Hasta».</span>
              ) : rangeDeleteWorkouts.length === 0 ? (
                <span>No hay entrenos en ese rango.</span>
              ) : (
                <>
                  <div style={{ fontWeight: 800, color: "#b91c1c" }}>
                    {rangeDeleteWorkouts.length} {rangeDeleteWorkouts.length === 1 ? "entreno" : "entrenos"} en el rango
                  </div>
                  {rangeDeleteDoneCount > 0 ? (
                    <div style={{ marginTop: 4 }}>
                      {rangeDeleteDoneCount} {rangeDeleteDoneCount === 1 ? "ya está marcado" : "ya están marcados"} como hechos: se borra también ese historial.
                    </div>
                  ) : null}
                  {rangeDeleteRaces.length > 0 ? (
                    <div style={{ marginTop: 4, color: "#b45309" }}>
                      🏁 {rangeDeleteRaces.length} {rangeDeleteRaces.length === 1 ? "carrera" : "carreras"} en este rango NO se eliminarán.
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setRangeDeleteOpen(false)}
                disabled={rangeDeleteBusy}
                style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: rangeDeleteBusy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={deleteWorkoutsInRange}
                disabled={rangeDeleteBusy || !rangeDeleteWorkouts.length}
                style={{
                  background: rangeDeleteBusy || !rangeDeleteWorkouts.length ? "#e2e8f0" : "linear-gradient(135deg,#b91c1c,#ef4444)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: rangeDeleteBusy || !rangeDeleteWorkouts.length ? "#64748b" : "#fff",
                  cursor: rangeDeleteBusy || !rangeDeleteWorkouts.length ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: ".82em",
                }}
              >
                {rangeDeleteBusy ? "Eliminando…" : `Eliminar ${rangeDeleteWorkouts.length || ""} ${rangeDeleteWorkouts.length === 1 ? "entreno" : "entrenos"}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
{adjustProposalModal && (
  <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 10011, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: ".7em", fontWeight: 800, color: "#4338ca", textTransform: "uppercase", letterSpacing: ".1em" }}>🔧 Ajuste de Plan IA</div>
          <div style={{ fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
            {adjustProposalModal.signal === "fatiga_alta" ? "🔴 Fatiga alta detectada" :
             adjustProposalModal.signal === "fatiga_media" ? "🟡 Fatiga media detectada" :
             adjustProposalModal.signal === "descarga_necesaria" ? "🔴 Semana de descarga necesaria" :
             adjustProposalModal.signal === "puede_progresar" ? "🟢 Listo para progresar" : "🟢 Estado óptimo"}
          </div>
        </div>
        <button type="button" onClick={() => setAdjustProposalModal(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
      </div>
      <div style={{ padding: "12px 14px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", marginBottom: 16, fontSize: ".85em", color: "#334155", lineHeight: 1.6 }}>
        {adjustProposalModal.summary}
      </div>
      {adjustProposalModal.adjustments.length === 0 ? (
        <div style={{ textAlign: "center", color: "#64748b", fontSize: ".88em", padding: "20px 0" }}>
          El atleta está bien — no se necesitan ajustes en el plan.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em" }}>
            Cambios propuestos ({adjustProposalModal.adjustments.length})
          </div>
          {adjustProposalModal.adjustments.map((adj, i) => {
            const fw = adjustProposalModal.futureWorkouts.find((w) => String(w.id) === String(adj.workout_id));
            return (
              <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#fafafa" }}>
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
                  {fw?.scheduled_date} — {fw?.title || fw?.type}
                </div>
                <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>{adj.reason}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {adj.changes.total_km != null && <span style={{ fontSize: ".75em", padding: "4px 8px", borderRadius: 6, background: "rgba(99,102,241,.1)", color: "#4338ca", fontWeight: 700 }}>{fw?.total_km}km → {adj.changes.total_km}km</span>}
                  {adj.changes.duration_min != null && <span style={{ fontSize: ".75em", padding: "4px 8px", borderRadius: 6, background: "rgba(99,102,241,.1)", color: "#4338ca", fontWeight: 700 }}>{fw?.duration_min}min → {adj.changes.duration_min}min</span>}
                  {adj.changes.type != null && <span style={{ fontSize: ".75em", padding: "4px 8px", borderRadius: 6, background: "rgba(255,138,61,.15)", color: "#b45309", fontWeight: 700 }}>Tipo: {fw?.type} → {adj.changes.type}</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button"
                    onClick={async () => {
                      await applyAdjustment(adj);
                      setAdjustProposalModal((prev) => ({ ...prev, adjustments: prev.adjustments.filter((_, j) => j !== i) }));
                      notify("Cambio aplicado");
                    }}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#0d9488,#14b8a6)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>✓ Aplicar</button>
                  <button type="button"
                    onClick={() => setAdjustProposalModal((prev) => ({ ...prev, adjustments: prev.adjustments.filter((_, j) => j !== i) }))}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>✕ Ignorar</button>
                </div>
              </div>
            );
          })}
          {adjustProposalModal.adjustments.length > 1 && (
            <button type="button"
              onClick={async () => {
                for (const adj of adjustProposalModal.adjustments) await applyAdjustment(adj);
                notify("Todos los cambios aplicados");
                setAdjustProposalModal(null);
              }}
              style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#4338ca,#6366f1)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".88em" }}>
              ✓ Aplicar todos los cambios
            </button>
          )}
        </div>
      )}
    </div>
  </div>
)}
{coachAnalysisModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 10010, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 800, color: "#b45309", textTransform: "uppercase", letterSpacing: ".1em" }}>🤖 Análisis IA</div>
                <div style={{ fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{coachAnalysisModal.title}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={adjustLoading}
                  onClick={() => coachAnalysisModal?.workout && adjustPlanWithAI(coachAnalysisModal.workout)}
                  style={{ border: "1px solid rgba(99,102,241,.5)", borderRadius: 8, padding: "6px 12px", background: adjustLoading ? "#e2e8f0" : "rgba(99,102,241,.1)", color: "#4338ca", fontWeight: 700, cursor: adjustLoading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}
                >
                  {adjustLoading ? "Ajustando…" : "🔧 Ajustar plan"}
                </button>
                <button type="button" onClick={() => setCoachAnalysisModal(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: ".88em", color: "#0f172a", lineHeight: 1.7, whiteSpace: "pre-wrap", borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
              {coachAnalysisModal.text.replace(/#{1,3} /g, "").replace(/\*\*/g, "")}
            </div>
          </div>
        </div>
      )}
      {registroModal && (() => {
        const w = registroModal;
        const feelingMatch = String(w.athlete_notes || "").match(/^Cómo me sentí:\s*(.+)$/m);
        const feelingText = feelingMatch ? feelingMatch[1] : "";
        const notesText = String(w.athlete_notes || "")
          .replace(/^Cómo me sentí:\s*.+$/m, "")
          .trim();
        const hasManualNumbers =
          w.manual_distance_km != null || w.manual_duration_min != null ||
          w.manual_avg_hr != null || w.manual_max_hr != null ||
          w.manual_calories != null;
        // Si hay datos del reloj (actual_*), no mostramos los manual numericos:
        // saldrian en 0 y confunden. Los reales ya se ven en "⌚ Datos del reloj".
        const hasWatchData = !!w.actual_synced_at;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 10010, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: ".7em", fontWeight: 800, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".1em" }}>📋 Registro</div>
                  <div style={{ fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{w.title}</div>
                  {w.scheduled_date ? <div style={{ fontSize: ".82em", color: "#64748b", marginTop: 2 }}>{w.scheduled_date}</div> : null}
                </div>
                <button type="button" onClick={() => setRegistroModal(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>✕</button>
              </div>
              <div style={{ fontSize: ".92em", color: "#334155", lineHeight: 1.6, borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                {!hasWatchData && hasManualNumbers && (
                  <>
                    <div><strong>Distancia:</strong> {w.manual_distance_km != null ? `${w.manual_distance_km} km` : "—"}</div>
                    <div><strong>Duración:</strong> {w.manual_duration_min != null ? `${w.manual_duration_min} min` : "—"}</div>
                    <div><strong>FC prom/máx:</strong> {w.manual_avg_hr != null ? w.manual_avg_hr : "—"} / {w.manual_max_hr != null ? w.manual_max_hr : "—"} lpm</div>
                    <div><strong>Calorías:</strong> {w.manual_calories != null ? w.manual_calories : "—"}</div>
                  </>
                )}
                {feelingText ? <div><strong>Cómo se sintió:</strong> {feelingText}</div> : null}
                {notesText ? <div><strong>Notas:</strong> {notesText}</div> : null}
                {w.completed_at ? <div><strong>Completado:</strong> {new Date(w.completed_at).toLocaleString("es-CO")}</div> : null}
                {w.actual_synced_at ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 5 }}>⌚ Datos del reloj</div>
                    <div><strong>Distancia:</strong> {w.total_km != null ? `${w.total_km} km plan` : "—"} → {w.actual_distance_km != null ? `${w.actual_distance_km} km real` : "—"}</div>
                    <div><strong>Duración:</strong> {w.duration_min != null ? `${w.duration_min} min plan` : "—"} → {w.actual_duration_min != null ? `${w.actual_duration_min} min real` : "—"}</div>
                    <div><strong>Ritmo medio real:</strong> {w.actual_avg_pace_s != null ? `${Math.floor(w.actual_avg_pace_s/60)}:${String(w.actual_avg_pace_s%60).padStart(2,"0")}/km` : "—"}</div>
                    <div><strong>FC prom/máx real:</strong> {w.actual_avg_hr ?? "—"} / {w.actual_max_hr ?? "—"} lpm</div>
                    <div><strong>Desnivel:</strong> {w.actual_elevation_m != null ? `${w.actual_elevation_m} m` : "—"}</div>
                    <div style={{ color: "#94a3b8", marginTop: 4 }}>Sincronizado del reloj: {new Date(w.actual_synced_at).toLocaleString("es-CO")}</div>
                    <React.Suspense fallback={<div style={{ marginTop: 8, color: "#94a3b8", fontSize: ".85em" }}>Cargando mapa…</div>}>
                      <WorkoutRouteMap workout={w} />
                    </React.Suspense>
                    {w.intervals_activity_id ? (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e2e8f0" }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>📊 Comparación por bloque</div>
                        <div style={{ fontSize: ".82em", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                          El ritmo planificado se deriva del esfuerzo objetivo de cada bloque y del VDOT actual del atleta{athleteVdot ? ` (VDOT ${athleteVdot})` : ""}. Es una referencia para interpretar la ejecución, no un objetivo exacto que se haya prescrito en tiempo.
                        </div>
                        {registroLapsLoading ? (
                          <div style={{ color: "#64748b" }}>Cargando bloques…</div>
                        ) : (registroBlocks && registroBlocks.length ? (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9em" }}>
                            <thead>
                              <tr style={{ textAlign: "left", color: "#64748b", fontSize: ".85em" }}>
                                <th style={{ padding: "4px 6px" }}>Bloque</th>
                                <th style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>Ritmo previsto</th>
                                <th style={{ padding: "4px 6px", textAlign: "right" }}>Real</th>
                                <th style={{ padding: "4px 6px", textAlign: "right" }}>Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {registroBlocks.map((b, i) => {
                                const faster = b.delta_s != null && b.delta_s <= 0;
                                const deltaColor = b.delta_s == null ? "#94a3b8" : (faster ? "#16a34a" : "#ea580c");
                                const deltaTxt = b.delta_s == null ? "—" : `${b.delta_s <= 0 ? "" : "+"}${Math.round(b.delta_s)}s`;
                                return (
                                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9", opacity: b.dur_mismatch && !b.incomplete ? 0.55 : 1 }}>
                                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>
                                      {b.step_name || `Bloque ${i + 1}`}
                                      {b.incomplete ? <span style={{ color: "#b45309", fontWeight: 700 }}> · no completado</span> : null}
                                      {b.dur_mismatch && !b.incomplete ? <span title="Duración muy distinta a la planeada"> ⚠️</span> : null}
                                    </td>
                                    <td style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{b.planned_pace_s != null ? `${fmtPace(b.planned_pace_s)}/km` : "—"}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{b.actual_pace_s != null ? `${fmtPace(b.actual_pace_s)}/km` : "—"}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "right", color: deltaColor, fontWeight: 700 }}>{deltaTxt}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ color: "#94a3b8" }}>No hay datos por bloque para esta actividad</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (w.done ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0", color: "#94a3b8" }}>
                    ⌚ Sin datos del reloj (el atleta no conectó intervals.icu o el reloj no había sincronizado al marcar hecho)
                  </div>
                ) : null)}
              </div>
            </div>
          </div>
        );
      })()}
      <AthletePaymentModal
        paymentModalOpen={athletePaymentsApi.paymentModalOpen}
        paymentForm={athletePaymentsApi.paymentForm}
        setPaymentForm={athletePaymentsApi.setPaymentForm}
        paymentSaving={athletePaymentsApi.paymentSaving}
        closePaymentModal={athletePaymentsApi.closePaymentModal}
        registerPayment={athletePaymentsApi.registerPayment}
      />

    </div>
  );
}

export default Athletes;
