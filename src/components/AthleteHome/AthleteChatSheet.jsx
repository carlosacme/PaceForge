import React, { useEffect, useRef } from "react";
import { formatMessageTimestamp } from "../shared/appShared";

/**
 * Sheet a pantalla completa del chat atleta→coach.
 * z-index 9989 (bajo el nav 9999); paddingBottom 94 deja el input usable.
 * Burbujas: propias (sender_role athlete) a la derecha en verde; las del coach a la izquierda en blanco.
 */
export default function AthleteChatSheet({
  open,
  onClose,
  coachId,
  chatMessages,
  chatDraft,
  setChatDraft,
  chatSending,
  sendAthleteChat,
}) {
  const chatScrollRef = useRef(null);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9989, background: "rgba(15,23,42,.4)", display: "flex", alignItems: "flex-end" }}>
      <div style={{ width: "100%", height: "100%", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", padding: 16, paddingBottom: 94 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: "1.05em", fontWeight: 900 }}>💬 Chat con tu coach</div>
          <button type="button" onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        {!coachId ? (
          <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos de coach. Contacta a soporte si esto continúa.</div>
        ) : (
          <>
            <div ref={chatScrollRef} style={{ maxHeight: 420, overflowY: "auto", padding: "10px 8px", borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {chatMessages.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div>
              ) : (
                chatMessages.map((m) => {
                  const isMine = m.sender_role === "athlete";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isMine ? "flex-end" : "flex-start",
                        maxWidth: "88%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: isMine ? "#dcf8c6" : "#ffffff",
                        border: `1px solid ${isMine ? "rgba(37,211,102,.45)" : "#e2e8f0"}`,
                        color: "#0f172a",
                        fontSize: ".82em",
                        lineHeight: 1.45,
                      }}
                    >
                      <div>{m.body}</div>
                      <div style={{ fontSize: ".65em", color: isMine ? "#3f6212" : "#64748b", marginTop: 6 }}>
                        {formatMessageTimestamp(m.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendAthleteChat()}
                placeholder="Escribe un mensaje a tu coach…"
                style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em" }}
              />
              <button
                type="button"
                onClick={sendAthleteChat}
                disabled={chatSending || !chatDraft.trim()}
                style={{
                  background: chatSending || !chatDraft.trim() ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: chatSending || !chatDraft.trim() ? "#64748b" : "#fff",
                  fontWeight: 800,
                  cursor: chatSending || !chatDraft.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                }}
              >
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
