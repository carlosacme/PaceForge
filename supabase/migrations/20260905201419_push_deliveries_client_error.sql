-- El cliente registra el hueco que el servidor no ve: fetch que nunca llega
-- a /api/send-push (red, timeout, abort). No puede escribir sent ni otros
-- estados: WITH CHECK limita a client_error y a su propio from_user_id.

ALTER TABLE public.push_deliveries
  DROP CONSTRAINT IF EXISTS push_deliveries_status_check;

ALTER TABLE public.push_deliveries
  ADD CONSTRAINT push_deliveries_status_check
  CHECK (status = ANY (ARRAY[
    'sent'::text,
    'no_token'::text,
    'rejected'::text,
    'error'::text,
    'client_error'::text
  ]));

DROP POLICY IF EXISTS "push_deliveries_insert_client_error" ON public.push_deliveries;
CREATE POLICY "push_deliveries_insert_client_error"
  ON public.push_deliveries FOR INSERT
  TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND status = 'client_error'
  );

NOTIFY pgrst, 'reload schema';
