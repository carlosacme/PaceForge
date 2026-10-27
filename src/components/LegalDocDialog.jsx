import React from "react";

const DOCS = {
  privacy: { href: "/privacy", src: "/privacy.html", title: "Política de privacidad" },
  terms: { href: "/terms", src: "/terms.html", title: "Términos" },
};

function openLegalDoc(event, doc, setDoc) {
  event.preventDefault();
  event.stopPropagation();
  setDoc(doc);
}

/**
 * Panel sobre la pantalla actual. El formulario sigue montado detrás:
 * en el WebView nativo target="_blank" a menudo no abre nada, y navegar
 * a /privacy desmontaría el registro y borraría lo escrito.
 */
export default function LegalDocDialog({ doc, onClose }) {
  const entry = DOCS[doc];
  if (!entry) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={entry.title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        background: "rgba(15,23,42,.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 12,
      }}
    >
      <div
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 760,
          height: "min(86vh, 780px)",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 16px 40px rgba(15,23,42,.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid #e2e8f0" }}>
          <strong style={{ color: "#0f172a", fontSize: ".95em" }}>{entry.title}</strong>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Cerrar
          </button>
        </div>
        <iframe title={entry.title} src={entry.src} style={{ flex: 1, width: "100%", border: 0, background: "#f8fafc" }} />
      </div>
    </div>
  );
}

export function LegalDocAnchor({ doc, setDoc, children, style }) {
  const entry = DOCS[doc];
  return (
    <a
      href={entry.href}
      onClick={(event) => openLegalDoc(event, doc, setDoc)}
      style={{ color: "#c2410c", fontWeight: 700, ...style }}
    >
      {children}
    </a>
  );
}
