create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  location_code text not null,
  location_name text not null,
  location_type text not null
    check (location_type in ('FIXED_PALLET', 'MOBILE_PALLET', 'OPEN_STOCK_SHELF', 'OPEN_STOCK_BIN', 'RECEIVING', 'SHIPPING', 'OTHER')),
  parent_location_id uuid references public.locations(id),
  status text not null default 'active'
    check (status in ('active', 'locked', 'disabled')),
  barcode text,
  is_pickable boolean not null default true,
  is_temporary boolean not null default false,
  sort_order integer not null default 0,
  remark text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint locations_warehouse_code_uk unique (warehouse_id, location_code)
);

create index if not exists locations_lookup_idx
  on public.locations (warehouse_id, location_code)
  where deleted_at is null;

create index if not exists locations_parent_idx
  on public.locations (parent_location_id)
  where parent_location_id is not null and deleted_at is null;

drop trigger if exists locations_set_updated_at on public.locations;
create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

alter table public.pallets
  add column if not exists location_id uuid references public.locations(id);

alter table public.inventory_batches
  add column if not exists location_id uuid references public.locations(id);

alter table public.stock_operation_lines
  add column if not exists location_id uuid references public.locations(id);

alter table public.inventory_counts
  add column if not exists location_id uuid references public.locations(id);

alter table public.inventory_count_items
  add column if not exists location_id uuid references public.locations(id);

alter table public.inventory_batches
  alter column pallet_id drop not null;

alter table public.stock_operation_lines
  alter column pallet_id drop not null;

alter table public.inventory_counts
  alter column pallet_id drop not null;

alter table public.inventory_count_items
  alter column pallet_id drop not null;

with main_warehouse as (
  select id
  from public.warehouses
  where warehouse_code = 'MAIN'
  limit 1
),
seed_rows(location_code, location_name, location_type, is_pickable, is_temporary, sort_order) as (
  values
    ('P01', 'Fixed Pallet P01', 'FIXED_PALLET', true, false, 10),
    ('P02', 'Fixed Pallet P02', 'FIXED_PALLET', true, false, 20),
    ('P03', 'Fixed Pallet P03', 'FIXED_PALLET', true, false, 30),
    ('P04', 'Fixed Pallet P04', 'FIXED_PALLET', true, false, 40),
    ('P05', 'Fixed Pallet P05', 'FIXED_PALLET', true, false, 50),
    ('P06', 'Fixed Pallet P06', 'FIXED_PALLET', true, false, 60),
    ('M01', 'Mobile Pallet M01', 'MOBILE_PALLET', true, true, 70),
    ('M02', 'Mobile Pallet M02', 'MOBILE_PALLET', true, true, 80),
    ('S01', 'Open Stock Shelf S01', 'OPEN_STOCK_SHELF', true, false, 110),
    ('S02', 'Open Stock Shelf S02', 'OPEN_STOCK_SHELF', true, false, 120),
    ('S03', 'Open Stock Shelf S03', 'OPEN_STOCK_SHELF', true, false, 130),
    ('S04', 'Open Stock Shelf S04', 'OPEN_STOCK_SHELF', true, false, 140),
    ('S05', 'Open Stock Shelf S05', 'OPEN_STOCK_SHELF', true, false, 150),
    ('S06', 'Open Stock Shelf S06', 'OPEN_STOCK_SHELF', true, false, 160),
    ('S07', 'Open Stock Shelf S07', 'OPEN_STOCK_SHELF', true, false, 170),
    ('S08', 'Open Stock Shelf S08', 'OPEN_STOCK_SHELF', true, false, 180),
    ('IN-01', 'Receiving Staging IN-01', 'RECEIVING', false, true, 210),
    ('OUT-01', 'Shipping Staging OUT-01', 'SHIPPING', false, true, 220)
)
insert into public.locations (
  warehouse_id,
  location_code,
  location_name,
  location_type,
  status,
  is_pickable,
  is_temporary,
  sort_order
)
select
  w.id,
  s.location_code,
  s.location_name,
  s.location_type,
  'active',
  s.is_pickable,
  s.is_temporary,
  s.sort_order
