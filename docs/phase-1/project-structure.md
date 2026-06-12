# Proposed Project Structure

This structure keeps product code, database logic, and operational documents clearly separated while staying small enough for a first release.

```text
PalletFlow/
├─ README.md
├─ docs/
│  └─ phase-1/
│     ├─ architecture.md
│     ├─ database-er.md
│     ├─ page-flow.md
│     ├─ project-structure.md
│     ├─ prototypes.md
│     └─ mobile-wireframes.svg
├─ apps/
│  └─ web/
│     ├─ public/
│     │  ├─ manifest.webmanifest
│     │  ├─ icons/
│     │  └─ offline.html
│     ├─ src/
│     │  ├─ app/
│     │  │  ├─ router/
│     │  │  ├─ layouts/
│     │  │  └─ providers/
│     │  ├─ components/
│     │  │  ├─ mobile/
│     │  │  ├─ scanner/
│     │  │  ├─ forms/
│     │  │  └─ feedback/
│     │  ├─ features/
│     │  │  ├─ home/
│     │  │  ├─ material-search/
│     │  │  ├─ pallet-search/
│     │  │  ├─ inbound/
│     │  │  ├─ outbound/
│     │  │  ├─ cycle-count/
│     │  │  └─ operation-log/
│     │  ├─ lib/
│     │  │  ├─ api/
│     │  │  ├─ formatters/
│     │  │  ├─ validators/
│     │  │  └─ constants/
│     │  ├─ services/
│     │  │  ├─ supabase/
│     │  │  ├─ search/
│     │  │  ├─ inventory/
│     │  │  └─ export/
│     │  ├─ store/
│     │  ├─ styles/
│     │  ├─ types/
│     │  └─ workers/
│     ├─ tests/
│     │  ├─ unit/
│     │  └─ e2e/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ tailwind.config.ts
│     └─ vite.config.ts
├─ supabase/
│  ├─ migrations/
│  │  └─ 0001_init_schema.sql
│  ├─ seed/
│  │  └─ 0001_seed_main_warehouse.sql
│  └─ functions/
│     ├─ import-master-data/
│     └─ export-inventory/
├─ scripts/
│  ├─ generate-import-template/
│  └─ verify-search-performance/
└─ .github/
   └─ workflows/
      ├─ deploy-pages.yml
      └─ validate-sql.yml
```

## Structure Rationale

- `apps/web`: the installable PWA frontend
- `supabase/migrations`: schema and database logic evolution
- `supabase/functions`: future-safe place for import/export or protected server-side workflows
- `docs/phase-1`: signed-off product and architecture baseline
- `scripts`: utilities that do not belong in the runtime app

## Frontend Feature Boundaries

Keep screens by user task, not by technical layer:

- `material-search`
- `pallet-search`
- `inbound`
- `outbound`
- `cycle-count`
- `operation-log`

That reduces cross-feature coupling and keeps the warehouse workflows easy to evolve.
