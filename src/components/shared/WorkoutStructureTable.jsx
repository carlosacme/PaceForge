import React from "react";
import { normalizeWorkoutStructure, WORKOUT_BLOCK_COLORS } from "./appShared";
import { stripTestTimeGoalsFromStructure } from "../../lib/enrichPace";

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
            const c = WORKOUT_BLOCK_COLORS[step.block_type] || { bg: "#f8fafc", border: "#e2e8f0", text: "#334155" };
            return (
              <tr key={`${step.block_type}-${i}`}>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{i + 1}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 999, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontWeight: 800 }}>
                    {step.block_type}
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
