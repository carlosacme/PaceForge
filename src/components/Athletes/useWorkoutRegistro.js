import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { readStructure } from "../../lib/workoutStructure";
import { compareBlocks } from "../../lib/blockComparison";

/**
 * Modal Registro de una sesión completada.
 * Laps vía /api/integrations `activity-intervals`; compareBlocks no se duplica.
 */
export function useWorkoutRegistro({ athleteVdot }) {
  const [registroModal, setRegistroModal] = useState(null);
  const [registroLaps, setRegistroLaps] = useState(null);
  const [registroLapsLoading, setRegistroLapsLoading] = useState(false);
  const [registroLapsError, setRegistroLapsError] = useState(false);

  useEffect(() => {
    const w = registroModal;
    setRegistroLaps(null);
    setRegistroLapsError(false);
    setRegistroLapsLoading(false);
    if (!w || !w.intervals_activity_id) return undefined;
    const structure = readStructure(w);
    if (!Array.isArray(structure) || structure.length === 0) return undefined;

    let cancelled = false;
    (async () => {
      setRegistroLapsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch("/api/integrations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            action: "activity-intervals",
            athlete_id: w.athlete_id,
            activity_id: w.intervals_activity_id,
          }),
        });
        const data = await resp.json();
        if (cancelled) return;
        setRegistroLaps(resp.ok && Array.isArray(data.icu_intervals) ? data.icu_intervals : []);
      } catch (e) {
        if (!cancelled) {
          setRegistroLaps([]);
          setRegistroLapsError(true);
        }
      } finally {
        if (!cancelled) setRegistroLapsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [registroModal]);

  const registroBlocks = useMemo(() => {
    const w = registroModal;
    if (!w || !Array.isArray(registroLaps) || registroLaps.length === 0) return null;
    const structure = readStructure(w);
    if (!Array.isArray(structure) || structure.length === 0) return null;
    try {
      return compareBlocks({ structure, laps: registroLaps, vdot: athleteVdot });
    } catch {
      return null;
    }
  }, [registroModal, registroLaps, athleteVdot]);

  return {
    registroModal,
    setRegistroModal,
    registroLaps,
    registroLapsLoading,
    registroLapsError,
    registroBlocks,
  };
}
