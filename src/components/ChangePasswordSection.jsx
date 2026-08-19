import { useState } from "react";
import { supabase } from "../lib/supabase";
import { PASSWORD_MIN_LENGTH, validateNewPassword, passwordUpdateErrorText } from "./shared/appShared";

/**
 * Seccion "Contraseña" del perfil: cambiarla estando ya dentro de la app.
 *
 * Existe para no depender del correo. El enlace de restablecimiento es la via
 * de quien NO puede entrar; quien ya entro no deberia tener que pedirse un
 * correo a si mismo para cambiarla.
 *
 * Misma interfaz que DeleteAccountSection ({ notify, cardStyle }) para poder
 * montarla igual en el perfil del coach y en el del atleta.
 */
export default function ChangePasswordSection({ notify, cardStyle }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const reset = () => {
    setPassword("");
    setConfirm("");
    setShow(false);
    setError("");
  };

  const card = cardStyle || {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  };

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "inherit",
    fontSize: ".9em",
    marginBottom: 10,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setOkMsg("");
    const invalid = validateNewPassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(passwordUpdateErrorText(updErr));
        return;
      }
      setOpen(false);
      reset();
      setOkMsg("Contraseña actualizada. Úsala la próxima vez que inicies sesión.");
      notify?.("Contraseña actualizada");
    } catch (err) {
      console.error("[password] updateUser:", err);
      setError("No se pudo cambiar la contraseña. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, marginTop: 8 }}>
      <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>
        CONTRASEÑA
      </div>
      {okMsg ? (
        <div
          style={{
            background: "rgba(34,197,94,.12)",
            border: "1px solid rgba(34,197,94,.4)",
            color: "#166534",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: ".78em",
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          {okMsg}
        </div>
      ) : null}

      {!open ? (
        <>
          <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: ".8em", lineHeight: 1.5 }}>
            Cambia tu contraseña sin salir de la app ni pedir un correo.
          </p>
          <button
            type="button"
            onClick={() => {
              setOkMsg("");
              setOpen(true);
            }}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".88em",
            }}
          >
            Cambiar contraseña
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Nueva contraseña</div>
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
            autoComplete="new-password"
            disabled={busy}
            style={inputStyle}
          />
          <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Repite la contraseña</div>
          <input
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error) setError("");
            }}
            placeholder="La misma contraseña"
            autoComplete="new-password"
            disabled={busy}
            style={inputStyle}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".76em", color: "#64748b", marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Ver contraseñas
          </label>
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                flex: 1,
                minWidth: 140,
                border: "none",
                borderRadius: 8,
                padding: "11px 14px",
                background: busy ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
                color: busy ? "#334155" : "#fff",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: ".82em",
              }}
            >
              {busy ? "Guardando…" : "Guardar contraseña"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                setOpen(false);
                reset();
              }}
              disabled={busy}
              style={{
                border: "1px solid #e2e8f0",
                background: "#fff",
                borderRadius: 8,
                padding: "11px 14px",
                color: "#475569",
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: ".82em",
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
