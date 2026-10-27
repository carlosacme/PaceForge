import { Capacitor } from "@capacitor/core";

/**
 * True solo dentro del shell de Capacitor en iOS.
 * En web, Android, SSR y tests sin el bridge devuelve false y no lanza.
 */
export function isIosApp() {
  try {
    if (typeof Capacitor?.getPlatform !== "function") return false;
    return Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

export const IOS_FEATURE_UNAVAILABLE =
  "Esta función no está disponible en tu cuenta. Escríbenos a soporte@runningapexflow.com.";

export const IOS_ACCOUNT_NO_ACCESS =
  "Tu cuenta no tiene acceso activo. Escríbenos a soporte@runningapexflow.com";
