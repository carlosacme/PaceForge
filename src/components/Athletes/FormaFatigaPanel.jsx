import React, { useMemo } from "react";
import FormaFatigaLineChart from "../shared/FormaFatigaLineChart";
import {
  computeFormaFatigaWeeklyPoints,
  computeGarminLoadMetricsFromWorkouts,
  formatDurationMinutesTotal,
  formaFatigaStatusFromPoint,
  styles,
} from "../shared/appShared";

/**
 * Panel FORMA Y FATIGA de la ficha del coach.
 * 0 estados propios: solo lee `workouts` / `loadingWorkouts`.
 * Cálculos en appShared; el chart ya está extraído.
 */
export default function FormaFatigaPanel({ workouts, loadingWorkouts }) {
  const S = styles;
  const formaFatigaPoints = useMemo(() => computeFormaFatigaWeeklyPoints(workouts), [workouts]);
  const formaFatigaChronological = useMemo(() => [...formaFatigaPoints].reverse(), [formaFatigaPoints]);
  const formaFatigaStatus = useMemo(() => formaFatigaStatusFromPoint(formaFatigaPoints[0]), [formaFatigaPoints]);
  const formaFatigaTableRows = useMemo(() => formaFatigaPoints.slice(0, 4), [formaFatigaPoints]);
  const coachGarminLoadMetrics = useMemo(() => computeGarminLoadMetricsFromWorkouts(workouts), [workouts]);

  return (
    <div style={{ order: 6, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
        FORMA Y FATIGA
      </div>
      {!loadingWorkouts ? (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: ".72em", marginBottom: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>
            Carga por volumen (completados · 4 semanas)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 12 }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Estado de entrenamiento</div>
              <div style={{ fontSize: "1.2em", fontWeight: 900, color: coachGarminLoadMetrics.statusColor }}>{coachGarminLoadMetrics.statusLabel}</div>
              <div style={{ fontSize: ".7em", color: "#64748b", marginTop: 8, lineHeight: 1.45 }}>
                Ratio 7 días / promedio semanal (4 sem): &lt; 0.8 desentrenado · 0.8–1.3 óptimo · &gt; 1.3 sobreentrenado
              </div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga aguda (7 días)</div>
              <div style={{ fontSize: "1.35em", fontWeight: 900, color: coachGarminLoadMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{coachGarminLoadMetrics.acuteKm.toFixed(1)} km</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga crónica (prom. semanal)</div>
              <div style={{ fontSize: "1.35em", fontWeight: 900, color: coachGarminLoadMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{coachGarminLoadMetrics.chronicWeeklyAvgKm.toFixed(1)} km/sem</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa", gridColumn: "1 / -1", minWidth: 0 }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Ratio carga aguda / crónica</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: "1.35em", fontWeight: 900, fontFamily: "monospace", color: coachGarminLoadMetrics.ratioIndicatorColor }}>
                  {coachGarminLoadMetrics.hasRatio ? coachGarminLoadMetrics.ratio.toFixed(2) : "—"}
                </span>
                <span style={{ fontSize: ".72em", color: "#64748b" }}>verde = óptimo · rojo = extremos</span>
              </div>
              <div style={{ position: "relative", marginTop: 10, height: 14, borderRadius: 7, background: "linear-gradient(90deg, #dc2626 0%, #dc2626 40%, #16a34a 40%, #16a34a 65%, #dc2626 65%, #dc2626 100%)" }}>
                {coachGarminLoadMetrics.hasRatio ? (
                  <div
                    style={{
                      position: "absolute",
                      top: -2,
                      width: 4,
                      height: 18,
                      marginLeft: -2,
                      left: `${Math.min(100, Math.max(0, (coachGarminLoadMetrics.ratio / 2) * 100))}%`,
                      background: "#0f172a",
                      borderRadius: 2,
                      boxShadow: "0 0 0 2px #fff",
                    }}
                  />
                ) : null}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65em", color: "#94a3b8", marginTop: 4 }}>
                <span>0</span>
                <span>Óptimo 0.8–1.3</span>
                <span>2+</span>
              </div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Sesiones / semana (prom.)</div>
              <div style={{ fontSize: "1.35em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{coachGarminLoadMetrics.avgSessionsPerWeek.toFixed(1)}</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Tiempo total (4 sem)</div>
              <div style={{ fontSize: "1.15em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{formatDurationMinutesTotal(coachGarminLoadMetrics.totalMin4w)}</div>
            </div>
            <div style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>Km por semana (lun–dom, más antigua → actual)</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, minHeight: 120, paddingTop: 4 }}>
                {coachGarminLoadMetrics.weekBarsOldestFirst.map((b) => {
                  const hPct = Math.max(6, (b.km / coachGarminLoadMetrics.maxBarKm) * 100);
                  return (
                    <div key={b.key} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{ width: "100%", height: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "#f1f5f9", borderRadius: 8, padding: "0 6px", boxSizing: "border-box" }}>
                        <div
                          style={{
                            width: "72%",
                            height: `${hPct}%`,
                            maxHeight: "100%",
                            background: coachGarminLoadMetrics.COLOR_ORANGE,
                            borderRadius: "6px 6px 2px 2px",
                            boxShadow: "0 0 10px rgba(249,115,22,.35)",
                          }}
                        />
                      </div>
                      <div style={{ fontSize: ".62em", color: "#64748b", textAlign: "center", lineHeight: 1.2 }}>{b.label}</div>
                      <div style={{ fontSize: ".68em", fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>{b.km.toFixed(1)} km</div>
                      <div style={{ fontSize: ".58em", color: "#94a3b8", textAlign: "center" }}>{b.rangeLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, lineHeight: 1.45 }}>
        Basado en sesiones completadas con RPE: carga aguda = promedio (RPE × km) últimos 7 días; carga crónica = promedio (RPE × km) últimos 28 días; forma = crónica − aguda.
      </div>
      {loadingWorkouts ? (
        <div style={{ color: "#64748b", fontSize: ".85em", padding: "12px 0" }}>Cargando datos…</div>
      ) : (
        <>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              fontSize: ".88em",
              fontWeight: 700,
              color:
                formaFatigaStatus.kind === "forma"
                  ? "#22c55e"
                  : formaFatigaStatus.kind === "fatiga"
                    ? "#f87171"
                    : formaFatigaStatus.kind === "fresco"
                      ? "#facc15"
                      : "#94a3b8",
            }}
          >
            Estado actual: {formaFatigaStatus.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14, fontSize: ".72em", color: "#94a3b8" }}>
            <span>
              <span style={{ color: "#ef4444", fontWeight: 700 }}>—</span> Carga aguda (7 d)
            </span>
            <span>
              <span style={{ color: "#3b82f6", fontWeight: 700 }}>—</span> Carga crónica (28 d)
            </span>
            <span>
              <span style={{ color: "#22c55e", fontWeight: 700 }}>—</span> Forma (crónica − aguda)
            </span>
          </div>
          <FormaFatigaLineChart chronological={formaFatigaChronological} />
          <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#475569", textTransform: "uppercase", marginTop: 18, marginBottom: 8 }}>
            Resumen últimas 4 semanas
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8em" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#94a3b8", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "8px 10px", fontWeight: 700 }}>Semana (corte)</th>
                  <th style={{ padding: "8px 10px", fontWeight: 700, color: "#ef4444" }}>Aguda</th>
                  <th style={{ padding: "8px 10px", fontWeight: 700, color: "#3b82f6" }}>Crónica</th>
                  <th style={{ padding: "8px 10px", fontWeight: 700, color: "#22c55e" }}>Forma</th>
                </tr>
              </thead>
              <tbody>
                {formaFatigaTableRows.map((row) => (
                  <tr key={row.i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 10px", color: "#0f172a" }}>
                      {row.label} <span style={{ color: "#64748b", fontSize: ".85em" }}>({row.endYmd})</span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "#fecaca", fontFamily: "monospace" }}>
                      {row.acute != null ? row.acute.toFixed(1) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#bfdbfe", fontFamily: "monospace" }}>
                      {row.chronic != null ? row.chronic.toFixed(1) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#bbf7d0", fontFamily: "monospace" }}>
                      {row.forma != null ? row.forma.toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
