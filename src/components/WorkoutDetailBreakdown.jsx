import React, { useMemo } from "react";
import { getWorkoutDetailGroups, formatDetailStepAmount } from "../lib/intervals";
import { stripTestTimeGoalFromDescription, stripTestTimeGoalsFromStructure } from "../lib/enrichPace";

/**
 * Desglose tipo TrainingPeaks: descripcion general + PASOS (con repeticiones
 * agrupadas vía groupRepeats). Pensado para vivir dentro del menú contextual
 * del calendario del atleta.
 */
export default function WorkoutDetailBreakdown({ workout, vdot = 42.5 }) {
  const { hasStructure, groups } = useMemo(
    () => {
      const structure = stripTestTimeGoalsFromStructure(
        workout?.title,
        workout?.structure ?? workout?.workout_structure,
      );
      return getWorkoutDetailGroups({ ...workout, structure }, vdot);
    },
    [workout, vdot],
  );

  const generalDescription = stripTestTimeGoalFromDescription(
    workout?.title,
    workout?.description || "",
  ).trim();
  const title = String(workout?.title || "Entrenamiento").trim();
  const simpleKm = workout?.total_km != null && Number(workout.total_km) > 0
    ? `${Number(workout.total_km)} km`
    : "";
  const simpleMin = workout?.duration_min != null && Number(workout.duration_min) > 0
    ? `${Number(workout.duration_min)} min`
    : "";

  let stepNumber = 0;

  const renderStepRow = (step, { indented = false, indexLabel = null } = {}) => {
    const n = indexLabel != null ? indexLabel : (++stepNumber);
    const amount = formatDetailStepAmount(step);
    const pace = step?.pace ? `${step.pace} min/km` : "";
    const hr = step?.targetHr || "";
    const bits = [amount, pace ? `@ ${pace}` : "", hr].filter(Boolean);
    return (
      <div
        key={`${n}-${step?.label}-${amount}`}
        style={{
          marginLeft: indented ? 12 : 0,
          padding: "8px 0",
          borderBottom: "1px solid #f1f5f9",
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: ".8em",
            color: "#0f172a",
            lineHeight: 1.35,
            wordBreak: "break-word",
          }}
        >
          <span style={{ color: "#64748b", fontWeight: 600 }}>{n}. </span>
          {step?.label || "Paso"}
        </div>
        {bits.length > 0 ? (
          <div
            style={{
              marginTop: 3,
              fontSize: ".74em",
              color: "#475569",
              lineHeight: 1.4,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {bits.join(" · ")}
          </div>
        ) : null}
        {step?.description ? (
          <div
            style={{
              marginTop: 3,
              fontSize: ".72em",
              color: "#64748b",
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}
          >
            {step.description}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <div style={{ fontWeight: 900, fontSize: ".88em", color: "#0d1f38", marginBottom: 4 }}>
        {title}
      </div>
      {(simpleKm || simpleMin) ? (
        <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 10 }}>
          {[simpleKm, simpleMin].filter(Boolean).join(" · ")}
        </div>
      ) : (
        <div style={{ height: 6 }} />
      )}

      {generalDescription ? (
        <div
          style={{
            fontSize: ".8em",
            color: "#334155",
            lineHeight: 1.5,
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(23,198,163,.08)",
            border: "1px solid rgba(23,198,163,.22)",
            wordBreak: "break-word",
          }}
        >
          {generalDescription}
        </div>
      ) : null}

      {!hasStructure ? (
        <div style={{ fontSize: ".8em", color: "#64748b", lineHeight: 1.45 }}>
          {simpleKm || simpleMin
            ? "Sesión simple sin desglose de pasos."
            : "Este entrenamiento no tiene estructura detallada."}
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: ".68em",
              letterSpacing: ".12em",
              textTransform: "uppercase",
              fontWeight: 800,
              color: "#17c6a3",
              marginBottom: 4,
            }}
          >
            Pasos
          </div>
          <div>
            {groups.map((g, gi) => {
              if (g.type === "repeat") {
                const headerNum = ++stepNumber;
                return (
                  <div key={`rep-${gi}`} style={{ marginTop: 6, marginBottom: 4 }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: ".8em",
                        color: "#ff8a3d",
                        padding: "6px 0 2px",
                      }}
                    >
                      {headerNum}. Repetir {g.reps} veces
                    </div>
                    {(g.steps || []).map((s, si) =>
                      renderStepRow(s, { indented: true, indexLabel: si + 1 }),
                    )}
                  </div>
                );
              }
              return renderStepRow(g.step, { indented: false });
            })}
          </div>
        </>
      )}
    </div>
  );
}
