import React from "react";

const CHART_HELP =
  "Basado en sesiones completadas con RPE: carga aguda = promedio (RPE × km) últimos 7 días; carga crónica = promedio (RPE × km) últimos 28 días; forma = crónica − aguda.";

const LEGEND = [
  { color: "#ef4444", label: "Últimos 7 días" },
  { color: "#3b82f6", label: "Últimas 4 semanas" },
  { color: "#22c55e", label: "Forma" },
];

/** Gráfico de líneas (SVG + estilos inline, sin librerías de gráficos). */
export default function FormaFatigaLineChart({ chronological }) {
  const n = chronological.length;
  const W = 360;
  const H = 160;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = n <= 1 ? [padL + innerW / 2] : chronological.map((_, idx) => padL + (innerW * idx) / (n - 1));

  const vals = [];
  chronological.forEach((p) => {
    vals.push(p.acute ?? 0, p.chronic ?? 0, p.forma ?? 0);
  });
  const minV = Math.min(0, ...vals);
  const maxV = Math.max(1e-6, ...vals);
  const span = maxV - minV || 1;
  const toY = (v) => padT + innerH - ((v - minV) / span) * innerH;

  const linePoints = (key) =>
    chronological
      .map((p, idx) => {
        const v = p[key] ?? 0;
        return `${xs[idx]},${toY(v)}`;
      })
      .join(" ");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: ".72em", color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>
          Tendencia
        </div>
        <span
          title={CHART_HELP}
          aria-label={CHART_HELP}
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12, fontSize: ".78em", color: "#64748b" }}>
        {LEGEND.map((item) => (
          <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ color: item.color, fontWeight: 800, letterSpacing: -1 }}>
              ——
            </span>
            {item.label}
          </span>
        ))}
      </div>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Últimos 7 días, últimas 4 semanas y forma en las últimas 8 semanas"
      style={{ width: "100%", maxWidth: 520, height: "auto", display: "block" }}
    >
      <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={8} />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        const gv = minV + span * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(148,163,184,.15)" strokeWidth={1} />
            <text x={4} y={y + 4} fill="#64748b" fontSize={9} fontFamily="system-ui,sans-serif">
              {gv.toFixed(0)}
            </text>
          </g>
        );
      })}
      <polyline fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("acute")} />
      <polyline fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("chronic")} />
      <polyline fill="none" stroke="#22c55e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("forma")} />
      {chronological.map((p, idx) => (
        <text
          key={p.i}
          x={xs[idx]}
          y={H - 6}
          fill="#64748b"
          fontSize={8}
          fontFamily="system-ui,sans-serif"
          textAnchor="middle"
        >
          {p.label}
        </text>
      ))}
    </svg>
    </div>
  );
}
