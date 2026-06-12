create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.set_material_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := lower(
    trim(
      coalesce(new.material_code, '') || ' ' ||
      coalesce(new.short_code, '') || ' ' ||
      coalesce(new.description, '') || ' ' ||
      coalesce(new.category, '') || ' ' ||
      coalesce(new.specification, '')
    )
  );

  return new;
end;
$$;

create or replace function public.set_inventory_count_variance()
returns trigger
language plpgsql
as $$
begin
  new.variance_quantity := new.counted_quantity - new.system_quantity;
  return new;
end;
$$;

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null unique,
  warehouse_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.warehouses (warehouse_code, warehouse_name)
values ('MAIN', 'Default Warehouse')
on conflict (warehouse_code) do nothing;

create table if not exists public.pallets (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  pallet_code text not null,
  area text,
  status text not null default 'idle'
    check (status in ('idle', 'active', 'locked', 'disabled')),
  remark text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint pallets_code_format_ck check (pallet_code ~ '^[A-Z][0-9]{2,}$'),
  constraint pallets_warehouse_code_uk unique (warehouse_id, pallet_code)
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  material_code text not null unique,
  short_code text,
  description text,
  category text,
  specification text,
  image_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  search_text text not null default ''
);

create table if not exists public.barcode_aliases (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  barcode text not null,
  remark text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create unique index if not exists barcode_aliases_barcode_active_uk
  on public.barcode_aliases (barcode)
  where deleted_at is null;

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  pallet_id uuid not null references public.pallets(id),
  material_id uuid not null references public.materials(id),
  initial_quantity numeric(18, 3) not null check (initial_quantity > 0),
  quantity numeric(18, 3) not null check (quantity >= 0),
  production_date date not null,
  lot_no text,
  box_barcode text,
  batch_status text not null default 'active'
    check (batch_status in ('active', 'empty', 'cleared', 'archived')),
  remark text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  deleted_at timestamptz,
  constraint inventory_batches_month_granularity_ck check (extract(day from production_date) = 1)
);

create unique index if not exists inventory_batches_box_barcode_active_uk
  on public.inventory_batches (box_barcode)
  where box_barcode is not null and deleted_at is null;

create table if not exists public.stock_operations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  operation_type text not null
    check (operation_type in ('inbound', 'outbound', 'cycle_count', 'clear_pallet', 'adjustment')),
  source text not null default 'manual'
    check (source in ('manual', 'scan', 'import', 'system')),
  requested_material_id uuid references public.materials(id),
  requested_quantity numeric(18, 3),
  operator_name text,
  note text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stock_operation_lines (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.stock_operations(id) on delete cascade,
  line_no integer not null,
  batch_id uuid references public.inventory_batches(id),
  pallet_id uuid not null references public.pallets(id),
  material_id uuid not null references public.materials(id),
  quantity_change numeric(18, 3) not null check (quantity_change <> 0),
  quantity_before numeric(18, 3) not null check (quantity_before >= 0),
  quantity_after numeric(18, 3) not null check (quantity_after >= 0),
  production_date date not null,
  lot_no text,
  box_barcode text,
  remark text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint stock_operation_lines_month_granularity_ck check (extract(day from production_date) = 1),
  constraint stock_operation_lines_operation_line_uk unique (operation_id, line_no)
);

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  pallet_id uuid not null references public.pallets(id),
  count_status text not null default 'draft'
    check (count_status in ('draft', 'completed', 'cancelled')),
  operator_name text,
  note text,
  snapshot_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  line_no integer not null,
  batch_id uuid references public.inventory_batches(id),
  pallet_id uuid not null references public.pallets(id),
  material_id uuid not null references public.materials(id),
  production_date date not null,
  lot_no text,
  system_quantity numeric(18, 3) not null check (system_quantity >= 0),
  counted_quantity numeric(18, 3) not null check (counted_quantity >= 0),
  variance_quantity numeric(18, 3) not null default 0,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_count_items_month_granularity_ck check (extract(day from production_date) = 1),
  constraint inventory_count_items_count_line_uk unique (count_id, line_no)
);

create index if not exists pallets_lookup_idx
  on public.pallets (warehouse_id, pallet_code)
  where deleted_at is null;

create index if not exists materials_material_code_idx
  on public.materials (material_code);

create index if not exists materials_short_code_idx
  on public.materials (short_code);

create index if not exists materials_search_text_trgm_idx
  on public.materials
  using gin (search_text gin_trgm_ops)
  where deleted_at is null and is_active = true;

create index if not exists barcode_aliases_material_idx
  on public.barcode_aliases (material_id)
  where deleted_at is null;

create index if not exists inventory_batches_fifo_idx
  on public.inventory_batches (material_id, production_date, created_at, id)
  where deleted_at is null and quantity > 0;

create index if not exists inventory_batches_pallet_idx
  on public.inventory_batches (pallet_id, production_date, created_at)
  where deleted_at is null and quantity > 0;

