import React, { useState, useEffect } from "react";

/**
 * InstallAppButton
 * -----------------------------------------------------------
 * Boton para instalar la PWA en la pantalla de inicio.
 *
 * Tres casos:
 *  - Android/Chrome: usa el beforeinstallprompt capturado en App
 *    (expuesto en window.__deferredInstallPrompt). Boton nativo.
 *  - iOS/Safari: no existe beforeinstallprompt. Muestra instruccion
 *    manual (Compartir -> Anadir a inicio).
 *  - Ya instalada (standalone): no muestra nada.
 *
 * Uso:
 *   <InstallAppButton />
 * -----------------------------------------------------------
 */
export default function InstallAppButton() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  const isIos = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;

  useEffect(() => {
    if (isStandalone()) { setInstalled(true); return; }

    // App.jsx captura el evento y lo deja en window.__deferredInstallPrompt.
    // Puede estar ya listo, o llegar despues: escuchamos ambos.
    if (window.__deferredInstallPrompt) {
      setDeferred(window.__deferredInstallPrompt);
    }
    const onAvailable = (e) => setDeferred(e.detail || window.__deferredInstallPrompt);
    const onInstalled = () => { setInstalled(true); setDeferred(null); };

    window.addEventListener("raf:install-available", onAvailable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("raf:install-available", onAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (deferred) {
      deferred.prompt();
      try {
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") setInstalled(true);
      } catch { /* ignore */ }
      window.__deferredInstallPrompt = null;
      setDeferred(null);
    } else if (isIos()) {
      setShowIosHelp((v) => !v);
    }
  };

  // Ya instalada: no mostrar nada.
  if (installed) return null;
  // Ni prompt de Android ni iOS: el navegador no soporta instalacion.
  if (!deferred && !isIos()) return null;

  const S = {
    btn: {
      display: "inline-flex", alignItems: "center", gap: 8,
      background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
      border: "none", borderRadius: 10, padding: "11px 18px",
      color: "#fff", fontWeight: 800, fontFamily: "inherit",
      cursor: "pointer", fontSize: ".9em",
    },
    help: {
      marginTop: 10, background: "#f8fafc", border: "1px solid #e2e8f0",
      borderRadius: 10, padding: 14, fontSize: ".82em", color: "#334155",
      lineHeight: 1.7, maxWidth: 360,
    },
  };

  return (
    <div style={{ margin: "8px 0" }}>
      <button type="button" onClick={handleInstall} style={S.btn}>
        📲 Instalar app en tu teléfono
      </button>

      {showIosHelp && (
        <div style={S.help}>
          <strong>Para instalar en iPhone/iPad:</strong>
          <div style={{ marginTop: 6 }}>
            1. Toca el botón <strong>Compartir</strong> (el cuadrito con la
            flecha hacia arriba, abajo en Safari).
          </div>
          <div style={{ marginTop: 4 }}>
            2. Baja y toca <strong>“Añadir a pantalla de inicio”</strong>.
          </div>
          <div style={{ marginTop: 4 }}>
            3. Confirma con <strong>Añadir</strong>. ¡Listo!
          </div>
        </div>
      )}
    </div>
  );
}
