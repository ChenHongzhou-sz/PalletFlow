# Supabase And GitHub Setup

This project is deployed as a static GitHub Pages site, so Supabase connection values must be injected during the GitHub Actions build.

## 1. What You Need From Supabase

From your Supabase project settings, prepare:

- `Project URL`
- `anon public key`

Use the `anon` key only.

Do not use:

- `service_role`
- database password
- JWT secret

## 2. What To Set In GitHub

Open:

- `Repository > Settings > Secrets and variables > Actions`

Create these repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The GitHub Pages workflow already reads exactly these two names.

## 3. What To Run In Supabase

Run these SQL files in order:

1. `supabase/migrations/0001_init_schema.sql`
2. `supabase/migrations/0002_inventory_transactions.sql`
3. `supabase/migrations/0003_master_data_import.sql`
4. `supabase/migrations/0004_api_access.sql`

Then optionally run:

- `supabase/seed/0001_seed_main_warehouse.sql`

## 4. Why 0004 Matters

`0004_api_access.sql` is the GitHub Pages compatibility layer for Supabase.

It does three things:

- exposes only the views and RPCs that the browser app needs
- grants `anon` / `authenticated` access only to those safe entry points
- makes write RPCs run as `security definer`, so the browser does not need raw table write permissions

## 5. Current V1 Access Model

V1 is currently prepared for internal warehouse use without a full login flow.

That means:

- the browser connects with the Supabase `anon` key
- reads happen through views
- writes happen through controlled RPC functions

This is suitable for internal rollout and testing.

If you later want:

- multiple users
- per-user permissions
- audit by real account

then we should move V2 to Supabase Auth plus RLS by user role.

## 6. After Secrets Are Added

Do either of these:

- push a new commit
- or open `Actions` and rerun `Deploy PalletFlow Web`

Then verify:

- GitHub Actions workflow is green
- `https://chenhongzhou-sz.github.io/PalletFlow/` opens
- the yellow config notice disappears
