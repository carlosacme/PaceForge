-- Evaluaciones fisiológicas del atleta (VDOT, ritmos, zonas, predicciones)

CREATE TABLE IF NOT EXISTS public.athlete_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes (id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  method text NOT NULL,
  input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  vdot numeric NOT NULL DEFAULT 0,
  paces jsonb NOT NULL DEFAULT '[]'::jsonb,
  hr_zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  predicted_times jsonb NOT NULL DEFAULT '[]'::jsonb,
  fc_max integer,
  fc_reposo integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS athlete_evaluations_athlete_created_idx
  ON public.athlete_evaluations (athlete_id, created_at DESC);

ALTER TABLE public.athlete_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS athlete_evaluations_select_participants ON public.athlete_evaluations;
CREATE POLICY athlete_evaluations_select_participants
  ON public.athlete_evaluations FOR SELECT
  TO authenticated
  USING (
    auth.uid() = coach_id
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS athlete_evaluations_insert_participants ON public.athlete_evaluations;
CREATE POLICY athlete_evaluations_insert_participants
  ON public.athlete_evaluations FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = coach_id
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = athlete_id
        AND a.coach_id = coach_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );
