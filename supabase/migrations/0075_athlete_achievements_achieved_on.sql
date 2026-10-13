-- Fecha de calendario del evento que cumplió el logro (YYYY-MM-DD local,
-- igual que workouts.scheduled_date). Aditivo: no toca filas existentes.
--
-- NO crea índice unique. Prod tiene duplicados masivos; el unique va en
-- supabase/manual/athlete_achievements_paso0.sql DESPUÉS de backup + DELETE
-- aprobado. Aplicar este archivo no escribe datos de atletas.

ALTER TABLE public.athlete_achievements
  ADD COLUMN IF NOT EXISTS achieved_on date;

NOTIFY pgrst, 'reload schema';
