import { IOS_ACCOUNT_NO_ACCESS } from "../lib/platform";

/**
 * Misma pantalla que el coach con plan_status blocked dentro de iOS:
 * aviso neutro y cerrar sesión. Sin precios ni enlace de pago.
 */
export default function IosNoAccessScreen({ onSignOut, signingOut = false }) {
  return (
    <div style={{ minHeight: "100svh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f8fafc" }}>
      <div style={{ background: "#ffffff", border: "1px solid #f1f5f9", borderRadius: 12, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", maxWidth: 440, width: "100%", textAlign: "center" }}>
        <p style={{ margin: "0 0 16px", color: "#334155", fontSize: ".95em", lineHeight: 1.5 }}>{IOS_ACCOUNT_NO_ACCESS}</p>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          style={{
            width: "100%",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "12px 14px",
            color: "#dc2626",
            cursor: signingOut ? "wait" : "pointer",
            fontFamily: "inherit",
            fontSize: ".88em",
            fontWeight: 800,
          }}
        >
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>
    </div>
  );
}
