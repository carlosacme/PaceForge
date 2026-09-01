import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase";
import { BRAND_NAME, ANDROID_PACKAGE_ID, resendSignupConfirmation, ensureOwnProfile, acceptPendingInvitationIfAny } from "./shared/appShared";

/** Tipos de OTP por correo que acepta verifyOtp; cualquier otro cae a "email". */
const EMAIL_OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * Abre la APK instalada desde el navegador de Android.
 *
 * El intent:// con package es lo unico que funciona hoy: los App Links por
 * https requieren el assetlinks.json verificado, que es la fase siguiente. Si
 * la app no esta instalada, browser_fallback_url deja al usuario en la web en
 * lugar de en una pantalla de error.
 */
function androidIntentUrl(targetUrl) {
  const url = new URL(targetUrl);
  const fallback = encodeURIComponent(targetUrl);
  return `intent://${url.host}${url.pathname}#Intent;scheme=https;package=${ANDROID_PACKAGE_ID};S.browser_fallback_url=${fallback};end`;
}

const isAndroidBrowser = () =>
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");

const OTP_LOCK_PREFIX = "raf_otp_";

function otpLockKey(tokenHash) {
  return `${OTP_LOCK_PREFIX}${tokenHash}`;
}

function readOtpLock(tokenHash) {
  if (!tokenHash) return false;
  try {
    return sessionStorage.getItem(otpLockKey(tokenHash)) === "1";
  } catch {
    return false;
  }
}

/** Se escribe ANTES de verifyOtp para que una recarga/precarga no vuelva a canjear. */
function writeOtpLock(tokenHash) {
  if (!tokenHash) return;
  try {
    sessionStorage.setItem(otpLockKey(tokenHash), "1");
  } catch {
    /* private mode / sessionStorage bloqueado */
  }
}

function readConfirmLink() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash?.startsWith("#") ? window.location.hash.slice(1) : ""
  );
  const urlError =
    params.get("error_description") ||
    hashParams.get("error_description") ||
    params.get("error") ||
    hashParams.get("error");
  const tokenHash = params.get("token_hash") || hashParams.get("token_hash") || "";
  const rawType = (params.get("type") || hashParams.get("type") || "").trim().toLowerCase();
  const type = EMAIL_OTP_TYPES.has(rawType) ? rawType : "email";
  return { urlError, tokenHash, type };
}

function isEmailConfirmed(user) {
  if (!user) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;
  return user.user_metadata?.email_verified === true;
}

function isConsumedOtpError(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  if (code === "otp_expired" || code === "otp_disabled") return true;
  return (
    msg.includes("expired") ||
    msg.includes("invalid") ||
    msg.includes("already") ||
    msg.includes("not found")
  );
}

async function getConfirmedUser() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user || !isEmailConfirmed(user)) return null;
  return user;
}

/**
 * Pantalla de confirmacion de correo con token_hash.
 *
 * El enlace aterriza aqui (nuestro dominio) y se canjea con verifyOtp, pero
 * SOLO tras un clic: un GET de precarga (iOS, Gmail, Safe Links) no debe
 * gastar el token de un solo uso. Si el token ya se consumo y aun asi hay
 * sesion confirmada, se trata como exito y se crea la ficha (ensureOwnProfile).
 */
