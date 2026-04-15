create table if not exists public.plan_marketplace (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null,
  coach_name text,
  title text not null,
  description text,
  level text default 'intermedio',
  duration_weeks integer default 8,
  sessions_per_week integer default 4,
  price_cop integer default 0,
  preview_workouts jsonb default '[]'::jsonb,
  is_active boolean default true,
  is_approved boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.plan_purchases (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.plan_marketplace(id) on delete cascade,
  buyer_user_id uuid,
  buyer_name text,
  plan_title text,
  amount_cop integer default 0,
  payment_status text default 'pending',
  rating numeric,
  created_at timestamptz default now()
);

create index if not exists idx_plan_marketplace_active_approved
  on public.plan_marketplace(is_active, is_approved, created_at desc);

create index if not exists idx_plan_marketplace_coach
  on public.plan_marketplace(coach_user_id, created_at desc);

create index if not exists idx_plan_purchases_plan
  on public.plan_purchases(plan_id, payment_status, created_at desc);