from seed_rows s
cross join main_warehouse w
on conflict (warehouse_id, location_code)
do update set
  location_name = excluded.location_name,
  location_type = excluded.location_type,
  status = 'active',
  is_pickable = excluded.is_pickable,
  is_temporary = excluded.is_temporary,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());

insert into public.locations (
  warehouse_id,
  location_code,
  location_name,
  location_type,
  status,
  is_pickable,
  is_temporary,
  sort_order,
  metadata
)
select
  p.warehouse_id,
  p.pallet_code,
  coalesce(nullif(trim(coalesce(p.area, '')), ''), p.pallet_code),
  case
    when p.pallet_code ~ '^P[0-9]{2,}$' then 'FIXED_PALLET'
    when p.pallet_code ~ '^M[0-9]{2,}$' then 'MOBILE_PALLET'
    else 'OTHER'
  end,
  case when p.deleted_at is null then 'active' else 'disabled' end,
  true,
  case when p.pallet_code ~ '^M[0-9]{2,}$' then true else false end,
  1000,
  jsonb_strip_nulls(
    jsonb_build_object(
      'legacy_pallet_id', p.id,
      'legacy_pallet_area', p.area
    )
  )
from public.pallets p
left join public.locations l
  on l.warehouse_id = p.warehouse_id
 and l.location_code = p.pallet_code
where l.id is null;

update public.pallets p
set location_id = l.id
from public.locations l
where l.warehouse_id = p.warehouse_id
  and l.location_code = p.pallet_code
  and (p.location_id is null or p.location_id <> l.id);

alter table public.pallets
  alter column location_id set not null;

create unique index if not exists pallets_location_id_uk
  on public.pallets (location_id);

update public.inventory_batches ib
set location_id = p.location_id
from public.pallets p
where ib.pallet_id = p.id
  and ib.location_id is null;

alter table public.inventory_batches
  alter column location_id set not null;

update public.stock_operation_lines sol
set location_id = source.location_id
from (
  select
    sol_inner.id,
    coalesce(ib.location_id, p.location_id) as location_id
  from public.stock_operation_lines sol_inner
  left join public.inventory_batches ib on ib.id = sol_inner.batch_id
  left join public.pallets p on p.id = sol_inner.pallet_id
) source
where source.id = sol.id
  and source.location_id is not null
  and sol.location_id is null;

alter table public.stock_operation_lines
  alter column location_id set not null;

update public.inventory_counts ic
set location_id = p.location_id
from public.pallets p
where ic.pallet_id = p.id
  and ic.location_id is null;

alter table public.inventory_counts
  alter column location_id set not null;

update public.inventory_count_items ici
set location_id = source.location_id
from (
  select
    ici_inner.id,
    coalesce(ib.location_id, ic.location_id, p.location_id) as location_id
  from public.inventory_count_items ici_inner
  left join public.inventory_batches ib on ib.id = ici_inner.batch_id
  left join public.inventory_counts ic on ic.id = ici_inner.count_id
  left join public.pallets p on p.id = ici_inner.pallet_id
) source
where source.id = ici.id
  and source.location_id is not null
  and ici.location_id is null;

alter table public.inventory_count_items
  alter column location_id set not null;

create index if not exists inventory_batches_location_idx
  on public.inventory_batches (location_id, production_date, created_at)
  where deleted_at is null and quantity > 0;

create index if not exists stock_operation_lines_location_idx
  on public.stock_operation_lines (location_id, created_at desc);

create index if not exists inventory_counts_location_idx
  on public.inventory_counts (location_id, created_at desc);

