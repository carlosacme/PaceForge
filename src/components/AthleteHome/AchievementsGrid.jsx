import React, { useMemo } from "react";
import {
  ATHLETE_ACHIEVEMENT_DISPLAY_LIST,
  computeAthleteAchievementVisualProgress,
} from "../shared/appShared";

/**
 * Grilla MIS LOGROS (Perfil -> Logros).
 *
 * Presentacional: no fetch, no award. El padre carga earnedAchievements
 * (snapshot) y toggleDone llama evaluateAndAwardAthleteAchievements.
 * Aqui solo se pintan catalogo + progreso visual + fechas de award.
 */
export default function AchievementsGrid({
  cardStyle,
  workouts,
  evaluations,
  earnedAchievements,
}) {
  const progress = useMemo(
    () => computeAthleteAchievementVisualProgress(workouts, evaluations),
    [workouts, evaluations],
  );
  const earnedByCode = useMemo(() => {
    const m = {};
    for (const row of earnedAchievements || []) {
      const code = String(row?.achievement_code || "");
      if (!code) continue;
      if (!m[code]) m[code] = row?.awarded_at || null;
    }
    return m;
  }, [earnedAchievements]);

  return (
    <div style={{ ...cardStyle }}>
      <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>MIS LOGROS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12 }}>
        {ATHLETE_ACHIEVEMENT_DISPLAY_LIST.map((a) => {
          const currentValue = Number(progress?.[a.metric] || 0);
          const progressRatio = a.target > 0 ? Math.min(1, currentValue / a.target) : 0;
          const progressPct = Math.round(progressRatio * 100);
          const awardedAt = (a.codes || []).map((code) => earnedByCode[code]).find(Boolean) || null;
          const earnedByProgress = currentValue >= a.target;
          const earned = Boolean(awardedAt || earnedByProgress);
          const formattedDate = awardedAt ? new Date(awardedAt).toLocaleDateString("es-CO") : "Sin fecha registrada";
          const currentLabel = a.metric === "totalKm" ? `${currentValue.toFixed(1)} / ${a.target} km` : `${Math.round(currentValue)} / ${a.target}`;
          return (
            <div key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: earned ? "linear-gradient(145deg,#fffbeb,#fff7ed)" : "#f8fafc" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: "1.9rem", lineHeight: 1 }}>{a.icon}</div>
                {earned ? <span style={{ fontSize: ".66em", fontWeight: 800, color: "#166534", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>✅ Ganado</span> : <span style={{ fontSize: ".66em", fontWeight: 700, color: "#64748b", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>🔒 Bloqueado</span>}
              </div>
              <div style={{ fontSize: ".87em", fontWeight: 900, marginTop: 8, color: "#0f172a" }}>{a.name}</div>
              <div style={{ fontSize: ".77em", color: "#475569", marginTop: 6, lineHeight: 1.45 }}>{a.requirement}</div>
              {earned ? (
                <div style={{ marginTop: 10, fontSize: ".72em", color: "#166534", fontWeight: 700 }}>Fecha de logro: {formattedDate}</div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 5 }}>{a.requirement}</div>
                  <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                    <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg,#ff8a3d,#f97316)" }} />
                  </div>
                  <div style={{ marginTop: 5, fontSize: ".7em", color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                    <span>{currentLabel}</span><span>{progressPct}%</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
