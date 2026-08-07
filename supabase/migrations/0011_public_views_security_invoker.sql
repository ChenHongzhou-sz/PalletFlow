-- Phase 2 security hardening:
-- Convert public read views from security definer to security invoker.
-- Keep the public app working by granting read-only column access plus RLS policies
-- on the exact base tables these views depend on.

revoke all on public.warehouses from public, anon, authenticated;
revoke all on public.pallets from public, anon, authenticated;
revoke all on public.materials from public, anon, authenticated;
revoke all on public.inventory_batches from public, anon, authenticated;
revoke all on public.stock_operations from public, anon, authenticated;
revoke all on public.stock_operation_lines from public, anon, authenticated;
revoke all on public.master_data_import_runs from public, anon, authenticated;

grant select (id, warehouse_code, warehouse_name, is_active, created_at)
  on public.warehouses to anon, authenticated;

grant select (
  id,
  warehouse_id,
  location_code,
  location_name,
  location_type,
  parent_location_id,
  status,
  is_pickable,
  is_temporary,
  created_at,
  deleted_at
)
  on public.locations to anon, authenticated;

grant select (id, warehouse_id, pallet_code, area, status, location_id, created_at, deleted_at)
  on public.pallets to anon, authenticated;

grant select (
  id,
  material_code,
  short_code,
  description,
  category,
  specification,
  is_active,
  created_at,
  updated_at,
  deleted_at
)
  on public.materials to anon, authenticated;

grant select (
  id,
  warehouse_id,
  pallet_id,
  material_id,
  initial_quantity,
  quantity,
  production_date,
  lot_no,
  box_barcode,
  batch_status,
  created_at,
  updated_at,
  location_id,
  closed_at,
  deleted_at,
  date_code,
  stock_form,
  received_at
)
  on public.inventory_batches to anon, authenticated;

grant select (id, warehouse_id, operation_type, source, requested_material_id, requested_quantity, operator_name, note, created_at)
  on public.stock_operations to anon, authenticated;

grant select (
  id,
  operation_id,
  line_no,
  batch_id,
  pallet_id,
  location_id,
  material_id,
  quantity_change,
  quantity_before,
  quantity_after,
  production_date,
  lot_no,
  box_barcode,
  remark,
  created_at
)
  on public.stock_operation_lines to anon, authenticated;

grant select (
  id,
  import_type,
  source_file_name,
  operator_name,
  processed_rows,
  created_rows,
  updated_rows,
  rejected_rows,
  created_at
)
  on public.master_data_import_runs to anon, authenticated;

alter table public.warehouses enable row level security;
alter table public.pallets enable row level security;
alter table public.materials enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.stock_operations enable row level security;
alter table public.stock_operation_lines enable row level security;
alter table public.master_data_import_runs enable row level security;

drop policy if exists "Public can read active warehouses" on public.warehouses;
create policy "Public can read active warehouses"
  on public.warehouses
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Public can read active locations" on public.locations;
create policy "Public can read active locations"
  on public.locations
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.warehouses w
      where w.id = warehouse_id
        and w.is_active = true
    )
  );

drop policy if exists "Public can read active pallets" on public.pallets;
create policy "Public can read active pallets"
  on public.pallets
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.warehouses w
      where w.id = warehouse_id
        and w.is_active = true
    )
  );

drop policy if exists "Public can read active materials" on public.materials;
create policy "Public can read active materials"
  on public.materials
  for select
  to anon, authenticated
  using (deleted_at is null);

drop policy if exists "Public can read active inventory batches" on public.inventory_batches;
create policy "Public can read active inventory batches"
  on public.inventory_batches
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and quantity > 0
    and exists (
      select 1
      from public.warehouses w
      where w.id = warehouse_id
        and w.is_active = true
    )
  );

drop policy if exists "Public can read stock operations" on public.stock_operations;
create policy "Public can read stock operations"
  on public.stock_operations
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.warehouses w
      where w.id = warehouse_id
        and w.is_active = true
    )
  );

drop policy if exists "Public can read stock operation lines" on public.stock_operation_lines;
create policy "Public can read stock operation lines"
  on public.stock_operation_lines
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can read import history" on public.master_data_import_runs;
create policy "Public can read import history"
  on public.master_data_import_runs
  for select
  to anon, authenticated
  using (true);

alter view public.v_master_data_import_runs set (security_invoker = true);
alter view public.v_pallet_lookup set (security_invoker = true);
alter view public.v_current_inventory_batches set (security_invoker = true);
alter view public.v_material_inventory_summary set (security_invoker = true);
alter view public.v_operation_log_lines set (security_invoker = true);
alter view public.v_inventory_export_rows set (security_invoker = true);
alter view public.v_location_lookup set (security_invoker = true);
