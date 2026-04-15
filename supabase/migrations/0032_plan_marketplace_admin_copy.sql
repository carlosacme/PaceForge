-- Copias admin de planes marketplace + coach_id alineado con coach_user_id

ALTER TABLE public.plan_marketplace
  ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_admin_copy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_plan_id uuid REFERENCES public.plan_marketplace (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_marketplace_source_plan ON public.plan_marketplace (source_plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_marketplace_admin_copy ON public.plan_marketplace (is_admin_copy) WHERE is_admin_copy = true;
