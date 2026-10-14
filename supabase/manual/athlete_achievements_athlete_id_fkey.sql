-- =============================================================================
-- FK athlete_achievements.athlete_id → athletes(id) ON DELETE CASCADE
-- =============================================================================
-- NO EJECUTAR hasta aprobación. No es migración automática.
--
-- Contexto: las 219 huérfanas vinieron de handleDeleteAthlete (coach borra
-- atleta: messages + workouts + athletes, sin logros). RLS de
-- athlete_achievements no tiene policy DELETE, así que un .delete() del
-- cliente no habría funcionado. delete_own_account YA borra logros
-- (SECURITY DEFINER); ese DELETE explícito se deja.
--
-- Tipo: prod tiene athlete_id integer y athletes.id bigint. Postgres
-- acepta FK int4 → int8 (probado 2026-10-14 con tablas TEMP + CASCADE).
-- NO hace falta ALTER TYPE. El bloque B2 (bigint) solo si A falla.
--
-- Precondición: 0 huérfanas (confirmado 2026-10-14 post-limpieza).
-- Índice: athlete_achievements_athlete_code_uq (athlete_id, achievement_code)
-- cubre el lado izquierdo del FK.
-- =============================================================================

-- 0) Guard: abortar si hay huérfanas
-- SELECT count(*) AS huerfanas
-- FROM public.athlete_achievements aa
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.athletes a WHERE a.id = aa.athlete_id
-- );
-- Esperado: 0

-- A) FK SIN cambiar el tipo (preferido)
-- ALTER TABLE public.athlete_achievements
--   ADD CONSTRAINT athlete_achievements_athlete_id_fkey
--   FOREIGN KEY (athlete_id)
--   REFERENCES public.athletes (id)
--   ON DELETE CASCADE;

-- A-check) El constraint existe y es CASCADE
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.athlete_achievements'::regclass
--   AND conname = 'athlete_achievements_athlete_id_fkey';

-- B2) Solo si A falla con error de tipos (no ocurrió en el probe TEMP)
-- ALTER TABLE public.athlete_achievements
--   ALTER COLUMN athlete_id TYPE bigint;
-- ALTER TABLE public.athlete_achievements
--   ADD CONSTRAINT athlete_achievements_athlete_id_fkey
--   FOREIGN KEY (athlete_id)
--   REFERENCES public.athletes (id)
--   ON DELETE CASCADE;

-- R) Rollback
-- ALTER TABLE public.athlete_achievements
--   DROP CONSTRAINT IF EXISTS athlete_achievements_athlete_id_fkey;
-- -- Si se aplicó B2 y se quiere revertir el tipo (solo si no hay FK):
-- -- ALTER TABLE public.athlete_achievements
-- --   ALTER COLUMN athlete_id TYPE integer;

-- delete_own_account: NO tocar. El DELETE de athlete_achievements
-- (0072 / 0049) se queda; con CASCADE es idempotente.
