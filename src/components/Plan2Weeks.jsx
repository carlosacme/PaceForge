import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  WORKOUT_TYPES,
  formatLocalYMD,
  addDays,
  normalizeScheduledDateYmd,
  startOfWeekMonday,
  extractJsonFromAnthropicText,
  normalizeWorkoutStructure,
  normalizeAthlete,
  formatDurationClock,
  formatCopInt,
  WORKOUT_BLOCK_TYPES,
  STRAVA_CALLBACK_URL,
  MARKETPLACE_AI_PACE_RANGES_BY_LEVEL,
  buildMarketplaceAiPacePromptSection,
  styles,
} from "./shared/appShared";

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
    const levelKey = String(levelId || "intermedio").toLowerCase();
    const pr = MARKETPLACE_AI_PACE_RANGES_BY_LEVEL[levelKey] || MARKETPLACE_AI_PACE_RANGES_BY_LEVEL.intermedio;
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

    // Ritmos por nivel del atleta (obligatorio; el VDOT solo guía volumen/intensidad relativa, no sustituye estos rangos).
    const paces = {
      easy: pr.easy.desc,
      tempo: pr.tempo.desc,
      interval: pr.interval.desc,
      recovery: `recuperación activa, ~30–60 s/km más lento que el ritmo fácil del nivel (${pr.easy.desc})`,
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
- Level: ${levelLabel} (id: ${levelKey})
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

TRAINING PACES for this athlete level ONLY (use these EXACT ranges in every description; do NOT derive paces from VDOT):
- Easy / long / warmup-cooldown easy segments: ${paces.easy}
- Tempo / threshold: ${paces.tempo}
- Intervals / reps: ${paces.interval}
- Recovery runs (between hard days): ${paces.recovery}
Reference pace_range strings for JSON descriptions when helpful: easy=${pr.easy.pace_range}, tempo=${pr.tempo.pace_range}, interval=${pr.interval.pace_range} (min/km, ASCII hyphen).

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
  }, [competition, targetTime, levelId, levelLabel, daysPerWeek, startDate, currentBlock, nextBlockParams, selectedTrainingDaysText, blockHistory]);

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


export default Plan2Weeks;
