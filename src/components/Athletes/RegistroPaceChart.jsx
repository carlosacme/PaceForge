import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtPace } from "../../lib/vdot";

const PLANNED_COLOR = "#0d9488";
const ACTUAL_COLOR = "#ea580c";

const SHORT_NAME = {
  Calentamiento: "Calent.",
  Enfriamiento: "Enfr.",
  Recuperación: "Recup.",
  Intervalo: "Intervalo",
  Rodaje: "Rodaje",
};

function shortLabel(name, i) {
  const raw = String(name || `Bloque ${i + 1}`).trim();
  const short = SHORT_NAME[raw] || (raw.length > 11 ? `${raw.slice(0, 10)}…` : raw);
  return `${i + 1} ${short}`;
}

function fmtPaceKm(secs) {
  return secs != null && Number.isFinite(secs) ? `${fmtPace(secs)}/km` : "—";
}

/**
 * Barras por bloque: previsto vs real.
 * El valor de barra es (techo − ritmo) para que un ritmo más rápido
 * (menos s/km) se vea más alto. El eje Y muestra min/km de verdad.
 */
export default function RegistroPaceChart({ blocks }) {
  const { rows, ceiling, range } = useMemo(() => {
    const list = Array.isArray(blocks) ? blocks : [];
    const paces = [];
    for (const b of list) {
      if (b.planned_pace_s != null) paces.push(b.planned_pace_s);
      if (b.actual_pace_s != null) paces.push(b.actual_pace_s);
    }
    if (!paces.length) return { rows: [], ceiling: 0, range: 0 };
    const minP = Math.min(...paces);
    const maxP = Math.max(...paces);
    const span = Math.max(maxP - minP, 20);
    const pad = Math.max(15, span * 0.2);
    const floor = Math.max(0, minP - pad);
    const ceil = maxP + pad;
    return {
      ceiling: ceil,
      range: ceil - floor,
      rows: list.map((b, i) => ({
        label: shortLabel(b.step_name, i),
        fullName: b.step_name || `Bloque ${i + 1}`,
        planned: b.planned_pace_s,
        actual: b.actual_pace_s,
        plannedBar: b.planned_pace_s != null ? ceil - b.planned_pace_s : null,
        actualBar: b.actual_pace_s != null ? ceil - b.actual_pace_s : null,
      })),
    };
  }, [blocks]);

  const yTicks = useMemo(() => {
    const n = 4;
    const ticks = [];
    for (let i = 0; i <= n; i++) ticks.push((range * i) / n);
    return ticks;
  }, [range]);

  if (!rows.length) return null;

  return (
    <div style={{ margin: "0 0 12px", padding: "8px 8px 4px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <div style={{ fontSize: ".78em", fontWeight: 800, color: "#0f172a", margin: "0 4px 2px" }}>
        Ritmo previsto vs real
      </div>
      <div style={{ fontSize: ".72em", color: "#64748b", margin: "0 4px 6px" }}>
        Más alto = más rápido (eje de ritmo invertido).
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, range]}
              ticks={yTicks}
              width={48}
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => fmtPace(ceiling - v)}
            />
            <Tooltip
              cursor={{ fill: "rgba(15,23,42,.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload;
                return (
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".8em", color: "#334155", boxShadow: "0 8px 24px rgba(15,23,42,.08)" }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{row.fullName}</div>
                    <div style={{ color: PLANNED_COLOR }}>Previsto: {fmtPaceKm(row.planned)}</div>
                    <div style={{ color: ACTUAL_COLOR }}>Real: {fmtPaceKm(row.actual)}</div>
                  </div>
                );
              }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: "0.75em", paddingTop: 4 }}
            />
            <Bar dataKey="plannedBar" name="Previsto" fill={PLANNED_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="actualBar" name="Real" fill={ACTUAL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
