import React, { useMemo } from "react";
import FormaFatigaLineChart from "../shared/FormaFatigaLineChart";
import CargaSemanaHero from "../shared/CargaSemanaHero";
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
        <CargaSemanaHero
          title="¿Cómo vas esta semana?"
          secondPerson
          metrics={garminLoadMetrics}
          formaFatigaStatus={formaFatigaStatus}
        />
      </div>
      <div style={{ ...cardStyle }}>
        <FormaFatigaLineChart chronological={formaFatigaChronological} />
      </div>
    </div>
  );
}
