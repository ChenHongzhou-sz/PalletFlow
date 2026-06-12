# PalletFlow

PalletFlow is a mobile-first warehouse pallet management system for electronic components.

This repository currently contains the phase-one delivery requested in the PRD:

- system architecture
- database ER design
- page flow design
- PostgreSQL / Supabase schema SQL
- proposed project directory structure
- mobile wireframe prototypes

## Phase-One Deliverables

- [Architecture](./docs/phase-1/architecture.md)
- [Database ER](./docs/phase-1/database-er.md)
- [Page Flow](./docs/phase-1/page-flow.md)
- [Project Structure](./docs/phase-1/project-structure.md)
- [Prototypes](./docs/phase-1/prototypes.md)
- [Excel Import Spec](./docs/phase-1/excel-import.md)
- [Supabase + GitHub Setup](./docs/supabase-github-setup.md)
- [Initial Schema SQL](./supabase/migrations/0001_init_schema.sql)

## Current Source Tree

Implementation work is already started in these folders:

- `apps/web`
- `supabase/migrations`
- `supabase/seed`
- `templates`

## Current App Scope

The current code scaffold already includes:

- mobile-first PWA shell
- home screen with lookup-first hierarchy
- material search page
- pallet search page
- inbound page
- outbound page
- cycle count page
- operation log page
- master data import page with CSV / Excel pre-validation
- recent import history panel
- Supabase client and service layer wiring
- service worker and manifest

## Setup Notes

Before running the web app, create `apps/web/.env` from `.env.example` and fill:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_BASE_PATH`

Recommended default:

- `VITE_APP_BASE_PATH=/`

For GitHub Pages on `ChenHongzhou-sz/PalletFlow`, the deployment workflow already injects:

- `VITE_APP_BASE_PATH=/PalletFlow/`

For GitHub Actions deployment, add these repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

And run the Supabase migrations through:

- `0001_init_schema.sql`
- `0002_inventory_transactions.sql`
- `0003_master_data_import.sql`
- `0004_api_access.sql`

## Product Direction

This is designed for real warehouse operations rather than a demo back office.

- Mobile-first, thumb-friendly, large targets
- Material search and pallet search are the most prominent entry points
- Inbound and outbound flows must stay within three steps
- All stock changes must be traceable
- FIFO is based on production month, not data entry time
- The system does not replace ERP inventory in Kingdee K3

## Master Data Import

V1 supports Excel import for master data maintained outside the app.

- Material master data can be imported from Excel
- Barcode alias data can be imported from Excel
- Import should use template-based validation to reduce bad data in production
- Inventory batches and operation logs should not be bulk-overwritten from browser-side Excel files without controlled workflows

Recommended import columns for material master data:

- `material_code`
- `short_code`
- `description`
- `category`
- `specification`
- `image_url`

Recommended import columns for barcode alias data:

- `barcode`
- `material_code`
- `remark`

Current importer also accepts common Chinese headers from existing warehouse spreadsheets:

- `物料型号 -> material_code`
- `物料代码 -> short_code`
- `物料描述 -> description`
- `条码 -> barcode`
- `备注 -> remark`

Current implementation status:

- browser page already supports CSV and Excel template upload
- database RPCs already support bulk material and barcode upsert
- recent import runs can be queried from the app
- `.xlsx` template remains the recommended maintenance format

## Data Persistence

Original business data must not depend on browser local storage.

- Official data source: Supabase PostgreSQL
- Browser storage: only for app shell cache, recent searches, and temporary draft forms
- If the browser is reset, official data remains in the database
- At worst, local drafts and cached pages are cleared, but inventory, materials, and logs stay intact

## Notes Before Coding

One important product decision still needs confirmation before implementation starts:

- V1 access model: shared account, Supabase Auth login, or internal network open access

The schema already reserves V2-ready fields such as `warehouse_id`, `created_by`, `updated_by`, and `metadata`.
