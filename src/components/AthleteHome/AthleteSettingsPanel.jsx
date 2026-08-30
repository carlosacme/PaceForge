import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../../lib/supabase";
import { clearFcmToken } from "../../firebase.js";
import { clearNativePush } from "../../lib/nativePush";
import { unregisterOwnDeviceToken } from "../shared/appShared";
import IntervalsConnect from "../IntervalsConnect";
import ChangePasswordSection from "../ChangePasswordSection";
import DeleteAccountSection from "../DeleteAccountSection";
import CoachLinkActions from "./CoachLinkActions";

/**
 * Coaches publicos que hacen falta para que valga la pena enseñar el
 * directorio. Con uno o dos no hay nada que elegir y queda pobre; la seccion
 * se enciende sola cuando la plataforma llega a este numero.
 */
const MIN_COACHES_FOR_DIRECTORY = 3;

/**
 * Directorio `coach_public`. El hook vive en el padre para conservar
 * “una sola carga al abrir Config” aunque el panel se desmonte al cambiar de tab.
 * No toca `intervalsConnected` (eso lo lee el modal RPE).
 */
export function useCoachDirectory({ enabled, excludeCoachUserId }) {
  const [coachDirectory, setCoachDirectory] = useState([]);
  const [coachDirLoading, setCoachDirLoading] = useState(false);
  const loadedRef = useRef(false);

  const loadCoachDirectory = useCallback(async () => {
    setCoachDirLoading(true);
    const { data, error } = await supabase
      .from("coach_public")
      .select("user_id, name, full_name, coach_id, city, country, avatar_url")
      .eq("is_public", true)
      .order("name", { ascending: true })
      .limit(20);
    setCoachDirLoading(false);
    if (error) {
      console.error("[AthleteHome] directorio de coaches:", error);
      return;
    }
    setCoachDirectory(data || []);
  }, []);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    loadCoachDirectory();
  }, [enabled, loadCoachDirectory]);

  const availableCoaches = useMemo(
    () => coachDirectory.filter((c) => !excludeCoachUserId || String(c.user_id) !== String(excludeCoachUserId)),
    [coachDirectory, excludeCoachUserId],
  );

  return { availableCoaches, coachDirLoading, loadCoachDirectory };
}

/**
 * Perfil → Config: foto, vínculo de coach (+ directorio), Intervals.icu.
 * `intervalsConnected` / `loadIntervalsConnected` se quedan en AthleteHome
 * porque el modal RPE los lee (campos manuales vs reloj).
 */
