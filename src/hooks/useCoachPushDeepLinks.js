import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { registerFcmToken } from "../components/shared/appShared";
import {
  initMessaging,
  onMessage,
  refreshFcmTokenIfGranted,
  requestNotificationPermission,
} from "../firebase.js";
import {
  isNativePush,
  registerNativePush,
  nativePushPermissionState,
  consumePendingDeepLink,
  subscribeDeepLink,
} from "../lib/nativePush";

/**
 * Push/FCM (web + nativo) + deep links coach_* desde notificación / URL.
 *
 * Expone `syncFcmTokenToProfile` para AuthLanding.onLoginSuccess y el banner.
 * No incluye App Links de auth (`nativeAppLinks`) — tubería distinta.
 *
 * @param {{
 *   session: object | null,
 *   authLoading: boolean,
 *   profile: object | null,
 *   athletes: array,
 *   notify: (msg: string) => void,
 *   setView: (v: string) => void,
 *   setSelectedAthlete: (a: object | null) => void,
 *   setViewRestored: (v: boolean) => void,
 *   setPendingRegistroWorkoutId: (id: string | null) => void,
 * }} args
 */
export function useCoachPushDeepLinks({
  session,
  authLoading,
  profile,
  athletes,
  notify,
  setView,
  setSelectedAthlete,
  setViewRestored,
  setPendingRegistroWorkoutId,
}) {
  const [pushInviteDismissed, setPushInviteDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("raf_push_invite_dismissed") === "1",
  );
  const [nativePushPermission, setNativePushPermission] = useState(null);

  /** Destino de un push que aun no se pudo aplicar porque faltaba el atleta. */
  const pendingCoachDeepLinkRef = useRef(null);
  const [nativeDeepLinkTick, setNativeDeepLinkTick] = useState(0);

  const syncFcmTokenToProfile = useCallback(async () => {
    try {
      const uid = session?.user?.id;
      if (!uid) {
        return;
      }
      // En la APK no existen ni Notification ni el service worker, asi que el
      // flujo web nunca obtenia token. El nativo pide permiso con el plugin y
      // entrega el token por el listener "registration" a la misma
      // registerFcmToken().
      if (Capacitor.isNativePlatform()) {
        await registerNativePush({ notify });
        return;
      }
      const token = await requestNotificationPermission();
      if (!token) {
        return;
      }
      // El backend (service_role) limpia el token de otros perfiles antes de
      // asignarlo al actual: dos usuarios del mismo navegador no pueden
      // compartir token.
      const ok = await registerFcmToken(token);
      if (!ok) {
        console.warn("[FCM] No se pudo registrar el token en el backend");
      }
    } catch (e) {
      console.warn("syncFcmTokenToProfile", e);
    }
  }, [session?.user?.id, notify]);

  const dismissPushInvite = useCallback(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("raf_push_invite_dismissed", "1");
    setPushInviteDismissed(true);
  }, []);

  /**
   * El banner de "activa las notificaciones" mira Notification.permission en
   * web, pero ese objeto no existe en el WebView: en nativo el estado sale de
   * PushNotifications.checkPermissions().
   */
  const refreshNativePushPermission = useCallback(async () => {
    if (!isNativePush()) return;
    setNativePushPermission(await nativePushPermissionState());
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    void refreshNativePushPermission();
  }, [session?.user?.id, refreshNativePushPermission]);

  const pushPermissionGranted = isNativePush()
    ? nativePushPermission === "granted"
    : typeof Notification !== "undefined" && Notification.permission === "granted";
  const pushPermissionKnown = isNativePush()
    ? nativePushPermission != null
    : typeof Notification !== "undefined";
  const showPushInvite = Boolean(session) && pushPermissionKnown && !pushPermissionGranted && !pushInviteDismissed;

  useEffect(() => {
    if (authLoading || !session?.user?.id) return undefined;
    let cancelled = false;
    (async () => {
      // Nativo: register() vuelve a emitir el token en cada arranque, asi que
      // esto cubre tambien las rotaciones que hace FCM.
      if (Capacitor.isNativePlatform()) {
        await registerNativePush({ notify });
        return;
      }
      const tok = await refreshFcmTokenIfGranted();
      if (cancelled || !tok) return;
      await registerFcmToken(tok);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, notify]);

  useEffect(() => {
    // En nativo el primer plano lo cubre el listener pushNotificationReceived
    // de nativePush.js; firebase/messaging no funciona en el WebView.
    if (!session || Capacitor.isNativePlatform()) return undefined;
    let unsub = () => {};
    (async () => {
      const m = await initMessaging();
      if (!m) return;
      unsub = onMessage(m, (payload) => {
        const t = payload.notification?.title;
        notify(t || "Nuevo mensaje");
      });
    })();
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [session, notify]);

  // Un tap con la app ya montada no vuelve a ejecutar el efecto de abajo por si
  // solo (en la APK no hay recarga ni cambio de URL): el plugin avisa y este
  // contador lo despierta.
  useEffect(() => {
    if (!isNativePush()) return undefined;
    return subscribeDeepLink(() => setNativeDeepLinkTick((n) => n + 1));
  }, []);

  /**
   * Salta al destino de un aviso push. La web lo recibe en la URL y la APK en
   * el `data` de la notificacion, pero la navegacion es la misma, asi que vive
   * en un solo sitio. Devuelve false si aun no se puede aplicar.
   */
  const applyCoachDeepLink = useCallback((data) => {
    const athleteId = data?.athlete_id;
    if (athleteId) {
      const found = (athletes || []).find((a) => String(a.id) === String(athleteId));
      if (!found) return false; // aun no cargaron; se reintenta cuando lleguen
      setSelectedAthlete(found);
    }
    setView("athletes");
    // Persistir: el efecto de visibilitychange re-aplica raf_lastView al
    // volver a foco y pisaria el destino del deep link.
    try { localStorage.setItem("raf_lastView", "athletes"); } catch {}
    setViewRestored(true); // evita que el efecto de restauracion lo pise
    if (data?.type === "coach_workout_completed" && data?.workout_id) {
      setPendingRegistroWorkoutId(String(data.workout_id));
    }
    return true;
  }, [athletes]);

  // Deep link desde notificaciones push (tipos coach_*). Requiere que el
  // perfil y la lista de atletas ya esten cargados; si el athlete_id aun no
  // esta en `athletes`, el efecto reintenta cuando llegue (dep [athletes]).
  // deps exactas: críticos para foreground / background / killed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!profile || profile.role === "athlete") return;

    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    const fromUrl = open && open.startsWith("coach_")
      ? { type: open, athlete_id: params.get("athlete_id"), workout_id: params.get("workout_id") }
      : null;
    // En la APK la URL nunca cambia al tocar la notificacion: el destino lo
    // dejo el listener nativo. Se guarda en el ref si no se pudo aplicar, para
    // no perderlo (consumirlo lo borra del modulo).
    const target = fromUrl || pendingCoachDeepLinkRef.current || consumePendingDeepLink("coach_");
    if (!target) return;

    if (!applyCoachDeepLink(target)) {
      pendingCoachDeepLinkRef.current = target;
      return;
    }
    pendingCoachDeepLinkRef.current = null;

    // Consumir el parametro para que no se reprocese en recargas.
    if (fromUrl) {
      params.delete("open"); params.delete("athlete_id"); params.delete("workout_id");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [profile, athletes, applyCoachDeepLink, nativeDeepLinkTick]);

  return {
    syncFcmTokenToProfile,
    showPushInvite,
    dismissPushInvite,
    refreshNativePushPermission,
    setNativePushPermission,
  };
}
