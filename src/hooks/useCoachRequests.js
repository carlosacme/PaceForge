import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";

/**
 * Inbox de coach_requests (pending) para Settings y Dashboard.
 * Aceptar vincula athletes.coach_id + profiles.coach_id.
 */
export function useCoachRequests({ coachUserId, notify, onAccepted }) {
  const [coachRequests, setCoachRequests] = useState([]);
  const [requestsBusyId, setRequestsBusyId] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);

  const loadCoachRequests = useCallback(async () => {
    if (!coachUserId) {
      setCoachRequests([]);
      return;
    }
    setLoadingRequests(true);
    const { data, error } = await supabase
      .from("coach_requests")
      .select("id, athlete_id, coach_id, status, created_at")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error cargando coach_requests:", error);
      setCoachRequests([]);
      setLoadingRequests(false);
      return;
    }
    const rows = data || [];
    const ids = [...new Set(rows.map((r) => r.athlete_id).filter(Boolean))];
    let byId = {};
    if (ids.length > 0) {
      const { data: athRows, error: athErr } = await supabase
        .from("athletes")
        .select("id, name, email")
        .in("id", ids);
      if (athErr) {
        console.error("Error cargando atletas de solicitudes:", athErr);
      } else {
        byId = Object.fromEntries((athRows || []).map((a) => [String(a.id), a]));
      }
    }
    setCoachRequests(
      rows.map((r) => {
        const a = byId[String(r.athlete_id)];
        return {
          ...r,
          athlete_name: a?.name || "",
          athlete_email: a?.email || "",
        };
      }),
    );
    setLoadingRequests(false);
  }, [coachUserId]);

  useEffect(() => {
    loadCoachRequests();
  }, [loadCoachRequests]);

  const pendingRequests = useMemo(
    () => coachRequests.filter((r) => r.status === "pending"),
    [coachRequests],
  );

  const updateCoachRequestStatus = useCallback(
    async (row, status) => {
      if (!row?.id || !coachUserId) return;
      setRequestsBusyId(row.id);
      const { data: reqRows, error } = await supabase
        .from("coach_requests")
        .update({ status })
        .eq("id", row.id)
        .eq("coach_id", coachUserId)
        .select("id");
      if (error) {
        console.error("Error actualizando solicitud:", error);
        notify?.(error.message || "No se pudo actualizar la solicitud");
        setRequestsBusyId("");
        return;
      }
      if (!(reqRows || []).length) {
        notify?.("No se actualizó la solicitud (sin permiso o ya no existe)");
        setRequestsBusyId("");
        return;
      }
      if (status === "accepted") {
        const { data: athleteRow } = await supabase
          .from("athletes")
          .select("id, user_id")
          .eq("id", row.athlete_id)
          .maybeSingle();
        const { data: athleteUpdated, error: athleteErr } = await supabase
          .from("athletes")
          .update({ coach_id: coachUserId })
          .eq("id", row.athlete_id)
          .select("id");
        if (athleteErr) {
          console.error("Error vinculando atleta:", athleteErr);
          notify?.(athleteErr.message || "Solicitud aceptada, pero no se pudo vincular el atleta");
          setRequestsBusyId("");
          await loadCoachRequests();
          return;
        }
        if (!(athleteUpdated || []).length) {
          notify?.("Solicitud aceptada, pero no se vinculó el atleta (sin permiso sobre esa fila)");
          setRequestsBusyId("");
          await loadCoachRequests();
          return;
        }
        if (athleteRow?.user_id) {
          const { data: profileUpdated, error: profileErr } = await supabase
            .from("profiles")
            .update({ coach_id: coachUserId })
            .eq("user_id", athleteRow.user_id)
            .select("user_id");
          if (profileErr) {
            console.error("Error sincronizando profiles.coach_id:", profileErr);
            notify?.(`Atleta vinculado, pero el perfil no se sincronizó: ${profileErr.message}`);
          } else if (!(profileUpdated || []).length) {
            notify?.("Atleta vinculado, pero el perfil no se actualizó (sin permiso o sin fila)");
          }
        }
        notify?.("Solicitud aceptada");
        if (typeof onAccepted === "function") {
          await onAccepted(row);
        }
      } else {
        notify?.(status === "rejected" ? "Solicitud rechazada" : "Solicitud actualizada");
      }
      await loadCoachRequests();
      setRequestsBusyId("");
    },
    [coachUserId, notify, onAccepted, loadCoachRequests],
  );

  return {
    coachRequests,
    pendingRequests,
    requestsBusyId,
    loadingRequests,
    loadCoachRequests,
    updateCoachRequestStatus,
  };
}
