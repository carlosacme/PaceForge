import { useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * Sección "Cuenta" con eliminación irreversible (Google Play).
 * Usa RPC delete_own_account() (SECURITY DEFINER) y luego signOut.
 */
export default function DeleteAccountSection({ notify, cardStyle }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canConfirm = confirmText.trim() === "ELIMINAR" && !busy;

  const closeModal = () => {
    if (busy) return;
    setOpen(false);
    setConfirmText("");
    setError("");
  };

  const handleDelete = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("delete_own_account");
      if (rpcError) throw rpcError;
      if (data && data.ok === false) {
        throw new Error(data.error || "No se pudo eliminar la cuenta");
      }

      try {
        sessionStorage.setItem("raf_account_deleted", "1");
      } catch {
        /* ignore */
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        // Datos ya borrados; forzar salida local aunque signOut falle.
        console.warn("[delete-account] signOut:", signOutError);
      }
    } catch (e) {
      const msg = e?.message || "Error al eliminar la cuenta. Inténtalo de nuevo.";
      setError(msg);
      notify?.(msg);
      setBusy(false);
    }
  };

  const card = cardStyle || {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  };

  return (
    <>
      <div style={{ ...card, marginTop: 8 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>
          CUENTA
        </div>
        <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: ".8em", lineHeight: 1.5 }}>
          Elimina permanentemente tu cuenta y los datos asociados. Esta acción no se puede deshacer.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#b91c1c",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: ".88em",
          }}
        >
          Eliminar mi cuenta
        </button>
        <p style={{ margin: "10px 0 0", fontSize: ".72em", color: "#94a3b8" }}>
          Más info:{" "}
          <a href="/eliminar-cuenta" target="_blank" rel="noopener noreferrer" style={{ color: "#ff8a3d", fontWeight: 700 }}>
            runningapexflow.com/eliminar-cuenta
          </a>
        </p>
      </div>

      {open ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10050,
            background: "rgba(15,23,42,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              padding: 20,
              boxShadow: "0 20px 50px rgba(15,23,42,.25)",
            }}
          >
            <div id="delete-account-title" style={{ fontWeight: 900, fontSize: "1.05em", color: "#0f172a", marginBottom: 10 }}>
              ¿Eliminar tu cuenta?
            </div>
            <p style={{ margin: "0 0 12px", color: "#475569", fontSize: ".84em", lineHeight: 1.55 }}>
              Se borrarán de forma <strong>inmediata e irreversible</strong> tu perfil, entrenamientos,
              evaluaciones VDOT, mensajes, participación en retos, conexiones con dispositivos
              (intervals.icu / Garmin) y tokens de notificaciones.
            </p>
            <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: ".78em", lineHeight: 1.5 }}>
              Los registros de facturación se conservan anonimizados por obligaciones legales.
            </p>
            <label style={{ display: "block", fontSize: ".74em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
              Escribe <span style={{ color: "#b91c1c", fontFamily: "monospace" }}>ELIMINAR</span> para confirmar
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ELIMINAR"
              autoComplete="off"
              disabled={busy}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "10px 12px",
                fontFamily: "inherit",
                fontSize: ".9em",
                marginBottom: 12,
              }}
            />
            {error ? (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: ".78em",
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                style={{
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "9px 14px",
                  color: "#475569",
                  fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".8em",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canConfirm}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 14px",
                  background: canConfirm ? "#dc2626" : "#fecaca",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: canConfirm ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  fontSize: ".8em",
                }}
              >
                {busy ? "Eliminando…" : "Eliminar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