create or replace view public.v_location_lookup as
select
  l.id as location_id,
  w.warehouse_code,
  l.location_code,
  l.location_name,
  l.location_type,
  parent.location_code as parent_location_code,
  l.status,
  l.is_pickable,
  l.is_temporary,
  l.created_at,
  coalesce(count(ib.id), 0)::integer as active_batch_count
from public.locations l
join public.warehouses w on w.id = l.warehouse_id
left join public.locations parent on parent.id = l.parent_location_id
left join public.inventory_batches ib
  on ib.location_id = l.id
 and ib.deleted_at is null
 and ib.quantity > 0
where l.deleted_at is null
  and w.is_active = true
group by
  l.id,
  w.warehouse_code,
  l.location_code,
  l.location_name,
  l.location_type,
  parent.location_code,
  l.status,
  l.is_pickable,
  l.is_temporary,
  l.created_at;

create or replace view public.v_pallet_lookup as
select
  location_id as pallet_id,
  warehouse_code,
  location_code as pallet_code,
  location_name as pallet_area,
  status,
  created_at,
  active_batch_count
from public.v_location_lookup;

create or replace view public.v_current_inventory_batches as
select
  ib.id as batch_id,
  w.warehouse_code,
  coalesce(p.pallet_code, l.location_code) as pallet_code,
  m.material_code,
  m.short_code,
  m.description,
  m.category,
  m.specification,
  ib.quantity,
  ib.initial_quantity,
  ib.production_date,
  ib.lot_no,
  ib.box_barcode,
  ib.batch_status,
  ib.created_at,
  ib.updated_at,
  ib.location_id,
  l.location_code,
  l.location_name,
  l.location_type,
  parent.location_code as parent_location_code,
  ib.pallet_id,
  coalesce(p.area, l.location_name) as pallet_area
from public.inventory_batches ib
join public.warehouses w on w.id = ib.warehouse_id
join public.locations l on l.id = ib.location_id
left join public.locations parent on parent.id = l.parent_location_id
left join public.pallets p on p.id = ib.pallet_id
join public.materials m on m.id = ib.material_id
where ib.deleted_at is null
  and ib.quantity > 0;

create or replace view public.v_material_inventory_summary as
select
  ib.material_id,
  m.material_code,
  m.short_code,
  m.description,
  m.category,
  m.specification,
  sum(ib.quantity) as total_quantity,
  count(distinct ib.location_id) as pallet_count,
  min(ib.production_date) as earliest_production_date,
  max(ib.production_date) as latest_production_date,
  count(distinct ib.location_id) as location_count
from public.inventory_batches ib
join public.materials m on m.id = ib.material_id
where ib.deleted_at is null
  and ib.quantity > 0
group by
  ib.material_id,
  m.material_code,
  m.short_code,
  m.description,
  m.category,
  m.specification;

create or replace view public.v_operation_log_lines as
select
  so.id as operation_id,
  so.operation_type,
  so.created_at,
  so.operator_name,
  so.note as operation_note,
  w.warehouse_code,
  coalesce(p.pallet_code, l.location_code) as pallet_code,
  m.material_code,
  m.short_code,
  m.description,
  sol.line_no,
  sol.quantity_change,
  sol.quantity_before,
  sol.quantity_after,
  sol.production_date,
  sol.lot_no,
  sol.box_barcode,
  sol.remark as line_remark,
  sol.location_id,
  l.location_code,
  l.location_name,
  l.location_type,
  parent.location_code as parent_location_code,
  sol.pallet_id
from public.stock_operation_lines sol
join public.stock_operations so on so.id = sol.operation_id
join public.locations l on l.id = sol.location_id
left join public.locations parent on parent.id = l.parent_location_id
left join public.pallets p on p.id = sol.pallet_id
join public.warehouses w on w.id = so.warehouse_id
join public.materials m on m.id = sol.material_id;

