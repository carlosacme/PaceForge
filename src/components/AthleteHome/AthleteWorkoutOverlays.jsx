import React from "react";

/**
 * Modales briefing IA + “No estoy al 100%”.
 * z-index 10003: por encima del nav (9999) y del menú (10002); debajo del RPE (10050).
 */
export default function AthleteWorkoutOverlays({
  briefingModal,
  briefingText,
  briefingLoading,
  onRegenerateBriefing,
  onCloseBriefing,
  not100Modal,
  not100Form,
  setNot100Form,
  not100Sending,
  onSendNot100,
  onCloseNot100,
}) {
  return (
    <>
      {briefingModal ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10003, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: "1.2em" }}>⚡</span>
              <div style={{ fontWeight: 900, fontSize: ".95em", color: "#4338ca" }}>Briefing del entreno</div>
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 14 }}>{briefingModal.title} · {briefingModal.total_km || 0} km · {briefingModal.duration_min || 0} min</div>
            {briefingLoading ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "#6366f1", fontSize: ".85em" }}>Generando briefing con IA...</div>
            ) : (
              <div style={{ fontSize: ".88em", color: "#0f172a", lineHeight: 1.65, background: "rgba(99,102,241,.05)", border: "1px solid rgba(99,102,241,.2)", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                {briefingText}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {!briefingLoading && (
                <button
                  type="button"
                  onClick={() => onRegenerateBriefing(briefingModal)}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,.3)", background: "rgba(99,102,241,.08)", color: "#4338ca", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
                >
                  Regenerar
                </button>
              )}
              <button
                type="button"
                onClick={onCloseBriefing}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {not100Modal ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10003, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ fontWeight: 900, fontSize: "1em", color: "#0f172a", marginBottom: 4 }}>😓 No estoy al 100%</div>
            <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 14 }}>{not100Modal.title} · Cuéntale a tu coach cómo estás</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Nivel</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["leve", "😕 Leve"], ["medio", "😓 Regular"], ["grave", "🤒 Mal"]].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setNot100Form((f) => ({ ...f, level: val }))}
                    style={{ flex: 1, padding: "8px 6px", borderRadius: 8, border: not100Form.level === val ? "2px solid #ff8a3d" : "1px solid #e2e8f0", background: not100Form.level === val ? "rgba(255,138,61,.1)" : "#f8fafc", color: not100Form.level === val ? "#b45309" : "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>¿Qué pasa? (opcional)</div>
              <textarea
                rows={3}
                value={not100Form.reason}
                onChange={(e) => setNot100Form((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Dolor muscular, cansancio, enfermedad..."
                style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box", resize: "none" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onCloseNot100}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSendNot100}
                disabled={not100Sending}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: not100Sending ? "#e2e8f0" : "linear-gradient(135deg,#ff8a3d,#d97706)", color: not100Sending ? "#94a3b8" : "#fff", fontWeight: 800, cursor: not100Sending ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}
              >
                {not100Sending ? "Enviando..." : "Notificar coach"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
