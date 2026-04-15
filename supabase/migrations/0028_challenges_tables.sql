-- Retos globales (coaches, atletas, admin)
create table if not exists public.challenges (
  id bigserial primary key,
  title text not null,
  description text,
  challenge_type text not null,
  target_value numeric not null default 0,
  unit text,
  start_date date not null,
  end_date date not null,
  emoji text default '🏁',
  color text default '#a855f7',
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.challenge_participants (
  id bigserial primary key,
  challenge_id bigint not null references public.challenges(id) on delete cascade,
  user_id uuid,
  athlete_id bigint,
  joined_at timestamptz not null default now()
);

create unique index if not exists challenge_participants_unique_user
on public.challenge_participants (challenge_id, user_id, athlete_id);
