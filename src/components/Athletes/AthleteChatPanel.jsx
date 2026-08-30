import React, { useEffect, useRef } from "react";
import { formatMessageTimestamp } from "../shared/appShared";

export default function AthleteChatPanel({
  coachId,
  chatMessages,
  chatDraft,
  setChatDraft,
  chatSending,
  chatClearing,
  sendCoachChat,
  clearCoachChat,
}) {
  const chatScrollRef = useRef(null);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

  return (
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
  );
}
