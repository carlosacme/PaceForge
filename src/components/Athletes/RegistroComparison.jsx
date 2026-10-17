import React, { useState } from "react";
import { fmtPace } from "../../lib/vdot";
import { blockHasWatchSplits } from "../../lib/blockComparison";
import {
  UNGUIDED_MESSAGE,
  kindBadge,
  deltaDisplay,
  plannedObjectiveText,
  actualText,
  summaryText,
  isUnguidedComparison,
  shouldShowKmSplits,
  extraLabel,
  blockStatusNote,
  fmtDistM,
  fmtDurS,
} from "../../lib/registroComparisonView";
import "./registroComparison.css";

const RegistroPaceChart = React.lazy(() => import("./RegistroPaceChart"));

function KindBadge({ block }) {
  const b = kindBadge(block);
  return (
    <span className={`pf-reg-badge pf-reg-badge-${b.key}`} title={b.text}>
      {b.text}
    </span>
  );
}

function SplitsTable({ splits }) {
  if (!Array.isArray(splits) || !splits.length) return null;
  return (
    <table className="pf-reg-table" style={{ fontSize: ".88em", marginTop: 4 }}>
      <thead>
        <tr>
          <th>Vuelta</th>
          <th className="num">Tiempo</th>
          <th className="num">Distancia</th>
          <th className="num">Ritmo</th>
        </tr>
      </thead>
      <tbody>
        {splits.map((sp, si) => (
          <tr key={si}>
            <td style={{ fontWeight: 600 }}>{sp.name}</td>
            <td className="num">{sp.dur_s != null ? fmtPace(sp.dur_s) : "—"}</td>
            <td className="num">{fmtDistM(sp.dist_m)}</td>
            <td className="num">{sp.pace_s != null ? `${fmtPace(sp.pace_s)}/km` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KmSplitsTable({ splits }) {
  if (!Array.isArray(splits) || !splits.length) return null;
  return (
    <table className="pf-reg-table">
      <thead>
        <tr>
          <th>km</th>
          <th className="num">Tiempo</th>
          <th className="num">Distancia</th>
          <th className="num">Ritmo</th>
        </tr>
      </thead>
      <tbody>
        {splits.map((sp, i) => (
          <tr key={i}>
            <td style={{ fontWeight: 600 }}>{sp.name || `km ${i + 1}`}</td>
            <td className="num">{fmtDurS(sp.dur_s) || "—"}</td>
            <td className="num">{fmtDistM(sp.dist_m)}</td>
            <td className="num">{sp.pace_s != null ? `${fmtPace(sp.pace_s)}/km` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Tabla Garmin: una fila por bloque, etiquetas RÁPIDO/RECUPERACIÓN,
 * unguided con km_splits, Extra, chip N vueltas.
 */
export default function RegistroComparison({ comparison, blocks: blocksProp, chartBlocks }) {
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const unguided = isUnguidedComparison(comparison);
  const blocks = Array.isArray(blocksProp)
    ? blocksProp
    : (Array.isArray(comparison?.blocks) ? comparison.blocks : []);
  const extra = Array.isArray(comparison?.extra) ? comparison.extra : [];
  const showKm = shouldShowKmSplits(comparison);
  const kmSplits = showKm ? (comparison.km_splits || []) : [];
  const showChevron = !showKm;

  const toggleRow = (i) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (unguided) {
    return (
      <div className="pf-reg-compare">
        <div className="pf-reg-unguided">
          <strong>{comparison.message || UNGUIDED_MESSAGE}</strong>
          <span style={{ color: "var(--pf-reg-muted)", fontSize: ".88em" }}>
            El reloj no lanzó el entreno guiado. Resumen: {summaryText(comparison.summary) || "—"}
          </span>
        </div>
        {kmSplits.length ? (
          <>
            <React.Suspense fallback={<div style={{ height: 160, color: "var(--pf-reg-muted)", fontSize: ".85em" }}>Cargando gráfico…</div>}>
              <RegistroPaceChart blocks={[]} kmSplits={kmSplits} />
            </React.Suspense>
            <div className="pf-reg-section-title">Parciales por km</div>
            <KmSplitsTable splits={kmSplits} />
          </>
        ) : null}
      </div>
    );
  }

  if (!blocks.length) {
    return (
      <div className="pf-reg-compare" style={{ color: "var(--pf-reg-muted)" }}>
        No hay datos por bloque para esta actividad
      </div>
    );
  }

  const chartData = chartBlocks || blocks;

  return (
    <div className="pf-reg-compare">
      {chartData.length ? (
        <React.Suspense fallback={<div style={{ height: 220, color: "var(--pf-reg-muted)", fontSize: ".85em" }}>Cargando gráfico…</div>}>
          <RegistroPaceChart blocks={chartData} />
        </React.Suspense>
      ) : null}
      <table className="pf-reg-table">
        <thead>
          <tr>
            <th>Bloque</th>
            <th className="num">Objetivo</th>
            <th className="num">Real</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b, i) => {
            const delta = deltaDisplay(b);
            const expandable = showChevron && blockHasWatchSplits(b);
            const open = expandable && expandedRows.has(i);
            const note = blockStatusNote(b);
            const deltaColor = delta.faster == null
              ? "var(--pf-reg-muted)"
              : (delta.faster ? "#16a34a" : "#ea580c");
            return (
              <React.Fragment key={i}>
                <tr>
                  <td>
                    {expandable ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? "Ocultar vueltas del reloj" : "Ver vueltas del reloj"}
                        onClick={() => toggleRow(i)}
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
                    <KindBadge block={b} />
                    {" "}
                    <span style={{ fontWeight: 600 }}>{b.step_name || `Bloque ${i + 1}`}</span>
                    {b.fused_label ? <span className="pf-reg-chip">{b.fused_label}</span> : null}
                    {note ? <span className="pf-reg-note">{note}</span> : null}
                  </td>
                  <td className="num">{plannedObjectiveText(b)}</td>
                  <td className="num">{actualText(b)}</td>
                  <td className="num" style={{ color: deltaColor, fontWeight: 700 }}>{delta.text}</td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "4px 6px 10px 22px" }}>
                      <div style={{ fontSize: ".72em", color: "var(--pf-reg-muted)", fontWeight: 700, marginBottom: 4 }}>
                        Vueltas del reloj
                      </div>
                      <SplitsTable splits={b.splits} />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {showKm && kmSplits.length ? (
        <>
          <div className="pf-reg-section-title">Parciales por km</div>
          <KmSplitsTable splits={kmSplits} />
        </>
      ) : null}
      {extra.length > 0 && blocks.length === (comparison?.blocks || []).length ? (
        <div className="pf-reg-extra">
          <div className="pf-reg-section-title">Extra</div>
          <div style={{ fontSize: ".78em", color: "var(--pf-reg-muted)", marginBottom: 6 }}>
            Vueltas que no encajan en un bloque del plan (no es un fallo del atleta).
          </div>
          <table className="pf-reg-table">
            <thead>
              <tr>
                <th>Vuelta</th>
                <th className="num">Tiempo</th>
                <th className="num">Distancia</th>
                <th className="num">Ritmo</th>
              </tr>
            </thead>
            <tbody>
              {extra.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{extraLabel(e)}</td>
                  <td className="num">{fmtDurS(e.dur_s) || "—"}</td>
                  <td className="num">{fmtDistM(e.dist_m)}</td>
                  <td className="num">{e.pace_s != null ? `${fmtPace(e.pace_s)}/km` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
