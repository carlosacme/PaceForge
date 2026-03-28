import { StrictMode, useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

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
      if (isInstallBannerTarget()) setVisible(true);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
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
          Instalar PaceForge
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
            background: "linear-gradient(135deg,#b45309,#f59e0b)",
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")).render(
  <>
    <InstallPwaBanner />
    <StrictMode>
      <App />
    </StrictMode>
  </>,
);
