-- Fecha de vencimiento de suscripción coach (admin / app)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;
