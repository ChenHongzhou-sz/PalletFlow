-- Phase 1 security hardening:
-- 1. Lock down direct table access for tables that are not queried by the browser.
-- 2. Enable RLS so Supabase Security Advisor stops flagging these public tables.
-- 3. Keep existing security-definer views and RPCs untouched to avoid breaking the live app.

revoke all on public.locations from public, anon, authenticated;
revoke all on public.material_aliases from public, anon, authenticated;

alter table public.locations enable row level security;
alter table public.material_aliases enable row level security;
