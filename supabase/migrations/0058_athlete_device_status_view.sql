-- Estado de dispositivos visible para el coach, SIN exponer credenciales.
--
-- Hoy device_connections tiene una sola policy: "atleta gestiona su conexion"
-- (athletes.user_id = auth.uid()). El coach no puede leer nada, asi que la
-- lista de atletas no sabe quien tiene intervals.icu conectado.
--
-- No se anade una policy de SELECT para el coach sobre la tabla: ahi viven
-- api_key, access_token y refresh_token, y darle SELECT al coach le entrega
-- los tokens de sus atletas al navegador. En su lugar esta vista expone solo
-- el estado (provider, status, last_pull_at) y filtra por dueno: el propio
-- atleta, su coach, el staff asignado a ese atleta, o un admin.
--
-- security_invoker = false (SECURITY DEFINER, el modo por defecto de las
-- vistas): la vista salta la RLS de device_connections, por eso el filtro de
-- permisos va explicito en el WHERE.

CREATE OR REPLACE VIEW public.athlete_device_status
WITH (security_invoker = false) AS
SELECT
  dc.athlete_id,
  dc.provider,
  dc.status,
  dc.last_pull_at
FROM public.device_connections dc
JOIN public.athletes a ON a.id = dc.athlete_id
WHERE a.user_id = auth.uid()
   OR a.coach_id = auth.uid()
   OR EXISTS (
     SELECT 1
     FROM public.staff_athletes sa
     WHERE sa.athlete_id = dc.athlete_id
       AND sa.staff_id = auth.uid()
   )
   OR public.is_admin();

REVOKE ALL ON public.athlete_device_status FROM anon;
GRANT SELECT ON public.athlete_device_status TO authenticated;

NOTIFY pgrst, 'reload schema';
