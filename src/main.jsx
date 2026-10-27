import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import InstallPwaBanner from "./components/InstallPwaBanner";
import posthog from "posthog-js";
import { startNativeBuildUpdateWatcher } from "./lib/nativeBuildUpdate";
import { applyIosDocumentShell } from "./lib/platform";
import { posthogInitOptions } from "./lib/posthogPrivacy";

applyIosDocumentShell();

if (typeof window !== "undefined" && import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, posthogInitOptions());
}

/**
 * Banner suave cuando hay deploy nuevo y no conviene recargar a ciegas
 * (chat abierto, background corto). El usuario confirma.
 */
function UpdateAvailableBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onAvail = () => setVisible(true);
    window.addEventListener("raf:update-available", onAvail);
    return () => window.removeEventListener("raf:update-available", onAvail);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        top: "max(12px, env(safe-area-inset-top, 0px))",
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "14px 16px",
        borderRadius: 12,
        background: "#0d1f38",
        border: "1px solid rgba(23,198,163,.35)",
        boxShadow: "0 8px 32px rgba(0,0,0,.35)",
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#f8fafc", fontSize: ".95rem", marginBottom: 4 }}>
          Nueva versión disponible
        </div>
        <div style={{ fontSize: ".78rem", color: "rgba(248,250,252,.7)", lineHeight: 1.35 }}>
          Hay una actualización de RunningApexFlow. Recarga cuando puedas para verla.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setVisible(false)}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.18)",
            background: "rgba(255,255,255,.06)",
            color: "#f8fafc",
            fontWeight: 700,
            fontSize: ".8rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Más tarde
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
            color: "white",
            fontWeight: 800,
            fontSize: ".8rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}

if ("serviceWorker" in navigator) {
  // Cuando un deploy nuevo activa otro SW, recargar para no quedarse con el
  // index/assets de la build anterior (sintoma: logo viejo, pantallas antiguas).
  // Solo si YA habia un controlador: la primera activacion en un host nuevo
  // (Preview, primera visita) tambien dispara controllerchange y un reload
  // ahi remonta login/dashboard como si la pagina se recargara sola.
  let refreshing = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    if (!hadController) {
      hadController = true;
      return;
    }
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Pedir update en cada carga: si hay build nueva, install → skipWaiting → activate.
        try {
          reg.update();
        } catch {
          /* ignore */
        }
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });
}

startNativeBuildUpdateWatcher();

createRoot(document.getElementById("root")).render(
  <>
    <InstallPwaBanner />
    <UpdateAvailableBanner />
    <StrictMode>
      <App />
    </StrictMode>
  </>,
);
