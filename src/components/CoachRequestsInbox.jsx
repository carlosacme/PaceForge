import React from "react";

/**
 * Lista de solicitudes pending. Misma acción Aceptar/Rechazar en
 * Dashboard (card) y CoachSettings (bloque de config).
 */
export default function CoachRequestsInbox({
  pendingRequests = [],
  requestsBusyId = "",
  loading = false,
  onAccept,
  onReject,
  title = "Solicitudes de atletas",
  emptyText = "No tienes solicitudes pendientes.",
}) {
  const count = pendingRequests.length;
  return (
    <div id="coach-pending-requests">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
          {title}
        </div>
        {count > 0 ? (
          <span
            style={{
              fontSize: ".72em",
              fontWeight: 800,
              color: "#9a3412",
              background: "rgba(255,138,61,.16)",
              border: "1px solid rgba(255,138,61,.4)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            {count} pendiente{count === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {loading && count === 0 ? (
        <div style={{ color: "#64748b", fontSize: ".84em" }}>Cargando solicitudes…</div>
      ) : count === 0 ? (
        <div style={{ color: "#64748b", fontSize: ".84em" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pendingRequests.map((r) => {
            const displayName = (r.athlete_name || "").trim() || "Atleta";
            const displayEmail = (r.athlete_email || "").trim();
            const busy = requestsBusyId === r.id;
            return (
              <div
                key={r.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "#f8fafc",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ color: "#0f172a", fontWeight: 700, fontSize: ".82em" }}>{displayName}</div>
                  <div style={{ color: "#64748b", fontSize: ".72em" }}>{displayEmail || "Sin correo"}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAccept(r)}
                    style={{
                      background: "rgba(34,197,94,.14)",
                      border: "1px solid rgba(34,197,94,.35)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      color: "#15803d",
                      fontSize: ".72em",
                      fontWeight: 700,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReject(r)}
                    style={{
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 8,
                      padding: "6px 10px",
                      color: "#b91c1c",
                      fontSize: ".72em",
                      fontWeight: 700,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
