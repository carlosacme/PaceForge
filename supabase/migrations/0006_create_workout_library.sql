-- Plantillas de workouts por coach (biblioteca)
CREATE TABLE IF NOT EXISTS public.workout_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'easy',
  total_km numeric NOT NULL DEFAULT 0,
  duration_min integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  structure jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_library_coach_id_idx ON public.workout_library (coach_id);
CREATE INDEX IF NOT EXISTS workout_library_created_at_idx ON public.workout_library (coach_id, created_at DESC);

ALTER TABLE public.workout_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workout_library_select_own"
  ON public.workout_library FOR SELECT
  USING (auth.uid() = coach_id);

CREATE POLICY "workout_library_insert_own"
  ON public.workout_library FOR INSERT
  WITH CHECK (auth.uid() = coach_id);

CREATE POLICY "workout_library_update_own"
  ON public.workout_library FOR UPDATE
  USING (auth.uid() = coach_id);

CREATE POLICY "workout_library_delete_own"
  ON public.workout_library FOR DELETE
  USING (auth.uid() = coach_id);
