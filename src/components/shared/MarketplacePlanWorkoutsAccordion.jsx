import React, { useState, useEffect, useMemo } from "react";
import { readStructure } from "../../lib/workoutStructure";
import WorkoutStructureTable from "./WorkoutStructureTable";

/** Acordeón por semana para preview_workouts (modal Marketplace y Biblioteca admin). */
export default function MarketplacePlanWorkoutsAccordion({ previewWorkouts, resetKey, lockAfterWeek1 = false }) {
  const list = Array.isArray(previewWorkouts) ? previewWorkouts : [];
  const weekGroups = useMemo(() => {
    const arr = Array.isArray(previewWorkouts) ? previewWorkouts : [];
    const groups = new Map();
    for (let i = 0; i < arr.length; i++) {
      const w = arr[i];
      const wn = w?.week != null && w.week !== "" ? Number(w.week) : NaN;
      const key = Number.isFinite(wn) && wn > 0 ? wn : 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ w, i });
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 0) return 1;
      if (b[0] === 0) return -1;
      return a[0] - b[0];
    });
  }, [previewWorkouts]);

  const week1Groups = useMemo(() => weekGroups.filter(([k]) => k === 1), [weekGroups]);
  const lockedWeekGroups = useMemo(() => weekGroups.filter(([k]) => k !== 1), [weekGroups]);

  const [openWeeks, setOpenWeeks] = useState(() => new Set([1]));

  useEffect(() => {
    const arr = Array.isArray(previewWorkouts) ? previewWorkouts : [];
    const weekNums = [
      ...new Set(
        arr
          .map((w) => (w?.week != null && w.week !== "" ? Number(w.week) : NaN))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ].sort((a, b) => a - b);
    const defaultW = lockAfterWeek1 ? 1 : weekNums.includes(1) ? 1 : weekNums.length ? weekNums[0] : 1;
    setOpenWeeks(new Set([defaultW]));
  }, [resetKey, previewWorkouts, lockAfterWeek1]);

  const renderSessionCard = (w, i, weekKey) => {
    const struct = readStructure(w);
    const hasStructure = struct.length > 0;
    const km =
      w.distance_km != null && w.distance_km !== "" && Number.isFinite(Number(w.distance_km))
        ? Number(w.distance_km)
        : w.total_km != null && w.total_km !== ""
          ? Number(w.total_km)
          : null;
    const mins = w.duration_min != null && w.duration_min !== "" ? Number(w.duration_min) : null;
    const metaParts = [];
    if (w.pace_range != null && String(w.pace_range).trim() !== "") metaParts.push(`${String(w.pace_range).trim()} min/km`);
    if (km != null && Number.isFinite(km)) metaParts.push(`${km} km`);
    if (mins != null && Number.isFinite(mins)) metaParts.push(`${mins} min`);
    return (
      <div
        key={w.id != null ? String(w.id) : `wk-${weekKey}-row-${i}`}
        style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#fff" }}
      >
        <div style={{ fontWeight: 800, fontSize: ".85em" }}>
          {w.day ? `${w.day} · ` : ""}
          {w.title || `Sesión ${i + 1}`}
        </div>
        {w.description ? <div style={{ fontSize: ".78em", color: "#475569", marginTop: 4, lineHeight: 1.4 }}>{w.description}</div> : null}
        {metaParts.length > 0 ? <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 4 }}>{metaParts.join(" · ")}</div> : null}
        {hasStructure ? (
          <div style={{ marginTop: 6 }}>
            <WorkoutStructureTable structure={struct} />
          </div>
        ) : null}
      </div>
    );
  };

  if (list.length === 0) {
    return <div style={{ color: "#94a3b8", fontSize: ".82em", marginBottom: 12 }}>No hay muestra de workouts.</div>;
  }

  const headerBtnStyle = {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    border: "none",
    background: "#fff",
    fontWeight: 800,
    fontSize: ".82em",
    color: "#0f172a",
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxSizing: "border-box",
  };

  const renderInteractiveWeek = ([weekKey, items]) => {
    const open = openWeeks.has(weekKey);
    const label = weekKey === 0 ? "Sin número de semana" : `Semana ${weekKey}`;
    return (
      <div key={weekKey} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() =>
            setOpenWeeks((prev) => {
              if (prev.has(weekKey) && prev.size === 1) return new Set();
              return new Set([weekKey]);
            })
          }
          style={{
            ...headerBtnStyle,
            background: open ? "#f1f5f9" : "#fff",
          }}
        >
          <span>
            {label}
            <span style={{ fontWeight: 600, color: "#64748b", marginLeft: 6 }}>
              ({items.length} {items.length === 1 ? "sesión" : "sesiones"})
            </span>
          </span>
          <span style={{ fontSize: ".75em", color: "#64748b" }}>{open ? "▾" : "▸"}</span>
        </button>
        {open ? (
          <div style={{ padding: "8px 10px 10px", background: "#fafafa", display: "grid", gap: 8 }}>
            {items.map(({ w, i }) => renderSessionCard(w, i, weekKey))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderLockedWeek = ([weekKey, items]) => {
    const label = weekKey === 0 ? "Sin número de semana" : `Semana ${weekKey}`;
    return (
      <div key={`locked-${weekKey}`} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginTop: 6 }}>
        <div
          style={{
            ...headerBtnStyle,
            background: "#f8fafc",
            cursor: "default",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <span>
            {label}
            <span style={{ marginLeft: 8 }} aria-hidden="true">
              🔒
            </span>
            <span style={{ fontWeight: 600, color: "#64748b", marginLeft: 6 }}>
              ({items.length} {items.length === 1 ? "sesión" : "sesiones"})
            </span>
          </span>
        </div>
        <div style={{ position: "relative", background: "#fafafa" }}>
          <div style={{ padding: "8px 10px 10px", display: "grid", gap: 8, filter: "blur(3px)", userSelect: "none", pointerEvents: "none" }}>
            {items.map(({ w, i }) => renderSessionCard(w, i, weekKey))}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(248,250,252,0.82)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              pointerEvents: "auto",
            }}
            aria-hidden="true"
          />
        </div>
      </div>
    );
  };

  if (lockAfterWeek1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        <div style={{ fontSize: ".72em", fontWeight: 800, color: "#0369a1", marginBottom: 2 }}>Muestra gratuita · Semana 1</div>
        {week1Groups.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: ".82em", padding: "10px 12px", border: "1px dashed #cbd5e1", borderRadius: 10, background: "#fff" }}>
            No hay sesiones numeradas como semana 1 en esta vista previa.
          </div>
        ) : (
          week1Groups.map(renderInteractiveWeek)
        )}
        {lockedWeekGroups.length > 0 ? (
          <>
            <div style={{ fontSize: ".72em", fontWeight: 800, color: "#64748b", marginTop: 8, marginBottom: 2 }}>Resto del plan</div>
            {lockedWeekGroups.map(renderLockedWeek)}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      {weekGroups.map(renderInteractiveWeek)}
    </div>
  );
}
