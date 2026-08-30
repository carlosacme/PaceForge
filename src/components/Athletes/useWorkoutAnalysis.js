import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { WORKOUT_TYPES, formatLocalYMD } from "../shared/appShared";

/**
 * Analyze / adjust del coach → `/api/analyze-workout`.
 * VDOT y ritmos por bloque los resuelve el API (no se reimplementan aquí).
 * El calendario entra solo por callbacks (`analyzeWorkoutAsCoach`, `setCoachAnalysisModal`).
 * Laps del registro se adjuntan si el modal abierto es el mismo workout.
 */
export function useWorkoutAnalysis({
  workouts,
  setWorkouts,
  athlete,
  notify,
  registroModal,
  registroLaps,
}) {
  const [coachAnalysisModal, setCoachAnalysisModal] = useState(null);
  const [adjustProposalModal, setAdjustProposalModal] = useState(null);
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [coachWorkoutAnalysis, setCoachWorkoutAnalysis] = useState({});
  const [coachWorkoutAnalysisLoading, setCoachWorkoutAnalysisLoading] = useState({});

  useEffect(() => {
    if (!athlete?.id) setCoachWorkoutAnalysis({});
  }, [athlete?.id]);

  // Hidratar desde servidor (fuente de verdad) + localStorage como primer nivel.
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
    const ids = workouts.map((w) => w.id).filter((id) => id != null);
    if (!ids.length) return undefined;
    let cancelled = false;
    supabase
      .from("workout_ai_cache")
      .select("workout_id, text")
      .eq("kind", "coach_analyze")
      .in("workout_id", ids)
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return;
        const fromDb = {};
        for (const row of data) {
          if (row.workout_id != null && row.text) fromDb[row.workout_id] = row.text;
        }
        if (Object.keys(fromDb).length) {
          setCoachWorkoutAnalysis((prev) => ({ ...prev, ...fromDb }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workouts]);

  const analyzeWorkoutAsCoach = async (w, athleteName, opts = {}) => {
    if (coachWorkoutAnalysisLoading[w.id]) return;
    const force = opts.force !== false;
    setCoachWorkoutAnalysisLoading((prev) => ({ ...prev, [w.id]: true }));
    if (force) setCoachWorkoutAnalysis((prev) => ({ ...prev, [w.id]: "" }));
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
          force,
        }),
      });
      const data = await response.json();
      if (data?.analysis) {
        setCoachWorkoutAnalysis((prev) => ({ ...prev, [w.id]: data.analysis }));
        try { localStorage.setItem(`raf_analysis_${w.id}`, data.analysis); } catch {}
        if (opts.open) {
          setCoachAnalysisModal({ text: data.analysis, title: w.title, workout: w });
        }
      }
    } catch (e) {
      console.error("analyzeWorkoutAsCoach error:", e);
    } finally {
      setCoachWorkoutAnalysisLoading((prev) => ({ ...prev, [w.id]: false }));
    }
  };

  const openCoachAnalysis = async (w, athleteName) => {
    const existing = coachWorkoutAnalysis[w.id];
    if (existing) {
      setCoachAnalysisModal({ text: existing, title: w.title, workout: w });
    }
    await analyzeWorkoutAsCoach(w, athleteName, { force: false, open: true });
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

  return {
    coachAnalysisModal,
    setCoachAnalysisModal,
    adjustProposalModal,
    setAdjustProposalModal,
    adjustLoading,
    coachWorkoutAnalysis,
    coachWorkoutAnalysisLoading,
    analyzeWorkoutAsCoach,
    openCoachAnalysis,
    adjustPlanWithAI,
    applyAdjustment,
  };
}
