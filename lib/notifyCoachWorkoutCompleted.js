/**
 * Aviso al coach cuando un atleta completa un workout (manual o webhook ICU).
 * Best-effort: nunca debe tumbar el marcado done ni el webhook.
 *
 * Dedupe: claim atómico en workouts.coach_completion_notified_at
 * (solo el primer caller notifica).
 */
import {
  adminClient,
  pushTargets,
  sendToAllDevices,
  logDelivery,
  COACH_WORKOUT_COMPLETED_TYPE,
  COACH_WORKOUT_COMPLETED_KIND,
} from "./fcmPush.js";

function workoutBodyLine(w) {
  const title = (w?.title && String(w.title).trim()) || w?.type || "Entreno";
  const distRaw = w?.actual_distance_km ?? w?.manual_distance_km ?? w?.total_km;
  const dist = Number(distRaw);
  if (Number.isFinite(dist) && dist > 0) {
    const rounded = Math.round(dist * 10) / 10;
    return `${title} · ${rounded} km`;
  }
  return String(title);
}

/**
 * @param {{ workoutId: string|number, fromUserId?: string|null }} opts
 * @returns {Promise<{ sent: boolean, skipped?: string, reason?: string }>}
 */
export async function notifyCoachWorkoutCompleted({ workoutId, fromUserId = null } = {}) {
  if (workoutId == null || String(workoutId).trim() === "") {
    return { sent: false, skipped: "sin workout_id" };
  }
  try {
    const supabase = adminClient();
    if (!supabase) return { sent: false, reason: "sin supabase admin" };

    // Claim atómico: si ya se notificó (manual o webhook), no reenviar.
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabase
      .from("workouts")
      .update({ coach_completion_notified_at: claimedAt })
      .eq("id", workoutId)
      .is("coach_completion_notified_at", null)
      .eq("done", true)
      .select("id, title, type, total_km, actual_distance_km, manual_distance_km, athlete_id")
      .maybeSingle();

    if (claimErr) {
      console.warn("[workout-completed] claim:", claimErr.message);
      return { sent: false, reason: claimErr.message };
    }
    if (!claimed) {
      return { sent: false, skipped: "ya notificado o no done" };
    }

    const { data: athlete, error: athErr } = await supabase
      .from("athletes")
      .select("id, name, coach_id, user_id")
      .eq("id", claimed.athlete_id)
      .maybeSingle();
    if (athErr || !athlete?.coach_id) {
      console.warn("[workout-completed] sin coach:", athErr?.message || "coach_id vacío");
      return { sent: false, reason: "sin coach" };
    }

    const coachUserId = athlete.coach_id;
    const athleteName = (athlete.name && String(athlete.name).trim()) || "Atleta";
    const title = `✅ ${athleteName} completó un entreno`;
    const body = workoutBodyLine(claimed);
    const pushData = {
      type: COACH_WORKOUT_COMPLETED_TYPE,
      athlete_id: String(athlete.id),
      workout_id: String(claimed.id),
    };
    const kind = COACH_WORKOUT_COMPLETED_KIND;

    const targets = await pushTargets(coachUserId);
    if (!targets.length) {
      await logDelivery({
        fromUserId: fromUserId || athlete.user_id || null,
        toUserId: coachUserId,
        kind,
        title,
        status: "no_token",
        reason: "sin token",
      });
      return { sent: false, reason: "sin token" };
    }

    const outcome = await sendToAllDevices({
      targets,
      toUserId: coachUserId,
      fromUserId: fromUserId || athlete.user_id || null,
      kind,
      title,
      body,
      pushData,
    });

    if (outcome.delivered > 0) {
      console.log(`[workout-completed] ✓ coach=${coachUserId} workout=${claimed.id}`);
      return { sent: true };
    }
    return { sent: false, reason: outcome.lastCode || "envio fallido" };
  } catch (e) {
    console.warn("[workout-completed] error:", e?.message || e);
    return { sent: false, reason: String(e?.message || e) };
  }
}
