import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { BRAND_NAME, PASSWORD_MIN_LENGTH, validateNewPassword, passwordUpdateErrorText } from "./shared/appShared";

/**
 * Pantalla de "nueva contraseña" tras llegar desde el correo de restablecimiento.
 *
 * Se muestra ANTES de cualquier otra pantalla, con sesion o sin ella. El enlace
 * de recuperacion abre una sesion valida, asi que si esto no se interpusiera el
 * usuario entraria directo a la app y NUNCA veria el formulario: la contraseña
 * se quedaba sin cambiar y el usuario seguia bloqueado, que es el fallo que
 * reportaron los testers.
 *
 * @param {{onDone: (msg: string) => void, onCancel: () => void}} props
 *   onDone   se llama tras cambiarla, con el mensaje de exito.
 *   onCancel se llama si el usuario decide no cambiarla ahora.
 */
export default function ResetPasswordScreen({ onDone, onCancel }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  // Para quien abre el enlace: confirmar de que cuenta estamos hablando. El
  // enlace trae su propia sesion, asi que puede no ser la que habia antes en
  // este navegador.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setEmail(data?.user?.email || "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "11px 12px",
    color: "#0f172a",
    fontFamily: "inherit",
    fontSize: ".9em",
    outline: "none",
    marginBottom: 10,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const invalid = validateNewPassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Sin sesion no hay a quien cambiarle la contraseña: pasa si el enlace ya
      // se uso o caduco, y conviene decirlo en vez de dejar un error de Supabase.
      const { data: sessData } = await supabase.auth.getSession();
      if (!sessData?.session) {
        setError("El enlace ya se usó o caducó. Vuelve a pedir el correo de restablecimiento.");
        return;
      }
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(passwordUpdateErrorText(updErr));
        return;
      }
      onDone?.("Contraseña actualizada. Ya puedes usarla para iniciar sesión.");
    } catch (err) {
      console.error("[recovery] updateUser:", err);
      setError("No se pudo cambiar la contraseña. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "'Inter',system-ui,sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          border: "1px solid #f1f5f9",
          borderRadius: 14,
          padding: "28px 24px 26px",
          boxShadow: "0 12px 34px rgba(15,23,42,.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: "1.6em", color: "#f59e0b", lineHeight: 1 }} aria-hidden>
            ▲
          </span>
          <div style={{ fontSize: ".9em", fontWeight: 900, letterSpacing: ".04em", color: "#0f172a" }}>{BRAND_NAME}</div>
        </div>

        <h1 style={{ margin: "0 0 8px", fontSize: "1.2em", fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" }}>
          Elige tu nueva contraseña
        </h1>
        <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: ".82em", lineHeight: 1.5 }}>
          {email
            ? `Estás cambiando la contraseña de ${email}.`
            : "Escribe la contraseña que usarás para entrar a partir de ahora."}
        </p>

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
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".76em", color: "#64748b", marginBottom: 14, cursor: "pointer" }}>
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
                padding: "9px 12px",
                fontSize: ".78em",
                fontWeight: 600,
                marginBottom: 14,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              padding: "13px 18px",
              borderRadius: 12,
              border: "none",
              background: busy ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
              color: busy ? "#334155" : "#fff",
              fontFamily: "inherit",
              fontWeight: 800,
              fontSize: ".92em",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Guardando…" : "Guardar y continuar"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => onCancel?.()}
          disabled={busy}
          style={{
            display: "block",
            width: "100%",
            marginTop: 12,
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            fontSize: ".78em",
          }}
        >
          Cambiarla más tarde
        </button>
      </div>
    </div>
  );
}
