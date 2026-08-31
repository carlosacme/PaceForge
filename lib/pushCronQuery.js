/**
 * Lecturas compartidas por los crons de send-push (remind + weekly-summary).
 */
import { deviceTokensByUserIds } from "./fcmPush.js";

const PAGE = 1000;

export async function fetchWorkoutsInRange(supabase, { from, to, columns }) {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("workouts")
      .select(columns)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("athlete_id", { ascending: true })
      .order("scheduled_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function loadAthleteUserMap(supabase, athleteIds) {
  const ids = [...new Set((athleteIds || []).filter(Boolean))];
  if (!ids.length) return { users: {}, coaches: {} };
  const { data, error } = await supabase.from("athletes").select("id,user_id,coach_id").in("id", ids);
  if (error) throw error;
  const users = {};
  const coaches = {};
  for (const a of data || []) {
    users[a.id] = a.user_id;
    if (a.coach_id) coaches[a.id] = a.coach_id;
  }
  return { users, coaches };
}

export async function loadPushTargetsByUser(supabase, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) {
    return { targetsFor: () => [] };
  }
  const devicesByUser = await deviceTokensByUserIds(ids);
  const { data: profiles } = await supabase.from("profiles").select("user_id,fcm_token").in("user_id", ids);
  const tokenMap = Object.fromEntries((profiles || []).filter((p) => p.fcm_token).map((p) => [p.user_id, p.fcm_token]));
  const targetsFor = (userId) => {
    const rows = devicesByUser?.[userId];
    if (rows?.length) return rows.map((r) => ({ token: r.token, platform: r.platform || null }));
    const legacy = tokenMap[userId];
    return legacy ? [{ token: legacy, platform: null }] : [];
  };
  return { targetsFor };
}

export async function sentKindUserIds(supabase, { kind, userIds, sinceIso }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const found = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("push_deliveries")
      .select("to_user_id")
      .eq("kind", kind)
      .eq("status", "sent")
      .gte("created_at", sinceIso)
      .in("to_user_id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      if (row.to_user_id) found.add(row.to_user_id);
    }
  }
  return found;
}
