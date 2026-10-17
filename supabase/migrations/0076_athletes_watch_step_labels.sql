-- Etiquetas RÁPIDO/RECUPERACIÓN en el texto enviado a intervals.icu/reloj.
-- OFF por defecto: no reescribe entrenos ya enviados. Solo aplica en el
-- próximo push si el atleta (o su coach) activa el flag.

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS watch_step_labels boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.athletes.watch_step_labels IS
  'Si true, toIntervalsText añade RÁPIDO/RECUPERACIÓN e intensity= al enviar al reloj. Default false.';

DROP POLICY IF EXISTS athletes_update_self_by_user_id ON public.athletes;
CREATE POLICY athletes_update_self_by_user_id
  ON public.athletes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
