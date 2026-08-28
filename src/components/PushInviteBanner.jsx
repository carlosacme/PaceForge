import React from "react";

/**
 * Banner coach: pedir permiso de notificaciones (web Notification / nativo Capacitor).
 *
 * @param {{
 *   visible: boolean,
 *   onActivate: () => void | Promise<void>,
 *   onDismiss: () => void,
 * }} props
 */
export default function PushInviteBanner({ visible, onActivate, onDismiss }) {
  if (!visible) return null;

  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "12px 16px",
        borderRadius: 12,
        background: "#fffbeb",
        border: "1px solid #fde68a",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <span style={{ flex: "1 1 200px", color: "#78350f", fontSize: ".88em", fontWeight: 600 }}>
        Activa las notificaciones para recibir mensajes
      </span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onActivate}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
            color: "#fff",
            fontWeight: 800,
            fontSize: ".8em",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Activar
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#fff",
            color: "#64748b",
            fontWeight: 700,
            fontSize: ".8em",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
