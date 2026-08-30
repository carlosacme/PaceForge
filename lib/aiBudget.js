/**
 * Techo de generaciones IA (generate-workout) en el servidor.
 *
 * Cuenta las dos ventanas con increment_ai_generation() (RPC de 0067, llamada
 * con service_role): la fila mensual month = "YYYY-MM" que pinta
 * Builder/Plan2Weeks "X/100", y una fila diaria aparte month = "d:YYYY-MM-DD".
 *
 * El cliente solo LEE. Hasta 0067 el incremento mensual vivía en el browser y
 * la tabla no tenía policy UPDATE: el .update() afectaba 0 filas sin dar error,
 * así que el contador llevaba meses congelado en 1 y el tope nunca disparaba.
 * Contar aquí también cubre las generaciones de ChallengesHub y
 * AdminMarketplacePanel, que nunca tocaron el contador mensual.
 *
 * Se cuenta ANTES de llamar a Anthropic: una generación que falle a mitad ya
 * gastó cuota del proveedor, que es justo lo que este techo protege.
 *
 * Env opcionales para Preview: AI_GENERATE_DAILY_BASIC / AI_GENERATE_DAILY_PRO
 * (y los MONTHLY_*) — no definirlos en producción.
 */

import { adminHeaders, jsonError } from "./apiAuth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const DEFAULTS = {
  basic: { monthly: 100, daily: 20 },
  pro: { monthly: 400, daily: 40 },
};

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Mismo criterio que Builder/Plan2Weeks: vacío / starter / básico = Básico. */
export function isBasicCoachPlan(subscriptionPlan) {
  const p = String(subscriptionPlan || "").toLowerCase().trim();
  return p === "basico" || p === "básico" || p === "starter" || p === "";
}

export function limitsForProfile(profile) {
  const role = String(profile?.role || "").toLowerCase();
  const basic = isBasicCoachPlan(profile?.subscription_plan);
  const tier = role === "admin" || !basic ? "pro" : "basic";
  return {
    tier,
    monthly: envInt(
      tier === "basic" ? "AI_GENERATE_MONTHLY_BASIC" : "AI_GENERATE_MONTHLY_PRO",
      DEFAULTS[tier].monthly,
    ),
    daily: envInt(
      tier === "basic" ? "AI_GENERATE_DAILY_BASIC" : "AI_GENERATE_DAILY_PRO",
      DEFAULTS[tier].daily,
    ),
  };
}

export function canGenerateWorkouts(profile) {
  const role = String(profile?.role || "").toLowerCase();
  return role === "coach" || role === "admin";
}

/** Calendario Colombia (no depende del TZ del runtime de Vercel). */
export function colombiaYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function monthKeyFromDate(now = new Date()) {
  return colombiaYmd(now).slice(0, 7);
}

export function dayKeyFromDate(now = new Date()) {
  return `d:${colombiaYmd(now)}`;
}

async function sbJson(path, init = {}) {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init.headers || {}) },
  });
  const text = await r.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { ok: r.ok, status: r.status, data };
}

/**
 * `order` explícito: sin él PostgREST no garantiza qué fila llega primero.
 * 0067 deja una sola fila por coach+mes, pero mientras una base sin migrar
 * tenga duplicadas conviene quedarse con el count más alto y no infravalorar
 * el consumo.
 */
async function readCount(userId, monthKey) {
  const q = `ai_generations?coach_id=eq.${encodeURIComponent(userId)}&month=eq.${encodeURIComponent(monthKey)}&select=id,count&order=count.desc,updated_at.desc&limit=1`;
  const { ok, status, data } = await sbJson(q);
  if (!ok) throw new Error(`ai_generations GET -> ${status}`);
  const row = Array.isArray(data) ? data[0] : null;
  return { id: row?.id || null, count: Number(row?.count) || 0 };
}

/**
 * Incremento atómico en la base (INSERT ... ON CONFLICT DO UPDATE).
 * Un read-modify-write desde aquí perdería cuentas cuando dos generaciones
 * del mismo coach entran a la vez.
 */
async function incrementCount(userId, key) {
  const { ok, status, data } = await sbJson("rpc/increment_ai_generation", {
    method: "POST",
    body: JSON.stringify({ p_coach_id: userId, p_month: key }),
  });
  if (!ok) throw new Error(`increment_ai_generation(${key}) -> ${status}`);
  return Number(data) || 0;
}

async function loadProfile(userId) {
  const { ok, status, data } = await sbJson(
    `profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,role,subscription_plan&limit=1`,
  );
  if (!ok) throw new Error(`profiles GET -> ${status}`);
  return Array.isArray(data) ? data[0] : null;
}

/**
 * 403 si no es coach/admin. 429 si ya está en el tope (sin incrementar).
 * Si cabe, incrementa el cupo diario y el mensual, y deja pasar.
 */
export async function assertGenerateBudget(res, user) {
  let profile;
  try {
    profile = await loadProfile(user.id);
  } catch (e) {
    console.error("[aiBudget] profile:", e.message);
    return jsonError(res, 500, "No se pudo verificar el plan");
  }

  if (!canGenerateWorkouts(profile)) {
    return jsonError(res, 403, "Solo coaches pueden generar entrenamientos con IA");
  }

  const limits = limitsForProfile(profile);
  const monthKey = monthKeyFromDate();
  const dayKey = dayKeyFromDate();

  let monthUsed = 0;
  let dayUsed = 0;
  try {
    monthUsed = (await readCount(user.id, monthKey)).count;
    dayUsed = (await readCount(user.id, dayKey)).count;
  } catch (e) {
    console.error("[aiBudget] read counts:", e.message);
    return jsonError(res, 500, "No se pudo leer el uso de generaciones IA");
  }

  if (monthUsed >= limits.monthly) {
    return res.status(429).json({
      error: "Límite de generaciones IA alcanzado",
      scope: "monthly",
      used: monthUsed,
      limit: limits.monthly,
      reset: `${monthKey}-01`,
    });
  }
  if (dayUsed >= limits.daily) {
    return res.status(429).json({
      error: "Límite de generaciones IA alcanzado",
      scope: "daily",
      used: dayUsed,
      limit: limits.daily,
      reset: dayKey.slice(2),
    });
  }

  try {
    await incrementCount(user.id, dayKey);
    await incrementCount(user.id, monthKey);
  } catch (e) {
    console.error("[aiBudget] increment:", e.message);
    return jsonError(res, 500, "No se pudo registrar el uso de generaciones IA");
  }

  return null;
}
