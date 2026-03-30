-- Límite mensual de generaciones IA por coach

CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  month text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, month)
);

CREATE INDEX IF NOT EXISTS ai_generations_coach_month_idx
  ON public.ai_generations (coach_id, month);

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_generations_select_own ON public.ai_generations;
CREATE POLICY ai_generations_select_own
  ON public.ai_generations FOR SELECT
  TO authenticated
  USING (coach_id = auth.uid());

DROP POLICY IF EXISTS ai_generations_insert_own ON public.ai_generations;
CREATE POLICY ai_generations_insert_own
  ON public.ai_generations FOR INSERT
  TO authenticated
  WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS ai_generations_update_own ON public.ai_generations;
CREATE POLICY ai_generations_update_own
  ON public.ai_generations FOR UPDATE
  TO authenticated
  USING (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());
