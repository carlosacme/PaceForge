-- Ejecutar en Supabase SQL Editor DESPUÉS de aplicar la migración 0038_challenges_recurring.sql
-- Marca como recurrentes mensuales hasta 12 retos (los más recientes por created_at).

update public.challenges c
set
  is_recurring = true,
  recurrence = 'monthly'
from (
  select id
  from public.challenges
  where coalesce(is_active, true) = true
  order by created_at desc nulls last, id desc
  limit 12
) t
where c.id = t.id;
