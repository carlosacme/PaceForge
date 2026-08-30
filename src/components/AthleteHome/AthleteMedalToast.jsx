import React from "react";

/**
 * Toast de medalla nueva. Mismo lenguaje visual que styles.notification
 * del coach (borde verde, fixed). z-index 10100: por encima del modal RPE
 * (10050), para que se vea al otorgar en segundo plano mientras se llena el resumen.
 */
export default function AthleteMedalToast({ text }) {
  if (!text) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        right: 16,
        maxWidth: 420,
        margin: "0 auto",
        background: "#ffffff",
        border: "1px solid #86efac",
        borderRadius: 10,
        padding: "12px 18px",
        fontSize: ".86em",
        fontWeight: 800,
        color: "#15803d",
        zIndex: 10100,
        boxShadow: "0 4px 20px rgba(15,23,42,0.16)",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}
