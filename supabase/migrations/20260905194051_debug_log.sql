-- Log temporal de diagnostico (bandeja de chat). Lo escribe el cliente
-- autenticado; lo lee el dueño de la fila o el admin. Quitar cuando cerremos
-- el caso de getDeliveredNotifications.

CREATE TABLE IF NOT EXISTS public.debug_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id    uuid NOT NULL,
  source     text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_debug_log_created
  ON public.debug_log (created_at DESC);

ALTER TABLE public.debug_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "debug_log_insert_own" ON public.debug_log;
CREATE POLICY "debug_log_insert_own"
  ON public.debug_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "debug_log_select_own_or_admin" ON public.debug_log;
CREATE POLICY "debug_log_select_own_or_admin"
  ON public.debug_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

NOTIFY pgrst, 'reload schema';
