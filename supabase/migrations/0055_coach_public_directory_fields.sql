-- Campos del directorio de coaches en la vista publica.
--
-- El directorio del atleta consultaba coach_profiles con is_public = true,
-- pero esa tabla solo la pueden leer el propio coach o el admin, asi que la
-- consulta devolvia siempre vacio. Igual que con la foto (0054), la salida es
-- exponer lo justo en coach_public, que corre con security_invoker = off.
--
-- Se anaden solo los datos que el atleta necesita para decidir a quien
-- contactar:
--   is_public  -> para filtrar; sin el, el directorio listaria a cualquier
--                 coach o admin de la plataforma, incluidos los que no quieren
--                 aparecer.
--   city       -> el atleta suele buscar a alguien de su ciudad.
--   country    -> distingue coaches homonimos y da contexto de zona horaria.
--   full_name  -> nombre que el coach edita en su configuracion; profiles.name
--                 es el del registro y a veces esta incompleto.
--
-- Fuera a proposito: email y phone (contacto directo, se pide despues de
-- conectar), subscription_* y trial_days (informacion comercial del coach, no
-- del servicio que ofrece) y approved_by_admin (estado interno de moderacion).

CREATE OR REPLACE VIEW public.coach_public
  WITH (security_invoker = off) AS
  SELECT
    p.user_id,
    p.coach_id,
    p.name,
    p.role,
    cp.avatar_url,
    COALESCE(cp.is_public, false) AS is_public,
    cp.city,
    cp.country,
    cp.full_name
  FROM public.profiles p
  LEFT JOIN public.coach_profiles cp ON cp.user_id = p.user_id
  WHERE p.role IN ('coach', 'admin');

REVOKE ALL ON public.coach_public FROM public;
GRANT SELECT ON public.coach_public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
