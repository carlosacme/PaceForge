-- RLS de plan_purchases: solo el admin puede hacer UPDATE.
--
-- La politica anterior ("Coach/admin confirma compra") usaba
-- USING (coach_id = auth.uid() OR is_admin()) sin WITH CHECK y sin limitar
-- columnas, asi que un coach podia editar price_paid, platform_fee o
-- coach_earnings de sus propias ventas, ademas de confirmar pagos que Wompi
-- nunca aprobo.
--
-- El webhook confirma con la service_role key, que se salta RLS, asi que no
-- necesita politica.

DROP POLICY IF EXISTS "Coach/admin confirma compra" ON public.plan_purchases;

CREATE POLICY "Solo admin actualiza compras"
  ON public.plan_purchases
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- SELECT sin cambios: comprador, coach dueno del plan y admin.
-- INSERT sin cambios: el comprador crea su propia fila.

-- El admin necesita ver el estado real del pago en Wompi antes de confirmar a
-- mano. Hasta ahora subscription_payments solo era visible para el pagador.
DROP POLICY IF EXISTS "admin_view_all_payments" ON public.subscription_payments;

CREATE POLICY "admin_view_all_payments"
  ON public.subscription_payments
  FOR SELECT
  USING (is_admin());
