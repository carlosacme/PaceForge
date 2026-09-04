import React, { useEffect } from "react";
import WorkoutDetailBreakdown from "../WorkoutDetailBreakdown";
import WorkoutStructureTable from "./WorkoutStructureTable";

/**
 * Sheet de detalle del plan: desglose (Pasos) + tabla de estructura.
 * Los datos de ejecución viven en WorkoutRegistroModal, no aquí.
 *
 * canEditPlan monta Editar/Eliminar. Los handlers hacen return temprano si
 * la prop es false: no basta con ocultar los botones. El calendario del atleta
 * no pasa onEdit/onDelete.
 */
export default function WorkoutDetailSheet({
  workout,
  vdot = 42.5,
  onClose,
  canEditPlan = false,
  onEdit,
  onDelete,
}) {
  useEffect(() => {
    if (!workout) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [workout, onClose]);

  const handleEdit = () => {
    if (!canEditPlan) return;
    onEdit?.(workout);
  };

  const handleDelete = () => {
    if (!canEditPlan) return;
    onDelete?.(workout);
  };

  if (!workout) return null;

  const w = workout;
  const structure = w.structure ?? w.workout_structure ?? [];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 10010,
        padding: 12,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={w.title || "Detalle del entrenamiento"}
        style={{
          width: "min(96vw, 640px)",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: ".7em", fontWeight: 800, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".1em" }}>
            Detalle del entreno
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#475569",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "12px 16px 16px", overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
          <WorkoutDetailBreakdown workout={w} vdot={vdot} />

          {Array.isArray(structure) && structure.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontSize: ".68em",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                  color: "#17c6a3",
                  marginBottom: 8,
                }}
              >
                Estructura
              </div>
              <WorkoutStructureTable structure={structure} title={w.title} />
            </div>
          ) : null}
        </div>

        {canEditPlan ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "10px 16px 14px",
              borderTop: "1px solid #e2e8f0",
              flexShrink: 0,
            }}
          >
            {onEdit ? (
              <button
                type="button"
                onClick={handleEdit}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#0f172a",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: ".8em",
                }}
              >
                ✏️ Editar
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                style={{
                  background: "#fff",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#b91c1c",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: ".8em",
                }}
              >
                🗑 Eliminar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
