import React from "react";

/**
 * Modales de análisis (z 10010) y propuesta de ajuste (z 10011).
 * El calendario no importa este módulo: abre el análisis por callback.
 */
export default function WorkoutAnalysisOverlays({
  adjustProposalModal,
  setAdjustProposalModal,
  applyAdjustment,
  notify,
  coachAnalysisModal,
  setCoachAnalysisModal,
  adjustLoading,
  adjustPlanWithAI,
}) {
  return (
    <>
      {adjustProposalModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 10011, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 800, color: "#4338ca", textTransform: "uppercase", letterSpacing: ".1em" }}>🔧 Ajuste de Plan IA</div>
                <div style={{ fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                  {adjustProposalModal.signal === "fatiga_alta" ? "🔴 Fatiga alta detectada" :
                   adjustProposalModal.signal === "fatiga_media" ? "🟡 Fatiga media detectada" :
                   adjustProposalModal.signal === "descarga_necesaria" ? "🔴 Semana de descarga necesaria" :
                   adjustProposalModal.signal === "puede_progresar" ? "🟢 Listo para progresar" : "🟢 Estado óptimo"}
                </div>
              </div>
              <button type="button" onClick={() => setAdjustProposalModal(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", marginBottom: 16, fontSize: ".85em", color: "#334155", lineHeight: 1.6 }}>
              {adjustProposalModal.summary}
            </div>
            {adjustProposalModal.adjustments.length === 0 ? (
              <div style={{ textAlign: "center", color: "#64748b", fontSize: ".88em", padding: "20px 0" }}>
                El atleta está bien — no se necesitan ajustes en el plan.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em" }}>
                  Cambios propuestos ({adjustProposalModal.adjustments.length})
                </div>
                {adjustProposalModal.adjustments.map((adj, i) => {
                  const fw = adjustProposalModal.futureWorkouts.find((w) => String(w.id) === String(adj.workout_id));
                  return (
                    <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#fafafa" }}>
                      <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
                        {fw?.scheduled_date} — {fw?.title || fw?.type}
                      </div>
                      <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>{adj.reason}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                        {adj.changes.total_km != null && <span style={{ fontSize: ".75em", padding: "4px 8px", borderRadius: 6, background: "rgba(99,102,241,.1)", color: "#4338ca", fontWeight: 700 }}>{fw?.total_km}km → {adj.changes.total_km}km</span>}
                        {adj.changes.duration_min != null && <span style={{ fontSize: ".75em", padding: "4px 8px", borderRadius: 6, background: "rgba(99,102,241,.1)", color: "#4338ca", fontWeight: 700 }}>{fw?.duration_min}min → {adj.changes.duration_min}min</span>}
                        {adj.changes.type != null && <span style={{ fontSize: ".75em", padding: "4px 8px", borderRadius: 6, background: "rgba(255,138,61,.15)", color: "#b45309", fontWeight: 700 }}>Tipo: {fw?.type} → {adj.changes.type}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button"
                          onClick={async () => {
                            await applyAdjustment(adj);
                            setAdjustProposalModal((prev) => ({ ...prev, adjustments: prev.adjustments.filter((_, j) => j !== i) }));
                            notify("Cambio aplicado");
                          }}
                          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#0d9488,#14b8a6)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>✓ Aplicar</button>
                        <button type="button"
                          onClick={() => setAdjustProposalModal((prev) => ({ ...prev, adjustments: prev.adjustments.filter((_, j) => j !== i) }))}
                          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>✕ Ignorar</button>
                      </div>
                    </div>
                  );
                })}
                {adjustProposalModal.adjustments.length > 1 && (
                  <button type="button"
                    onClick={async () => {
                      for (const adj of adjustProposalModal.adjustments) await applyAdjustment(adj);
                      notify("Todos los cambios aplicados");
                      setAdjustProposalModal(null);
                    }}
                    style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#4338ca,#6366f1)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".88em" }}>
                    ✓ Aplicar todos los cambios
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {coachAnalysisModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 10010, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 800, color: "#b45309", textTransform: "uppercase", letterSpacing: ".1em" }}>🤖 Análisis IA</div>
                <div style={{ fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{coachAnalysisModal.title}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={adjustLoading}
                  onClick={() => coachAnalysisModal?.workout && adjustPlanWithAI(coachAnalysisModal.workout)}
                  style={{ border: "1px solid rgba(99,102,241,.5)", borderRadius: 8, padding: "6px 12px", background: adjustLoading ? "#e2e8f0" : "rgba(99,102,241,.1)", color: "#4338ca", fontWeight: 700, cursor: adjustLoading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}
                >
                  {adjustLoading ? "Ajustando…" : "🔧 Ajustar plan"}
                </button>
                <button type="button" onClick={() => setCoachAnalysisModal(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: ".88em", color: "#0f172a", lineHeight: 1.7, whiteSpace: "pre-wrap", borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
              {coachAnalysisModal.text.replace(/#{1,3} /g, "").replace(/\*\*/g, "")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