create index if not exists stock_operations_type_created_idx
  on public.stock_operations (operation_type, created_at desc);

create index if not exists stock_operation_lines_material_idx
  on public.stock_operation_lines (material_id, created_at desc);

create index if not exists stock_operation_lines_pallet_idx
  on public.stock_operation_lines (pallet_id, created_at desc);

create index if not exists inventory_counts_pallet_idx
  on public.inventory_counts (pallet_id, created_at desc);

drop trigger if exists pallets_set_updated_at on public.pallets;
create trigger pallets_set_updated_at
before update on public.pallets
for each row execute function public.set_updated_at();

drop trigger if exists materials_set_updated_at on public.materials;
create trigger materials_set_updated_at
before update on public.materials
for each row execute function public.set_updated_at();

drop trigger if exists materials_set_search_text on public.materials;
create trigger materials_set_search_text
before insert or update on public.materials
for each row execute function public.set_material_search_text();

drop trigger if exists inventory_batches_set_updated_at on public.inventory_batches;
create trigger inventory_batches_set_updated_at
before update on public.inventory_batches
for each row execute function public.set_updated_at();

drop trigger if exists inventory_count_items_set_variance on public.inventory_count_items;
create trigger inventory_count_items_set_variance
before insert or update on public.inventory_count_items
for each row execute function public.set_inventory_count_variance();

create or replace view public.v_current_inventory_batches as
select
  ib.id as batch_id,
  w.warehouse_code,
  p.pallet_code,
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
  ib.updated_at
from public.inventory_batches ib
join public.warehouses w on w.id = ib.warehouse_id
join public.pallets p on p.id = ib.pallet_id
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
  count(distinct ib.pallet_id) as pallet_count,
  min(ib.production_date) as earliest_production_date,
  max(ib.production_date) as latest_production_date
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

create or replace function public.search_materials(
  p_query text,
  p_limit integer default 20
)
returns table (
  material_id uuid,
  material_code text,
  short_code text,
  description text,
  category text,
  specification text,
  matched_by text,
  score real
)
language sql
stable
as $$
with normalized as (
  select lower(trim(coalesce(p_query, ''))) as q
),
candidate_rows as (
  select
    m.id as material_id,
    m.material_code,
    m.short_code,
    m.description,
    m.category,
    m.specification,
    ba.barcode,
    greatest(
      similarity(lower(m.material_code), n.q),
      similarity(lower(coalesce(m.short_code, '')), n.q),
      similarity(lower(coalesce(m.description, '')), n.q),
      similarity(lower(coalesce(m.specification, '')), n.q),
      similarity(m.search_text, n.q)
    ) as score,
    case
      when ba.barcode = p_query then 'barcode'
      when lower(m.material_code) = n.q then 'material_code_exact'
      when lower(coalesce(m.short_code, '')) = n.q then 'short_code_exact'
      when lower(m.material_code) like n.q || '%' then 'material_code_prefix'
      when lower(coalesce(m.short_code, '')) like n.q || '%' then 'short_code_prefix'
      when m.search_text like '%' || n.q || '%' then 'contains'
      else 'fuzzy'
    end as matched_by
  from public.materials m
  cross join normalized n
  left join public.barcode_aliases ba
    on ba.material_id = m.id
   and ba.deleted_at is null
   and ba.is_active = true
  where m.deleted_at is null
    and m.is_active = true
    and n.q <> ''
    and (
      ba.barcode = p_query
      or lower(m.material_code) like '%' || n.q || '%'
      or lower(coalesce(m.short_code, '')) like '%' || n.q || '%'
      or lower(coalesce(m.description, '')) like '%' || n.q || '%'
      or lower(coalesce(m.category, '')) like '%' || n.q || '%'
      or lower(coalesce(m.specification, '')) like '%' || n.q || '%'
      or similarity(m.search_text, n.q) >= 0.10
    )
),
deduped as (
  select distinct on (material_id)
    material_id,
    material_code,
    short_code,
    description,
    category,
    specification,
    matched_by,
    score
  from candidate_rows
  order by
    material_id,
    case matched_by
      when 'barcode' then 1
      when 'material_code_exact' then 2
      when 'short_code_exact' then 3
      when 'material_code_prefix' then 4
      when 'short_code_prefix' then 5
      when 'contains' then 6
      else 7
    end,
    score desc
)
select
  material_id,
  material_code,
  short_code,
  description,
  category,
  specification,
  matched_by,
  score
from deduped
order by
  case matched_by
    when 'barcode' then 1
    when 'material_code_exact' then 2
    when 'short_code_exact' then 3
    when 'material_code_prefix' then 4
    when 'short_code_prefix' then 5
    when 'contains' then 6
    else 7
  end,
  score desc,
  material_code
limit greatest(coalesce(p_limit, 20), 1);
$$;

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
as $$
with ordered_batches as (
  select
    ib.id as batch_id,
    ib.pallet_id,
    p.pallet_code,
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
  join public.pallets p on p.id = ib.pallet_id
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