export default function ConfirmEmailScreen() {
  const [status, setStatus] = useState("loading"); // loading | idle | verifying | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const [email, setEmail] = useState("");
  const [resendMsg, setResendMsg] = useState("");
  const [resendOk, setResendOk] = useState(false);
  const [resending, setResending] = useState(false);
  const [linkType, setLinkType] = useState("email");
  const native = Capacitor.isNativePlatform();
  const linkRef = useRef({ urlError: null, tokenHash: "", type: "email" });
  const inFlightRef = useRef(false);

  const finishConfirmed = useCallback(
    async (user, type) => {
      try {
        let pending = null;
        try {
          const raw = localStorage.getItem("raf_pending_profile");
          if (raw) pending = JSON.parse(raw);
        } catch {
          pending = null;
        }
        if (user) {
          const role =
            pending?.role === "coach" || pending?.role === "athlete"
              ? pending.role
              : user.user_metadata?.role === "coach"
                ? "coach"
                : "athlete";
          const name =
            (typeof pending?.name === "string" && pending.name.trim()) ||
            (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
            (user.email ? user.email.split("@")[0] : "Usuario");
          const coach_id =
            role === "athlete"
              ? (pending?.coach_id ?? user.user_metadata?.coach_id ?? null)
              : null;
          await ensureOwnProfile({ name, role, coach_id });
          try { localStorage.removeItem("raf_pending_profile"); } catch { /* ignore */ }
          await acceptPendingInvitationIfAny();
        }
      } catch (e) {
        console.warn("[confirm] ensureOwnProfile / invite:", e);
      }

      if (type === "recovery") {
        window.location.replace("/?type=recovery");
        return;
      }

      if (native) {
        window.location.replace("/");
        return;
      }

      setEmail(user?.email || "");
      setStatus("success");
    },
    [native],
  );

  const resolveFromExistingSession = useCallback(
    async (type) => {
      const user = await getConfirmedUser();
      if (!user) return false;
      await finishConfirmed(user, type);
      return true;
    },
    [finishConfirmed],
  );

  const showConsumedError = useCallback(() => {
    setErrorMsg(
      "El enlace no es válido, ya se usó o caducó. Pide uno nuevo y ábrelo cuanto antes. " +
      "Si ya habías confirmado tu correo, entra con tu contraseña.",
    );
    setStatus("error");
  }, []);

  useEffect(() => {
    const link = readConfirmLink();
    linkRef.current = link;
    setLinkType(link.type);
    const { urlError, tokenHash, type } = link;

    (async () => {
      // Token ya canjeado en esta pestaña (recarga / segundo documento): no
      // volver a verifyOtp; si la sesion quedo confirmada, es un exito.
      if (tokenHash && readOtpLock(tokenHash)) {
        setStatus("verifying");
        if (await resolveFromExistingSession(type)) return;
      }

      if (urlError) {
        if (await resolveFromExistingSession(type)) return;
        setErrorMsg(
          /expired/i.test(urlError)
            ? "El enlace de confirmación caducó. Pide uno nuevo y ábrelo cuanto antes."
            : "El enlace de confirmación no es válido. Pide uno nuevo.",
        );
        setStatus("error");
        return;
      }

      if (!tokenHash) {
        if (await resolveFromExistingSession(type)) return;
        setErrorMsg("Este enlace está incompleto. Ábrelo directamente desde el correo que te enviamos.");
        setStatus("error");
        return;
      }

      setStatus("idle");
    })();
  }, [resolveFromExistingSession]);

  const handleConfirmClick = async () => {
    if (inFlightRef.current) return;
    const { tokenHash, type } = linkRef.current;
    if (!tokenHash) {
      setErrorMsg("Este enlace está incompleto. Ábrelo directamente desde el correo que te enviamos.");
      setStatus("error");
      return;
    }

    inFlightRef.current = true;
    setStatus("verifying");
    setErrorMsg("");

    try {
      // Candado ANTES del POST: una segunda carga con el mismo token_hash no
      // debe volver a llamar verifyOtp.
      if (readOtpLock(tokenHash)) {
        if (await resolveFromExistingSession(type)) return;
        showConsumedError();
        return;
      }

      writeOtpLock(tokenHash);

      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        console.warn("[confirm] verifyOtp:", error);
        if (isConsumedOtpError(error) && (await resolveFromExistingSession(type))) {
          return;
        }
        showConsumedError();
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        showConsumedError();
        return;
      }
      await finishConfirmed(user, type);
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendMsg("");
    const res = await resendSignupConfirmation(email);
    setResendOk(res.ok);
    setResendMsg(res.message);
    setResending(false);
  };

  const openApp = () => {
    const target = `${window.location.origin}/`;
    window.location.href = isAndroidBrowser() ? androidIntentUrl(target) : target;
  };

  const confirmButtonLabel =
    linkType === "recovery"
      ? "Continuar"
      : linkType === "email_change"
        ? "Confirmar cambio de correo"
        : "Confirmar mi correo";

  const card = {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    border: "1px solid #f1f5f9",
    borderRadius: 14,
    padding: "28px 24px 26px",
    boxShadow: "0 12px 34px rgba(15,23,42,.12)",
  };

  const primaryBtn = {
    width: "100%",
    padding: "13px 18px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
    color: "#fff",
    fontFamily: "inherit",
    fontWeight: 800,
    fontSize: ".92em",
    cursor: "pointer",
  };

  const secondaryBtn = {
    width: "100%",
    marginTop: 10,
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#0f172a",
    fontFamily: "inherit",
    fontWeight: 700,
    fontSize: ".85em",
    cursor: "pointer",
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
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <img
            src="/pwa-192.png"
            alt=""
            width={36}
            height={36}
            style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ fontSize: ".9em", fontWeight: 900, letterSpacing: ".04em", color: "#0f172a" }}>{BRAND_NAME}</div>
        </div>

        {status === "loading" || status === "verifying" ? (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: "1.15em", fontWeight: 900, color: "#0f172a" }}>
              {status === "verifying" ? "Confirmando tu correo…" : "Cargando…"}
            </h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: ".84em", lineHeight: 1.55 }}>
              {status === "verifying"
                ? "Un segundo, estamos validando el enlace."
                : "Un segundo."}
            </p>
          </>
        ) : null}

        {status === "idle" ? (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: "1.18em", fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" }}>
              {linkType === "recovery" ? "Restablecer contraseña" : "Confirma tu correo"}
            </h1>
            <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: ".84em", lineHeight: 1.55 }}>
              {linkType === "recovery"
                ? "Pulsa el botón para continuar. Así el enlace no se gasta solo al abrir el correo."
                : "Pulsa el botón para activar tu cuenta. Así el enlace no se gasta solo al abrir el correo."}
            </p>
            <button type="button" onClick={handleConfirmClick} style={primaryBtn}>
              {confirmButtonLabel}
            </button>
            <button type="button" onClick={() => window.location.replace("/")} style={secondaryBtn}>
              Ir a iniciar sesión
            </button>
          </>
        ) : null}

        {status === "success" ? (
          <>
            <div
              style={{
                background: "rgba(34,197,94,.12)",
                border: "1px solid rgba(34,197,94,.4)",
                color: "#166534",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: ".8em",
                fontWeight: 800,
                marginBottom: 14,
              }}
            >
              ✓ Correo confirmado
            </div>
            <h1 style={{ margin: "0 0 8px", fontSize: "1.18em", fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" }}>
              Abre la app {BRAND_NAME} para entrar
            </h1>
            <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: ".84em", lineHeight: 1.55 }}>
              {email ? `Tu cuenta ${email} ya está activa. ` : "Tu cuenta ya está activa. "}
              Si tienes la app instalada, el botón la abre; si no, puedes seguir aquí en el navegador.
            </p>
            <button type="button" onClick={openApp} style={primaryBtn}>
              Abrir la app
            </button>
            <button type="button" onClick={() => window.location.replace("/")} style={secondaryBtn}>
              Seguir en el navegador
            </button>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: "1.18em", fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" }}>
              No pudimos confirmar tu correo
            </h1>
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: ".8em",
                fontWeight: 600,
                lineHeight: 1.55,
                margin: "0 0 16px",
              }}
            >
              {errorMsg}
            </div>

            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>
              Tu correo, para enviarte otro enlace
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (resendMsg) setResendMsg("");
              }}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              disabled={resending}
              style={{
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
                marginBottom: 12,
              }}
            />
            {resendMsg ? (
              <div
                style={{
                  background: resendOk ? "rgba(34,197,94,.12)" : "#fef2f2",
                  border: `1px solid ${resendOk ? "rgba(34,197,94,.4)" : "#fecaca"}`,
                  color: resendOk ? "#166534" : "#b91c1c",
                  fontWeight: 600,
                  fontSize: ".78em",
                  lineHeight: 1.5,
                  borderRadius: 8,
                  padding: "9px 12px",
                  marginBottom: 12,
                }}
              >
                {resendMsg}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              style={{ ...primaryBtn, background: resending ? "#e2e8f0" : primaryBtn.background, color: resending ? "#334155" : "#fff", cursor: resending ? "not-allowed" : "pointer" }}
            >
              {resending ? "Enviando…" : "Reenviar correo de confirmación"}
            </button>
            <button type="button" onClick={() => window.location.replace("/")} style={secondaryBtn}>
              Ir a iniciar sesión
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
