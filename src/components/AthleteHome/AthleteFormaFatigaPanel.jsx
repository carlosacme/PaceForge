import React, { useMemo } from "react";
import FormaFatigaLineChart from "../shared/FormaFatigaLineChart";
import {
  computeFormaFatigaWeeklyPoints,
  computeGarminLoadMetricsFromWorkouts,
  formaFatigaStatusFromPoint,
} from "../shared/appShared";

/**
 * Perfil -> Forma del atleta.
 *
 * 0 estados propios: deriva de `workouts`. Paywall propio (Premium Atleta).
 * Subset vs el FormaFatigaPanel del coach: sin el número ACWR, sin barras
 * semanales, sin tabla 4 semanas, sin spinner de loadingWorkouts. El label
 * (Óptimo / Desentrenado / Precaución / Sobreentrenado) usa las mismas bandas
 * que el coach. No fusionar con el bloque RPE.
 */
export default function AthleteFormaFatigaPanel({
  cardStyle,
  workouts,
  hasPremiumAccess,
  onGoToPagos,
}) {
  const formaFatigaPoints = useMemo(() => computeFormaFatigaWeeklyPoints(workouts), [workouts]);
  const formaFatigaChronological = useMemo(() => [...formaFatigaPoints].reverse(), [formaFatigaPoints]);
  const formaFatigaStatus = useMemo(() => formaFatigaStatusFromPoint(formaFatigaPoints[0]), [formaFatigaPoints]);
  const garminLoadMetrics = useMemo(() => computeGarminLoadMetricsFromWorkouts(workouts), [workouts]);

  if (!hasPremiumAccess) {
    return (
      <div style={{ ...cardStyle, textAlign: "center" }}>
        <p style={{ color: "#64748b" }}>Esta sección requiere Plan Premium Atleta.</p>
        <button
          type="button"
          onClick={onGoToPagos}
          style={{ background: "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
        >
          Ir a Pagos para suscribirme
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".72em", marginBottom: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Carga por volumen (completados · 4 semanas)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 12 }}>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
            <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Estado de entrenamiento</div>
            <div style={{ fontSize: "1.2em", fontWeight: 900, color: garminLoadMetrics.statusColor }}>{garminLoadMetrics.statusLabel}</div>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
            <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga aguda (7 días)</div>
            <div style={{ fontSize: "1.35em", fontWeight: 900, color: garminLoadMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{garminLoadMetrics.acuteKm.toFixed(1)} km</div>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
            <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga crónica (prom. semanal)</div>
            <div style={{ fontSize: "1.35em", fontWeight: 900, color: garminLoadMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{garminLoadMetrics.chronicWeeklyAvgKm.toFixed(1)} km/sem</div>
          </div>
        </div>
      </div>
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".72em", marginBottom: 8, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>RPE × km (tendencia)</div>
        <div style={{ marginBottom: 12, fontWeight: 800, color: formaFatigaStatus.kind === "forma" ? "#22c55e" : formaFatigaStatus.kind === "fatiga" ? "#f87171" : "#94a3b8" }}>Estado (RPE): {formaFatigaStatus.label}</div>
        <FormaFatigaLineChart chronological={formaFatigaChronological} />
      </div>
    </div>
  );
}
