-- =============================================================================
-- EJECUTAR MANUALMENTE en Supabase SQL Editor (NO es una migración automática).
-- Marca la periodicidad de retos activos existentes para la renovación con
-- pg_cron (función renew_recurring_challenges).
--
-- Requisitos previos:
--   1) Aplicar supabase/migrations/0048_renew_recurring_challenges_cron.sql
-- =============================================================================

-- Semanales
UPDATE public.challenges
SET is_recurring = true, recurrence = 'weekly'
WHERE is_active = true
  AND (
    title = 'Semana de Velocidad'
    OR title = '⚡ Semana de Velocidad'
    OR title ILIKE '%Semana de Velocidad%'
  );

UPDATE public.challenges
SET is_recurring = true, recurrence = 'weekly'
WHERE is_active = true
  AND (
    title = 'Semana Perfecta'
    OR title = '⭐ Semana Perfecta'
    OR title ILIKE '%Semana Perfecta%'
  );

-- Mensuales
UPDATE public.challenges
SET is_recurring = true, recurrence = 'monthly'
WHERE is_active = true
  AND (
    title = '12 Sesiones en el Mes'
    OR title = '📅 12 Sesiones en el Mes'
    OR title ILIKE '%12 Sesiones en el Mes%'
  );

UPDATE public.challenges
SET is_recurring = true, recurrence = 'monthly'
WHERE is_active = true
  AND (
    title = 'Club de los Madrugadores'
    OR title = '🌅 Club de los Madrugadores'
    OR title ILIKE '%Club de los Madrugadores%'
  );

UPDATE public.challenges
SET is_recurring = true, recurrence = 'monthly'
WHERE is_active = true
  AND (
    title = 'Rey/Reina del Kilómetro'
    OR title = '🏆 Rey/Reina del Kilómetro'
    OR title ILIKE '%Rey/Reina del Kilómetro%'
  );

-- Únicos (explícito; no deben renovarse solos)
UPDATE public.challenges
SET is_recurring = false, recurrence = null
WHERE is_active = true
  AND (
    title = '500km en 2026'
    OR title = '🌍 500km en 2026'
    OR title ILIKE '%500km en 2026%'
    OR title = 'Reto Velocidad 5K'
    OR title ILIKE '%Reto Velocidad 5K%'
  );

-- Verificación rápida
SELECT id, title, end_date, is_recurring, recurrence
FROM public.challenges
WHERE is_active = true
ORDER BY is_recurring DESC, recurrence NULLS LAST, title;
