import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  markConversationRead,
  sendChatPushNotification,
  PUSH_INACTIVE_REASONS,
} from "../shared/appShared";

/**
 * Chat coach↔atleta (`messages`).
 * Unread de la lista se apaga vía `onMarkedRead` (Athletes posee el badge).
 * `chatDraft` sale hacia arriba para `resumeUiBusy` (OR con el panel de workout).
 */
export function useAthleteChat({
  athleteId,
  athleteName,
  athleteUserId,
  coachId,
  notify,
  onMarkedRead,
}) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatClearing, setChatClearing] = useState(false);
  const pushWarnedAthletesRef = useRef(new Set());
  const onMarkedReadRef = useRef(onMarkedRead);
  onMarkedReadRef.current = onMarkedRead;

  const loadCoachChat = useCallback(async () => {
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
  }, [athleteId, coachId]);

  useEffect(() => {
    loadCoachChat();
  }, [loadCoachChat]);

  // Abrir la ficha ES abrir la conversacion: se marcan leidos y se avisa a la
  // lista para apagar el punto. chatMessages.length cubre los que llegan
  // mientras la ficha esta abierta.
  useEffect(() => {
    if (!athleteId || !coachId) return undefined;
    let cancelled = false;
    markConversationRead({ coachId, athleteId, readerRole: "coach" }).then((marked) => {
      if (cancelled || !marked) return;
      onMarkedReadRef.current?.(athleteId);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteId, coachId, chatMessages.length]);

  useEffect(() => {
    if (!athleteId || !coachId) return undefined;
    const channel = supabase
      .channel(`chat-coach-${coachId}-${athleteId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `athlete_id=eq.${athleteId}` },
        () => loadCoachChat(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [athleteId, coachId, loadCoachChat]);

  // Respaldo por si Realtime se cae o el navegador suspende la conexion.
  useEffect(() => {
    const t = setInterval(() => loadCoachChat(), 60000);
    return () => clearInterval(t);
  }, [loadCoachChat]);

  const clearCoachChat = async () => {
    if (!athleteId || !coachId) return;
    if (!window.confirm("¿Estás seguro? Esto eliminará todos los mensajes de esta conversación.")) return;
    setChatClearing(true);
    try {
      const { error } = await supabase.from("messages").delete().eq("athlete_id", athleteId).eq("coach_id", coachId);
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

  const sendCoachChat = async () => {
    const body = chatDraft.trim();
    if (!body || !athleteId || !coachId || chatSending) return;
    setChatSending(true);
    setChatDraft("");
    const optimistic = {
      id: `tmp-${Date.now()}`,
      athlete_id: athleteId,
      coach_id: coachId,
      sender_role: "coach",
      body,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    setChatMessages((prev) => [...prev, optimistic]);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: athleteId,
        coach_id: coachId,
        sender_role: "coach",
        body,
      });
      if (error) {
        console.error(error);
        setChatMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setChatDraft(body);
        alert(`No se pudo enviar: ${error.message}`);
        return;
      }
      sendChatPushNotification({
        toUserId: athleteUserId,
        title: "Nuevo mensaje de tu coach",
        body,
        data: { type: "athlete_chat" },
        logLabel: "chat coach→atleta",
      })
        .then((r) => {
          if (r.sent || !PUSH_INACTIVE_REASONS.has(r.reason)) return;
          if (pushWarnedAthletesRef.current.has(String(athleteId))) return;
          pushWarnedAthletesRef.current.add(String(athleteId));
          notify?.(`${athleteName || "El atleta"} no tiene las notificaciones activas: verá el mensaje al abrir la app.`);
        })
        .catch(() => {});
      loadCoachChat();
    } finally {
      setChatSending(false);
    }
  };

  return {
    chatMessages,
    chatDraft,
    setChatDraft,
    chatSending,
    chatClearing,
    sendCoachChat,
    clearCoachChat,
  };
}
