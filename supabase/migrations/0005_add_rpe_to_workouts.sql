-- RPE (Rate of Perceived Exertion) 1–10, opcional hasta que el atleta lo registre
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS rpe integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'workouts' AND c.conname = 'workouts_rpe_check'
  ) THEN
    ALTER TABLE public.workouts
      ADD CONSTRAINT workouts_rpe_check
      CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10));
  END IF;
END $$;
