import React, { useState } from "react";
import { providerLabel, formatDeviceSyncDate } from "../shared/appShared";

/**
 * Foto del atleta en la lista del coach. La URL viene con el resto del atleta
 * en la consulta que ya carga la lista, asi que esto no dispara ninguna
 * peticion extra. Si no hay foto, o si falla la carga, queda el emoji.
 */
export const AthleteListAvatar = ({ url, fallback = "🏃", size = 32 }) => {
  const [failed, setFailed] = useState(false);
  const src = failed ? "" : String(url || "");
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        overflow: "hidden",
        background: "#f1f5f9",
        border: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.55,
        lineHeight: 1,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
};

/**
 * Estado de sincronizacion del atleta en la lista del coach: un badge verde
 * por cada plataforma conectada (intervals.icu hoy, garmin/coros
 * despues) o uno gris si no tiene ninguna. Las conexiones llegan ya cargadas
 * en una sola consulta para toda la lista, no una por atleta.
 */
export const DeviceConnectionBadges = ({ connections }) => {
  const list = Array.isArray(connections) ? connections : [];
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    padding: "2px 7px",
    fontSize: ".62em",
    fontWeight: 700,
    lineHeight: 1.4,
    whiteSpace: "nowrap",
  };
  if (!list.length) {
    return (
      <div style={{ marginTop: 4 }}>
        <span style={{ ...base, background: "#f1f5f9", color: "#94a3b8" }} title="Sin dispositivos conectados">
          <span aria-hidden="true">●</span> sin conectar
        </span>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
      {list.map((c, i) => {
        const label = providerLabel(c.provider);
        return (
          <span
            key={`${c.provider}-${i}`}
            style={{ ...base, background: "#dcfce7", color: "#166534" }}
            title={`Conectado a ${label} — última sincronización: ${formatDeviceSyncDate(c.last_pull_at)}`}
          >
            <span aria-hidden="true">●</span> {label}
          </span>
        );
      })}
    </div>
  );
};

/**
 * Punto rojo de mensajes sin leer en la lista de atletas. Lleva el numero
 * dentro porque saber si hay uno o siete cambia la urgencia; a partir de 10 se
 * corta a "9+" para no ensanchar la fila.
 */
export const UnreadMessagesBadge = ({ count }) => {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (
    <span
      title={`${n} mensaje${n === 1 ? "" : "s"} sin leer`}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        background: "#ef4444",
        color: "#fff",
        fontSize: ".62em",
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
};

/**
 * Carga de la semana en la tarjeta del atleta: lo programado frente a lo
 * corrido. Sustituye a athletes.weekly_km, que era un dato declarado que nadie
 * actualizaba y no decia nada de la semana en curso.
 */
export const WeeklyLoadLine = ({ load }) => {
  const planned = Number(load?.planned) || 0;
  const actual = Number(load?.actual) || 0;
  if (planned <= 0) {
    return <span style={{ color: "#94a3b8" }}>Sin plan esta semana</span>;
  }
  const cumplio = actual >= planned;
  return (
    <>
      Plan {planned} ·{" "}
      <span style={{ color: cumplio ? "#16a34a" : "#d97706", fontWeight: 700 }}>Real {actual}</span> km
    </>
  );
};