create or replace view public.v_inventory_export_rows as
select
  ib.id as batch_id,
  w.warehouse_code,
  coalesce(p.pallet_code, l.location_code) as pallet_code,
  coalesce(p.area, l.location_name) as pallet_area,
  m.material_code,
  m.short_code,
  m.description,
  m.category,
  m.specification,
  ib.quantity,
  ib.initial_quantity,
  ib.production_date,
  ib.lot_no,
  ib.box_barcode,
  ib.created_at as inbound_at,
  ib.updated_at as last_updated_at,
  ib.location_id,
  l.location_code,
  l.location_name,
  l.location_type,
  parent.location_code as parent_location_code
from public.inventory_batches ib
join public.warehouses w on w.id = ib.warehouse_id
join public.locations l on l.id = ib.location_id
left join public.locations parent on parent.id = l.parent_location_id
left join public.pallets p on p.id = ib.pallet_id
join public.materials m on m.id = ib.material_id
where ib.deleted_at is null
  and ib.quantity > 0;

create or replace function public.get_fifo_suggestions(
  p_material_id uuid,
  p_requested_qty numeric
)
returns table (
  batch_id uuid,
  pallet_id uuid,
  pallet_code text,
  available_quantity numeric,
  production_date date,
  lot_no text,
  box_barcode text,
  suggested_quantity numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
with ordered_batches as (
  select
    ib.id as batch_id,
    ib.location_id as pallet_id,
    l.location_code as pallet_code,
    ib.quantity as available_quantity,
    ib.production_date,
    ib.lot_no,
    ib.box_barcode,
    ib.created_at,
    coalesce(
      sum(ib.quantity) over (
        order by ib.production_date, ib.created_at, ib.id
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as prior_quantity
  from public.inventory_batches ib
  join public.locations l on l.id = ib.location_id
  where ib.material_id = p_material_id
    and ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0
  order by ib.production_date, ib.created_at, ib.id
)
select
  batch_id,
  pallet_id,
  pallet_code,
  available_quantity,
  production_date,
  lot_no,
  box_barcode,
  least(available_quantity, greatest(coalesce(p_requested_qty, 0) - prior_quantity, 0)) as suggested_quantity
from ordered_batches
where least(available_quantity, greatest(coalesce(p_requested_qty, 0) - prior_quantity, 0)) > 0
order by production_date, created_at, batch_id;
$$;

create or replace function public.create_inbound_batch(
  p_pallet_code text,
  p_material_code text,
  p_quantity numeric,
  p_production_date date,
  p_warehouse_code text default 'MAIN',
  p_lot_no text default null,
  p_box_barcode text default null,
  p_operator_name text default null,
  p_note text default null,
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_warehouse_id uuid;
  v_pallet_id uuid;
  v_location_id uuid;
  v_material_id uuid;
  v_operation_id uuid;
  v_batch_id uuid;
  v_location_code text;
  v_location_name text;
  v_location_type text;
  v_parent_location_id uuid;
  v_production_date date;
begin
  if p_pallet_code is null or trim(p_pallet_code) = '' then
    raise exception 'Location code is required.';
  end if;

  if p_material_code is null or trim(p_material_code) = '' then
    raise exception 'Material code is required.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Inbound quantity must be greater than zero.';
  end if;

  if p_production_date is null then
    raise exception 'Production date is required.';
  end if;

  v_location_code := upper(trim(p_pallet_code));
  v_production_date := date_trunc('month', p_production_date)::date;

  select id
    into v_warehouse_id
  from public.warehouses
  where warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and is_active = true
  limit 1;

  if v_warehouse_id is null then
    raise exception 'Warehouse % does not exist or is inactive.', coalesce(p_warehouse_code, 'MAIN');
  end if;

  select id
    into v_material_id
  from public.materials
  where lower(material_code) = lower(trim(p_material_code))
    and deleted_at is null
    and is_active = true
  limit 1;

  if v_material_id is null then
    raise exception 'Material % does not exist in active master data.', p_material_code;
  end if;

  select
    l.id,
    l.location_name,
    l.location_type
    into v_location_id,
    v_location_name,
    v_location_type
  from public.locations l
  where l.warehouse_id = v_warehouse_id
    and l.location_code = v_location_code
    and l.deleted_at is null
  limit 1;

  if v_location_id is null then
    if v_location_code ~ '^S[0-9]{2,}-[0-9]{2,}$' then
      select id
        into v_parent_location_id
      from public.locations
      where warehouse_id = v_warehouse_id
        and location_code = split_part(v_location_code, '-', 1)
        and deleted_at is null
      limit 1;
    end if;

    v_location_type := case
      when v_location_code ~ '^P[0-9]{2,}$' then 'FIXED_PALLET'
      when v_location_code ~ '^M[0-9]{2,}$' then 'MOBILE_PALLET'
      when v_location_code ~ '^S[0-9]{2,}-[0-9]{2,}$' then 'OPEN_STOCK_BIN'
      when v_location_code ~ '^S[0-9]{2,}$' then 'OPEN_STOCK_SHELF'
      when v_location_code like 'IN-%' then 'RECEIVING'
      when v_location_code like 'OUT-%' then 'SHIPPING'
      else 'OTHER'
    end;
    v_location_name := v_location_code;

    insert into public.locations (
      warehouse_id,
      location_code,
      location_name,
      location_type,
      parent_location_id,
      status,
      is_pickable,
      is_temporary,
      sort_order
    )
    values (
      v_warehouse_id,
      v_location_code,
      v_location_name,
      v_location_type,
      v_parent_location_id,
      'active',
      case when v_location_type in ('RECEIVING', 'SHIPPING') then false else true end,
      case when v_location_type in ('MOBILE_PALLET', 'RECEIVING', 'SHIPPING') then true else false end,
      1000
    )
    returning id into v_location_id;
  end if;

  if v_location_type in ('FIXED_PALLET', 'MOBILE_PALLET') then
    insert into public.pallets (warehouse_id, pallet_code, status, location_id)
    values (v_warehouse_id, v_location_code, 'active', v_location_id)
    on conflict (warehouse_id, pallet_code)
    do update set
      status = 'active',
      location_id = excluded.location_id,
      updated_at = timezone('utc', now())
    returning id into v_pallet_id;
  else
    select id
      into v_pallet_id
    from public.pallets
    where location_id = v_location_id
    limit 1;
  end if;

  insert into public.stock_operations (
    warehouse_id,
    operation_type,
    source,
    requested_material_id,
    requested_quantity,
    operator_name,
    note
  )
  values (
    v_warehouse_id,
    'inbound',
    coalesce(nullif(trim(p_source), ''), 'manual'),
    v_material_id,
    p_quantity,
    nullif(trim(coalesce(p_operator_name, '')), ''),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_operation_id;

  insert into public.inventory_batches (
    warehouse_id,
    pallet_id,
    location_id,
    material_id,
    initial_quantity,
    quantity,
    production_date,
    lot_no,
    box_barcode,
    batch_status,
    remark
  )
  values (
    v_warehouse_id,
    v_pallet_id,
    v_location_id,
    v_material_id,
    p_quantity,
    p_quantity,
    v_production_date,
    nullif(trim(coalesce(p_lot_no, '')), ''),
    nullif(trim(coalesce(p_box_barcode, '')), ''),
    'active',
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_batch_id;

  insert into public.stock_operation_lines (
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
    remark
  )
  values (
    v_operation_id,
    1,
    v_batch_id,
    v_pallet_id,
    v_location_id,
    v_material_id,
    p_quantity,
    0,
    p_quantity,
    v_production_date,
    nullif(trim(coalesce(p_lot_no, '')), ''),
    nullif(trim(coalesce(p_box_barcode, '')), ''),
    'Inbound batch created'
  );

  return v_operation_id;
end;
$$;

create or replace function public.confirm_outbound_pick(
  p_material_code text,
  p_requested_qty numeric,
  p_operator_name text default null,
  p_note text default null,
  p_source text default 'manual'
)
returns table (
  operation_id uuid,
  line_no integer,
  batch_id uuid,
  pallet_code text,
  picked_quantity numeric,
  remaining_quantity numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_material_id uuid;
  v_warehouse_id uuid;
  v_operation_id uuid;
  v_total_available numeric(18, 3);
  v_remaining numeric(18, 3);
  v_pick numeric(18, 3);
  v_line_no integer := 0;
  rec record;
begin
  if p_material_code is null or trim(p_material_code) = '' then
    raise exception 'Material code is required.';
  end if;

  if p_requested_qty is null or p_requested_qty <= 0 then
    raise exception 'Requested outbound quantity must be greater than zero.';
  end if;

  select id
    into v_material_id
  from public.materials
  where lower(material_code) = lower(trim(p_material_code))
    and deleted_at is null
    and is_active = true
  limit 1;

  if v_material_id is null then
    raise exception 'Material % does not exist in active master data.', p_material_code;
  end if;

  select ib.warehouse_id, sum(ib.quantity)
    into v_warehouse_id, v_total_available
  from public.inventory_batches ib
  where ib.material_id = v_material_id
    and ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0
  group by ib.warehouse_id
  order by sum(ib.quantity) desc
  limit 1;

  if coalesce(v_total_available, 0) < p_requested_qty then
    raise exception 'Insufficient stock. Requested %, available %.', p_requested_qty, coalesce(v_total_available, 0);
  end if;

  insert into public.stock_operations (
    warehouse_id,
    operation_type,
    source,
    requested_material_id,
    requested_quantity,
    operator_name,
    note
  )
  values (
    v_warehouse_id,
    'outbound',
    coalesce(nullif(trim(p_source), ''), 'manual'),
    v_material_id,
    p_requested_qty,
    nullif(trim(coalesce(p_operator_name, '')), ''),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_operation_id;

  v_remaining := p_requested_qty;

  for rec in
    select
      ib.id as batch_id,
      ib.pallet_id,
      ib.location_id,
      l.location_code as pallet_code,
      ib.material_id,
      ib.quantity as available_quantity,
      ib.production_date,
      ib.lot_no,
      ib.box_barcode,
      ib.batch_status
    from public.inventory_batches ib
    join public.locations l on l.id = ib.location_id
    where ib.material_id = v_material_id
      and ib.deleted_at is null
      and ib.batch_status = 'active'
      and ib.quantity > 0
    order by ib.production_date, ib.created_at, ib.id
    for update of ib
  loop
    exit when v_remaining <= 0;

    v_pick := least(rec.available_quantity, v_remaining);
    v_line_no := v_line_no + 1;

    update public.inventory_batches
    set
      quantity = rec.available_quantity - v_pick,
      batch_status = case when rec.available_quantity - v_pick = 0 then 'empty' else batch_status end,
      closed_at = case when rec.available_quantity - v_pick = 0 then timezone('utc', now()) else closed_at end
    where id = rec.batch_id;

    insert into public.stock_operation_lines (
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
      remark
    )
    values (
      v_operation_id,
      v_line_no,
      rec.batch_id,
      rec.pallet_id,
      rec.location_id,
      rec.material_id,
      -v_pick,
      rec.available_quantity,
      rec.available_quantity - v_pick,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      'FIFO outbound confirmed'
    );

    operation_id := v_operation_id;
    line_no := v_line_no;
    batch_id := rec.batch_id;
    pallet_code := rec.pallet_code;
    picked_quantity := v_pick;
    remaining_quantity := rec.available_quantity - v_pick;

    v_remaining := v_remaining - v_pick;
    return next;
  end loop;
end;
$$;

create or replace function public.clear_pallet_inventory(
  p_pallet_code text,
  p_warehouse_code text default 'MAIN',
  p_operator_name text default null,
  p_note text default null
)
returns table (
  operation_id uuid,
  line_no integer,
  batch_id uuid,
  material_code text,
  cleared_quantity numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_warehouse_id uuid;
  v_location_id uuid;
  v_operation_id uuid;
  v_line_no integer := 0;
  rec record;
begin
  if p_pallet_code is null or trim(p_pallet_code) = '' then
    raise exception 'Location code is required.';
  end if;

  select w.id, l.id
    into v_warehouse_id, v_location_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where w.warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and l.location_code = upper(trim(p_pallet_code))
    and l.deleted_at is null
  limit 1;

  if v_location_id is null then
    raise exception 'Location % does not exist.', p_pallet_code;
  end if;

  insert into public.stock_operations (
    warehouse_id,
    operation_type,
    source,
    operator_name,
    note
  )
  values (
    v_warehouse_id,
    'clear_pallet',
    'manual',
    nullif(trim(coalesce(p_operator_name, '')), ''),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_operation_id;

  for rec in
    select
      ib.id as batch_id,
      ib.pallet_id,
      ib.location_id,
      ib.material_id,
      ib.quantity,
      ib.production_date,
      ib.lot_no,
      ib.box_barcode,
      m.material_code
    from public.inventory_batches ib
    join public.materials m on m.id = ib.material_id
    where ib.location_id = v_location_id
      and ib.deleted_at is null
      and ib.quantity > 0
    order by ib.production_date, ib.created_at, ib.id
    for update of ib
  loop
    v_line_no := v_line_no + 1;

    update public.inventory_batches
    set
      quantity = 0,
      batch_status = 'cleared',
      closed_at = timezone('utc', now())
    where id = rec.batch_id;

    insert into public.stock_operation_lines (
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
      remark
    )
    values (
      v_operation_id,
      v_line_no,
      rec.batch_id,
      rec.pallet_id,
      rec.location_id,
      rec.material_id,
      -rec.quantity,
      rec.quantity,
      0,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      'Location cleared'
    );

    operation_id := v_operation_id;
    line_no := v_line_no;
    batch_id := rec.batch_id;
    material_code := rec.material_code;
    cleared_quantity := rec.quantity;
    return next;
  end loop;
end;
$$;

create or replace function public.complete_cycle_count(
  p_pallet_code text,
  p_items jsonb,
  p_warehouse_code text default 'MAIN',
  p_operator_name text default null,
  p_note text default null
)
returns table (
  count_id uuid,
  operation_id uuid,
  line_no integer,
  batch_id uuid,
  material_code text,
  variance_quantity numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_warehouse_id uuid;
  v_location_id uuid;
  v_pallet_id uuid;
  v_count_id uuid;
  v_operation_id uuid;
  v_line_no integer := 0;
  rec record;
  v_batch record;
  v_variance numeric(18, 3);
begin
  if p_pallet_code is null or trim(p_pallet_code) = '' then
    raise exception 'Location code is required.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Cycle count items must be a JSON array.';
  end if;

  select w.id, l.id, p.id
    into v_warehouse_id, v_location_id, v_pallet_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  left join public.pallets p on p.location_id = l.id
  where w.warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and l.location_code = upper(trim(p_pallet_code))
    and l.deleted_at is null
  limit 1;

  if v_location_id is null then
    raise exception 'Location % does not exist.', p_pallet_code;
  end if;

  insert into public.inventory_counts (
    warehouse_id,
    pallet_id,
    location_id,
    count_status,
    operator_name,
    note,
    snapshot_at,
    completed_at
  )
  values (
    v_warehouse_id,
    v_pallet_id,
    v_location_id,
    'completed',
    nullif(trim(coalesce(p_operator_name, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    timezone('utc', now()),
    timezone('utc', now())
  )
  returning id into v_count_id;

  insert into public.stock_operations (
    warehouse_id,
    operation_type,
    source,
    operator_name,
    note
  )
  values (
    v_warehouse_id,
    'cycle_count',
    'manual',
    nullif(trim(coalesce(p_operator_name, '')), ''),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_operation_id;

  for rec in
    select
      (item->>'batch_id')::uuid as batch_id,
      coalesce((item->>'counted_quantity')::numeric, 0) as counted_quantity,
      nullif(trim(coalesce(item->>'note', '')), '') as item_note
    from jsonb_array_elements(p_items) item
  loop
    if rec.batch_id is null then
      raise exception 'Each cycle count row must include batch_id.';
    end if;

    if rec.counted_quantity < 0 then
      raise exception 'Counted quantity cannot be negative for batch %.', rec.batch_id;
    end if;

    select
      ib.id as batch_id,
      ib.pallet_id,
      ib.location_id,
      ib.material_id,
      ib.quantity as system_quantity,
      ib.production_date,
      ib.lot_no,
      ib.box_barcode,
      m.material_code
      into v_batch
    from public.inventory_batches ib
    join public.materials m on m.id = ib.material_id
    where ib.id = rec.batch_id
      and ib.location_id = v_location_id
      and ib.deleted_at is null
    for update of ib;

    if not found then
      raise exception 'Batch % does not belong to location %.', rec.batch_id, p_pallet_code;
    end if;

    v_line_no := v_line_no + 1;
    v_variance := rec.counted_quantity - v_batch.system_quantity;

    insert into public.inventory_count_items (
      count_id,
      line_no,
      batch_id,
      pallet_id,
      location_id,
      material_id,
      production_date,
      lot_no,
      system_quantity,
      counted_quantity,
      note
    )
    values (
      v_count_id,
      v_line_no,
      v_batch.batch_id,
      v_batch.pallet_id,
      v_batch.location_id,
      v_batch.material_id,
      v_batch.production_date,
      v_batch.lot_no,
      v_batch.system_quantity,
      rec.counted_quantity,
      rec.item_note
    );

    if v_variance <> 0 then
      update public.inventory_batches
      set
        quantity = rec.counted_quantity,
        batch_status = case when rec.counted_quantity = 0 then 'empty' else 'active' end,
        closed_at = case when rec.counted_quantity = 0 then timezone('utc', now()) else null end
      where id = v_batch.batch_id;

      insert into public.stock_operation_lines (
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
        remark
      )
      values (
        v_operation_id,
        v_line_no,
        v_batch.batch_id,
        v_batch.pallet_id,
        v_batch.location_id,
        v_batch.material_id,
        v_variance,
        v_batch.system_quantity,
        rec.counted_quantity,
        v_batch.production_date,
        v_batch.lot_no,
        v_batch.box_barcode,
        coalesce(rec.item_note, 'Cycle count adjustment')
      );
    end if;

    count_id := v_count_id;
    operation_id := v_operation_id;
    line_no := v_line_no;
    batch_id := v_batch.batch_id;
    material_code := v_batch.material_code;
    variance_quantity := v_variance;
    return next;
  end loop;
end;
$$;

grant select on public.v_current_inventory_batches to anon, authenticated;
grant select on public.v_material_inventory_summary to anon, authenticated;
grant select on public.v_operation_log_lines to anon, authenticated;
grant select on public.v_inventory_export_rows to anon, authenticated;
grant select on public.v_pallet_lookup to anon, authenticated;
grant select on public.v_location_lookup to anon, authenticated;

grant execute on function public.get_fifo_suggestions(uuid, numeric) to anon, authenticated;
grant execute on function public.create_inbound_batch(text, text, numeric, date, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.confirm_outbound_pick(text, numeric, text, text, text) to anon, authenticated;
grant execute on function public.clear_pallet_inventory(text, text, text, text) to anon, authenticated;
grant execute on function public.complete_cycle_count(text, jsonb, text, text, text) to anon, authenticated;
