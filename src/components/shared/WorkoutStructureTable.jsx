import React from "react";
import { normalizeWorkoutStructure, WORKOUT_BLOCK_COLORS } from "./appShared";
import { stripTestTimeGoalsFromStructure } from "../../lib/enrichPace";
import { classifyPlanKind, resolveDanielsZone } from "../../lib/blockComparison";
import { kindBadge } from "../../lib/registroComparisonView";

export default function WorkoutStructureTable({ structure = [], title = "" }) {
  const rows = normalizeWorkoutStructure(stripTestTimeGoalsFromStructure(title, structure));
  if (!rows.length) return null;
  return (
    <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8em" }}>
        <thead style={{ background: "#f8fafc" }}>
          <tr>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Paso</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Tipo</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Duración (min)</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Distancia (km)</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Ritmo</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>FC objetivo</th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Descripción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((step, i) => {
            const zone = resolveDanielsZone({
              target_zone: step.target_zone,
              text: [step.description, step.block_type, step.target_pace].filter(Boolean).join(" "),
              pace: step.target_pace,
            });
            const badge = kindBadge({
              kind: classifyPlanKind(step),
              target_zone: zone,
              step_name: step.block_type,
              target_effort: step.target_pace,
              description: step.description,
            });
            const intervaloNoRapido = step.block_type === "Intervalo" && badge.key !== "fast";
            const c = intervaloNoRapido
              ? { bg: badge.bg, border: badge.bg, text: badge.fg }
              : (WORKOUT_BLOCK_COLORS[step.block_type] || { bg: "#f8fafc", border: "#e2e8f0", text: "#334155" });
            const tipoLabel = intervaloNoRapido ? badge.text : step.block_type;
            return (
              <tr key={`${step.block_type}-${i}`}>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{i + 1}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 999, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontWeight: 800 }}>
                    {tipoLabel}
                  </span>
                </td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.duration_min || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.distance_km || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.target_pace || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.target_hr || "—"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{step.description || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
