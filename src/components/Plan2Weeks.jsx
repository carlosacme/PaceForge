import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  paceRangesForPrompt,
  vdotRequiredForRace,
  parseTimeToSeconds,
  planWeeklyVolume,
  planRaceContext,
  qualityWorkGuide,
  fmtPace,
  midPaceSecondsFromRange,
  extractPaceSecondsFromText,
} from "../lib/vdot";
import { usePersistedState } from "../hooks/usePersistedState";
import {
  BRAND_NAME,
  DAYS,
  getCurrentMonthKey,
  PLAN_12_LEVELS,
  PLAN2_NEXT_BLOCK_FOCUSES,
  PLAN2_TRAINING_DAY_OPTIONS,
  PLAN2_ATHLETE_STORAGE_KEY,
  getNextMonday,
  getPlan2ExpectedSlots,
  validatePlan2Distribution,
  sendWorkoutAssignmentPushToAthlete,
  WORKOUT_TYPES,
  formatLocalYMD,
  addDays,
  normalizeScheduledDateYmd,
  startOfWeekMonday,
  extractJsonFromAnthropicText,
  extractAnthropicTextContent,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  sumStructureRows,
  buildAthleteHrZonesPromptText,
  normalizeAthlete,
  formatDurationClock,
  formatCopInt,
  styles,
} from "./shared/appShared";
import WorkoutStructureEditor from "./shared/WorkoutStructureEditor";
import { enrichStructureWithPaces } from "../lib/enrichPace";

/** Metros por competencia, para validar el tiempo objetivo contra el VDOT. */
const RACE_METERS_BY_COMPETITION = {
  "Maratón": 42195,
  "Media Maratón": 21097.5,
  "10K": 10000,
  "5K": 5000,
};

/** Diferencia de VDOT desde la que el objetivo deja de ser realista. */
const VDOT_GAP_WARNING = 3;

/** Volumen de un bloque marcado como descarga, sobre la carga normal. */
const DELOAD_FACTOR = 0.65;

/** Bloques seguidos de carga creciente a partir de los que se sugiere bajar. */
const BLOCKS_BEFORE_DELOAD_HINT = 3;

/**
 * Parte de la sesion que se corre a ritmo facil (calentamiento y vuelta a la
 * calma). En tempo e intervalos el ritmo de las series NO es el ritmo medio de
 * la sesion, y usarlo para convertir km en minutos se queda muy corto.
 */
const EASY_SHARE_BY_TYPE = { tempo: 0.35, interval: 0.5 };

/** Zona de ritmo que le corresponde a cada tipo de sesion. */
const PACE_ZONE_BY_TYPE = {
  easy: "easy",
  long: "easy",
  recovery: "recovery",
  tempo: "tempo",
  interval: "interval",
  race: "marathon",
};

/** Numeros seguidos de una unidad, ignorando los ritmos ("7:55 min/km"). */
const numbersWithUnit = (text, unit) => {
  const re = unit === "km"
    ? /(^|[^\d:.,])(\d+(?:[.,]\d+)?)\s*km\b/gi
    : /(^|[^\d:.,])(\d+(?:[.,]\d+)?)\s*min(?:utos)?\b(\s*\/)?/gi;
  const out = [];
  let m = re.exec(text);
  while (m) {
    if (!(unit === "min" && m[3])) out.push(Number(String(m[2]).replace(",", ".")));
    m = re.exec(text);
  }
  return out.filter((n) => Number.isFinite(n));
};

