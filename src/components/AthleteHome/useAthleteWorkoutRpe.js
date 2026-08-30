import { useState, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  achievementJoinMeta,
  ATHLETE_ACHIEVEMENT_DISPLAY_LIST,
  computeAchievementProgress,
  evaluateAndAwardAthleteAchievements,
  clampWorkoutRpe,
  normalizeWorkoutRow,
  sendChatPushNotification,
  notifyCoachWorkoutCompletedFromClient,
} from "../shared/appShared";

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

function medalLabelFromAward(row) {
  const meta = achievementJoinMeta(row);
  const code = row?.achievement_code || meta?.code || "";
  const fromDisplay = ATHLETE_ACHIEVEMENT_DISPLAY_LIST.find((a) => (a.codes || []).includes(code));
  const icon = (meta?.icon && String(meta.icon).trim()) || fromDisplay?.icon || "🏅";
  const rawName = meta?.name && String(meta.name).trim();
  const name = (rawName && rawName !== code ? rawName : null) || fromDisplay?.name || code;
  return `${icon} ${name}`.trim();
}

function medalToastText(newAwards) {
  const labels = (newAwards || []).map(medalLabelFromAward).filter(Boolean);
  if (!labels.length) return "";
  if (labels.length === 1) return `¡Nueva medalla desbloqueada! ${labels[0]}`;
  return `¡${labels.length} medallas nuevas! ${labels.join(" · ")}`;
}

/**
 * Marcar hecho del atleta + modal RPE.
 * No unificar con Athletes/toggleWorkoutDone ni WorkoutRegistroModal.
 * Orden fijo: optimistic done → abrir modal → update done → notify coach
 * (solo aquí) → pull-activity → evaluateAndAward. Save no notifica ni usa
 * .single()/.maybeSingle(). intervalsConnected vive en el padre.
 */
export function useAthleteWorkoutRpe({
  workouts,
  setWorkouts,
  athleteInfo,
  intervalsConnected,
  loadIntervalsConnected,
  setMessage,
  setAchievementsCatalog,
  setEarnedAchievements,
  setAchProgress,
  setMedalToast,
}) {
  const toggleDoneBusyIdRef = useRef(null);
  const [forceManualFields, setForceManualFields] = useState(false);
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

  const closeWorkoutModal = () => {
    setWorkoutSummaryModal(null);
    setForceManualFields(false);
  };

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
          const text = medalToastText(newAwards);
          if (text) {
            setMedalToast(text);
            setTimeout(() => setMedalToast(""), 4200);
          }
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

  return {
    toggleDone,
    workoutSummaryModal,
    manualSummaryForm,
    setManualSummaryForm,
    manualSummarySaving,
    forceManualFields,
    setForceManualFields,
    saveManualWorkoutSummary,
    closeWorkoutModal,
  };
}
