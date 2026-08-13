import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

// 'resume' y visibilitychange suelen llegar casi juntos al volver a la APK.
// Sin esta ventana, cada vuelta lanzaria la misma consulta dos veces.
const MIN_GAP_MS = 1500;

/**
 * Ejecuta `onResume` cuando el usuario vuelve a la app sin haberla cerrado.
 *
 * Cubre los dos caminos porque ninguno basta solo:
 * - 'resume' del plugin nativo: en la APK, volver de segundo plano NO remonta
 *   nada, asi que sin esto los datos se quedan congelados desde que se abrio.
 * - visibilitychange: el unico disponible en navegador, y respaldo en nativo.
 *
 * Ninguno de los dos se dispara al montar, asi que esto nunca duplica la carga
 * inicial del componente.
 *
 * @param {() => void} onResume - se guarda en un ref; no hace falta memoizarla
 * @param {boolean} enabled - false mientras no haya nada que refrescar
 */
export function useAppResumeRefresh(onResume, enabled = true) {
  const callbackRef = useRef(onResume);
  const lastRunRef = useRef(0);

  // En un efecto y no en render: asignar a un ref mientras se pinta es impuro.
  useEffect(() => {
    callbackRef.current = onResume;
  }, [onResume]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return undefined;

    const fire = () => {
      const now = Date.now();
      if (now - lastRunRef.current < MIN_GAP_MS) return;
      lastRunRef.current = now;
      callbackRef.current?.();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fire();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    let removeResume = null;
    if (Capacitor.isNativePlatform()) {
      // Se quita el handle concreto en vez de App.removeAllListeners(): ese
      // metodo se llevaria por delante los listeners de App de otras pantallas.
      const pending = CapacitorApp.addListener("resume", fire);
      removeResume = () => {
        Promise.resolve(pending).then((h) => h?.remove?.()).catch(() => {});
      };
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (removeResume) removeResume();
    };
  }, [enabled]);
}
