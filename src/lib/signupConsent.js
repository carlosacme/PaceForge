/** Versión de los términos y la política aceptados en el registro. */
export const TERMS_VERSION = "2026-10";

/**
 * Metadata de signUp. El correo va en el campo email de Auth, no aquí.
 * Sin migración: Supabase guarda options.data en el usuario.
 */
export function signupUserData({ fullName, role, coachId, now = new Date() } = {}) {
  const acceptedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    full_name: String(fullName ?? "").trim(),
    role,
    coach_id: coachId ?? null,
    terms_accepted_at: acceptedAt,
    terms_version: TERMS_VERSION,
  };
}
