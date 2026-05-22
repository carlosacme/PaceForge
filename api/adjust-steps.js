export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
  };

  const { workout_id, isSimple, finalType, finalKm, finalDuration, originalKm, originalDuration, description, title } = req.body;

  if (isSimple) {
    await fetch(`${supabaseUrl}/rest/v1/workout_steps?workout_id=eq.${workout_id}`, { method: "DELETE", headers });
    await fetch(`${supabaseUrl}/rest/v1/workout_steps`, {
      method: "POST", headers,
      body: JSON.stringify([{
        workout_id: Number(workout_id),
        step_order: 1,
        type: finalType,
        duration_min: finalDuration,
        distance_km: finalKm > 0 ? finalKm : null,
        target_pace: finalType === "recovery" ? "Very easy pace" : finalType === "easy" ? "Conversational pace" : finalType === "long" ? "Easy to moderate pace" : "Tempo pace",
        target_hr_zone: finalType === "recovery" ? "Easy" : finalType === "easy" ? "Moderate" : "Hard",
        description: description || title || "Bloque ajustado por IA",
      }])
    });
  } else {
    const stepsRes = await fetch(`${supabaseUrl}/rest/v1/workout_steps?workout_id=eq.${workout_id}&order=step_order`, { headers });
    const existingSteps = await stepsRes.json();
    if (Array.isArray(existingSteps) && existingSteps.length > 0) {
      const kmRatio = originalKm > 0 ? finalKm / originalKm : 1;
      const durRatio = originalDuration > 0 ? finalDuration / originalDuration : 1;
      for (const step of existingSteps) {
        const stepUpdate = {};
        if (step.distance_km != null) stepUpdate.distance_km = Math.round(step.distance_km * kmRatio * 100) / 100;
        if (step.duration_min != null) stepUpdate.duration_min = Math.round(step.duration_min * durRatio * 10) / 10;
        if (Object.keys(stepUpdate).length > 0) {
          await fetch(`${supabaseUrl}/rest/v1/workout_steps?id=eq.${step.id}`, { method: "PATCH", headers, body: JSON.stringify(stepUpdate) });
        }
      }
    }
  }

  return res.status(200).json({ ok: true });
}
