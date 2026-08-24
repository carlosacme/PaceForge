import { StrictMode, useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import posthog from "posthog-js";
import { startNativeBuildUpdateWatcher } from "./lib/nativeBuildUpdate";

if (typeof window !== "undefined" && import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
  });
}

function isInstallBannerTarget() {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(max-width: 768px)");
  const ua = navigator.userAgent || "";
  return mq.matches || /Android|iPhone|iPad|iPod/i.test(ua);
}

function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Exponer el evento globalmente para que <InstallAppButton /> (montado
      // en las pantallas de bienvenida) pueda usarlo, ya sea que llegue antes
      // o despues de que el boton se monte.
      window.__deferredInstallPrompt = e;
      window.dispatchEvent(new CustomEvent("raf:install-available", { detail: e }));
      if (isInstallBannerTarget()) setVisible(true);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      window.__deferredInstallPrompt = null;
      setVisible(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      className="pf-install-banner"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "14px 16px",
        borderRadius: 12,
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        boxShadow: "0 8px 32px rgba(15, 23, 42, 0.12)",
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".95rem", marginBottom: 4 }}>
          Instalar RunningApexFlow
        </div>
        <div style={{ fontSize: ".78rem", color: "#64748b", lineHeight: 1.35 }}>
          Añade la app a tu pantalla de inicio para acceso rápido y mejor experiencia.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={dismiss}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            color: "#64748b",
            fontWeight: 700,
            fontSize: ".8rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={install}
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
          Instalar
        </button>
      </div>
    </div>
  );
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
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
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
