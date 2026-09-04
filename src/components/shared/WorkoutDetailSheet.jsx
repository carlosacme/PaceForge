import React, { useEffect } from "react";
import WorkoutDetailBreakdown from "../WorkoutDetailBreakdown";
import WorkoutStructureTable from "./WorkoutStructureTable";
import { fmtPace } from "../../lib/vdot";

/**
 * Sheet de detalle de un entreno: desglose + tabla de estructura + datos del
 * reloj / comparación si vienen. Sustituye el popup de 340px, que en Android
 * no cabe para tabla + ejecución.
 *
 * canEditPlan monta Editar/Eliminar. Los handlers hacen return temprano si
 * la prop es false: no basta con ocultar los botones. El calendario del atleta
 * no pasa onEdit/onDelete.
 */
export default function WorkoutDetailSheet({
  workout,
  vdot = 42.5,
  onClose,
  canEditPlan = false,
  onEdit,
  onDelete,
  registroLapsLoading = false,
  registroBlocks = null,
}) {
  useEffect(() => {
    if (!workout) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [workout, onClose]);

  const handleEdit = () => {
    if (!canEditPlan) return;
    onEdit?.(workout);
  };

  const handleDelete = () => {
    if (!canEditPlan) return;
    onDelete?.(workout);
  };

  if (!workout) return null;

  const w = workout;
  const hasWatchData = Boolean(w.actual_synced_at);
  const hasManualNumbers =
    w.manual_distance_km != null ||
    w.manual_duration_min != null ||
    w.manual_avg_hr != null ||
    w.manual_max_hr != null ||
    w.manual_calories != null;
  const structure = w.structure ?? w.workout_structure ?? [];
  const comparisonRows = Array.isArray(registroBlocks) ? registroBlocks : [];
  const showComparison = Boolean(w.intervals_activity_id);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 10010,
        padding: 12,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={w.title || "Detalle del entrenamiento"}
        style={{
          width: "min(96vw, 640px)",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: ".7em", fontWeight: 800, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".1em" }}>
            Detalle del entreno
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#475569",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "12px 16px 16px", overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
          <WorkoutDetailBreakdown workout={w} vdot={vdot} />

          {Array.isArray(structure) && structure.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontSize: ".68em",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                  color: "#17c6a3",
                  marginBottom: 8,
                }}
              >
                Estructura
              </div>
              <WorkoutStructureTable structure={structure} title={w.title} />
            </div>
          ) : null}

          {hasWatchData ? (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6, fontSize: ".82em" }}>⌚ Datos del reloj</div>
              <div style={{ fontSize: ".82em", color: "#334155", lineHeight: 1.55 }}>
                <div>
                  <strong>Distancia:</strong> {w.total_km != null ? `${w.total_km} km plan` : "—"} →{" "}
                  {w.actual_distance_km != null ? `${w.actual_distance_km} km real` : "—"}
                </div>
                <div>
                  <strong>Duración:</strong> {w.duration_min != null ? `${w.duration_min} min plan` : "—"} →{" "}
                  {w.actual_duration_min != null ? `${w.actual_duration_min} min real` : "—"}
                </div>
                <div>
                  <strong>Ritmo medio real:</strong>{" "}
                  {w.actual_avg_pace_s != null ? `${fmtPace(w.actual_avg_pace_s)}/km` : "—"}
                </div>
                <div>
                  <strong>FC prom/máx real:</strong> {w.actual_avg_hr ?? "—"} / {w.actual_max_hr ?? "—"} lpm
                </div>
                <div>
                  <strong>Desnivel:</strong> {w.actual_elevation_m != null ? `${w.actual_elevation_m} m` : "—"}
                </div>
              </div>
            </div>
          ) : hasManualNumbers ? (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6, fontSize: ".82em" }}>Registro manual</div>
              <div style={{ fontSize: ".82em", color: "#334155", lineHeight: 1.55 }}>
                <div>
                  <strong>Distancia:</strong> {w.manual_distance_km != null ? `${w.manual_distance_km} km` : "—"}
                </div>
                <div>
                  <strong>Duración:</strong> {w.manual_duration_min != null ? `${w.manual_duration_min} min` : "—"}
                </div>
                <div>
                  <strong>FC prom/máx:</strong> {w.manual_avg_hr ?? "—"} / {w.manual_max_hr ?? "—"} lpm
                </div>
              </div>
            </div>
          ) : null}

          {showComparison ? (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6, fontSize: ".82em" }}>📊 Comparación por bloque</div>
              {registroLapsLoading ? (
                <div style={{ fontSize: ".82em", color: "#64748b" }}>Cargando bloques…</div>
              ) : comparisonRows.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8em" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#64748b" }}>
                        <th style={{ padding: "4px 6px" }}>Bloque</th>
                        <th style={{ padding: "4px 6px", textAlign: "right" }}>Previsto</th>
                        <th style={{ padding: "4px 6px", textAlign: "right" }}>Real</th>
                        <th style={{ padding: "4px 6px", textAlign: "right" }}>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((b, i) => {
                        const faster = b.delta_s != null && b.delta_s <= 0;
                        const deltaColor = b.delta_s == null ? "#94a3b8" : faster ? "#16a34a" : "#ea580c";
                        const deltaTxt =
                          b.delta_s == null ? "—" : `${b.delta_s <= 0 ? "" : "+"}${Math.round(b.delta_s)}s`;
                        return (
                          <tr key={`${b.step_name || "block"}-${i}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "4px 6px", fontWeight: 600 }}>{b.step_name || "Bloque"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>
                              {b.planned_pace_s != null ? `${fmtPace(b.planned_pace_s)}/km` : "—"}
                            </td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>
                              {b.actual_pace_s != null ? `${fmtPace(b.actual_pace_s)}/km` : "—"}
                            </td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: deltaColor, fontWeight: 700 }}>
                              {deltaTxt}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: ".82em", color: "#64748b" }}>No hay laps del reloj para comparar.</div>
              )}
            </div>
          ) : null}
        </div>

        {canEditPlan ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "10px 16px 14px",
              borderTop: "1px solid #e2e8f0",
              flexShrink: 0,
            }}
          >
            {onEdit ? (
              <button
                type="button"
                onClick={handleEdit}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#0f172a",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: ".8em",
                }}
              >
                ✏️ Editar
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                style={{
                  background: "#fff",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#b91c1c",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: ".8em",
                }}
              >
                🗑 Eliminar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
