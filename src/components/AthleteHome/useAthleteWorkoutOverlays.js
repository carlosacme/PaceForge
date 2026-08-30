import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { sendChatPushNotification } from "../shared/appShared";

/**
 * Overlays del menú del calendario: briefing IA + “No estoy al 100%”.
 * No es el analyze/adjust del coach (`Athletes/useWorkoutAnalysis`).
 * Not-100 escribe `athlete_notes` (pisa el campo) y push; no ajusta km/ritmo
 * ni usa composeAthleteNotes del modal RPE.
 */
export function useAthleteWorkoutOverlays({
  athleteId,
  athleteName,
  athleteGoal,
  athleteFcMax,
  coachId,
  notify,
}) {
  const [briefingModal, setBriefingModal] = useState(null);
  const [briefingText, setBriefingText] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [not100Modal, setNot100Modal] = useState(null);
  const [not100Form, setNot100Form] = useState({ reason: "", level: "medio" });
  const [not100Sending, setNot100Sending] = useState(false);

  const generateBriefing = async (workout) => {
    setBriefingLoading(true);
    setBriefingText("");
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
        body: JSON.stringify({ prompt, mode: "briefing" }),
      });
      const data = await res.json();
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
    generateBriefing(workout);
  };

  const sendNot100Report = async () => {
    if (!not100Modal || !coachId) return;
    setNot100Sending(true);
    try {
      const note = `[No estoy al 100% · Nivel: ${not100Form.level}] ${not100Form.reason || "Sin detalle adicional"}`;
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
