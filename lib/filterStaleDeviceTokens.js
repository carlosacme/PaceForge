/** Hay un hermano reciente de la misma plataforma (≤ este umbral). */
export const STALE_TOKEN_FRESH_DAYS = 7;
/** Con hermano fresco, no se envía a tokens más viejos que esto. */
export const STALE_TOKEN_MAX_DAYS = 21;

export function tokenAgeDays(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return null;
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / (86400 * 1000);
}

/**
 * Filtro SOFT: no borra filas. Omite tokens stale al armar el envío.
 *
 * Un token se omite solo si, en la misma platform, existe otro con
 * last_seen ≤ 7 días y este tiene last_seen > 21 días. El único token
 * de una plataforma siempre se envía.
 */
export function filterStaleDeviceTokens(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < 2) return list;

  const byPlatform = new Map();
  for (const row of list) {
    const platform = row?.platform || "";
    if (!byPlatform.has(platform)) byPlatform.set(platform, []);
    byPlatform.get(platform).push(row);
  }

  const kept = [];
  for (const group of byPlatform.values()) {
    const hasFreshSibling = group.some((row) => {
      const days = tokenAgeDays(row.last_seen_at, now);
      return days != null && days <= STALE_TOKEN_FRESH_DAYS;
    });
    if (!hasFreshSibling) {
      kept.push(...group);
      continue;
    }
    for (const row of group) {
      const days = tokenAgeDays(row.last_seen_at, now);
      if (days != null && days > STALE_TOKEN_MAX_DAYS) continue;
      kept.push(row);
    }
  }
  return kept;
}
