import React from "react";

/**
 * Modal “Resumen del entrenamiento” del atleta.
 * z-index 10050: por encima del nav (9999), menú (10002) y briefing/not-100 (10003).
 * No reusar Athletes/WorkoutRegistroModal.
 */
export default function AthleteRpeModal({
  cardStyle,
  workoutSummaryModal,
  intervalsConnected,
  forceManualFields,
  setForceManualFields,
  manualSummaryForm,
  setManualSummaryForm,
  manualSummarySaving,
  onSave,
  onClose,
}) {
  if (!workoutSummaryModal) return null;

  return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...cardStyle, width: "100%", maxWidth: 520, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Resumen del entrenamiento</div>
            <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 12 }}>
              {(workoutSummaryModal.workout?.title || "Entreno")} · {workoutSummaryModal.workout?.scheduled_date || "—"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: "#f8fafc", borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>PROGRAMADO</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>📏 {workoutSummaryModal?.workout?.total_km || "—"} km</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>⏱ {workoutSummaryModal?.workout?.duration_min || "—"} min</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>🏃 {workoutSummaryModal?.workout?.type || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 700, color: "#0d9488", marginBottom: 6 }}>LO QUE HICISTE</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>📏 {manualSummaryForm.distanceKm || "—"} km</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>⏱ {manualSummaryForm.durationMin || "—"} min</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>RPE {manualSummaryForm.rpe || "—"} / 10</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
          {intervalsConnected ? (
            <div style={{ fontSize: ".8em", color: "#0d9488", background: "rgba(13,148,136,.08)", border: "1px solid rgba(13,148,136,.25)", borderRadius: 8, padding: "9px 11px" }}>
              ⌚ Los datos de tu carrera (distancia, tiempo, FC) llegan automáticamente desde tu reloj. Solo cuéntanos cómo te sentiste.
              {!forceManualFields ? (
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setForceManualFields(true)}
                    style={{ background: "none", border: "none", color: "#64748b", fontSize: ".74em", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                  >
                    ¿No llegaron los datos? Escríbelos a mano
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {(!intervalsConnected || forceManualFields) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Distancia (km)</div>
                <input type="number" min="0" step="0.1" value={manualSummaryForm.distanceKm} onChange={(e) => setManualSummaryForm((f) => ({ ...f, distanceKm: e.target.value }))} placeholder="0.0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Duracion (min)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.durationMin} onChange={(e) => setManualSummaryForm((f) => ({ ...f, durationMin: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Esfuerzo percibido (RPE)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[1,2,3,4,5,6,7,8,9,10].map((n) => {
                const selected = Number(manualSummaryForm.rpe) === n;
                const color = n <= 3 ? "#16a34a" : n <= 6 ? "#d97706" : n <= 8 ? "#ea580c" : "#dc2626";
                const label = n <= 3 ? "Suave" : n <= 6 ? "Mod." : n <= 8 ? "Duro" : "Max";
                return (
                  <button key={n} type="button" onClick={() => setManualSummaryForm((f) => ({ ...f, rpe: String(n) }))}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: 40, padding: "5px 0", borderRadius: 8, border: selected ? ("2px solid " + color) : "1px solid #e2e8f0", background: selected ? color : "#f8fafc", color: selected ? "#fff" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                    <span style={{ fontSize: ".9em" }}>{n}</span>
                    <span style={{ fontSize: ".5em", fontWeight: 600 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Como te sentiste?</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["Muy cansado","Muy cansado"],["Cansado","Cansado"],["Normal","Normal"],["Bien","Bien"],["Excelente","Excelente"]].map(([label, val]) => {
                const emoji = label === "Muy cansado" ? "Muy cansado" : label === "Cansado" ? "Cansado" : label === "Normal" ? "Normal" : label === "Bien" ? "Bien" : "Excelente";
                const fullVal = label === "Muy cansado" ? "\uD83D\uDE34 Muy cansado" : label === "Cansado" ? "\uD83D\uDE15 Cansado" : label === "Normal" ? "\uD83D\uDE10 Normal" : label === "Bien" ? "\uD83D\uDE42 Bien" : "\uD83D\uDCAA Excelente";
                const selected = manualSummaryForm.feeling === fullVal;
                return (
                  <button key={val} type="button" onClick={() => setManualSummaryForm((f) => ({ ...f, feeling: fullVal }))}
                    style={{ padding: "6px 12px", borderRadius: 20, border: selected ? "2px solid #0d9488" : "1px solid #e2e8f0", background: selected ? "rgba(13,148,136,.1)" : "#f8fafc", color: selected ? "#0d9488" : "#475569", fontWeight: selected ? 800 : 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>
                    {fullVal}
                  </button>
                );
              })}
            </div>
          </div>

          {(!intervalsConnected || forceManualFields) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>FC prom (lpm)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.avgHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, avgHr: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>FC max (lpm)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.maxHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, maxHr: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>Calorias</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.calories} onChange={(e) => setManualSummaryForm((f) => ({ ...f, calories: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Notas del entreno</div>
            <textarea rows={3} value={manualSummaryForm.notes} onChange={(e) => setManualSummaryForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Como fue? Algo importante para tu coach?" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box", resize: "none" }} />
          </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" disabled={manualSummarySaving} onClick={onSave} style={{ background: manualSummarySaving ? "#cbd5e1" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: manualSummarySaving ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                  {manualSummarySaving ? "Guardando…" : intervalsConnected ? "Guardar notas" : "Guardar registro"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
  );
}
