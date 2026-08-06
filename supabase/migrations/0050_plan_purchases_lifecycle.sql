-- Ciclo de vida de las compras del marketplace.
--
-- Estados:
--   initiated -> fila creada, el usuario todavia no ha pagado
--   confirmed -> pago APROBADO en Wompi (webhook) o confirmado a mano por admin
--   declined  -> Wompi devolvio DECLINED / VOIDED / ERROR
--   expired   -> mas de 24h en 'initiated' sin resolucion
-- Se mantienen 'pending' y 'rejected' como valores legados para no romper
-- las filas historicas creadas antes de esta migracion.
--
-- confirmed_by es uuid (id del admin que confirma a mano), por eso la
-- procedencia va en confirmed_source: 'wompi_webhook' | 'admin_manual'.

ALTER TABLE public.plan_purchases
  DROP CONSTRAINT IF EXISTS plan_purchases_payment_status_check;

ALTER TABLE public.plan_purchases
  ADD CONSTRAINT plan_purchases_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'initiated'::text,
    'confirmed'::text,
    'declined'::text,
    'expired'::text,
    'pending'::text,
    'rejected'::text
  ]));

ALTER TABLE public.plan_purchases
  ADD COLUMN IF NOT EXISTS confirmed_source text;

COMMENT ON COLUMN public.plan_purchases.payment_status IS
  'initiated | confirmed | declined | expired (pending/rejected son legados).';
COMMENT ON COLUMN public.plan_purchases.confirmed_source IS
  'Quien confirmo el pago: wompi_webhook | admin_manual.';

CREATE INDEX IF NOT EXISTS idx_plan_purchases_status_created
  ON public.plan_purchases (payment_status, created_at DESC);

-- Caduca las compras que nunca llegaron a pagarse. Sin esto, abandonar el
-- checkout dejaba la fila visible para siempre en "compras pendientes".
CREATE OR REPLACE FUNCTION public.expire_stale_purchases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.plan_purchases
    SET payment_status = 'expired'
    WHERE payment_status IN ('initiated', 'pending')
      AND created_at < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_purchases() IS
  'Marca como expired las compras en initiated con mas de 24h. Programada via pg_cron.';

-- Idempotente: quita el job previo si existe y lo vuelve a crear.
DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-purchases');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'expire-stale-purchases',
  '30 5 * * *',
  $$SELECT public.expire_stale_purchases()$$
);