export default function AthleteSettingsPanel({
  cardStyle,
  athleteId,
  avatarUrl,
  onAvatarSaved,
  notify,
  coachName,
  coachLink,
  availableCoaches,
  coachDirLoading,
  onRefreshDirectory,
  onSelectCoachCode,
  intervalsRefreshNonce,
}) {
  const [avatarUploading, setAvatarUploading] = useState(false);

  const uploadAthleteAvatar = async (file) => {
    if (!file || !athleteId) return;
    setAvatarUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
      const filePath = `${athleteId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("athlete-avatars").upload(filePath, file, { upsert: true, cacheControl: "3600" });
      if (upErr) { notify?.("Error subiendo foto: " + upErr.message); return; }
      const { data: { publicUrl } } = supabase.storage.from("athlete-avatars").getPublicUrl(filePath);
      const { data: updated, error: avErr } = await supabase
        .from("athletes")
        .update({ avatar_url: publicUrl })
        .eq("id", athleteId)
        .select("id");
      if (avErr) {
        notify?.("Error guardando foto: " + avErr.message);
        return;
      }
      if (!(updated || []).length) {
        notify?.("No se guardó la foto en tu ficha (sin permiso o fila no encontrada)");
        return;
      }
      onAvatarSaved?.(publicUrl);
      notify?.("✅ Foto actualizada");
    } catch (e) {
      notify?.("Error subiendo foto");
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <div style={{ ...cardStyle }}>
      <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>MI CONFIGURACIÓN</div>
      <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 8 }}>Gestiona conexiones y preferencias.</div>
      <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>FOTO DE PERFIL</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", overflow: "hidden", background: "#f1f5f9", border: "2px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="foto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span>🏃</span>
            )}
          </div>
          <div>
            <label style={{ display: "inline-block", padding: "8px 14px", borderRadius: 8, background: avatarUploading ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", color: avatarUploading ? "#94a3b8" : "#fff", fontWeight: 800, cursor: avatarUploading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
              {avatarUploading ? "Subiendo..." : "📷 Subir foto"}
              <input type="file" accept="image/*" style={{ display: "none" }} disabled={avatarUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAthleteAvatar(f); }} />
            </label>
            <div style={{ fontSize: ".72em", color: "#94a3b8", marginTop: 6 }}>JPG, PNG o GIF · máx 2MB</div>
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>MI COACH</div>
        {coachName ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "rgba(255,138,61,.08)", border: "1px solid rgba(255,138,61,.3)", marginBottom: 10 }}>
            <span style={{ fontSize: "1.3em" }}>&#127939;</span>
            <div>
              <div style={{ fontSize: ".72em", color: "#b45309", fontWeight: 700 }}>Coach actual</div>
              <div style={{ fontSize: ".9em", fontWeight: 800, color: "#0f172a" }}>{coachName}</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: ".82em", color: "#64748b", marginBottom: 10 }}>No tienes coach asignado. Ingresa un codigo para conectarte.</div>
        )}
        <CoachLinkActions
          code={coachLink.code}
          onCodeChange={coachLink.onCodeChange}
          onConnect={coachLink.onConnect}
          connecting={coachLink.connecting}
          codeMsg={coachLink.codeMsg}
          onRequest={coachLink.onRequest}
          requesting={coachLink.requesting}
          requestPending={coachLink.requestPending}
          requestMsg={coachLink.requestMsg}
          showRequest={coachLink.showRequest}
        />
      </div>
      {/* Con menos de MIN_COACHES_FOR_DIRECTORY coaches disponibles no se
          renderiza nada: ni la seccion ni un mensaje de vacio. */}
      {availableCoaches.length >= MIN_COACHES_FOR_DIRECTORY ? (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em" }}>DIRECTORIO DE COACHES</div>
            <button type="button" onClick={onRefreshDirectory} disabled={coachDirLoading} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em" }}>
              {coachDirLoading ? "Cargando..." : "Actualizar"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {availableCoaches.map((c) => (
              <div key={c.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fafafa", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  {c.avatar_url ? (
                    <img src={c.avatar_url} alt="" loading="lazy" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid #e2e8f0" }} />
                  ) : (
                    <span style={{ fontSize: "1.2em", flexShrink: 0 }}>🏃</span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.full_name || c.name}</div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginTop: 2 }}>
                      {"Codigo: " + (c.coach_id || "N/A") + [c.city, c.country].filter(Boolean).map((s) => " · " + s).join("")}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => onSelectCoachCode?.(c.coach_id || "")} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,138,61,.4)", background: "rgba(255,138,61,.1)", color: "#b45309", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em", whiteSpace: "nowrap" }}>
                  Seleccionar
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
        <IntervalsConnect athleteId={athleteId} onNotify={notify} refreshNonce={intervalsRefreshNonce} />
      </div>
    </div>
  );
}

/**
 * Contraseña / borrar cuenta / logout. Hoy se pintan en TODOS los sub-tabs
 * de Perfil (layout preexistente). No moverlos dentro de Config.
 */
export function AthleteProfileSessionFooter({ notify, cardStyle }) {
  const handleLogout = async () => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("raf_athlete_tab");
      localStorage.removeItem("raf_athlete_eval_open");
      localStorage.removeItem("raf_athlete_profile_tab");
      localStorage.removeItem("raf_athlete_progress_tab");
      localStorage.removeItem("raf_lastView");
    }
    // Retirar el token de push de ESTE dispositivo ANTES de salir,
    // para que el proximo usuario no herede las notificaciones. Los
    // otros dispositivos del atleta siguen recibiendo. No debe
    // impedir el logout si falla.
    try {
      await unregisterOwnDeviceToken();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: cleared, error: fcmErr } = await supabase
          .from("profiles")
          .update({ fcm_token: null })
          .eq("user_id", user.id)
          .select("user_id");
        if (fcmErr) {
          console.warn("[FCM] no se pudo limpiar fcm_token en logout:", fcmErr.message);
        } else if (!(cleared || []).length) {
          console.warn("[FCM] fcm_token no se actualizó (0 filas) en logout");
        }
      }
      if (Capacitor.isNativePlatform()) await clearNativePush();
      else await clearFcmToken();
    } catch (e) {
      console.warn("[FCM] limpieza en logout:", e);
    }
    const { error } = await supabase.auth.signOut();
    if (error) { console.error("Error al cerrar sesión:", error); alert(`Error al cerrar sesión: ${error.message}`); }
  };

  return (
    <>
      <ChangePasswordSection notify={notify} cardStyle={cardStyle} />
      <DeleteAccountSection notify={notify} cardStyle={cardStyle} />
      <button
        type="button"
        onClick={handleLogout}
        style={{ width: "100%", marginTop: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 700, whiteSpace: "nowrap" }}
      >
        Cerrar sesión
      </button>
    </>
  );
}
