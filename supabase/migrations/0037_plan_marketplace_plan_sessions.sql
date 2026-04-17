-- Sesiones completas del plan (p. ej. 8 semanas); preview_workouts puede ser muestra corta.
ALTER TABLE public.plan_marketplace
  ADD COLUMN IF NOT EXISTS plan_sessions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.plan_marketplace.plan_sessions IS 'Todas las sesiones/semanas del plan; preview_workouts suele ser muestra (1–2 semanas).';
