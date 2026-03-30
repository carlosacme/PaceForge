-- Carreras objetivo por atleta (coach + atleta pueden ver)

CREATE TABLE IF NOT EXISTS public.races (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes (id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  date date NOT NULL,
  distance text NOT NULL,
  city text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS races_athlete_date_idx
  ON public.races (athlete_id, date ASC);

CREATE INDEX IF NOT EXISTS races_coach_idx
  ON public.races (coach_id, created_at DESC);

ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS races_select_participants ON public.races;
CREATE POLICY races_select_participants
  ON public.races FOR SELECT
  TO authenticated
  USING (
    coach_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = races.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS races_insert_coach ON public.races;
CREATE POLICY races_insert_coach
  ON public.races FOR INSERT
  TO authenticated
  WITH CHECK (coach_id = auth.uid());
