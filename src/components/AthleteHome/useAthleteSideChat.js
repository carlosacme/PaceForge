import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  markConversationRead,
  sendChatPushNotification,
  PUSH_INACTIVE_REASONS,
} from "../shared/appShared";

/**
 * Chat atleta→coach (`messages`).
 * Mismo patrón que Athletes/useAthleteChat (optimistic + Realtime INSERT +
 * poll 60s + mark-read + push), pero NO es ese hook:
 *   sender_role "athlete", push al coach (type coach_chat),
 *   mark-read solo con el sheet abierto (readerRole athlete).
 * No unificar en este PR. No importa useAthleteChat.
 */
export function useAthleteSideChat({
  athleteId,
  coachId,
  athleteName,
  panelOpen,
  notify,
}) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const coachPushWarnedRef = useRef(false);

  const loadAthleteChat = useCallback(async () => {
    if (!athleteId || !coachId) {
      setChatMessages([]);
      return;
    }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Error cargando chat atleta:", error);
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
  }, [athleteId, coachId]);

  useEffect(() => {
    loadAthleteChat();
  }, [loadAthleteChat]);

  // Simetrico al coach: con el panel de chat abierto, los mensajes del coach
  // pasan a leidos. chatMessages.length cubre los que llegan con el
  // panel ya abierto.
  useEffect(() => {
    if (!panelOpen || !athleteId || !coachId) return;
    markConversationRead({ coachId, athleteId, readerRole: "athlete" });
  }, [panelOpen, athleteId, coachId, chatMessages.length]);

  useEffect(() => {
    if (!athleteId || !coachId) return undefined;
    const channel = supabase
      .channel(`chat-athlete-${athleteId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `athlete_id=eq.${athleteId}` },
        () => loadAthleteChat(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [athleteId, coachId, loadAthleteChat]);

  // Respaldo por si Realtime se cae o el navegador suspende la conexion.
  useEffect(() => {
    const t = setInterval(() => loadAthleteChat(), 60000);
    return () => clearInterval(t);
  }, [loadAthleteChat]);

  const sendAthleteChat = async () => {
    const body = chatDraft.trim();
    if (!body || !athleteId || !coachId || chatSending) return;
    setChatSending(true);
    // Optimistic: limpiar el input y mostrar el mensaje al instante.
    setChatDraft("");
    const optimistic = {
      id: `tmp-${Date.now()}`,
      athlete_id: athleteId,
      coach_id: coachId,
      sender_role: "athlete",
      body,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    setChatMessages((prev) => [...prev, optimistic]);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: athleteId,
        coach_id: coachId,
        sender_role: "athlete",
        body,
      });
      if (error) {
        console.error(error);
        setChatMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setChatDraft(body);
        notify?.(`Error al enviar mensaje: ${error.message}`);
        return;
      }
      // Notificar sin bloquear la UI (fire and forget). Si el coach no tiene
      // push activo se avisa UNA vez por sesion: el mensaje esta guardado, pero
      // el atleta no debe quedarse esperando una respuesta que nadie sabe que
      // tiene pendiente.
      sendChatPushNotification({
        toUserId: coachId,
        title: `Tu atleta ${athleteName} respondió`,
        body,
        data: { type: "coach_chat", athlete_id: athleteId },
        logLabel: "chat atleta→coach",
      })
        .then((r) => {
          if (r.sent || !PUSH_INACTIVE_REASONS.has(r.reason) || coachPushWarnedRef.current) return;
          coachPushWarnedRef.current = true;
          notify?.("Mensaje enviado. Tu coach no tiene las notificaciones activas, así que puede tardar en verlo.");
        })
        .catch(() => {});
      loadAthleteChat();
    } finally {
      setChatSending(false);
    }
  };

  return {
    chatMessages,
    chatDraft,
    setChatDraft,
    chatSending,
    sendAthleteChat,
  };
}
