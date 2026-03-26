-- Add the "plan" column to athletes if it doesn't exist yet.
-- Run this migration in Supabase SQL Editor (or via Supabase migrations).

alter table public.athletes
add column if not exists plan text;

