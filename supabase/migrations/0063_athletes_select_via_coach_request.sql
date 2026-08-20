-- Permite al coach leer name/email de atletas que le han enviado
-- una solicitud (aun sin coach_id). Sin esto, el select por athlete_id
-- de coach_requests falla en RLS y la UI solo puede mostrar el id.

DROP POLICY IF EXISTS athletes_select_via_coach_request ON public.athletes;
CREATE POLICY athletes_select_via_coach_request
  ON public.athletes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_requests cr
      WHERE cr.athlete_id = athletes.id
        AND cr.coach_id = auth.uid()
    )
  );
