import React from "react";

const NEUTRAL = "#94a3b8";

/**
 * Barras de km semanales (lun–dom). Lee weekBarsOldestFirst / maxBarKm
 * de computeGarminLoadMetricsFromWorkouts. No recalcula.
 * Solo "Esta semana" usa el color del semáforo.
 */
export default function KmSemanaBars({ metrics }) {
  const bars = metrics?.weekBarsOldestFirst || [];
  const maxBarKm = metrics?.maxBarKm || 1;
  const statusColor = metrics?.statusColor || NEUTRAL;

  return (
    <div>
      <div style={{ fontSize: ".72em", color: "#475569", textTransform: "uppercase", letterSpacing: ".13em", fontWeight: 800, marginBottom: 10 }}>
        Km por semana
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, minHeight: 120, paddingTop: 4 }}>
        {bars.map((b) => {
          const hPct = Math.max(6, (b.km / maxBarKm) * 100);
          const isCurrent = b.label === "Esta semana";
          const color = isCurrent ? statusColor : NEUTRAL;
          return (
            <div key={b.key} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ width: "100%", height: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "#f1f5f9", borderRadius: 8, padding: "0 6px", boxSizing: "border-box" }}>
                <div
                  style={{
                    width: "72%",
                    height: `${hPct}%`,
                    maxHeight: "100%",
                    background: color,
                    borderRadius: "6px 6px 2px 2px",
                    boxShadow: isCurrent ? `0 0 10px ${color}59` : "none",
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
  );
}
