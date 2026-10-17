import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtPace } from "../../lib/vdot";
import { kindBadge } from "../../lib/registroComparisonView";
import "./registroComparison.css";

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

function barColor(block) {
  return kindBadge(block).bg;
}

/**
 * Barras por bloque: previsto vs real.
 * El valor de barra es (techo − ritmo) para que un ritmo más rápido
 * (menos s/km) se vea más alto. El eje Y muestra min/km de verdad.
 * Color del real: RÁPIDO vs RECUPERACIÓN (mismo mapa que la tabla).
 */
export default function RegistroPaceChart({ blocks, kmSplits }) {
  const kmMode = Array.isArray(kmSplits) && kmSplits.length > 0 && !(Array.isArray(blocks) && blocks.length);

  const { rows, ceiling, range } = useMemo(() => {
    if (kmMode) {
      const list = kmSplits;
      const paces = list.map((k) => k.pace_s).filter((p) => p != null);
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
        rows: list.map((k, i) => ({
          label: k.name || `km ${i + 1}`,
          fullName: k.name || `km ${i + 1}`,
          planned: null,
          actual: k.pace_s,
          plannedBar: null,
          actualBar: k.pace_s != null ? ceil - k.pace_s : null,
          barFill: ACTUAL_COLOR,
        })),
      };
    }

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
        barFill: barColor(b),
        kindLabel: kindBadge(b).text,
      })),
    };
  }, [blocks, kmSplits, kmMode]);

  const yTicks = useMemo(() => {
    const n = 4;
    const ticks = [];
    for (let i = 0; i <= n; i++) ticks.push((range * i) / n);
    return ticks;
  }, [range]);

  if (!rows.length) return null;

  return (
    <div className="pf-reg-compare" style={{ margin: "0 0 12px", padding: "8px 8px 4px", background: "var(--pf-reg-bg)", border: "1px solid var(--pf-reg-line)", borderRadius: 8 }}>
      <div style={{ fontSize: ".78em", fontWeight: 800, color: "var(--pf-reg-text)", margin: "0 4px 2px" }}>
        {kmMode ? "Ritmo por km" : "Ritmo previsto vs real"}
      </div>
      <div style={{ fontSize: ".72em", color: "var(--pf-reg-muted)", margin: "0 4px 6px" }}>
        Más alto = más rápido (eje de ritmo invertido).
        {kmMode ? "" : " Color del real: RÁPIDO vs RECUPERACIÓN."}
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--pf-reg-line)" vertical={false} />
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
                  <div style={{ background: "var(--pf-reg-card, #fff)", border: "1px solid var(--pf-reg-line, #e2e8f0)", borderRadius: 8, padding: "8px 10px", fontSize: ".8em", color: "var(--pf-reg-text, #334155)" }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{row.fullName}{row.kindLabel ? ` · ${row.kindLabel}` : ""}</div>
                    {row.planned != null ? <div style={{ color: PLANNED_COLOR }}>Previsto: {fmtPaceKm(row.planned)}</div> : null}
                    <div style={{ color: row.barFill || ACTUAL_COLOR }}>Real: {fmtPaceKm(row.actual)}</div>
                  </div>
                );
              }}
            />
            {kmMode ? null : (
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "0.75em", paddingTop: 4 }}
              />
            )}
            {kmMode ? null : (
              <Bar dataKey="plannedBar" name="Previsto" fill={PLANNED_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
            )}
            <Bar dataKey="actualBar" name="Real" fill={ACTUAL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28}>
              {rows.map((row, i) => (
                <Cell key={i} fill={row.barFill || ACTUAL_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
