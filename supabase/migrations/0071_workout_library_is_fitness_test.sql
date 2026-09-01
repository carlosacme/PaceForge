-- Flag explícito de TEST de esfuerzo en plantillas de biblioteca.
-- Sustituye la heurística solo-por-título (/TEST *K/) como fuente de verdad,
-- con backfill de las filas que ya calzaban ese patrón.

ALTER TABLE public.workout_library
  ADD COLUMN IF NOT EXISTS is_fitness_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workout_library.is_fitness_test IS
  'True si la plantilla es un TEST de esfuerzo (sin reloj-objetivo ni ritmo all-out al asignar).';

UPDATE public.workout_library
SET is_fitness_test = true
WHERE is_fitness_test IS DISTINCT FROM true
  AND title ~* 'TEST[[:space:]]*[0-9]*K';
