-- Caché de textos IA por workout (analyze del coach + briefing del atleta).
-- Escribe solo el backend (service_role). El cliente solo SELECT vía RLS.
-- Ver docs/ai-cache-detailed-map.md.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workout_ai_cache (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workout_id  bigint NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('coach_analyze', 'athlete_briefing')),
  text        text NOT NULL,
  input_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workout_id, kind)
);

COMMENT ON TABLE public.workout_ai_cache IS
  'Último texto IA por workout y kind. UPSERT del API; created_at = última escritura.';

CREATE INDEX IF NOT EXISTS workout_ai_cache_workout_idx
  ON public.workout_ai_cache (workout_id);

ALTER TABLE public.workout_ai_cache ENABLE ROW LEVEL SECURITY;

-- coach_analyze: coach dueño, staff asignado (isCoachOf), admin. No el atleta.
DROP POLICY IF EXISTS workout_ai_cache_select_coach_analyze ON public.workout_ai_cache;
CREATE POLICY workout_ai_cache_select_coach_analyze
  ON public.workout_ai_cache FOR SELECT TO authenticated
  USING (
    kind = 'coach_analyze'
    AND EXISTS (
      SELECT 1
      FROM public.workouts w
      JOIN public.athletes a ON a.id = w.athlete_id
      WHERE w.id = workout_ai_cache.workout_id
        AND (
          public.is_admin()
          OR a.coach_id = auth.uid()
          OR w.coach_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.staff_athletes sa
            JOIN public.coach_staff cs
              ON cs.staff_id = sa.staff_id AND cs.coach_id = a.coach_id
            WHERE sa.athlete_id = a.id AND sa.staff_id = auth.uid()
          )
        )
    )
  );

-- athlete_briefing: atleta dueño, o el mismo círculo coach/staff/admin.
DROP POLICY IF EXISTS workout_ai_cache_select_athlete_briefing ON public.workout_ai_cache;
CREATE POLICY workout_ai_cache_select_athlete_briefing
  ON public.workout_ai_cache FOR SELECT TO authenticated
  USING (
    kind = 'athlete_briefing'
    AND EXISTS (
      SELECT 1
      FROM public.workouts w
      JOIN public.athletes a ON a.id = w.athlete_id
      WHERE w.id = workout_ai_cache.workout_id
        AND (
          a.user_id = auth.uid()
          OR public.is_admin()
          OR a.coach_id = auth.uid()
          OR w.coach_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.staff_athletes sa
            JOIN public.coach_staff cs
              ON cs.staff_id = sa.staff_id AND cs.coach_id = a.coach_id
            WHERE sa.athlete_id = a.id AND sa.staff_id = auth.uid()
          )
        )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
