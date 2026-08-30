import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { sendChatPushNotification } from "../shared/appShared";

const NOT100_LINE_RE = /^\[No estoy al 100% · Nivel: [^\]]+\][^\n]*$/gm;

function stripNot100Lines(notes) {
  return String(notes || "").replace(NOT100_LINE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function composeNot100Notes(existing, level, reason) {
  const line = `[No estoy al 100% · Nivel: ${level}] ${reason || "Sin detalle adicional"}`;
  const body = stripNot100Lines(existing);
  return body ? `${body}\n${line}` : line;
}

/**
 * Overlays del menú del calendario: briefing IA + “No estoy al 100%”.
 * No es el analyze/adjust del coach (`Athletes/useWorkoutAnalysis`).
 * Not-100 agrega una línea a `athlete_notes` (idempotente: sustituye la
 * línea not-100 previa, no pisa el resto). No usa composeAthleteNotes del RPE.
 */
export function useAthleteWorkoutOverlays({
  athleteId,
  athleteName,
  athleteGoal,
  athleteFcMax,
  coachId,
  notify,
  onNotesSaved,
}) {
  const [briefingModal, setBriefingModal] = useState(null);
  const [briefingText, setBriefingText] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [not100Modal, setNot100Modal] = useState(null);
  const [not100Form, setNot100Form] = useState({ reason: "", level: "medio" });
  const [not100Sending, setNot100Sending] = useState(false);

  const generateBriefing = async (workout, opts = {}) => {
    const force = !!opts.force;
    setBriefingLoading(true);
    if (force) setBriefingText("");
    try {
      const hrZonesText = athleteFcMax ? `FC max: ${athleteFcMax} lpm` : "FC no configurada";
      const prompt = `Eres un coach de running experto. El atleta ${athleteName || "el atleta"} tiene programado hoy: "${workout.title || workout.type}" (${workout.total_km || 0} km, ${workout.duration_min || 0} min, tipo: ${workout.type || "general"}). Objetivo: ${athleteGoal || "mejorar rendimiento"}. ${hrZonesText}. Escribe un briefing motivacional de 3-4 oraciones en español. Incluye: 1) que va a trabajar hoy y por que es importante, 2) en que enfocarse durante la sesion, 3) una frase motivacional final. Sin bullets, solo texto corrido.`;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/analyze-workout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          prompt,
          mode: "briefing",
          workout_id: workout.id,
          workout: {
            id: workout.id,
            title: workout.title,
            type: workout.type,
            total_km: workout.total_km,
            duration_min: workout.duration_min,
          },
          athleteGoal,
          athleteFcMax,
          force,
        }),
      });
      const data = await res.json();
      if (data?.cached) {
        console.log("[ai-cache] briefing hit", workout?.id);
      }
      setBriefingText(data?.analysis || "No se pudo generar el briefing.");
    } catch (e) {
      setBriefingText("Error generando el briefing. Intenta de nuevo.");
    } finally {
      setBriefingLoading(false);
    }
  };

  const openBriefing = (workout) => {
    setBriefingModal(workout);
    setBriefingText("");
    generateBriefing(workout, { force: false });
  };

  const sendNot100Report = async () => {
    if (!not100Modal || !coachId) return;
    setNot100Sending(true);
    try {
      const { data: current, error: readErr } = await supabase
        .from("workouts")
        .select("athlete_notes")
        .eq("id", not100Modal.id)
        .maybeSingle();
      if (readErr) console.error("not100 read:", readErr);
      const existing = current?.athlete_notes ?? not100Modal.athlete_notes ?? "";
      const note = composeNot100Notes(existing, not100Form.level, not100Form.reason);
      const { data: updated, error } = await supabase
        .from("workouts")
        .update({ athlete_notes: note })
        .eq("id", not100Modal.id)
        .select("id");
      if (error) {
        console.error("not100:", error);
        notify?.(error.message || "No se pudo guardar el aviso");
        return;
      }
      if (!(updated || []).length) {
        notify?.("No se guardó el aviso en el entreno (sin permiso sobre esa fila)");
        return;
      }
      await sendChatPushNotification({
        toUserId: coachId,
        title: `😣 ${athleteName || "Tu atleta"} no esta al 100%`,
        body: `${not100Modal.title || "Entreno"}: ${not100Form.reason || "Nivel " + not100Form.level}`,
        data: { type: "coach_athlete", athlete_id: athleteId },
        logLabel: "not100",
      });
      onNotesSaved?.(not100Modal.id, note);
      setNot100Modal(null);
      notify?.("✅ Tu coach fue notificado");
    } catch (e) {
      console.error("not100:", e);
      notify?.("No se pudo notificar al coach");
    } finally {
      setNot100Sending(false);
    }
  };

  const openNot100 = (workout) => {
    setNot100Modal(workout);
    setNot100Form({ reason: "", level: "medio" });
  };

  return {
    briefingModal,
    briefingText,
    briefingLoading,
    generateBriefing,
    openBriefing,
    closeBriefing: () => setBriefingModal(null),
    not100Modal,
    not100Form,
    setNot100Form,
    not100Sending,
    openNot100,
    closeNot100: () => setNot100Modal(null),
    sendNot100Report,
  };
}
