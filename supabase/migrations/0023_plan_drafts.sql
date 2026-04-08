-- Drafts persistentes para Plan 2 Semanas por coach/atleta

CREATE TABLE IF NOT EXISTS public.plan_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  athlete_id integer NOT NULL REFERENCES public.athletes (id) ON DELETE CASCADE,
  plan_json jsonb NOT NULL,
  race_date date,
  block_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'assigned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS plan_drafts_coach_athlete_idx
  ON public.plan_drafts (coach_id, athlete_id);

CREATE INDEX IF NOT EXISTS plan_drafts_status_idx
  ON public.plan_drafts (status);

ALTER TABLE public.plan_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_drafts_select_own ON public.plan_drafts;
CREATE POLICY plan_drafts_select_own
  ON public.plan_drafts FOR SELECT
  TO authenticated
  USING (coach_id = auth.uid());

DROP POLICY IF EXISTS plan_drafts_insert_own ON public.plan_drafts;
CREATE POLICY plan_drafts_insert_own
  ON public.plan_drafts FOR INSERT
  TO authenticated
  WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS plan_drafts_update_own ON public.plan_drafts;
CREATE POLICY plan_drafts_update_own
  ON public.plan_drafts FOR UPDATE
  TO authenticated
  USING (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());
