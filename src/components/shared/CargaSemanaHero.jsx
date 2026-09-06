import React from "react";

const RPE_KIND_COLOR = {
  forma: "#22c55e",
  fatiga: "#f87171",
  fresco: "#facc15",
  none: "#94a3b8",
};

const HERO_HELP =
  "Aguda = km de los últimos 7 días. Crónica = promedio semanal de 4 semanas. Informativo: no cambia el plan. Óptimo 0.8–1.3 · precaución 1.3–1.5 · riesgo > 1.5";

function hexTint(hex, alpha) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function bandBlurb(bandKey, secondPerson) {
  switch (bandKey) {
    case "low":
      return secondPerson
        ? "Tu carga de los últimos 7 días está por debajo de lo que venías haciendo."
        : "La carga de los últimos 7 días está por debajo de lo que venía haciendo.";
    case "safe":
      return secondPerson
        ? "Tu carga de los últimos 7 días está en rango respecto a lo que venías haciendo."
        : "La carga de los últimos 7 días está en rango respecto a lo que venía haciendo.";
    case "caution":
      return secondPerson
        ? "Tu carga de los últimos 7 días está un poco por encima de lo habitual."
        : "La carga de los últimos 7 días está un poco por encima de lo habitual.";
    case "overload":
      return secondPerson
        ? "Tu carga de los últimos 7 días está claramente por encima de lo que venías haciendo."
        : "La carga de los últimos 7 días está claramente por encima de lo que venía haciendo.";
    default:
      return "Aún no hay suficientes kilómetros completados para leer la carga.";
  }
}

function acuteVsHabitualCopy(acuteKm, chronicWeeklyAvgKm) {
  if (chronicWeeklyAvgKm <= 1e-6 && acuteKm <= 1e-6) return "sin kilómetros aún";
  if (chronicWeeklyAvgKm <= 1e-6) return "sin promedio de 4 semanas aún";
  const diff = acuteKm - chronicWeeklyAvgKm;
  if (Math.abs(diff) < 0.05) return "parecido a lo habitual";
  return diff > 0 ? "por encima de lo habitual" : "por debajo de lo habitual";
}

function MetricCard({ statusColor, label, value, hint, valueColor }) {
  return (
    <div
      style={{
        border: `1px solid ${hexTint(statusColor, 0.45)}`,
        borderRadius: 12,
        padding: "14px 12px",
        background: "#fafafa",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: statusColor,
            flexShrink: 0,
          }}
        />
        <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700 }}>{label}</div>
      </div>
      <div style={{ fontSize: "1.2em", fontWeight: 900, color: valueColor || "#0f172a", fontFamily: valueColor ? undefined : "monospace" }}>
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: ".7em", color: "#64748b", marginTop: 8, lineHeight: 1.4 }}>{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * Héroe + 3 tarjetas del semáforo de carga.
 * El color sale de metrics.statusColor (acwrBands). No recalcula bandas.
 */
export default function CargaSemanaHero({
  title,
  secondPerson = true,
  metrics,
  formaFatigaStatus,
}) {
  const statusColor = metrics?.statusColor || "#64748b";
  const statusLabel = metrics?.statusLabel || "Sin datos suficientes";
  const acuteKm = Number(metrics?.acuteKm) || 0;
  const chronicWeeklyAvgKm = Number(metrics?.chronicWeeklyAvgKm) || 0;
  const rpeKind = formaFatigaStatus?.kind || "none";
  const rpeLabel = formaFatigaStatus?.label || "Sin datos suficientes";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          border: `1.5px solid ${hexTint(statusColor, 0.55)}`,
          background: hexTint(statusColor, 0.08),
          borderRadius: 14,
          padding: "16px 16px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: ".72em", color: "#475569", textTransform: "uppercase", letterSpacing: ".13em", fontWeight: 800 }}>
            {title}
          </div>
          <span
            title={HERO_HELP}
            aria-label={HERO_HELP}
            style={{
              width: 22,
              height: 22,
              borderRadius: 99,
              border: "1px solid #cbd5e1",
              color: "#64748b",
              fontSize: ".72em",
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "help",
              background: "#fff",
              flexShrink: 0,
            }}
          >
            ?
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 12,
              height: 12,
              borderRadius: 99,
              background: statusColor,
              boxShadow: `0 0 0 4px ${hexTint(statusColor, 0.2)}`,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: "1.25em", fontWeight: 900, color: statusColor }}>{statusLabel}</div>
        </div>
        <div style={{ fontSize: ".85em", color: "#334155", lineHeight: 1.45, paddingLeft: 22 }}>
          {bandBlurb(metrics?.acwrBandKey, secondPerson)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 12 }}>
        <MetricCard
          statusColor={statusColor}
          label="Últimos 7 días"
          value={`${acuteKm.toFixed(1)} km`}
          hint={acuteVsHabitualCopy(acuteKm, chronicWeeklyAvgKm)}
        />
        <MetricCard
          statusColor={statusColor}
          label="Lo habitual (4 semanas)"
          value={`${chronicWeeklyAvgKm.toFixed(1)} km/sem`}
          hint={secondPerson ? "tu promedio" : "su promedio"}
        />
        <MetricCard
          statusColor={statusColor}
          label={secondPerson ? "Cómo te sientes" : "Cómo se siente"}
          value={rpeLabel}
          valueColor={RPE_KIND_COLOR[rpeKind] || RPE_KIND_COLOR.none}
          hint="RPE × km"
        />
      </div>
    </div>
  );
}
