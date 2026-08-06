-- EJECUTAR MANUALMENTE en el SQL Editor de Supabase.
-- NO es una migracion: toca datos concretos de produccion, no el esquema.
-- Requisito: aplicar antes las migraciones 0050 y 0051.

-- ---------------------------------------------------------------------------
-- 1) Compra fantasma: se confirmo a mano pero su pago en Wompi sigue PENDING.
--    Revisar primero, luego ejecutar el UPDATE.
-- ---------------------------------------------------------------------------
SELECT
  pp.id,
  pp.payment_status,
  pp.price_paid,
  pp.confirmed_at,
  pp.confirmed_by,
  pp.created_at,
  sp.wompi_status,
  sp.wompi_reference
FROM public.plan_purchases pp
LEFT JOIN public.subscription_payments sp
  ON sp.marketplace_purchase_id = pp.id
WHERE pp.id = 'e44b92ad-cd12-47d3-b76c-a985c385e581';

UPDATE public.plan_purchases
SET payment_status = 'declined',
    confirmed_at = NULL,
    confirmed_by = NULL,
    confirmed_source = NULL
WHERE id = 'e44b92ad-cd12-47d3-b76c-a985c385e581';

-- ---------------------------------------------------------------------------
-- 2) Pagos huerfanos: apuntan a una compra que ya no existe.
--    Solo REPORTE, para revision manual. No borra nada.
-- ---------------------------------------------------------------------------
SELECT
  sp.id AS subscription_payment_id,
  sp.marketplace_purchase_id,
  sp.payer_user_id,
  sp.amount_cop,
  sp.wompi_status,
  sp.wompi_reference,
  sp.created_at
FROM public.subscription_payments sp
WHERE sp.marketplace_purchase_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.plan_purchases pp WHERE pp.id = sp.marketplace_purchase_id
  )
ORDER BY sp.created_at DESC;

-- ---------------------------------------------------------------------------
-- 3) Opcional: normalizar el estado legado 'pending' al nuevo 'initiated'
--    y caducar de una vez las compras abandonadas de mas de 24h.
-- ---------------------------------------------------------------------------
-- UPDATE public.plan_purchases SET payment_status = 'initiated' WHERE payment_status = 'pending';
-- SELECT public.expire_stale_purchases();