function Plan2Weeks({ athletes, notify, coachUserId, coachPlan, profileRole, onGoToPlans, onPlanAssigned }) {
  const S = styles;
  const [athleteId, setAthleteId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("raf_plan2_athlete") || "";
  });
  // Los parametros del plan son POR ATLETA. Con una sola clave compartida, al
  // cambiar de atleta se arrastraban los del anterior (VDOT incluido) y el plan
  // salia con los ritmos de otra persona.
  const athleteStorageKey = String(athleteId || "none");
  const [competition, setCompetition] = usePersistedState(`raf_plan2_competition_${athleteStorageKey}`, "Maratón");
  const [targetTime, setTargetTime] = usePersistedState(`raf_plan2_targetTime_${athleteStorageKey}`, "");
  const [levelId, setLevelId] = usePersistedState(`raf_plan2_levelId_${athleteStorageKey}`, "intermedio");
  const [daysPerWeek, setDaysPerWeek] = usePersistedState(`raf_plan2_daysPerWeek_${athleteStorageKey}`, 3);
  const [startDate, setStartDate] = usePersistedState(`raf_plan2_startDate_${athleteStorageKey}`, formatLocalYMD(addDays(new Date(), 14)));
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
    description: "",
    structureRows: [],
  });
  // Valores con los que se abrio el editor: sirven para saber si el coach
  // movio km o duracion y avisar de que la descripcion se quedo vieja.
  const [editInitial, setEditInitial] = useState({ total_km: 0, duration_min: 0, hasStructure: false });
  const [editManual, setEditManual] = useState(false);
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
  const [nextBlockParams, setNextBlockParams] = usePersistedState(`raf_plan2_nextBlock_${athleteStorageKey}`, {
    vdot: "",
    trainingDays: [3, 6, 7],
    focus: PLAN2_NEXT_BLOCK_FOCUSES[0],
    notes: "",
  });
  // Ultima evaluacion del atleta: VDOT medido (ritmos) y km/semana declarados
  // (volumen). Se recarga SIEMPRE al cambiar de atleta; nextBlockParams.vdot es
  // solo un override manual del coach.
  const [evalInfo, setEvalInfo] = useState({ loading: false, vdot: null, weeklyKm: null, testDate: null });
  // Carreras futuras del atleta: mandan sobre la fase por numero de bloque.
  const [athleteRaces, setAthleteRaces] = useState([]);
  const [isDeloadBlock, setIsDeloadBlock] = usePersistedState(`raf_plan2_deload_${athleteStorageKey}`, false);
  const [lastDeloadBlock, setLastDeloadBlock] = usePersistedState(`raf_plan2_lastDeload_${athleteStorageKey}`, 0);
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
  // Los dias los fija la plantilla segun el numero de sesiones, no la seleccion
  // del coach: la validacion posterior exige justamente esos weekdays, y si el
  // prompt pedia otros la generacion se rechazaba sola.
  const selectedTrainingDaysText = useMemo(() => {
    const expected = getPlan2ExpectedSlots(daysPerWeek).map((s) => s.weekday);
    return PLAN2_TRAINING_DAY_OPTIONS
      .filter((d) => expected.includes(d.weekday))
      .map((d) => `${d.label}(${d.weekday})`)
      .join(", ");
  }, [daysPerWeek]);
  const levelLabel = useMemo(
    () => PLAN_12_LEVELS.find((l) => l.id === levelId)?.label || levelId,
    [levelId],
  );

  // El coach puede sobreescribir el VDOT a mano (p. ej. mejoro y aun no hay
  // evaluacion nueva). Vacio = usar el de la evaluacion.
  const vdotOverride = useMemo(() => {
    const raw = String(nextBlockParams.vdot ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [nextBlockParams.vdot]);

  /** VDOT que se va a usar de verdad, con su procedencia para la UI. */
  const effectiveVdot = useMemo(() => {
    if (vdotOverride != null) return { value: vdotOverride, source: "manual" };
    if (evalInfo.vdot != null) return { value: evalInfo.vdot, source: "evaluation" };
    return { value: null, source: "estimated" };
  }, [vdotOverride, evalInfo.vdot]);

  const vdotPaceRanges = useMemo(
    () => paceRangesForPrompt(effectiveVdot.value, String(levelId || "intermedio").toLowerCase()),
    [effectiveVdot.value, levelId],
  );

  const vdotLabel = useMemo(() => {
    if (evalInfo.loading) return "Cargando VDOT del atleta…";
    const shown = vdotPaceRanges ? Number(vdotPaceRanges.vdotUsed) : null;
    if (shown == null) return "";
    if (effectiveVdot.source === "manual") return `VDOT ${shown.toFixed(2)} (ajustado a mano por el coach)`;
    if (effectiveVdot.source === "evaluation") {
      const d = evalInfo.testDate ? new Date(`${String(evalInfo.testDate).slice(0, 10)}T12:00:00`) : null;
      const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO") : "fecha desconocida";
      return `VDOT ${shown.toFixed(2)} (evaluación del ${when})`;
    }
    return `VDOT ${shown} (estimado — este atleta no tiene evaluación)`;
  }, [evalInfo.loading, evalInfo.testDate, effectiveVdot.source, vdotPaceRanges]);

  /**
   * Km/semana reales del atleta: primero lo declarado en la ultima evaluacion,
   * si no el dato de su perfil. null = no hay dato y se usara el piso del nivel.
   */
  const declaredWeeklyKm = useMemo(() => {
    if (evalInfo.weeklyKm != null) return evalInfo.weeklyKm;
    const fromProfile = Number(selectedAthlete?.weekly_km);
    return Number.isFinite(fromProfile) && fromProfile > 0 ? Math.round(fromProfile) : null;
  }, [evalInfo.weeklyKm, selectedAthlete?.weekly_km]);

  /** Volumen semanal objetivo del bloque: base real del atleta + progresion. */
  const volumePlan = useMemo(
    () => planWeeklyVolume({
      declaredKm: declaredWeeklyKm,
      level: levelId,
      competition,
      blockNumber: Number(currentBlock) || 1,
    }),
    [declaredWeeklyKm, levelId, competition, currentBlock],
  );

  const volumeLabel = useMemo(() => {
    if (evalInfo.loading) return "Cargando volumen del atleta…";
    const declaredText = declaredWeeklyKm == null
      ? `sin dato declarado, piso de ${volumePlan.floorKm} km por nivel`
      : declaredWeeklyKm < volumePlan.floorKm
        ? `declara ${declaredWeeklyKm} km/semana, se sube al piso de ${volumePlan.floorKm} km por nivel`
        : `declara ${declaredWeeklyKm} km/semana`;
    const capText = volumePlan.cappedByLevel ? `, limitado por el techo del nivel (${volumePlan.capKm} km)` : "";
    return `Semana 1 ≈ ${volumePlan.targetKm} km — ${declaredText}${capText}`;
  }, [evalInfo.loading, declaredWeeklyKm, volumePlan]);

  /** Carreras que caen dentro del bloque y afinamiento que toca cada semana. */
  const raceContext = useMemo(
    () => planRaceContext({ races: athleteRaces, blockStartYmd: startDate, weekCount: 2 }),
    [athleteRaces, startDate],
  );

  /**
   * Km de cada semana del bloque ya con el afinamiento de la carrera y la
   * descarga aplicados. El recorte se mide siempre contra la carga normal del
   * bloque (volumePlan.targetKm), no en cascada.
   */
  const blockWeekTargets = useMemo(() => {
    const blockNumber = Number(currentBlock) || 1;
    const normalWeek2 = blockNumber >= 8
      ? Math.round(volumePlan.targetKm * 0.6)
      : Math.min(volumePlan.capKm, Math.round(volumePlan.targetKm * 1.08));
    const normals = [volumePlan.targetKm, normalWeek2];
    return [0, 1].map((i) => {
      const week = raceContext.weeks[i] || { weekNumber: i + 1, race: null, taper: null };
      const cutPct = week.taper?.cutPct || 0;
      const normalKm = normals[i];
      let km = cutPct ? Math.round(volumePlan.targetKm * (1 - cutPct / 100)) : normalKm;
      // Descarga y afinamiento no se suman: manda el que deje la semana mas baja.
      if (isDeloadBlock) km = Math.min(km, Math.round(normalKm * DELOAD_FACTOR));
      return {
        weekNumber: i + 1,
        km: Math.max(5, km),
        normalKm,
        cutPct,
        race: week.race,
        taper: week.taper,
      };
    });
  }, [raceContext, volumePlan, currentBlock, isDeloadBlock]);

  /** Aviso informativo cuando hay competicion dentro del bloque. */
  const raceInBlockWarning = useMemo(() => {
    const week = blockWeekTargets.find((w) => w.race);
    if (!week) return "";
    const r = week.race;
    const fecha = new Date(`${r.date}T12:00:00`).toLocaleDateString("es-CO");
    if (r.priority === "C") {
      return `${r.name} (${r.distance}) el ${fecha} cae dentro de este bloque. Es prioridad C: se corre dentro de la carga normal, sin afinamiento.`;
    }
    return `${r.name} (${r.distance}) el ${fecha} cae dentro de este bloque. El plan incluirá afinamiento.`;
  }, [blockWeekTargets]);

  /** Sugerencia (no obligacion) de meter una descarga tras varios bloques. */
  const blocksSinceDeload = useMemo(() => {
    const block = Number(currentBlock) || 1;
    const last = Number(lastDeloadBlock) || 0;
    return Math.max(0, block - last);
  }, [currentBlock, lastDeloadBlock]);

  const deloadSuggestion = useMemo(() => {
    if (isDeloadBlock) return "";
    if ((Number(currentBlock) || 1) < BLOCKS_BEFORE_DELOAD_HINT) return "";
    if (blocksSinceDeload < BLOCKS_BEFORE_DELOAD_HINT) return "";
    return `Llevas ${blocksSinceDeload} bloques de carga creciente. Considera una semana de descarga.`;
  }, [isDeloadBlock, currentBlock, blocksSinceDeload]);

  /** Aviso NO bloqueante si el tiempo objetivo no cuadra con el VDOT. */
  const targetTimeWarning = useMemo(() => {
    const meters = RACE_METERS_BY_COMPETITION[competition];
    const secs = parseTimeToSeconds(targetTime);
    const current = vdotPaceRanges ? Number(vdotPaceRanges.vdotUsed) : null;
    if (!meters || !secs || current == null) return "";
    const required = vdotRequiredForRace(meters, secs);
    if (required == null || required - current < VDOT_GAP_WARNING) return "";
    const currentText = effectiveVdot.source === "estimated" ? `${current} (estimado)` : current.toFixed(1);
    return `El tiempo objetivo (${targetTime} en ${competition}) requiere un VDOT aproximado de ${required.toFixed(0)}, pero el atleta tiene ${currentText}. El plan puede ser poco realista.`;
  }, [competition, targetTime, vdotPaceRanges, effectiveVdot.source]);

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
      setEditDraft({ title: "", type: "easy", total_km: 0, duration_min: 0, weekday: 2, description: "", structureRows: [] });
      setEditInitial({ total_km: 0, duration_min: 0, hasStructure: false });
      setEditManual(false);
      return;
    }
    const wo = week.workouts?.[planEditModal.workoutIdx];
    if (!wo) {
      setPlanEditModal(null);
      return;
    }
    const km = Number(wo.total_km ?? wo.km) || 0;
    const min = Number(wo.duration_min) || 0;
    const rows = workoutStructureToEditableRows(Array.isArray(wo.structure) ? wo.structure : []);
    setEditDraft({
      title: String(wo.title || ""),
      type: WORKOUT_TYPES.some((t) => t.id === wo.type) ? wo.type : "easy",
      total_km: km,
      duration_min: min,
      weekday: Math.min(7, Math.max(1, Number(wo.weekday) || 2)),
      description: String(wo.description || ""),
      structureRows: rows,
    });
    setEditInitial({ total_km: km, duration_min: min, hasStructure: rows.length > 0 });
    setEditManual(false);
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
    setDraftLoading(true);
    const { data, error } = await supabase
      .from("plan_drafts")
      .select("*")
      .eq("athlete_id", athleteNumericId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
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

  // Recarga incondicional al cambiar de atleta: antes un guard impedia
  // sobrescribir el valor previo y el plan del atleta B se generaba con el
  // VDOT del atleta A. Orden por test_date (fecha real del test) y created_at
  // como desempate, igual que en Builder.
  useEffect(() => {
    if (!athleteId) {
      setEvalInfo({ loading: false, vdot: null, weeklyKm: null, testDate: null });
      return undefined;
    }
    let cancelled = false;
    setEvalInfo({ loading: true, vdot: null, weeklyKm: null, testDate: null });
    (async () => {
      const { data, error } = await supabase
        .from("athlete_evaluations")
        .select("vdot, weekly_km_declared, test_date, created_at")
        .eq("athlete_id", athleteId)
        .order("test_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("athlete_evaluations vdot:", error);
        setEvalInfo({ loading: false, vdot: null, weeklyKm: null, testDate: null });
        return;
      }
      const vdotVal = Number(data?.vdot);
      // 0 km es un dato valido ("viene de una pausa"), asi que solo se descarta
      // cuando la columna viene vacia.
      const kmVal = data?.weekly_km_declared == null ? null : Number(data.weekly_km_declared);
      setEvalInfo({
        loading: false,
        vdot: Number.isFinite(vdotVal) && vdotVal > 0 ? vdotVal : null,
        weeklyKm: Number.isFinite(kmVal) && kmVal >= 0 ? Math.round(kmVal) : null,
        testDate: data?.test_date || data?.created_at || null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  // Carreras futuras del atleta. El generador las necesita para afinar sobre
  // la fecha real de competicion en vez de sobre el numero de bloque.
  useEffect(() => {
    if (!athleteId) {
      setAthleteRaces([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, date, distance, priority")
        .eq("athlete_id", athleteId)
        .gte("date", formatLocalYMD(new Date()))
        .order("date", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("races plan2:", error);
        setAthleteRaces([]);
        return;
      }
      setAthleteRaces(data || []);
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
      // Los dias salen de la plantilla: al quitar uno se recalcula que dia cae
      // de verdad (primero el jueves, luego el martes), nunca el domingo.
      return { ...prev, trainingDays: getPlan2ExpectedSlots(nextSessions).map((s) => s.weekday) };
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
    setIsDeloadBlock(false);
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
    const levelKey = String(levelId || "intermedio").toLowerCase();
    const pr = vdotPaceRanges;
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

    // Ritmos derivados del VDOT medido del atleta (o estimado por nivel si aún no hay evaluación).
    const paces = {
      easy: pr.easy.desc,
      marathon: pr.marathon.desc,
      tempo: pr.tempo.desc,
      interval: pr.interval.desc,
      rep: pr.rep.desc,
      recovery: pr.recovery.desc,
    };

    // Volumen: sale del kilometraje real del atleta, no de una tabla por
    // distancia. El nivel solo pone el techo (volumePlan.capKm).
    const vol = volumePlan;
    const [week1Info, week2Info] = blockWeekTargets;
    const week1Km = week1Info.km;
    const week2Km = week2Info.km;
    const maxSessionKm = Math.max(4, Math.round(week1Km * 0.4));
    const declaredVolumeText = vol.declaredKm == null
      ? `${vol.floorKm} km/week (starting floor for level, athlete has no declared volume)`
      : vol.declaredKm < vol.floorKm
        ? `${vol.declaredKm} km/week declared, raised to ${vol.baseKm} km (starting floor for level)`
        : `${vol.declaredKm} km/week`;
    const signed = (n) => `${n > 0 ? "+" : ""}${n}%`;
    const progressionText = vol.progressionPct === 0
      ? `That is exactly the athlete's current weekly volume (${vol.baseKm} km): block 1 does not add load yet.`
      : `That is the athlete's current weekly volume (${vol.baseKm} km) progressed to block ${blockNumber}: ${signed(vol.progressionPct)} for this block, ${signed(vol.cumulativePct)} accumulated since block 1.`;

    // Calidad: el VDOT decide el tipo de series, no el nivel ni la distancia.
    const quality = qualityWorkGuide(pr.vdotUsed);

    // Fase: si hay una carrera cerca manda ella; si no, el numero de bloque.
    const governingTaper = week1Info.taper || week2Info.taper;
    const phaseByBlock = blockNumber <= 2 ? "BASE (aerobic foundation, easy runs dominate)"
      : blockNumber <= 4 ? "BUILDING (introduce tempo runs over a consolidated aerobic base)"
      : blockNumber <= 6 ? "DEVELOPMENT (threshold work and interval sessions)"
      : blockNumber <= 8 ? "PEAK (race-specific workouts, highest intensity)"
      : "TAPER (keep intensity, volume already reduced)";
    const phase = governingTaper
      ? `TAPER FOR ${governingTaper.race.name} on ${governingTaper.race.date} (keep intensity, volume already reduced)`
      : phaseByBlock;

    // Semana 2: la carrera manda; sin carrera, el numero de bloque. Antes se
    // decia "race on race date" a partir del bloque 8 aunque no hubiera
    // ninguna carrera registrada y el plan se la inventaba.
    const week2Type = week2Info.race && week2Info.race.priority !== "C"
      ? `RACE WEEK: ${week2Km} km total, the race is on ${week2Info.race.date}, only easy runs + strides before it`
      : week2Info.cutPct
        ? `TAPER WEEK: ${week2Km} km total, keep the intensity and cut the volume`
        : blockNumber >= 8
          ? `LOW-VOLUME WEEK: ${week2Km} km total, only easy runs + strides`
          : `CONSOLIDATION WEEK: ${week2Km} km total, same focus as week 1 with slightly higher volume or quality`;

    // Bloque de carreras del prompt. Sin carreras registradas no se menciona
    // ninguna: el generador no puede inventarse una competicion.
    const raceProfileLines = [];
    for (const w of blockWeekTargets) {
      if (!w.race) continue;
      raceProfileLines.push(
        `- RACE IN THIS BLOCK: ${w.race.name}, ${w.race.distance}, on ${w.race.date} (${w.race.priority} priority, week ${w.weekNumber} of this block)`,
      );
    }
    const target = raceContext.nextTargetRace;
    const targetInBlock = blockWeekTargets.some((w) => w.race && String(w.race.id) === String(target?.id));
    if (target && !targetInBlock && raceContext.daysToNextTarget != null) {
      raceProfileLines.push(`- Next target race: ${target.name} (${target.distance}) in ${raceContext.daysToNextTarget} days`);
    }

    const raceRules = [];
    for (const w of blockWeekTargets) {
      if (w.taper && w.taper.mode === "full") {
        raceRules.push(
          `- Week ${w.weekNumber} is a TAPER week for ${w.taper.race.name} (${w.taper.race.distance}, ${w.taper.race.date}): ${w.km} km total, ${w.cutPct}% below the normal load. Keep the intensity (same paces, fewer or shorter reps) and cut only the volume.`,
        );
      } else if (w.taper && w.taper.mode === "short") {
        raceRules.push(
          `- ${w.taper.race.name} (${w.taper.race.date}) is a B-priority race: do not rebuild the whole week, just keep the last 3-4 days before it easy. Week ${w.weekNumber} totals ${w.km} km.`,
        );
      }
      if (w.race && w.race.priority === "C") {
        raceRules.push(
          `- ${w.race.name} (${w.race.distance}) on ${w.race.date} is a C-priority training race: do NOT taper, keep the normal load, and replace the session scheduled that day with the race itself (title it "${w.race.name}").`,
        );
      } else if (w.race) {
        raceRules.push(
          `- On ${w.race.date} the session IS the race: title it "${w.race.name}", type "long", total_km equal to the race distance (${w.race.distance}).`,
        );
      }
    }
    const raceSection = raceRules.length
      ? `\nRACE PLAN (this overrides the block-number phase):\n${raceRules.join("\n")}\n`
      : "";

    const deloadSection = isDeloadBlock
      ? `\nDELOAD BLOCK (the coach marked this block as recovery):\n- Volume is already reduced to about ${Math.round(DELOAD_FACTOR * 100)}% of the normal load. Keep ONE short quality session (for example 4-6 x 400m or a 15 min tempo) and run everything else easy.\n`
      : "";

    // Zonas reales del atleta para el campo intensity de los bloques. Sin
    // fc_max no hay zonas y la IA usa la notacion Z1-Z5 generica.
    const hrZonesBlock = buildAthleteHrZonesPromptText(selectedAthlete);

    return `Generate a 2-week running training block as JSON only.
IMPORTANT: Respond entirely in Spanish. All fields including plan_title, focus, title, and description MUST be in Spanish. Do not use English in any field.

ATHLETE PROFILE:
- Goal race: ${competition}
- Target time: ${targetTime}
- Current VDOT: ${pr.vdotUsed}${pr.isEstimated ? " (estimated from level)" : ""}
- Level: ${levelLabel} (id: ${levelKey})
- Training days per week: ${daysPerWeek}
- Block start date: ${blockStartDate}. Week 1 starts on this date, week 2 starts 7 days later.
- Previous block summary: ${prevBlockSummary}
- Current weekly volume: ${declaredVolumeText}
- Training weekdays for ${daysPerWeek} sessions, fixed by the template (1=Mon..7=Sun): ${selectedTrainingDaysText || "3,6,7"}
${raceProfileLines.length ? `${raceProfileLines.join("\n")}\n` : ""}
WEEKLY VOLUME (hard requirement, this athlete's real training load):
- Week 1 total volume MUST be approximately ${week1Km} km (sum of the ${daysPerWeek} sessions, ±10%).${week1Info.cutPct ? ` This week is already reduced ${week1Info.cutPct}% for the race (normal load would be ${week1Info.normalKm} km).` : ` ${progressionText}${vol.cappedByLevel ? ` It is also trimmed by the level safety cap (${vol.capKm} km).` : ""}`}
- Week 2 total volume: ${week2Km} km.${week2Info.cutPct ? ` Also reduced ${week2Info.cutPct}% for the race.` : ""}
- HARD CAP: never exceed ${vol.capKm} km in a week. That is the safety ceiling for a ${levelLabel} athlete targeting ${competition} at block ${blockNumber}.
- No single session may exceed ${maxSessionKm} km.
- Do NOT use a generic volume for the race distance: an athlete currently running ${vol.baseKm} km/week must NOT get a week built for someone running twice that.
${raceSection}${deloadSection}
BLOCK ${blockNumber} EASY/QUALITY BALANCE (the level and phase set the mix, not the volume):
- Block 1-2: base phase, 70% easy / 30% quality
- Block 3-4: building phase, 60% easy / 40% quality, introduce tempo
- Block 5-6: development phase, 50% easy / 50% quality, threshold + intervals
- Block 7-8: peak phase, 40% easy / 60% quality, race-specific work
- Block 9+: taper phase, keep intensity and cut volume
Apply the mix for block ${blockNumber} INSIDE the weekly volume above. Higher quality does not mean more km.

TRAINING PACES for this athlete (derived from their measured VDOT ${pr.vdotUsed}${pr.isEstimated ? " — ESTIMATED from level, athlete has no evaluation yet" : ""}). Use these EXACT ranges in every description:
- Easy / long / warmup-cooldown: ${pr.easy.desc}
- Marathon pace: ${pr.marathon.desc}
- Tempo / threshold: ${pr.tempo.desc}
- Intervals (VO2max): ${pr.interval.desc}
- Reps / speed: ${pr.rep.desc}
- Recovery runs: ${pr.recovery.desc}
Reference pace_range strings for JSON: easy=${pr.easy.pace_range}, tempo=${pr.tempo.pace_range}, interval=${pr.interval.pace_range} (min/km, ASCII hyphen).
${hrZonesBlock ? `\n${hrZonesBlock}\n` : ""}
QUALITY WORK by VDOT ${pr.vdotUsed} (band ${quality.band}):
- VDOT < 40: intervals of 200-600m, 4-6 reps, full recovery (equal to or longer than the interval)
- VDOT 40-50: intervals of 400-1000m, 5-8 reps, recovery 50-100% of the interval time
- VDOT > 50: intervals of 800-2000m, 6-10 reps, recovery 50% of the interval time
This athlete is in band ${quality.band}: use intervals of ${quality.intervalRange}, ${quality.reps} reps, ${quality.recovery}.
Adjust the number and length of the repetitions to this athlete's VDOT. Do NOT use the same session for every athlete.

PERIODIZATION:
- Block number: ${blockNumber} of ~10 total blocks
- Current phase: ${phase}
- Weekly volume: week 1 ${week1Km} km, week 2 ${week2Km} km (already computed from the athlete's real volume, races included, do not change it)
- Week 1: ${nextBlockParams.focus || phase}
- Week 2: ${week2Type}
- Coach notes: ${nextBlockParams.notes || "none"}

VOLUME RULES (percentages of the ${week1Km} km of week 1):
- Sunday long run: 25-35% of weekly km, pace ${paces.easy}
- Tempo runs: 20-25% of weekly km at ${paces.tempo}
- Intervals: 15-20% of weekly km at ${paces.interval}, following the QUALITY WORK section above (warmup and cooldown included in the session km)
- Easy runs (Tuesday, Thursday): remaining km at ${paces.easy}; keep the day after a long run or a quality session at ${paces.recovery}
- Marathon-pace segments (when prescribed): ${paces.marathon}; reps/strides: ${paces.rep}
- The sum of total_km of the ${daysPerWeek} sessions of week 1 MUST land within ±10% of ${week1Km} km.

SESSION STRUCTURE (fixed weekdays):
weekday 2 (Tuesday): type "easy" — Rodaje suave, recovery from Sunday's long run
weekday 3 (Wednesday): type "tempo" — Tempo run (quality session)
weekday 4 (Thursday): type "easy" — Rodaje suave
weekday 6 (Saturday): type "interval" — Intervalos (quality session, legs fresh after Friday rest)
weekday 7 (Sunday): type "long" — Rodaje largo, THE LONGEST SESSION OF THE WEEK
If N<5 sessions, drop in order: Thursday(4), then Tuesday(2). NEVER drop Sunday(7): the long run is the most important session of the plan.
- The Sunday long run must be the longest session of the week, typically 25-35% of weekly volume.
- Never schedule two quality sessions (tempo, interval) on consecutive days. There must be at least one easy day between them.
- Monday and Friday are rest days by default.

OUTPUT JSON SCHEMA:
{"plan_title":"string","weeks":[{"week_number":1,"focus":"string","workouts":[{"weekday":2,"title":"string","type":"easy|tempo|interval|long","total_km":0,"duration_min":0,"description":"Include specific pace, sets/reps for intervals, warmup/cooldown","structure":[{"phase":"string","duration":"string","intensity":"string","pace":"string"}]}]}]}

STRUCTURE RULES (field "structure" — the executable blocks that reach the athlete's watch):
- Include the "structure" array ONLY for quality sessions (type: interval, tempo, fartlek, or any session with varied intensity blocks). For easy runs, recovery runs, and steady long runs (type: easy, recovery, long), OMIT the "structure" field entirely — those sessions run at a constant pace and don't need blocks.
- This keeps the response compact. Quality sessions are 1-2 per week.
- When structure IS included: each block is {phase, duration, intensity, pace}.
- NEVER collapse repeated intervals into one block. For 6x400m, output 6 SEPARATE repetition blocks (phase "Repetition 1 - 400m", etc.), each followed by its own recovery block (except the last, followed by cooldown).
- For distance-based intervals, name each block with the distance (e.g. "Repetition 3 - 400m").
- Always use HR zone notation Z1-Z5 with bpm in the intensity field, e.g. "Z4-Z5 (150-170 bpm)".${hrZonesBlock ? " Use the athlete's real zones listed above." : ""}
- Include warmup and cooldown blocks in every quality session that has structure.
- The "duration" field of each block MUST be a plain number followed by a single unit: either "N sec" or "N min" (e.g. "60 sec", "2 min", "15 min"). Do NOT add extra words (no "caminar", no "trote suave", no "aprox"), do NOT use ranges (no "18-20 seg"), do NOT use clock format (no "1:30"), and do NOT use approximations (no "~2 min"). If a block is distance-based, still give a realistic single duration estimate.
- The "pace" field of each block is the numeric min/km range (H:MM-H:MM, ASCII hyphen) taken from the TRAINING PACES above; recoveries use the recovery or easy pace.
- The structure blocks must add up to the session's total_km and duration_min, and must match its description (structure is what gets executed, description is the readable text).

Rules: exactly 2 weeks, exactly ${daysPerWeek} workouts each week, same weekdays both weeks, all numeric fields must be numbers, description must include specific paces from above.`;
  }, [competition, targetTime, levelId, levelLabel, daysPerWeek, startDate, currentBlock, nextBlockParams, selectedTrainingDaysText, blockHistory, vdotPaceRanges, volumePlan, blockWeekTargets, raceContext, isDeloadBlock, selectedAthlete]);

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
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          // Margen para JSON de 2 semanas con structure por bloque: cada sesion
          // de calidad son ~12-20 bloques y con 16000 la respuesta se truncaba
          // (stop_reason max_tokens). Mismo techo que el generador del
          // marketplace, que ya genera planes completos con bloques.
          max_tokens: 32000,
          thinking: { type: "disabled" },
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
      const text = extractAnthropicTextContent(data.content, "[plan2-ia]");
      if (!text) {
        console.error("[plan2-ia] stop_reason:", data?.stop_reason, "| usage:", data?.usage);
        notify(
          data?.stop_reason === "max_tokens"
            ? "La IA truncó la respuesta (max_tokens). Intenta de nuevo."
            : "La IA no devolvió texto usable. Intenta de nuevo.",
        );
        return;
      }
      const parsed = extractJsonFromAnthropicText(text);
      const byWeek = new Map((parsed?.weeks || []).map((w) => [Number(w.week_number) || 0, w]));
      const orderedWeeks = [1, 2].map((n) => byWeek.get(n)).filter(Boolean);
      if (!parsed || orderedWeeks.length < 2) {
        // stop_reason "max_tokens" => se trunco; loguear el texto COMPLETO
        // (no un slice) para poder diagnosticar el corte real.
        console.error(
          "Plan JSON inválido. stop_reason:", data?.stop_reason,
          "| longitud texto:", text.length
        );
        console.log("Plan2 texto crudo recibido de la IA:", text);
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
        notify("El plan no respeta la distribución fija (miércoles tempo, sábado intervalos, domingo largo…). Reintenta la generación.");
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
        // Los bloques llegan al reloj con ritmos numericos segun el VDOT del
        // atleta, igual que hace el Builder al asignar un workout suelto.
        const structure = enrichStructureWithPaces(
          Array.isArray(wo.structure) ? wo.structure : [],
          vdotPaceRanges?.vdotUsed,
          selectedAthlete.fc_max,
        );
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

    // Choque con la carrera: si ese dia ya habia algo asignado, el coach tiene
    // que verlo antes de duplicar sesiones encima de la competicion.
    const raceDates = raceContext.racesInBlock.map((r) => r.date).filter(Boolean);
    if (raceDates.length) {
      const { data: clashes, error: clashError } = await supabase
        .from("workouts")
        .select("id, title, scheduled_date")
        .eq("athlete_id", selectedAthlete.id)
        .in("scheduled_date", raceDates);
      if (clashError) console.error("workouts en dia de carrera:", clashError);
      if (clashes?.length) {
        const detalle = clashes.map((c) => `· ${c.scheduled_date}: ${c.title || "entrenamiento"}`).join("\n");
        const seguir = window.confirm(
          `El día de la carrera ya tiene entrenamiento asignado:\n\n${detalle}\n\n¿Asignar el plan de todas formas? Tendrás que borrar el duplicado desde el calendario.`,
        );
        if (!seguir) return;
      }
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
      // Deja constancia de la descarga para no volver a sugerirla enseguida.
      if (isDeloadBlock) setLastDeloadBlock(Number(currentBlock) || 1);
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
      // Un solo push agrupado en vez de uno por workout (fire-and-forget).
      // El deep-link es athlete_calendar (generico), asi que un push abre el
      // calendario igual; scheduledDate apunta al primer dia del bloque.
      if (selectedAthlete?.user_id) {
        sendWorkoutAssignmentPushToAthlete({
          athleteUserId: selectedAthlete.user_id,
          workoutTitle: `Plan de 2 semanas · ${rows.length} sesiones`,
          scheduledDate: rows[0]?.scheduled_date,
        }).catch((e) => console.error("push plan12:", e));
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
        const rows = editDraft.structureRows || [];
        const merged = {
          ...prevWo,
          title: editDraft.title.trim() || "Entrenamiento",
          type: editDraft.type,
          total_km: Number(editDraft.total_km) || 0,
          duration_min: Number(editDraft.duration_min) || 0,
          weekday: Math.min(7, Math.max(1, Number(editDraft.weekday) || 1)),
          description: String(editDraft.description || ""),
          structure: rows.length ? editableRowsToWorkoutStructure(rows) : [],
        };
        if (workoutIdx === "new") list.push(merged);
        else list[workoutIdx] = merged;
        return { ...w, workouts: list };
      }),
    };
    // Sin esto la edicion se guardaba en el borrador pero la vista previa (y lo
    // que se asigna al atleta) se quedaba con la sesion vieja.
    setGeneratedPlan(updated);
    persistPlanDraft({ status: "draft", planJson: updated, startDateValue: startDate, blockNumber: currentBlock });
    setPlanEditModal(null);
  };

  /**
   * Ritmo medio (s/km) con el que se convierten km y minutos en el editor.
   * Prioridad: el pace_range de la propia sesion, la mezcla por tipo cuando la
   * sesion lleva calentamiento y series, el ritmo que escribio la IA en la
   * descripcion y, por ultimo, la zona que toca segun el VDOT del atleta.
   */
  const editPace = useMemo(() => {
    const pr = vdotPaceRanges;
    const type = editDraft.type;
    const workout = planEditModal && planEditModal.workoutIdx !== "new"
      ? generatedPlan?.weeks?.find((w) => Number(w.week_number) === planEditModal.weekNumber)?.workouts?.[planEditModal.workoutIdx]
      : null;

    const fromField = midPaceSecondsFromRange(workout?.pace_range);
    if (fromField) return { secs: fromField, source: "ritmo de la sesión" };

    const zoneKey = PACE_ZONE_BY_TYPE[type] || "easy";
    const zoneSecs = pr?.[zoneKey] ? midPaceSecondsFromRange(pr[zoneKey].pace_range) : null;
    const easySecs = pr?.easy ? midPaceSecondsFromRange(pr.easy.pace_range) : null;
    const easyShare = EASY_SHARE_BY_TYPE[type];
    if (easyShare && zoneSecs && easySecs) {
      return {
        secs: zoneSecs * (1 - easyShare) + easySecs * easyShare,
        source: "media de la sesión con calentamiento y vuelta a la calma",
      };
    }

    const fromText = extractPaceSecondsFromText(editDraft.description);
    if (fromText) return { secs: fromText, source: "ritmo de la descripción" };
    if (zoneSecs) return { secs: zoneSecs, source: `zona ${zoneKey} del VDOT ${pr.vdotUsed}` };
    return null;
  }, [vdotPaceRanges, editDraft.type, editDraft.description, planEditModal, generatedPlan]);

  const applyKmChange = (value) => {
    const km = Number(value);
    setEditDraft((d) => {
      const next = { ...d, total_km: Number.isFinite(km) ? km : 0 };
      if (!editManual && editPace?.secs && Number.isFinite(km) && km > 0) {
        next.duration_min = Math.round((km * editPace.secs) / 60);
      }
      return next;
    });
  };

  const applyDurationChange = (value) => {
    const min = Number(value);
    setEditDraft((d) => {
      const next = { ...d, duration_min: Number.isFinite(min) ? min : 0 };
      if (!editManual && editPace?.secs && Number.isFinite(min) && min > 0) {
        next.total_km = Math.round(((min * 60) / editPace.secs) * 10) / 10;
      }
      return next;
    });
  };

  /** Suma de los bloques que se esta editando, para el total de la sesion. */
  const editStructureTotals = useMemo(
    () => sumStructureRows(editDraft.structureRows),
    [editDraft.structureRows],
  );

  /**
   * Al tocar los bloques, el total de la sesion se recalcula sumandolos: si no,
   * el coach quita una serie y la sesion sigue diciendo los mismos km.
   */
  const applyStructureRowsChange = (rows) => {
    const totals = sumStructureRows(rows);
    setEditDraft((d) => {
      const next = { ...d, structureRows: rows };
      if (!editManual) {
        if (totals.kmComplete && totals.km > 0) next.total_km = totals.km;
        if (totals.minComplete && totals.min > 0) next.duration_min = totals.min;
      }
      return next;
    });
  };

  /** Aviso si la descripcion sigue citando los km o minutos anteriores. */
  const editDescriptionWarning = useMemo(() => {
    const desc = String(editDraft.description || "");
    if (!desc.trim()) return "";
    const km = Number(editDraft.total_km) || 0;
    const min = Number(editDraft.duration_min) || 0;
    const kmChanged = Math.abs(km - (Number(editInitial.total_km) || 0)) > 0.05;
    const minChanged = Math.abs(min - (Number(editInitial.duration_min) || 0)) > 0.5;
    const kmNums = numbersWithUnit(desc, "km");
    const minNums = numbersWithUnit(desc, "min");
    const kmStale = kmChanged && kmNums.length > 0 && !kmNums.some((n) => Math.abs(n - km) <= 0.5);
    const minStale = minChanged && minNums.length > 0 && !minNums.some((n) => Math.abs(n - min) <= 1);
    if (kmStale && minStale) return "⚠️ Cambiaste los kilómetros y la duración. Revisa la descripción, aún menciona los valores anteriores.";
    if (kmStale) return "⚠️ Cambiaste los kilómetros. Revisa la descripción, aún menciona los valores anteriores.";
    if (minStale) return "⚠️ Cambiaste la duración. Revisa la descripción, aún menciona los valores anteriores.";
    return "";
  }, [editDraft.description, editDraft.total_km, editDraft.duration_min, editInitial]);

  /**
   * Los bloques no se reescalan solos cuando el coach cambia el total a mano:
   * son series concretas (6x800m), no una distancia repartible, y estirarlas
   * cambiaria la sesion. Al reves si: editar bloques recalcula el total.
   */
  const editStructureWarning = useMemo(() => {
    if (!(editDraft.structureRows || []).length) return "";
    if (!editStructureTotals.kmComplete) return "";
    const km = Number(editDraft.total_km) || 0;
    const blocksKm = editStructureTotals.km;
    if (blocksKm > 0 && Math.abs(km - blocksKm) > 0.5) {
      return `Los bloques suman ${blocksKm} km y la sesión dice ${km} km. Ajusta los bloques o el total.`;
    }
    return "";
  }, [editDraft.structureRows, editDraft.total_km, editStructureTotals]);

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
          Distribución fija: mar suave · mié tempo · jue suave · sáb intervalos · dom largo (la sesión más larga). Lunes y viernes descansan. Con menos de 5 sesiones se quitan primero el jueves y luego el martes; el domingo nunca se quita.
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
            <div
              style={{
                borderRadius: 10,
                padding: "10px 12px",
                border: `1px solid ${effectiveVdot.source === "estimated" ? "rgba(245,158,11,.45)" : "rgba(14,116,144,.35)"}`,
                background: effectiveVdot.source === "estimated" ? "#fffbeb" : "rgba(14,116,144,.08)",
              }}
            >
              <div style={{ ...labelStyle, marginBottom: 6 }}>VDOT que se usará en el plan</div>
              <div
                style={{
                  fontSize: ".84em",
                  fontWeight: 800,
                  color: effectiveVdot.source === "estimated" ? "#92400e" : "#0e7490",
                  lineHeight: 1.4,
                }}
              >
                {vdotLabel || "Selecciona un atleta"}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={nextBlockParams.vdot === "" && evalInfo.vdot != null ? String(evalInfo.vdot) : nextBlockParams.vdot}
                  onChange={(e) => setNextBlockParams((prev) => ({ ...prev, vdot: e.target.value }))}
                  placeholder={vdotPaceRanges ? String(vdotPaceRanges.vdotUsed) : "Ej: 48.2"}
                  style={{ ...inputStyle, margin: 0 }}
                />
                {effectiveVdot.source === "manual" && evalInfo.vdot != null ? (
                  <button
                    type="button"
                    onClick={() => setNextBlockParams((prev) => ({ ...prev, vdot: "" }))}
                    style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, padding: "8px 10px", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".72em", whiteSpace: "nowrap" }}
                  >
                    Usar evaluación
                  </button>
                ) : null}
              </div>
              {effectiveVdot.source === "estimated" ? (
                <div style={{ marginTop: 6, color: "#92400e", fontSize: ".72em", lineHeight: 1.4 }}>
                  Los ritmos saldrán de un VDOT por nivel. Haz una evaluación al atleta para ajustarlos a su estado real.
                </div>
              ) : null}
            </div>
            <div
              style={{
                borderRadius: 10,
                padding: "10px 12px",
                border: `1px solid ${declaredWeeklyKm == null ? "rgba(245,158,11,.45)" : "rgba(14,116,144,.35)"}`,
                background: declaredWeeklyKm == null ? "#fffbeb" : "rgba(14,116,144,.08)",
              }}
            >
              <div style={{ ...labelStyle, marginBottom: 6 }}>Volumen que se usará en el plan</div>
              <div
                style={{
                  fontSize: ".84em",
                  fontWeight: 800,
                  color: declaredWeeklyKm == null ? "#92400e" : "#0e7490",
                  lineHeight: 1.4,
                }}
              >
                {athleteId ? volumeLabel : "Selecciona un atleta"}
              </div>
              {athleteId && (blockWeekTargets[0].cutPct || blockWeekTargets[1].cutPct || isDeloadBlock) ? (
                <div style={{ marginTop: 6, color: "#0f172a", fontSize: ".74em", fontWeight: 700, lineHeight: 1.4 }}>
                  Ajustado a {blockWeekTargets[0].km} km la semana 1 y {blockWeekTargets[1].km} km la semana 2
                  {isDeloadBlock ? " (bloque de descarga)" : " (afinamiento por carrera)"}
                </div>
              ) : null}
              {athleteId && declaredWeeklyKm == null ? (
                <div style={{ marginTop: 6, color: "#92400e", fontSize: ".72em", lineHeight: 1.4 }}>
                  Registra el kilometraje semanal del atleta en su evaluación para que el volumen salga de su estado real.
                </div>
              ) : null}
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
              {targetTimeWarning ? (
                <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,.45)", background: "#fffbeb", color: "#92400e", fontSize: ".72em", fontWeight: 600, lineHeight: 1.45 }}>
                  ⚠️ {targetTimeWarning}
                </div>
              ) : null}
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
            {raceInBlockWarning ? (
              <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(245,158,11,.45)", background: "#fffbeb", color: "#92400e", fontSize: ".76em", fontWeight: 600, lineHeight: 1.45 }}>
                ⚠️ {raceInBlockWarning}
              </div>
            ) : null}
            {raceContext.nextTargetRace && !raceInBlockWarning && raceContext.daysToNextTarget != null ? (
              <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(14,116,144,.35)", background: "rgba(14,116,144,.08)", color: "#0e7490", fontSize: ".76em", fontWeight: 600, lineHeight: 1.45 }}>
                🏁 Próxima carrera objetivo: {raceContext.nextTargetRace.name} ({raceContext.nextTargetRace.distance}) en {raceContext.daysToNextTarget} días.
              </div>
            ) : null}
            <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(isDeloadBlock)}
                  onChange={(e) => setIsDeloadBlock(e.target.checked)}
                  style={{ marginTop: 2, accentColor: "#b45309" }}
                />
                <span style={{ fontSize: ".78em", color: "#0f172a", fontWeight: 700, lineHeight: 1.4 }}>
                  Este bloque es de descarga
                  <span style={{ display: "block", fontWeight: 500, color: "#64748b", marginTop: 2 }}>
                    Baja el volumen al {Math.round(DELOAD_FACTOR * 100)}% del bloque anterior y deja una sola sesión de calidad corta.
                  </span>
                </span>
              </label>
              {deloadSuggestion ? (
                <div style={{ marginTop: 8, color: "#92400e", fontSize: ".74em", fontWeight: 600, lineHeight: 1.45 }}>
                  💡 {deloadSuggestion}
                </div>
              ) : null}
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
                <div style={{ color: "#475569", fontSize: ".76em", lineHeight: 1.45 }}>
                  {vdotLabel ? `Ritmos con ${vdotLabel}. Se edita arriba, en Parámetros del plan.` : ""}
                </div>
                <div>
                  <div style={labelStyle}>Días de entrenamiento</div>
                  <div style={{ color: "#64748b", fontSize: ".72em", lineHeight: 1.4, marginBottom: 6 }}>
                    Los fija la plantilla según el número de sesiones: el domingo (largo) siempre entra.
                  </div>
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
                                      {Array.isArray(wo.structure) && wo.structure.length > 0 ? (
                                        <span style={{ color: "#0e7490", fontWeight: 700 }}> · {wo.structure.length} bloques</span>
                                      ) : null}
                                    </div>
                                    {wo.description && <div style={{ fontSize: ".78em", color: "#cbd5e1", marginTop: 8, lineHeight: 1.45 }}>{wo.description}</div>}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                                    <button
                                      type="button"
                                      title="Editar sesión"
                                      onClick={() => {
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
            return null;
          })()}
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 220, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: (editDraft.structureRows || []).length ? 560 : 420, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
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
                    onChange={(e) => applyKmChange(e.target.value)}
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
                    onChange={(e) => applyDurationChange(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginTop: -4 }}>
                <div style={{ fontSize: ".72em", color: editManual ? "#94a3b8" : "#0e7490", fontWeight: 600, lineHeight: 1.4 }}>
                  {editManual
                    ? "Ajuste manual: km y duración no se recalculan entre sí."
                    : editPace
                      ? `Calculado a ${fmtPace(editPace.secs)} min/km (${editPace.source}).`
                      : "Sin ritmo de referencia: los campos no se recalculan."}
                </div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editManual}
                    onChange={(e) => setEditManual(e.target.checked)}
                    style={{ accentColor: "#b45309" }}
                  />
                  <span style={{ fontSize: ".74em", color: "#475569", fontWeight: 600 }}>Ajustar manualmente</span>
                </label>
              </div>
              <div>
                <div style={labelStyle}>Descripción</div>
                <textarea
                  value={editDraft.description}
                  onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                  rows={4}
                  placeholder="Ritmos, series, calentamiento y vuelta a la calma"
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }}
                />
                {editDescriptionWarning ? (
                  <div style={{ marginTop: 6, color: "#92400e", fontSize: ".72em", fontWeight: 600, lineHeight: 1.45 }}>
                    {editDescriptionWarning}
                  </div>
                ) : null}
                {editStructureWarning ? (
                  <div style={{ marginTop: 6, color: "#0e7490", fontSize: ".72em", fontWeight: 600, lineHeight: 1.45 }}>
                    ℹ️ {editStructureWarning}
                  </div>
                ) : null}
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
              {(editDraft.structureRows || []).length > 0 ? (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                  <WorkoutStructureEditor
                    rows={editDraft.structureRows}
                    onRowsChange={applyStructureRowsChange}
                    minRows={0}
                  />
                  <div style={{ marginTop: 8, fontSize: ".72em", color: "#0e7490", fontWeight: 600, lineHeight: 1.45 }}>
                    Los bloques suman {editStructureTotals.km} km · {editStructureTotals.min} min.
                    {editManual
                      ? " Ajuste manual: el total de la sesión no se toca."
                      : !editStructureTotals.kmComplete
                        ? " Hay bloques sin distancia (calentamiento, recuperaciones), así que los km de la sesión se dejan como están."
                        : " Ese es el total de la sesión."}
                  </div>
                </div>
              ) : null}
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


export default Plan2Weeks;
