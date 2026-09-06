import React, { useId } from "react";

const CHART_HELP =
  "Basado en sesiones completadas con RPE: carga aguda = promedio (RPE × km) últimos 7 días; carga crónica = promedio (RPE × km) últimos 28 días; forma = crónica − aguda.";

const COLOR_ACUTE = "#ef4444";
const COLOR_CHRONIC = "#3b82f6";
const COLOR_FORMA = "#22c55e";

const LEGEND = [
  { color: COLOR_ACUTE, label: "Últimos 7 días" },
  { color: COLOR_CHRONIC, label: "Últimas 4 semanas" },
  { color: COLOR_FORMA, label: "Forma" },
];

/** Path cúbico monotone (Fritsch–Carlson). Pasa por cada punto; no inventa picos. */
function monotonePath(points) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const dx = [];
  const dy = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
    slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const tan = [];
  tan[0] = slope[0];
  tan[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    tan[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(slope[i]) < 1e-12) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i];
    const b = tan[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const f = 3 / Math.sqrt(s);
      tan[i] = f * a * slope[i];
      tan[i + 1] = f * b * slope[i];
    }
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const c1x = p0.x + dx[i] / 3;
    const c1y = p0.y + (tan[i] * dx[i]) / 3;
    const c2x = p1.x - dx[i] / 3;
    const c2y = p1.y - (tan[i + 1] * dx[i]) / 3;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p1.x} ${p1.y}`;
  }
  return d;
}

/** Gráfico de líneas (SVG + estilos inline, sin librerías de gráficos). */
export default function FormaFatigaLineChart({ chronological }) {
  const fillId = useId().replace(/:/g, "");
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

  const seriesPoints = (key) =>
    chronological.map((p, idx) => ({ x: xs[idx], y: toY(p[key] ?? 0) }));

  const acutePts = seriesPoints("acute");
  const chronicPts = seriesPoints("chronic");
  const formaPts = seriesPoints("forma");
  const acutePath = monotonePath(acutePts);
  const chronicPath = monotonePath(chronicPts);
  const formaPath = monotonePath(formaPts);
  const yZero = toY(0);
  const formaFill =
    formaPts.length >= 2
      ? `${formaPath} L ${formaPts[formaPts.length - 1].x} ${yZero} L ${formaPts[0].x} ${yZero} Z`
      : "";

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
      <defs>
        <linearGradient id={fillId} gradientUnits="userSpaceOnUse" x1="0" y1={padT} x2="0" y2={padT + innerH}>
          <stop offset="0%" stopColor={COLOR_FORMA} stopOpacity="0.18" />
          <stop offset="100%" stopColor={COLOR_FORMA} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={8} />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        const gv = minV + span * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(148,163,184,.07)" strokeWidth={1} />
            <text x={4} y={y + 4} fill="#64748b" fontSize={9} fontFamily="system-ui,sans-serif">
              {gv.toFixed(0)}
            </text>
          </g>
        );
      })}
      {formaFill ? <path d={formaFill} fill={`url(#${fillId})`} /> : null}
      <path d={chronicPath} fill="none" stroke={COLOR_CHRONIC} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={acutePath} fill="none" stroke={COLOR_ACUTE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={formaPath} fill="none" stroke={COLOR_FORMA} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
      {[
        { pts: chronicPts, color: COLOR_CHRONIC, key: "chronic" },
        { pts: acutePts, color: COLOR_ACUTE, key: "acute" },
        { pts: formaPts, color: COLOR_FORMA, key: "forma" },
      ].map((series) =>
        series.pts.map((pt, idx) => (
          <g key={`${series.key}-${idx}`}>
            <circle cx={pt.x} cy={pt.y} r={4} fill="#fff" />
            <circle cx={pt.x} cy={pt.y} r={2.6} fill={series.color} />
          </g>
        ))
      )}
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
