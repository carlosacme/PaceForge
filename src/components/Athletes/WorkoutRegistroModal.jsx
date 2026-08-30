import React from "react";
import { fmtPace } from "../../lib/vdot";

const WorkoutRouteMap = React.lazy(() => import("../WorkoutRouteMap"));

/**
 * Modal 📋 Registro. z-index 10010 (por encima del menú del calendario, 300).
 * “Cómo me sentí” se parte de athlete_notes para no duplicar el RPE en Notas.
 */
export default function WorkoutRegistroModal({
  workout,
  athleteVdot,
  registroLapsLoading,
  registroBlocks,
  onClose,
}) {
  if (!workout) return null;
  const w = workout;
  const feelingMatch = String(w.athlete_notes || "").match(/^Cómo me sentí:\s*(.+)$/m);
  const feelingText = feelingMatch ? feelingMatch[1] : "";
  const notesText = String(w.athlete_notes || "")
    .replace(/^Cómo me sentí:\s*.+$/m, "")
    .trim();
  const hasManualNumbers =
    w.manual_distance_km != null || w.manual_duration_min != null ||
    w.manual_avg_hr != null || w.manual_max_hr != null ||
    w.manual_calories != null;
  // Si hay datos del reloj (actual_*), no mostramos los manual numericos:
  // saldrian en 0 y confunden. Los reales ya se ven en "⌚ Datos del reloj".
  const hasWatchData = !!w.actual_synced_at;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 10010, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: ".7em", fontWeight: 800, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".1em" }}>📋 Registro</div>
            <div style={{ fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{w.title}</div>
            {w.scheduled_date ? <div style={{ fontSize: ".82em", color: "#64748b", marginTop: 2 }}>{w.scheduled_date}</div> : null}
          </div>
          <button type="button" onClick={onClose} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>✕</button>
        </div>
        <div style={{ fontSize: ".92em", color: "#334155", lineHeight: 1.6, borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
          {!hasWatchData && hasManualNumbers && (
            <>
              <div><strong>Distancia:</strong> {w.manual_distance_km != null ? `${w.manual_distance_km} km` : "—"}</div>
              <div><strong>Duración:</strong> {w.manual_duration_min != null ? `${w.manual_duration_min} min` : "—"}</div>
              <div><strong>FC prom/máx:</strong> {w.manual_avg_hr != null ? w.manual_avg_hr : "—"} / {w.manual_max_hr != null ? w.manual_max_hr : "—"} lpm</div>
              <div><strong>Calorías:</strong> {w.manual_calories != null ? w.manual_calories : "—"}</div>
            </>
          )}
          {feelingText ? <div><strong>Cómo se sintió:</strong> {feelingText}</div> : null}
          {notesText ? <div><strong>Notas:</strong> {notesText}</div> : null}
          {w.completed_at ? <div><strong>Completado:</strong> {new Date(w.completed_at).toLocaleString("es-CO")}</div> : null}
          {w.actual_synced_at ? (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 5 }}>⌚ Datos del reloj</div>
              <div><strong>Distancia:</strong> {w.total_km != null ? `${w.total_km} km plan` : "—"} → {w.actual_distance_km != null ? `${w.actual_distance_km} km real` : "—"}</div>
              <div><strong>Duración:</strong> {w.duration_min != null ? `${w.duration_min} min plan` : "—"} → {w.actual_duration_min != null ? `${w.actual_duration_min} min real` : "—"}</div>
              <div><strong>Ritmo medio real:</strong> {w.actual_avg_pace_s != null ? `${Math.floor(w.actual_avg_pace_s / 60)}:${String(w.actual_avg_pace_s % 60).padStart(2, "0")}/km` : "—"}</div>
              <div><strong>FC prom/máx real:</strong> {w.actual_avg_hr ?? "—"} / {w.actual_max_hr ?? "—"} lpm</div>
              <div><strong>Desnivel:</strong> {w.actual_elevation_m != null ? `${w.actual_elevation_m} m` : "—"}</div>
              <div style={{ color: "#94a3b8", marginTop: 4 }}>Sincronizado del reloj: {new Date(w.actual_synced_at).toLocaleString("es-CO")}</div>
              <React.Suspense fallback={<div style={{ marginTop: 8, color: "#94a3b8", fontSize: ".85em" }}>Cargando mapa…</div>}>
                <WorkoutRouteMap workout={w} />
              </React.Suspense>
              {w.intervals_activity_id ? (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e2e8f0" }}>
                  <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>📊 Comparación por bloque</div>
                  <div style={{ fontSize: ".82em", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                    El ritmo planificado se deriva del esfuerzo objetivo de cada bloque y del VDOT actual del atleta{athleteVdot ? ` (VDOT ${athleteVdot})` : ""}. Es una referencia para interpretar la ejecución, no un objetivo exacto que se haya prescrito en tiempo.
                  </div>
                  {registroLapsLoading ? (
                    <div style={{ color: "#64748b" }}>Cargando bloques…</div>
                  ) : (registroBlocks && registroBlocks.length ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9em" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#64748b", fontSize: ".85em" }}>
                          <th style={{ padding: "4px 6px" }}>Bloque</th>
                          <th style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>Ritmo previsto</th>
                          <th style={{ padding: "4px 6px", textAlign: "right" }}>Real</th>
                          <th style={{ padding: "4px 6px", textAlign: "right" }}>Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registroBlocks.map((b, i) => {
                          const faster = b.delta_s != null && b.delta_s <= 0;
                          const deltaColor = b.delta_s == null ? "#94a3b8" : (faster ? "#16a34a" : "#ea580c");
                          const deltaTxt = b.delta_s == null ? "—" : `${b.delta_s <= 0 ? "" : "+"}${Math.round(b.delta_s)}s`;
                          return (
                            <tr key={i} style={{ borderTop: "1px solid #f1f5f9", opacity: b.dur_mismatch && !b.incomplete ? 0.55 : 1 }}>
                              <td style={{ padding: "4px 6px", fontWeight: 600 }}>
                                {b.step_name || `Bloque ${i + 1}`}
                                {b.incomplete ? <span style={{ color: "#b45309", fontWeight: 700 }}> · no completado</span> : null}
                                {b.dur_mismatch && !b.incomplete ? <span title="Duración muy distinta a la planeada"> ⚠️</span> : null}
                              </td>
                              <td style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{b.planned_pace_s != null ? `${fmtPace(b.planned_pace_s)}/km` : "—"}</td>
                              <td style={{ padding: "4px 6px", textAlign: "right" }}>{b.actual_pace_s != null ? `${fmtPace(b.actual_pace_s)}/km` : "—"}</td>
                              <td style={{ padding: "4px 6px", textAlign: "right", color: deltaColor, fontWeight: 700 }}>{deltaTxt}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: "#94a3b8" }}>No hay datos por bloque para esta actividad</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (w.done ? (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0", color: "#94a3b8" }}>
              ⌚ Sin datos del reloj (el atleta no conectó intervals.icu o el reloj no había sincronizado al marcar hecho)
            </div>
          ) : null)}
        </div>
      </div>
    </div>
  );
}
