import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { CONFIRM_EMAIL_PATH } from "../lib/authRoutes";
import {
  BRAND_NAME,
  styles,
  userFacingError,
  resendSignupConfirmation,
  ensureOwnProfile,
  stashPendingInviteCode,
  acceptPendingInvitationIfAny,
  isAuthLockContentionError,
  withAuthLockRetry,
} from "./shared/appShared";

/**
 * Marketing + formularios login/registro cuando no hay sesión.
 * La sesión la posee App vía onAuthStateChange — este módulo no la setea.
 *
 * Props desde App (~callbacks): notify, resolveCoachIdByCode, onLoginSuccess,
 * onAthleteProfileDraft, openRequest (p.ej. tras reset password sin sesión).
 */
export default function AuthLanding({
  notify: _notify,
  resolveCoachIdByCode,
  onLoginSuccess,
  onAthleteProfileDraft,
  openRequest = null,
}) {
  const S = styles;

  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  /**
   * Ofrecer el reenvio del correo de confirmacion junto al error del login.
   * Se enciende tanto cuando GoTrue confirma que el correo esta sin verificar
   * como cuando responde el genérico "Invalid login credentials", porque ahi las
   * dos causas (sin confirmar / contraseña mala) son indistinguibles y el propio
   * reenvio es lo que las separa.
   */
  const [authCanResend, setAuthCanResend] = useState(false);
  const [authResending, setAuthResending] = useState(false);
  const [landingAuthOpen, setLandingAuthOpen] = useState(false);
  /** Pantalla dentro del flujo de auth: elección inicial, login o registro. */
  const [authLandingStep, setAuthLandingStep] = useState("choice");
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [authRole, setAuthRole] = useState("");
  const [authName, setAuthName] = useState("");
  const [authCoachCode, setAuthCoachCode] = useState("");
  const [inviteCodeFromUrl, setInviteCodeFromUrl] = useState("");
  const [inviteParentCoachId, setInviteParentCoachId] = useState("");
  const [pendingCoachRequestId, setPendingCoachRequestId] = useState("");

  // Invite link → abrir registro (solo montamos cuando !session).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const invite = (params.get("invite") || "").trim();
    if (!invite) return;
    const inviteType = (params.get("type") || "").trim();
    const inviteParentCoach = (params.get("coach") || "").trim();
    setInviteCodeFromUrl(invite);
    setAuthMode("register");
    if (inviteType === "staff") {
      setAuthRole("coach");
      if (inviteParentCoach) {
        setInviteParentCoachId(inviteParentCoach);
        // Persistir para sobrevivir al email de confirmacion y recargas
        try {
          window.localStorage.setItem(
            "pendingStaffInvite",
            JSON.stringify({ parentCoach: inviteParentCoach, code: invite }),
          );
        } catch (_) {}
      }
    } else {
      setAuthRole("athlete");
    }
    setAuthLandingStep("register");
    setLandingAuthOpen(true);
  }, []);

  // Tras delete_own_account + signOut: confirmación en login.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("raf_account_deleted") === "1") {
        sessionStorage.removeItem("raf_account_deleted");
        setAuthInfo("Tu cuenta y datos asociados fueron eliminados correctamente.");
        setAuthError("");
        setLandingAuthOpen(true);
        setAuthLandingStep("login");
        setAuthMode("login");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // App pide abrir login (p.ej. closePasswordRecovery sin sesión).
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.info != null) setAuthInfo(String(openRequest.info));
    if (openRequest.error != null) setAuthError(String(openRequest.error));
    else if (openRequest.info != null) setAuthError("");
    if (openRequest.mode) setAuthMode(openRequest.mode);
    if (openRequest.step) setAuthLandingStep(openRequest.step);
    setLandingAuthOpen(true);
  }, [openRequest]);

  /**
   * Reenvia el correo de confirmacion, y de paso DESAMBIGUA por qué falló el
   * login: si GoTrue responde que el usuario ya está confirmado, el problema era
   * la contraseña. Es la unica forma de distinguirlo sin montar un endpoint que
   * conteste "este correo existe" a cualquiera que pregunte.
   */
  const handleResendConfirmation = async () => {
    const email = authEmail.trim().toLowerCase();
    if (!email) {
      setAuthError("Escribe tu correo para poder reenviarte la confirmación.");
      return;
    }
    setAuthResending(true);
    setAuthInfo("");
    try {
      const res = await resendSignupConfirmation(email);
      if (res.alreadyConfirmed) {
        // Aqui el reenvio se ofrecio porque el error de Supabase era ambiguo:
        // si el correo ya estaba confirmado, el problema era la contraseña.
        setAuthCanResend(false);
        setAuthError(
          "Tu correo ya está confirmado, así que lo que no coincide es la contraseña. " +
          "Usa «¿Olvidaste tu contraseña?» para cambiarla.",
        );
        return;
      }
      if (!res.ok) {
        setAuthError(res.message);
        return;
      }
      setAuthError("");
      setAuthInfo(res.message);
    } finally {
      setAuthResending(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthInfo("");
    setAuthCanResend(false);
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Completa email y contraseña.");
      return;
    }
    if (authMode === "register") {
      if (!authRole) {
        alert("Selecciona si eres coach o atleta.");
        return;
      }
      if (!authName.trim()) {
        alert("Completa tu nombre.");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const blockedDomains = ["test.com", "fake.com", "example.com", "correo.com", "mail.com", "temp.com", "yopmail.com"];
      const emailDomain = authEmail.trim().toLowerCase().split("@")[1];
      if (!emailRegex.test(authEmail.trim()) || blockedDomains.includes(emailDomain)) {
        setAuthError("Por favor ingresa un correo electrónico válido.");
        return;
      }
    }

    // Un correo con mayusculas o un espacio pegado al copiar no deben ser una
    // cuenta distinta: se normaliza igual en login y en registro.
    const emailNorm = authEmail.trim().toLowerCase();
    const passwordNorm = authPassword.trim();

    setAuthSubmitting(true);
    try {
      if (authMode === "login") {
        let error;
        try {
          const r = await withAuthLockRetry(async () => {
            const res = await supabase.auth.signInWithPassword({
              email: emailNorm,
              password: passwordNorm,
            });
            if (isAuthLockContentionError(res.error)) throw res.error;
            return res;
          });
          error = r.error;
        } catch (err) {
          setAuthError(userFacingError(err, "No se pudo iniciar sesión."));
          return;
        }
        if (error) {
          console.error("Error en login:", error);
          const code = String(error.code || "").toLowerCase();
          const msg = String(error.message || "").toLowerCase();
          // GoTrue solo dice "Email not confirmed" cuando la contraseña ES la
          // correcta. Si tambien falla la contraseña responde el genérico
          // invalid_credentials, y ahi las dos causas son indistinguibles: por
          // eso el segundo caso ofrece las dos salidas en vez de acusar a la
          // contraseña, que es lo que dejaba al tester dando vueltas.
          if (code === "email_not_confirmed" || msg.includes("not confirmed")) {
            setAuthCanResend(true);
            setAuthError("Tu correo aún no está confirmado. Revisa tu bandeja de entrada y la carpeta de spam.");
          } else if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
            setAuthCanResend(true);
            setAuthError(
              "No pudimos iniciar sesión. Si acabas de registrarte, puede que tu correo siga sin confirmar: " +
              "revisa tu bandeja de entrada y la carpeta de spam. Si ya lo confirmaste, la contraseña no coincide " +
              "(volver a registrarte NO la cambia; usa «¿Olvidaste tu contraseña?»).",
            );
          } else {
            setAuthError(userFacingError(error, "No se pudo iniciar sesión."));
          }
          return;
        }
        await onLoginSuccess?.();
      } else {
        let linkedCoachId = null;
        let inviteRow = null;
        const hasInviteCode = Boolean(inviteCodeFromUrl);
        const hasManualCoachCode = Boolean(authCoachCode.trim());
        if (hasInviteCode) {
          // Via RPC: durante el registro todavia no hay sesion y las policies
          // de invitations solo dejan leer al coach dueño de la fila.
          const { data: invRows, error: invErr } = await supabase.rpc("find_invitation_by_code", { p_code: inviteCodeFromUrl });
          if (invErr) {
            console.error("Error consultando invitación:", invErr);
          }
          const inv = Array.isArray(invRows) ? invRows[0] : invRows;
          if (inv) {
            const inviteEmail = String(inv.email || "").trim().toLowerCase();
            if (inviteEmail && inviteEmail !== emailNorm) {
              alert("Este link de invitación fue emitido para otro correo.");
              setAuthSubmitting(false);
              return;
            }
            linkedCoachId = inv.coach_id || null;
            inviteRow = inv;
          }
          if (!linkedCoachId) {
            const seguir = window.confirm(
              "El link de invitación no es válido o ya se usó, así que no podemos conectarte con tu coach automáticamente.\n\n¿Continuar el registro sin coach? Podrás conectarte después con el código de tu coach.",
            );
            if (!seguir) {
              setAuthSubmitting(false);
              return;
            }
          }
        } else if (hasManualCoachCode) {
          const coachIdFromCode = await resolveCoachIdByCode(authCoachCode);
          if (!coachIdFromCode) {
            alert("No encontramos un coach con ese código.");
            setAuthSubmitting(false);
            return;
          }
          linkedCoachId = coachIdFromCode;
        }

        const selectedRole = authRole === "coach" ? "coach" : "athlete";
        const resolvedCoachId =
          selectedRole === "athlete"
            ? (() => {
                if (linkedCoachId == null) return null;
                const c = String(linkedCoachId).trim();
                if (c === "" || c === "undefined" || c === "null") return null;
                return c;
              })()
            : null;

        // Forzar aterrizaje en /auth/confirm (token_hash), no depender solo
        // de Site URL / plantilla de Supabase.
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const { data, error } = await (async () => {
          try {
            return await withAuthLockRetry(async () => {
              const r = await supabase.auth.signUp({
                email: emailNorm,
                password: passwordNorm,
                options: {
                  emailRedirectTo: origin ? `${origin}${CONFIRM_EMAIL_PATH}` : undefined,
                  data: {
                    full_name: authName.trim(),
                    role: selectedRole,
                    coach_id: resolvedCoachId,
                  },
                },
              });
              if (isAuthLockContentionError(r.error)) throw r.error;
              return r;
            });
          } catch (err) {
            return { data: null, error: err };
          }
        })();
        if (error) {
          console.error("Error en registro:", error);
          setAuthError(userFacingError(error, "No se pudo crear la cuenta."));
          return;
        }

        // Correo YA registrado: con la confirmacion activada, Supabase no da un
        // error (para no revelar quien esta registrado) y devuelve un usuario
        // falso con identities vacio. Sin este aviso el tester cree que acaba de
        // crear la cuenta con la contraseña que escribió, cuando en realidad la
        // contraseña sigue siendo la de su registro original: de ahi el bucle de
        // "me registro otra vez y tampoco entro".
        if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
          setAuthMode("login");
          setAuthLandingStep("login");
          setAuthCanResend(true);
          setAuthError(
            "Ese correo ya tiene una cuenta. Si nunca confirmaste el correo, reenvíate la confirmación aquí abajo. " +
            "Y ojo: registrarte de nuevo NO cambia la contraseña; si no la recuerdas, usa «¿Olvidaste tu contraseña?».",
          );
          return;
        }

        const newUserId = data?.user?.id;
        if (!newUserId) {
          if (typeof localStorage !== "undefined") {
            localStorage.removeItem("raf_athlete_profile_tab");
            localStorage.removeItem("raf_athlete_nav_tab");
            localStorage.removeItem("raf_tab_atletas");
            localStorage.removeItem("raf_tab_entrenamientos");
            localStorage.removeItem("raf_tab_biblioteca");
            localStorage.removeItem("raf_tab_crear_workout");
            localStorage.removeItem("raf_athlete_progress_tab");
            localStorage.removeItem("raf_lastView");
          }
          setAuthInfo(
            `Cuenta creada. Te enviamos un correo de confirmación a ${emailNorm}: ábrelo antes de iniciar sesión ` +
            "(mira también la carpeta de spam).",
          );
          setAuthCanResend(true);
          setAuthMode("login");
          setAuthLandingStep("login");
          return;
        }

        /**
         * Atleta sin código de coach: null explícito.
         * Nunca persistir el propio user_id como coach_id (resolvedCoachId || null no aplica aquí).
         */
        const athleteCoachIdNeverSelf =
          selectedRole !== "athlete" || !resolvedCoachId || String(resolvedCoachId) === String(newUserId) ? null : resolvedCoachId;

        const roleForProfile = authRole === "coach" ? "coach" : "athlete";
        // Con confirmacion de correo activa, signUp a menudo NO deja sesion.
        // Si hay access_token, creamos el perfil ya; si no, lo deja pending
        // para ConfirmEmailScreen / primer login (ensureOwnProfile).
        const signupToken = data?.session?.access_token || null;
        if (signupToken) {
          const created = await ensureOwnProfile({
            name: authName.trim(),
            role: roleForProfile,
            coach_id: athleteCoachIdNeverSelf,
            accessToken: signupToken,
          });
          if (!created.ok) {
            console.error("create-profile API:", created.reason);
            setAuthError(
              created.reason
                ? `Cuenta creada, pero no se guardó tu nombre: ${created.reason}. Completa tu perfil al entrar.`
                : "Cuenta creada, pero no se pudo guardar el perfil. Completa tu nombre al entrar.",
            );
          }
        } else {
          try {
            localStorage.setItem(
              "raf_pending_profile",
              JSON.stringify({
                name: authName.trim(),
                role: roleForProfile,
                coach_id: athleteCoachIdNeverSelf,
              }),
            );
          } catch {
            /* ignore */
          }
        }
        if (roleForProfile === "athlete") {
          onAthleteProfileDraft?.({ user_id: newUserId, role: "athlete", name: authName.trim(), coach_id: athleteCoachIdNeverSelf });
        }
        await onLoginSuccess?.();

        if (roleForProfile === "coach" || authRole === "admin") {
          const cpPayload = {
            user_id: newUserId,
            full_name: authName.trim(),
            email: emailNorm,
            trial_start: new Date().toISOString(),
            trial_days: 10,
            subscription_status: "trial",
            approved_by_admin: false,
            registered_at: new Date().toISOString(),
          };
          const { error: cpErr } = await supabase.from("coach_profiles").insert(cpPayload);
          if (cpErr) console.error("Error creando coach_profiles en registro:", cpErr);
          // Si es invitacion de staff, registrar en coach_staff
          // Leer el parametro coach directamente de la URL para evitar problemas de timing/closure
          let parentCoachForStaff = inviteParentCoachId;
          try {
            if (typeof window !== "undefined") {
              const urlCoach = new URLSearchParams(window.location.search).get("coach");
              const urlType = new URLSearchParams(window.location.search).get("type");
              if (urlType === "staff" && urlCoach) parentCoachForStaff = urlCoach.trim();
            }
          } catch (_) {}
          if (parentCoachForStaff && newUserId && parentCoachForStaff !== newUserId) {
            const { error: csErr } = await supabase.from("coach_staff").insert({
              coach_id: parentCoachForStaff,
              staff_id: newUserId,
              billing_type: "included",
            });
            if (csErr) console.error("Error vinculando staff a coach principal:", csErr);
            else console.log("Staff vinculado al coach principal:", parentCoachForStaff);
          }
        }

        if (roleForProfile === "athlete" && pendingCoachRequestId) {
          setPendingCoachRequestId("");
        }

        if (inviteRow) {
          // accept_invitation_by_code exige sesion + email (0064). Sin JWT en
          // el registro se guarda el codigo y se acepta al confirmar / entrar.
          stashPendingInviteCode(inviteCodeFromUrl);
          if (signupToken) {
            const acc = await acceptPendingInvitationIfAny();
            if (!acc.ok && !acc.keep) {
              console.warn("No se pudo marcar la invitación como aceptada:", acc.reason);
            }
          }
          setInviteCodeFromUrl("");
          if (typeof window !== "undefined") {
            window.history.replaceState({}, "", "/");
          }
        }

        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("raf_athlete_profile_tab");
          localStorage.removeItem("raf_athlete_nav_tab");
          localStorage.removeItem("raf_tab_atletas");
          localStorage.removeItem("raf_tab_entrenamientos");
          localStorage.removeItem("raf_tab_biblioteca");
          localStorage.removeItem("raf_tab_crear_workout");
          localStorage.removeItem("raf_athlete_progress_tab");
          localStorage.removeItem("raf_lastView");
        }
        setAuthInfo(
          `Cuenta creada. Te enviamos un correo de confirmación a ${emailNorm}: ábrelo antes de iniciar sesión ` +
          "(mira también la carpeta de spam).",
        );
        setAuthCanResend(true);
        setAuthMode("login");
        setAuthLandingStep("login");
        setAuthRole("");
        setAuthName("");
        setAuthCoachCode("");
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleForgotPasswordClick = async () => {
    const email = authEmail.trim().toLowerCase();
    setAuthInfo("");
    setAuthCanResend(false);
    if (!email) {
      setAuthError("Escribe el correo de tu cuenta y vuelve a pulsar «¿Olvidaste tu contraseña?».");
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // El ?type=recovery viaja de vuelta en el enlace y hace que la pantalla de
    // nueva contraseña se muestre aunque el hash con los tokens ya se haya
    // consumido (o el navegador lo pierda).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin ? `${origin}/?type=recovery` : undefined,
    });
    if (error) {
      setAuthError(userFacingError(error, "No se pudo enviar el correo de recuperación. Inténtalo de nuevo."));
      return;
    }
    setAuthError("");
    setAuthInfo(
      `Si ${email} está registrado, te llegará un enlace para elegir una contraseña nueva. Ábrelo y escribe la contraseña ahí mismo.`
    );
  };

  if (landingAuthOpen) {
      const inputBase = {
        width: "100%",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "10px 12px",
        color: "#0f172a",
        fontFamily: "inherit",
        fontSize: ".85em",
        outline: "none",
        boxSizing: "border-box",
      };
      const bigBtn = {
        width: "100%",
        padding: "14px 18px",
        borderRadius: 12,
        border: "none",
        fontFamily: "inherit",
        fontWeight: 800,
        fontSize: ".95em",
        cursor: "pointer",
      };

      return (
        <div style={S.root}>
          <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: "70vh", padding: "20px 16px" }}>
            {authLandingStep === "choice" ? (
              <div style={{ ...S.card, width: "100%", maxWidth: 440, padding: "32px 28px 36px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22 }}>
                  <img
                    src="/pwa-192.png"
                    alt=""
                    width={48}
                    height={48}
                    style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
                  />
                  <div style={{ fontSize: "1.35em", fontWeight: 900, letterSpacing: ".04em", color: "#0f172a" }}>
                    RUNNING<span style={{ color: "#ff8a3d" }}>APEX</span>FLOW
                  </div>
                </div>
                <h1 style={{ ...S.pageTitle, fontSize: "1.45em", textAlign: "center", marginBottom: 10, lineHeight: 1.25 }}>
                  Bienvenido a {BRAND_NAME}
                </h1>
                <p style={{ textAlign: "center", color: "#64748b", fontSize: ".9em", lineHeight: 1.5, marginBottom: 28 }}>
                  Entrena con datos, IA y seguimiento real. Elige cómo quieres continuar.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAuthError("");
                      setAuthMode("login");
                      setAuthLandingStep("login");
                      setLandingAuthOpen(true);
                    }}
                    style={{
                      ...bigBtn,
                      background: "linear-gradient(135deg,#0f172a,#334155)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(15,23,42,.2)",
                    }}
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAuthError("");
                      setAuthMode("register");
                      setAuthLandingStep("register");
                      setLandingAuthOpen(true);
                    }}
                    style={{
                      ...bigBtn,
                      background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(255,138,61,.25)",
                    }}
                  >
                    Registrarse
                  </button>
                </div>
              </div>
            ) : authLandingStep === "login" ? (
              <div style={{ ...S.card, width: "100%", maxWidth: 400, padding: "28px 24px 32px" }}>
                <h1 style={{ ...S.pageTitle, fontSize: "1.25em", marginBottom: 18 }}>Iniciar sesión</h1>
                {authInfo ? (
                  <div style={{ marginBottom: 14, background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.4)", color: "#166534", borderRadius: 8, padding: "10px 12px", fontSize: ".8em", fontWeight: 700, lineHeight: 1.45 }}>
                    {authInfo}
                  </div>
                ) : null}
                {authError ? (
                  <div style={{ marginBottom: 12, background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.35)", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: ".78em", fontWeight: 600, lineHeight: 1.5 }}>
                    {authError}
                  </div>
                ) : null}
                {authCanResend ? (
                  <button
                    type="button"
                    onClick={handleResendConfirmation}
                    disabled={authResending}
                    style={{
                      width: "100%",
                      marginBottom: 14,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(148,163,184,.5)",
                      background: authResending ? "#f1f5f9" : "#fff",
                      color: "#0f172a",
                      cursor: authResending ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      fontWeight: 800,
                      fontSize: ".8em",
                    }}
                  >
                    {authResending ? "Enviando…" : "Reenviar correo de confirmación"}
                  </button>
                ) : null}
                <form onSubmit={handleAuthSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Correo</div>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError("");
                        if (authInfo) setAuthInfo("");
                        if (authCanResend) setAuthCanResend(false);
                      }}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      style={inputBase}
                    />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Contraseña</div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => {
                        setAuthPassword(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      style={inputBase}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    style={{
                      width: "100%",
                      ...bigBtn,
                      marginBottom: 12,
                      background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                      color: authSubmitting ? "#334155" : "white",
                      cursor: authSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {authSubmitting ? "Procesando…" : "Iniciar sesión"}
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError("");
                      setAuthMode("register");
                      setAuthLandingStep("register");
                    }}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿No tienes cuenta? Regístrate
                  </button>
                  <button
                    type="button"
                    onClick={handleForgotPasswordClick}
                    style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthLandingStep("choice")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", marginTop: 4 }}
                  >
                    ← Volver
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ ...S.card, width: "100%", maxWidth: 420, padding: "28px 24px 32px" }}>
                <h1 style={{ ...S.pageTitle, fontSize: "1.25em", marginBottom: 18 }}>Crear cuenta</h1>
                <form onSubmit={handleAuthSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Nombre completo</div>
                    <input
                      type="text"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Tu nombre completo"
                      style={inputBase}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Rol</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setAuthRole("coach")}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: authRole === "coach" ? "2px solid #ff8a3d" : "1px solid rgba(148,163,184,.4)",
                          background: authRole === "coach" ? "rgba(255,138,61,.15)" : "#f1f5f9",
                          color: "#0f172a",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontWeight: 800,
                          fontSize: ".8em",
                        }}
                      >
                        Coach
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthRole("athlete")}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: authRole === "athlete" ? "2px solid #3b82f6" : "1px solid rgba(148,163,184,.4)",
                          background: authRole === "athlete" ? "rgba(59,130,246,.15)" : "#f1f5f9",
                          color: "#0f172a",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontWeight: 800,
                          fontSize: ".8em",
                        }}
                      >
                        Atleta
                      </button>
                    </div>
                  </div>
                  {authRole === "athlete" && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Código de coach (Opcional)</div>
                      <input
                        type="text"
                        value={authCoachCode}
                        onChange={(e) => {
                          setAuthCoachCode(e.target.value.toUpperCase());
                          if (authError) setAuthError("");
                        }}
                        placeholder="Ej: B5C9E44A"
                        style={inputBase}
                      />
                      {inviteCodeFromUrl ? (
                        <div style={{ marginTop: 6, fontSize: ".7em", color: "#b45309", fontWeight: 700 }}>
                          Invitación detectada por link: se priorizará esa vinculación.
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Correo</div>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      style={inputBase}
                    />
                    {authError ? <div style={{ marginTop: 6, fontSize: ".74em", color: "#dc2626", fontWeight: 600 }}>{authError}</div> : null}
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Contraseña</div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      style={inputBase}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    style={{
                      width: "100%",
                      ...bigBtn,
                      background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                      color: authSubmitting ? "#334155" : "white",
                      cursor: authSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {authSubmitting
                      ? "Procesando…"
                      : authRole === "athlete"
                        ? "Crear cuenta como Atleta"
                        : authRole === "coach"
                          ? "Crear cuenta como Coach"
                          : "Crear cuenta"}
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError("");
                      setAuthMode("login");
                      setAuthLandingStep("login");
                    }}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿Ya tienes cuenta? Inicia sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthLandingStep("choice")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
                  >
                    ← Volver
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      );
    }

    return (
      <div style={{ ...S.root, background: "linear-gradient(165deg,#0d1f38 0%,#12294a 45%,#0d1f38 100%)", minHeight: "100vh" }}>
        <main style={{ ...S.page, width: "100%", display: "flex", flexDirection: "column", minHeight: "100vh", background: "transparent" }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 8,
              paddingBottom: 16,
              borderBottom: "1px solid rgba(23,198,163,.22)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src="/pwa-192.png"
                alt=""
                width={40}
                height={40}
                style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
              />
              <div style={{ fontSize: "1.2em", fontWeight: 900, letterSpacing: ".04em", color: "#f8fafc" }}>
                RUNNING<span style={{ color: "#ff8a3d" }}>APEX</span>FLOW
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthMode("login");
                setAuthLandingStep("login");
                setLandingAuthOpen(true);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.06)",
                color: "#f8fafc",
                fontWeight: 800,
                fontSize: ".85em",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthMode("register");
                setAuthRole("athlete");
                setAuthLandingStep("register");
                setLandingAuthOpen(true);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                color: "#fff",
                fontWeight: 800,
                fontSize: ".85em",
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 8px 22px rgba(255,138,61,.35)",
              }}
            >
              Crear cuenta gratis
            </button>
            </div>
          </header>

          <div
            style={{
              marginTop: 8,
              marginBottom: 32,
              padding: "32px 0 8px",
              textAlign: "center",
              maxWidth: 720,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div style={{ fontSize: "0.78em", color: "#17c6a3", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, marginBottom: 10 }}>
              Plataforma de coaching para runners
            </div>
            <h1 style={{ fontSize: "clamp(1.75rem, 4vw, 2.45rem)", fontWeight: 900, color: "#f8fafc", margin: "0 0 14px", lineHeight: 1.15 }}>
              Entrena con datos. Mejora con inteligencia.
            </h1>
            <p style={{ color: "rgba(248,250,252,.72)", fontSize: "1.05em", margin: "0 0 26px", lineHeight: 1.6 }}>
              {BRAND_NAME} conecta coaches y atletas con IA, evaluaciones VDOT, zonas de FC y sincronización con tu reloj para llevar el rendimiento al siguiente nivel.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("register");
                  setAuthRole("athlete");
                  setAuthLandingStep("register");
                  setLandingAuthOpen(true);
                }}
                style={{
                  background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                  border: "none",
                  borderRadius: 12,
                  padding: "14px 28px",
                  color: "white",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: "1em",
                  boxShadow: "0 8px 24px rgba(255,138,61,.35)",
                }}
              >
                Crear cuenta gratis
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("login");
                  setAuthLandingStep("login");
                  setLandingAuthOpen(true);
                }}
                style={{
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(23,198,163,.45)",
                  borderRadius: 12,
                  padding: "14px 28px",
                  color: "#f8fafc",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: "1em",
                }}
              >
                Iniciar sesión
              </button>
            </div>
          </div>

          <section style={{ marginBottom: 44, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%", padding: "0 4px" }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".14em", color: "#17c6a3", textTransform: "uppercase", marginBottom: 16, fontWeight: 800 }}>
              Características
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {[
                {
                  title: "Evaluación VDOT",
                  body: "Calcula VDOT, ritmos y zonas FC con 3 métodos: carrera reciente, test Cooper o umbral.",
                },
                {
                  title: "Workouts con IA",
                  body: "Genera sesiones personalizadas en segundos basadas en el VDOT y objetivos del atleta.",
                },
                {
                  title: "Plan flexible",
                  body: "Planes de 2 semanas renovables con 3, 4 o 5 sesiones semanales según la disponibilidad del atleta.",
                },
                {
                  title: "Análisis IA",
                  body: "Seguimiento inteligente del rendimiento con ajuste automático de entrenamientos para mejores resultados.",
                },
                {
                  title: "Sincronización",
                  body: "Conecta tu reloj Garmin o COROS para recibir los entrenamientos y sincronizar tus actividades automáticamente.",
                },
                {
                  title: "Chat en tiempo real",
                  body: "Comunicación directa coach-atleta con notificaciones push dentro de la plataforma.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  style={{
                    border: "1px solid rgba(23,198,163,.22)",
                    borderRadius: 14,
                    padding: "18px 16px",
                    background: "rgba(255,255,255,.05)",
                    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#f8fafc", fontSize: ".98em", marginBottom: 8 }}>{f.title}</div>
                  <div style={{ color: "rgba(248,250,252,.68)", fontSize: ".88em", lineHeight: 1.5 }}>{f.body}</div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginBottom: 48, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%", padding: "0 4px" }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".14em", color: "#17c6a3", textTransform: "uppercase", marginBottom: 16, fontWeight: 800 }}>
              Coaches y atletas
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div
                style={{
                  border: "1px solid rgba(255,138,61,.35)",
                  borderRadius: 14,
                  padding: "20px 18px",
                  background: "linear-gradient(145deg,rgba(255,138,61,.14),rgba(18,41,74,.9))",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 900, color: "#ff8a3d", fontSize: "1.1em", marginBottom: 8 }}>Coach</div>
                <div style={{ fontSize: ".82em", fontWeight: 700, color: "#f8fafc", marginBottom: 12 }}>7 días de prueba gratis</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(248,250,252,.7)", fontSize: ".88em", lineHeight: 1.55 }}>
                  <li>Panel en vivo</li>
                  <li>Biblioteca de workouts</li>
                  <li>Evaluación VDOT</li>
                  <li>Generación IA</li>
                  <li>Chat con atletas</li>
                </ul>
              </div>
              <div
                style={{
                  border: "1px solid rgba(23,198,163,.35)",
                  borderRadius: 14,
                  padding: "20px 18px",
                  background: "linear-gradient(145deg,rgba(23,198,163,.12),rgba(18,41,74,.9))",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 900, color: "#17c6a3", fontSize: "1.1em", marginBottom: 8 }}>Atleta</div>
                <div style={{ fontSize: ".82em", fontWeight: 700, color: "#f8fafc", marginBottom: 12 }}>Plan Premium disponible</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(248,250,252,.7)", fontSize: ".88em", lineHeight: 1.55 }}>
                  <li>Calendario personalizado</li>
                  <li>Evaluación VDOT propia</li>
                  <li>Análisis IA de rendimiento</li>
                  <li>Historial de evaluaciones</li>
                  <li>Logros avanzados</li>
                </ul>
              </div>
            </div>
          </section>

          <footer style={{ marginTop: "auto", paddingTop: 22, borderTop: "1px solid rgba(23,198,163,.22)", color: "rgba(248,250,252,.55)", fontSize: ".85em" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#f8fafc", fontWeight: 900 }}>
                <img src="/pwa-192.png" alt="" width={22} height={22} style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
                {BRAND_NAME}
              </div>
              <div>© 2026</div>
            </div>
          </footer>
        </main>

        {demoModalOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }}>
            <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, marginBottom: 6 }}>Demo simulada</div>
              <div style={{ color: "#94a3b8", fontSize: ".9em", marginBottom: 14 }}>
                En esta demo verás cómo, con {BRAND_NAME}, un coach crea entrenamientos con IA, los asigna al atleta y marca progreso en el calendario.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setDemoModalOpen(false)}
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".82em" }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );

}
