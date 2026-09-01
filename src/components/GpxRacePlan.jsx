import { useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fmtPace } from "../lib/vdot";
import {
  parseAndSegmentGpx,
  buildGpxRaceStructure,
  basePaceSecsForRaceZone,
  gradeAdjustedPaceSecs,
  estimateDurationMinFromStructure,
  GPX_RACE_ZONE_OPTIONS,
} from "../lib/gpxRacePlan";
import {
  formatLocalYMD,
  insertAssignedWorkouts,
  sendWorkoutAssignmentPushToAthlete,
  styles as sharedStyles,
} from "./shared/appShared";

const DEFAULT_PREVIEW_VDOT = 45;

export default function GpxRacePlan({ athletes = [], coachUserId, notify, onSavedToLibrary, onWorkoutAssigned }) {
  const S = sharedStyles;
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [segments, setSegments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [zoneId, setZoneId] = useState("M");
  const [title, setTitle] = useState("");
  const [previewAthleteId, setPreviewAthleteId] = useState("");
  const [previewVdot, setPreviewVdot] = useState(DEFAULT_PREVIEW_VDOT);
  const [vdotLoading, setVdotLoading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDate, setAssignDate] = useState(() => formatLocalYMD(new Date()));
  const [assignAthleteIds, setAssignAthleteIds] = useState([]);
  const [assignVdotById, setAssignVdotById] = useState({});
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);

  const loadVdot = useCallback(async (athleteId) => {
    if (!athleteId) {
      setPreviewVdot(DEFAULT_PREVIEW_VDOT);
      return;
    }
    setVdotLoading(true);
    const { data, error } = await supabase
      .from("athlete_evaluations")
      .select("vdot, test_date, created_at")
      .eq("athlete_id", athleteId)
      .order("test_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setVdotLoading(false);
    if (error) {
      console.error("gpx preview vdot:", error);
      setPreviewVdot(DEFAULT_PREVIEW_VDOT);
      return;
    }
    const v = Number(data?.vdot);
    setPreviewVdot(Number.isFinite(v) && v > 0 ? v : DEFAULT_PREVIEW_VDOT);
  }, []);

  const onPreviewAthleteChange = (id) => {
    setPreviewAthleteId(id);
    void loadVdot(id);
  };

  const structure = useMemo(() => {
    if (!segments.length) return [];
    try {
      return buildGpxRaceStructure(segments, previewVdot, zoneId);
    } catch {
      return [];
    }
  }, [segments, previewVdot, zoneId]);

  const durationMin = useMemo(() => estimateDurationMinFromStructure(structure), [structure]);
  const basePaceLabel = useMemo(() => {
    const s = basePaceSecsForRaceZone(previewVdot, zoneId);
    return s != null ? `${fmtPace(s)}/km` : "—";
  }, [previewVdot, zoneId]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError("");
    try {
      const text = await file.text();
      const { segments: segs, summary: sum } = parseAndSegmentGpx(text);
      setSegments(segs);
      setSummary(sum);
      setFileName(file.name);
      const base = file.name.replace(/\.gpx$/i, "").trim();
      setTitle((t) => t || base || "Plan de carrera GPX");
      notify?.(`GPX leído: ${sum.total_km} km · ${sum.segment_count} tramos`);
    } catch (err) {
      console.error(err);
      setSegments([]);
      setSummary(null);
      setFileName("");
      setParseError(err?.message || "No se pudo leer el GPX");
      notify?.(err?.message || "No se pudo leer el GPX");
    }
  };

  const workoutPayloadBase = () => ({
    title: (title || "").trim() || "Plan de carrera GPX",
    type: "race",
    total_km: summary?.total_km ?? 0,
    duration_min: durationMin || 0,
    description: `Plan GPX · zona ${zoneId} · ↑${summary?.elev_gain_m ?? 0} m ↓${summary?.elev_loss_m ?? 0} m · ritmos Minetti por tramo ~1 km`,
  });

  const saveToLibrary = async () => {
    if (!coachUserId) {
      notify?.("Sesión no válida");
      return;
    }
    if (!structure.length) {
      notify?.("Sube un GPX primero");
      return;
    }
    setSavingLibrary(true);
    const row = {
      ...workoutPayloadBase(),
      structure,
      coach_id: coachUserId,
      is_fitness_test: false,
    };
    const { error } = await supabase.from("workout_library").insert(row);
    setSavingLibrary(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "Error al guardar en biblioteca");
      return;
    }
    notify?.("Guardado en tu biblioteca (ritmos se recalculan al asignar con el VDOT del atleta)");
    onSavedToLibrary?.();
  };

  const openAssign = async () => {
    if (!structure.length) {
      notify?.("Sube un GPX primero");
      return;
    }
    setAssignOpen(true);
    setAssignAthleteIds([]);
    const ids = (athletes || []).map((a) => a.id).filter(Boolean);
    if (!ids.length) return;
    const { data, error } = await supabase
      .from("athlete_evaluations")
      .select("athlete_id, vdot, test_date, created_at")
      .in("athlete_id", ids)
      .order("test_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      return;
    }
    const map = {};
    for (const row of data || []) {
      if (row.athlete_id == null || Object.prototype.hasOwnProperty.call(map, row.athlete_id)) continue;
      const v = Number(row.vdot);
      map[row.athlete_id] = Number.isFinite(v) && v > 0 ? v : null;
    }
    setAssignVdotById(map);
  };

  const assignToAthletes = async () => {
    if (!coachUserId) return;
    if (!assignAthleteIds.length) {
      notify?.("Selecciona al menos un atleta");
      return;
    }
    if (!assignDate) {
      notify?.("Elige una fecha");
      return;
    }
    const rows = (athletes || []).filter((a) => assignAthleteIds.includes(String(a.id)));
    setAssignSaving(true);
    const base = workoutPayloadBase();
    const payload = rows.map((a) => {
      const vdot = assignVdotById[a.id] || DEFAULT_PREVIEW_VDOT;
      const structureForAthlete = buildGpxRaceStructure(segments, vdot, zoneId);
      return {
        ...base,
        structure: structureForAthlete,
        athlete_id: a.id,
        coach_id: coachUserId,
        scheduled_date: assignDate,
        generated_with_vdot: Number(vdot) || null,
        done: false,
        duration_min: estimateDurationMinFromStructure(structureForAthlete),
      };
    });
    const { error } = await insertAssignedWorkouts(payload);
    setAssignSaving(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "Error al asignar");
      return;
    }
    await Promise.all(
      rows.map((a) =>
        sendWorkoutAssignmentPushToAthlete({
          athleteUserId: a?.user_id,
          workoutTitle: base.title,
          scheduledDate: assignDate,
        }),
      ),
    );
    notify?.(`Plan asignado a ${rows.length} atleta(s). Puedes enviarlo al reloj con «Push».`);
    setAssignOpen(false);
    onWorkoutAssigned?.();
  };

  return (
    <div style={{ ...S.page, maxWidth: 960 }}>
      <h1 style={S.pageTitle}>Carrera GPX</h1>
      <p style={{ color: "#64748b", fontSize: ".9em", marginTop: 6, marginBottom: 18, maxWidth: 640, lineHeight: 1.5 }}>
        Sube el trayecto .gpx de la carrera. Se segmenta en tramos de ~1 km y se generan ritmos
        ajustados por pendiente (modelo Minetti) según el VDOT y la zona de carrera.
      </p>

      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: ".75em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>Archivo GPX</div>
            <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={onFile} style={{ fontSize: ".85em" }} />
            {fileName ? <div style={{ fontSize: ".78em", color: "#334155", marginTop: 6 }}>{fileName}</div> : null}
          </div>
          <div>
            <div style={{ fontSize: ".75em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>Zona de ritmo</div>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontWeight: 700 }}
            >
              {GPX_RACE_ZONE_OPTIONS.map((z) => (
                <option key={z.id} value={z.id}>{z.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: ".75em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>VDOT vista previa</div>
            <select
              value={previewAthleteId}
              onChange={(e) => onPreviewAthleteChange(e.target.value)}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", minWidth: 180 }}
            >
              <option value="">Genérico ({DEFAULT_PREVIEW_VDOT})</option>
              {(athletes || []).map((a) => (
                <option key={a.id} value={a.id}>{a.name || "Atleta"}</option>
              ))}
            </select>
            <div style={{ fontSize: ".72em", color: "#94a3b8", marginTop: 4 }}>
              {vdotLoading ? "Cargando VDOT…" : `VDOT ${previewVdot} · base ${basePaceLabel}`}
            </div>
          </div>
        </div>
        {parseError ? <div style={{ color: "#b91c1c", marginTop: 12, fontSize: ".85em" }}>{parseError}</div> : null}
      </div>

      {summary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
            {[
              ["Distancia", `${summary.total_km} km`],
              ["Tramos", String(summary.segment_count)],
              ["Desnivel +", `${summary.elev_gain_m} m`],
              ["Desnivel −", `${summary.elev_loss_m} m`],
              ["Duración est.", durationMin ? `${durationMin} min` : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ ...S.card, padding: "12px 14px" }}>
                <div style={{ fontSize: ".68em", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ ...S.card, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: ".75em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>Título del workout</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit", fontWeight: 700 }}
              placeholder="Nombre de la carrera"
            />
          </div>

          <div style={{ ...S.card, padding: 0, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82em" }}>
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>#</th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>Km</th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>Pendiente</th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>↑ / ↓</th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>Ritmo adj.</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((seg, i) => {
                    const base = basePaceSecsForRaceZone(previewVdot, zoneId);
                    const adj = base != null ? gradeAdjustedPaceSecs(base, seg.grade_pct) : null;
                    const g = seg.grade_pct || 0;
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{seg.distance_km.toFixed(2)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: g > 1 ? "#b45309" : g < -1 ? "#0369a1" : "#334155" }}>
                          {g >= 0 ? "+" : ""}{g.toFixed(1)}%
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#64748b" }}>
                          {Math.round(seg.elev_gain_m)} / {Math.round(seg.elev_loss_m)}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>
                          {adj != null ? `${fmtPace(adj)}/km` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              disabled={savingLibrary}
              onClick={() => void saveToLibrary()}
              style={{
                border: "1px solid rgba(99,102,241,.35)",
                background: "rgba(99,102,241,.1)",
                color: "#4338ca",
                borderRadius: 10,
                padding: "12px 16px",
                fontWeight: 800,
                cursor: savingLibrary ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {savingLibrary ? "Guardando…" : "Guardar en biblioteca"}
            </button>
            <button
              type="button"
              onClick={() => void openAssign()}
              style={{
                border: "none",
                background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                color: "#fff",
                borderRadius: 10,
                padding: "12px 16px",
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 6px 16px rgba(255,138,61,.25)",
              }}
            >
              Asignar a atleta(s)
            </button>
          </div>
          <p style={{ fontSize: ".78em", color: "#94a3b8", marginTop: 12, lineHeight: 1.45 }}>
            Al asignar se usa el VDOT actual de cada atleta (no el de la vista previa).
            Cada tramo guarda su pendiente para poder recalcular ritmos después desde la biblioteca.
          </p>
        </>
      ) : null}

      {assignOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 440, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800 }}>Asignar plan GPX</div>
              <button type="button" onClick={() => setAssignOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", fontWeight: 700, color: "#64748b" }}>✕</button>
            </div>
            <div style={{ fontSize: ".75em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>Fecha</div>
            <input type="date" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 12, fontFamily: "inherit" }} />
            <div style={{ fontSize: ".75em", fontWeight: 700, color: "#64748b", marginBottom: 8 }}>Atletas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto", marginBottom: 14 }}>
              {(athletes || []).length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: ".85em" }}>No hay atletas.</div>
              ) : (
                athletes.map((a) => {
                  const checked = assignAthleteIds.includes(String(a.id));
                  const v = assignVdotById[a.id];
                  return (
                    <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".85em", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setAssignAthleteIds((prev) =>
                            checked ? prev.filter((id) => id !== String(a.id)) : [...prev, String(a.id)],
                          );
                        }}
                      />
                      <span style={{ fontWeight: 700 }}>{a.name}</span>
                      <span style={{ color: "#94a3b8" }}>{v ? `VDOT ${v}` : "sin VDOT → 45"}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setAssignOpen(false)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", background: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancelar</button>
              <button
                type="button"
                disabled={assignSaving}
                onClick={() => void assignToAthletes()}
                style={{ border: "none", borderRadius: 8, padding: "8px 12px", background: assignSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", color: assignSaving ? "#64748b" : "#fff", fontWeight: 800, cursor: assignSaving ? "wait" : "pointer", fontFamily: "inherit" }}
              >
                {assignSaving ? "Asignando…" : "Asignar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
