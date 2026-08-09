import React from "react";
import { WORKOUT_BLOCK_TYPES, emptyWorkoutStructureRow } from "./appShared";

/**
 * Editor de bloques de un workout.
 *
 * Vivia dentro de Builder.jsx y estaba copiado en AdminMarketplacePanel; ahora
 * lo comparten el Builder y el editor de sesiones de Plan 2 Semanas. Trabaja
 * sobre las filas canonicas (block_type, duration_min, distance_km,
 * target_pace, target_hr, description) que producen
 * workoutStructureToEditableRows y consume editableRowsToWorkoutStructure.
 *
 * `block_label` es opcional y guarda el nombre original del bloque cuando la
 * IA lo llamo de una forma que no esta en WORKOUT_BLOCK_TYPES
 * ("Repetition 3 - 400m"). Se conserva salvo que el coach cambie el tipo.
 */
const cellLabelStyle = { fontSize: ".65em", color: "#94a3b8", marginBottom: 4 };
const cellInputStyle = {
  width: "100%",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: ".82em",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function WorkoutStructureEditor({ rows, onRowsChange, title = "ESTRUCTURA DEL WORKOUT", minRows = 1 }) {
  const list = Array.isArray(rows) ? rows : [];

  const updateRow = (idx, patch) => {
    const next = [...list];
    next[idx] = { ...next[idx], ...patch };
    onRowsChange(next);
  };

  const moveRow = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    onRowsChange(next);
  };

  const removeRow = (idx) => {
    if (list.length <= minRows) return;
    onRowsChange(list.filter((_, j) => j !== idx));
  };

  return (
    <>
      {title ? (
        <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>{title}</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((row, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "12px 12px",
              background: "#f8fafc",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: ".75em", fontWeight: 800, color: "#334155" }}>
                Paso {idx + 1}
                {row.block_label ? <span style={{ fontWeight: 600, color: "#64748b" }}> · {row.block_label}</span> : null}
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveRow(idx, -1)}
                  style={{
                    background: idx === 0 ? "#f1f5f9" : "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: ".72em",
                    cursor: idx === 0 ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontWeight: 700,
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={idx >= list.length - 1}
                  onClick={() => moveRow(idx, 1)}
                  style={{
                    background: idx >= list.length - 1 ? "#f1f5f9" : "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: ".72em",
                    cursor: idx >= list.length - 1 ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontWeight: 700,
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={list.length <= minRows}
                  onClick={() => removeRow(idx)}
                  style={{
                    background: "transparent",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: ".72em",
                    color: list.length <= minRows ? "#cbd5e1" : "#b91c1c",
                    cursor: list.length <= minRows ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontWeight: 700,
                  }}
                >
                  🗑️
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
              <div>
                <div style={cellLabelStyle}>Tipo de bloque</div>
                <select
                  value={WORKOUT_BLOCK_TYPES.includes(row.block_type) ? row.block_type : "Intervalo"}
                  onChange={(e) => updateRow(idx, { block_type: e.target.value, block_label: "" })}
                  style={cellInputStyle}
                >
                  {WORKOUT_BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                </select>
              </div>
              <div>
                <div style={cellLabelStyle}>Duración (minutos, o «90 sec»)</div>
                <input
                  value={row.duration_min}
                  onChange={(e) => updateRow(idx, { duration_min: e.target.value })}
                  placeholder="Ej: 12"
                  style={cellInputStyle}
                />
              </div>
              <div>
                <div style={cellLabelStyle}>Distancia (km)</div>
                <input
                  value={row.distance_km}
                  onChange={(e) => updateRow(idx, { distance_km: e.target.value })}
                  placeholder="Opcional"
                  style={cellInputStyle}
                />
              </div>
              <div>
                <div style={cellLabelStyle}>Ritmo objetivo (MM:SS /km)</div>
                <input
                  value={row.target_pace}
                  onChange={(e) => updateRow(idx, { target_pace: e.target.value })}
                  placeholder="Ej: 4:30"
                  style={cellInputStyle}
                />
              </div>
              <div>
                <div style={cellLabelStyle}>FC objetivo (lpm)</div>
                <input
                  value={row.target_hr}
                  onChange={(e) => updateRow(idx, { target_hr: e.target.value })}
                  placeholder="Ej: 140-160"
                  style={cellInputStyle}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={cellLabelStyle}>Descripción</div>
                <input
                  value={row.description}
                  onChange={(e) => updateRow(idx, { description: e.target.value })}
                  placeholder="Texto libre"
                  style={cellInputStyle}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onRowsChange([...list, emptyWorkoutStructureRow()])}
        style={{
          marginTop: 12,
          width: "100%",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          padding: "10px 14px",
          color: "#1d4ed8",
          fontWeight: 800,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: ".82em",
        }}
      >
        ➕ Agregar bloque
      </button>
    </>
  );
}

export default WorkoutStructureEditor;
