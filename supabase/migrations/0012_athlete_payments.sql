-- Pagos de atletas gestionados por coach

CREATE TABLE IF NOT EXISTS public.athlete_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes (id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'COP',
  payment_method text NOT NULL,
  plan text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  notes text,
  payment_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS athlete_payments_athlete_idx
  ON public.athlete_payments (athlete_id, payment_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS athlete_payments_coach_idx
  ON public.athlete_payments (coach_id, created_at DESC);

ALTER TABLE public.athlete_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS athlete_payments_select_participants ON public.athlete_payments;
CREATE POLICY athlete_payments_select_participants
  ON public.athlete_payments FOR SELECT
  TO authenticated
  USING (
    coach_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = athlete_payments.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS athlete_payments_insert_coach ON public.athlete_payments;
CREATE POLICY athlete_payments_insert_coach
  ON public.athlete_payments FOR INSERT
  TO authenticated
  WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS athlete_payments_update_coach ON public.athlete_payments;
CREATE POLICY athlete_payments_update_coach
  ON public.athlete_payments FOR UPDATE
  TO authenticated
  USING (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());
