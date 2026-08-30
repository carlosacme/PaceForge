import React, { useState, useEffect, useMemo } from "react";
import { fmtPace } from "../../lib/vdot";
import { classifyStepSection } from "../../lib/intervals";
import { blockHasWatchSplits } from "../../lib/blockComparison";

function fmtDistM(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

const STEP_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "warmup", label: "Calentamiento" },
  { id: "race", label: "Carrera" },
  { id: "cooldown", label: "Enfriamiento" },
];

const WorkoutRouteMap = React.lazy(() => import("../WorkoutRouteMap"));
const RegistroPaceChart = React.lazy(() => import("./RegistroPaceChart"));

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
  const [stepFilter, setStepFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  useEffect(() => {
    setStepFilter("all");
    setExpandedRows(new Set());
  }, [workout?.id]);
  useEffect(() => {
    setExpandedRows(new Set());
  }, [stepFilter]);

  const filteredBlocks = useMemo(() => {
    const rows = registroBlocks || [];
    if (stepFilter === "all") return rows;
    return rows.filter((b) => classifyStepSection(b.step_name) === stepFilter);
  }, [registroBlocks, stepFilter]);

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
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 720, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
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
                    <>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {STEP_FILTERS.map((f) => {
                        const selected = stepFilter === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setStepFilter(f.id)}
                            style={{
                              padding: "5px 11px",
                              borderRadius: 999,
                              border: selected ? "2px solid #0d9488" : "1px solid #e2e8f0",
                              background: selected ? "rgba(13,148,136,.1)" : "#f8fafc",
                              color: selected ? "#0d9488" : "#475569",
                              fontWeight: selected ? 800 : 600,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              fontSize: ".74em",
                            }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                    {filteredBlocks.length ? (
                    <>
                    <React.Suspense fallback={<div style={{ height: 220, color: "#94a3b8", fontSize: ".85em" }}>Cargando gráfico…</div>}>
                      <RegistroPaceChart blocks={filteredBlocks} />
                    </React.Suspense>
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
                        {filteredBlocks.map((b, i) => {
                          const faster = b.delta_s != null && b.delta_s <= 0;
                          const deltaColor = b.delta_s == null ? "#94a3b8" : (faster ? "#16a34a" : "#ea580c");
                          const deltaTxt = b.delta_s == null ? "—" : `${b.delta_s <= 0 ? "" : "+"}${Math.round(b.delta_s)}s`;
                          const expandable = blockHasWatchSplits(b);
                          const open = expandable && expandedRows.has(i);
                          return (
                            <React.Fragment key={i}>
                            <tr style={{ borderTop: "1px solid #f1f5f9", opacity: b.dur_mismatch && !b.incomplete ? 0.55 : 1 }}>
                              <td style={{ padding: "4px 6px", fontWeight: 600 }}>
                                {expandable ? (
                                  <button
                                    type="button"
                                    aria-expanded={open}
                                    aria-label={open ? "Ocultar vueltas del reloj" : "Ver vueltas del reloj"}
                                    onClick={() => setExpandedRows((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(i)) next.delete(i);
                                      else next.add(i);
                                      return next;
                                    })}
                                    style={{
                                      marginRight: 4,
                                      padding: 0,
                                      border: "none",
                                      background: "transparent",
                                      color: "#0d9488",
                                      cursor: "pointer",
                                      fontFamily: "inherit",
                                      fontSize: "1em",
                                      fontWeight: 800,
                                      lineHeight: 1,
                                      verticalAlign: "middle",
                                    }}
                                  >
                                    {open ? "▾" : "▸"}
                                  </button>
                                ) : null}
                                {b.step_name || `Bloque ${i + 1}`}
                                {b.incomplete ? <span style={{ color: "#b45309", fontWeight: 700 }}> · no completado</span> : null}
                                {b.dur_mismatch && !b.incomplete ? <span title="Duración muy distinta a la planeada"> ⚠️</span> : null}
                              </td>
                              <td style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{b.planned_pace_s != null ? `${fmtPace(b.planned_pace_s)}/km` : "—"}</td>
                              <td style={{ padding: "4px 6px", textAlign: "right" }}>{b.actual_pace_s != null ? `${fmtPace(b.actual_pace_s)}/km` : "—"}</td>
                              <td style={{ padding: "4px 6px", textAlign: "right", color: deltaColor, fontWeight: 700 }}>{deltaTxt}</td>
                            </tr>
                            {open ? (
                              <tr>
                                <td colSpan={4} style={{ padding: "4px 6px 10px 22px" }}>
                                  <div style={{ fontSize: ".72em", color: "#94a3b8", fontWeight: 700, marginBottom: 4 }}>Vueltas del reloj</div>
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88em", color: "#475569" }}>
                                    <thead>
                                      <tr style={{ color: "#94a3b8", fontSize: ".9em" }}>
                                        <th style={{ padding: "2px 4px", textAlign: "left", fontWeight: 600 }}>Vuelta</th>
                                        <th style={{ padding: "2px 4px", textAlign: "right", fontWeight: 600 }}>Tiempo</th>
                                        <th style={{ padding: "2px 4px", textAlign: "right", fontWeight: 600 }}>Distancia</th>
                                        <th style={{ padding: "2px 4px", textAlign: "right", fontWeight: 600 }}>Ritmo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(b.splits || []).map((sp, si) => (
                                        <tr key={`${i}-${si}`}>
                                          <td style={{ padding: "2px 4px", fontWeight: 600 }}>{sp.name}</td>
                                          <td style={{ padding: "2px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{sp.dur_s != null ? fmtPace(sp.dur_s) : "—"}</td>
                                          <td style={{ padding: "2px 4px", textAlign: "right" }}>{fmtDistM(sp.dist_m)}</td>
                                          <td style={{ padding: "2px 4px", textAlign: "right" }}>{sp.pace_s != null ? `${fmtPace(sp.pace_s)}/km` : "—"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            ) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    </>
                    ) : (
                      <div style={{ color: "#94a3b8" }}>No hay bloques de este tipo</div>
                    )}
                    </>
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
