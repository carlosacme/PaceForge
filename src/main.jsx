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
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "12px 14px",
        borderRadius: 12,
        background: "linear-gradient(135deg, #0f172a, #1e293b)",
        border: "1px solid rgba(245, 158, 11, 0.35)",
        boxShadow: "0 12px 40px rgba(0,0,0,.45)",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#f8fafc", fontSize: ".95rem", marginBottom: 4 }}>
          Instalar PaceForge
        </div>
        <div style={{ fontSize: ".78rem", color: "#94a3b8", lineHeight: 1.35 }}>
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
            border: "1px solid rgba(148,163,184,.35)",
            background: "transparent",
            color: "#94a3b8",
            fontWeight: 700,
            fontSize: ".8rem",
            cursor: "pointer",
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
