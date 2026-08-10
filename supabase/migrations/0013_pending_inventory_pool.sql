alter table public.master_data_import_runs
  drop constraint if exists master_data_import_runs_import_type_check;

alter table public.master_data_import_runs
  add constraint master_data_import_runs_import_type_check
  check (import_type in ('materials', 'barcode_aliases', 'pending_inventory'));

create table if not exists public.pending_inventory_pool (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  material_id uuid not null references public.materials(id),
  quantity numeric(18, 3) not null default 0 check (quantity >= 0),
  source_file_name text,
  operator_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint pending_inventory_pool_warehouse_material_uk unique (warehouse_id, material_id)
);

create index if not exists pending_inventory_pool_active_idx
  on public.pending_inventory_pool (warehouse_id, updated_at desc)
  where deleted_at is null and quantity > 0;

alter table public.pending_inventory_pool enable row level security;

drop trigger if exists pending_inventory_pool_set_updated_at on public.pending_inventory_pool;
create trigger pending_inventory_pool_set_updated_at
before update on public.pending_inventory_pool
for each row execute function public.set_updated_at();

create or replace function public.bulk_import_pending_inventory(
  p_rows jsonb,
  p_source_file_name text default null,
  p_operator_name text default null,
  p_warehouse_code text default 'MAIN'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec record;
  v_warehouse_id uuid;
  v_material_id uuid;
  v_existing_id uuid;
  v_import_run_id uuid;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_processed_count integer := 0;
  v_grouped_material_count integer := 0;
  v_total_quantity numeric(18, 3) := 0;
  v_material_code text;
  v_quantity numeric(18, 3);
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Pending inventory import payload must be a JSON array.';
  end if;

  select id
    into v_warehouse_id
  from public.warehouses
  where warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and is_active = true
  limit 1;

  if v_warehouse_id is null then
    raise exception 'Warehouse % does not exist or is inactive.', coalesce(p_warehouse_code, 'MAIN');
  end if;

  for rec in
    select
      row_number() over () as row_no,
      item->>'material_code' as material_code,
      item->>'quantity' as quantity
    from jsonb_array_elements(p_rows) item
  loop
    v_material_code := nullif(trim(coalesce(rec.material_code, '')), '');

    if v_material_code is null then
      raise exception 'material_code is required for every pending inventory import row.';
    end if;

    begin
      v_quantity := nullif(trim(coalesce(rec.quantity, '')), '')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'quantity % on row % is not a valid number.', rec.quantity, rec.row_no;
    end;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'quantity must be greater than zero for every pending inventory import row.';
    end if;
  end loop;

  for rec in
    select
      min(trim(item->>'material_code')) as material_code,
      sum((trim(item->>'quantity'))::numeric) as quantity
    from jsonb_array_elements(p_rows) item
    group by lower(trim(item->>'material_code'))
  loop
    v_grouped_material_count := v_grouped_material_count + 1;
    v_total_quantity := v_total_quantity + rec.quantity;

    select id
      into v_material_id
    from public.materials
    where lower(material_code) = lower(rec.material_code)
      and deleted_at is null
      and is_active = true
    limit 1;

    if v_material_id is null then
      raise exception 'material_code % does not exist in active materials.', rec.material_code;
    end if;

    select id
      into v_existing_id
    from public.pending_inventory_pool
    where warehouse_id = v_warehouse_id
      and material_id = v_material_id
      and deleted_at is null
    limit 1;

    if v_existing_id is null then
      insert into public.pending_inventory_pool (
        warehouse_id,
        material_id,
        quantity,
        source_file_name,
        operator_name,
        metadata
      )
      values (
        v_warehouse_id,
        v_material_id,
        rec.quantity,
        nullif(trim(coalesce(p_source_file_name, '')), ''),
        nullif(trim(coalesce(p_operator_name, '')), ''),
        jsonb_build_object(
          'receiving_location_code', 'IN-01',
          'last_import_mode', 'pending_inventory'
        )
      );

      v_created_count := v_created_count + 1;
    else
      update public.pending_inventory_pool
      set
        quantity = quantity + rec.quantity,
        source_file_name = coalesce(nullif(trim(coalesce(p_source_file_name, '')), ''), source_file_name),
        operator_name = coalesce(nullif(trim(coalesce(p_operator_name, '')), ''), operator_name),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'receiving_location_code', 'IN-01',
          'last_import_mode', 'pending_inventory'
        )
      where id = v_existing_id;

      v_updated_count := v_updated_count + 1;
    end if;
  end loop;

  v_processed_count := coalesce(jsonb_array_length(p_rows), 0);

  insert into public.master_data_import_runs (
    import_type,
    source_file_name,
    operator_name,
    processed_rows,
    created_rows,
    updated_rows,
    rejected_rows,
    summary
  )
  values (
    'pending_inventory',
    nullif(trim(coalesce(p_source_file_name, '')), ''),
    nullif(trim(coalesce(p_operator_name, '')), ''),
    v_processed_count,
    v_created_count,
    v_updated_count,
    0,
    jsonb_build_object(
      'grouped_material_count', v_grouped_material_count,
      'total_quantity', v_total_quantity,
      'receiving_location_code', 'IN-01',
      'processed_count', v_processed_count,
      'created_count', v_created_count,
      'updated_count', v_updated_count
    )
  )
  returning id into v_import_run_id;

  return jsonb_build_object(
    'import_run_id', v_import_run_id,
    'processed_count', v_processed_count,
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'rejected_count', 0
  );
end;
$$;

create or replace function public.get_pending_inventory_pool(
  p_query text default null,
  p_limit integer default 20,
  p_warehouse_code text default 'MAIN'
)
returns table (
  material_id uuid,
  material_code text,
  short_code text,
  description text,
  pending_quantity numeric,
  source_file_name text,
  operator_name text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
with normalized as (
  select lower(trim(coalesce(p_query, ''))) as q
),
warehouse_scope as (
  select id
  from public.warehouses
  where warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and is_active = true
  limit 1
)
select
  m.id as material_id,
  m.material_code,
  m.short_code,
  m.description,
  pip.quantity as pending_quantity,
  pip.source_file_name,
  pip.operator_name,
  pip.updated_at
from public.pending_inventory_pool pip
join warehouse_scope w on w.id = pip.warehouse_id
join public.materials m on m.id = pip.material_id
cross join normalized n
where pip.deleted_at is null
  and pip.quantity > 0
  and (
    n.q = ''
    or lower(m.material_code) like '%' || n.q || '%'
    or lower(coalesce(m.short_code, '')) like '%' || n.q || '%'
    or lower(coalesce(m.description, '')) like '%' || n.q || '%'
  )
order by
  case
    when n.q <> '' and lower(m.material_code) = n.q then 0
    when n.q <> '' and lower(m.material_code) like n.q || '%' then 1
    else 2
  end,
  pip.updated_at desc,
  m.material_code
limit greatest(coalesce(p_limit, 20), 1);
$$;

create or replace function public.putaway_pending_inventory(
  p_material_code text,
  p_target_location_code text,
  p_quantity numeric,
  p_production_date date,
  p_warehouse_code text default 'MAIN',
  p_lot_no text default null,
  p_box_barcode text default null,
  p_operator_name text default null,
  p_note text default null
)
returns table (
  batch_id uuid,
  material_code text,
  moved_quantity numeric,
  target_location_code text,
  remaining_pending_quantity numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_warehouse_id uuid;
  v_pool_id uuid;
  v_material_id uuid;
  v_material_code text;
  v_remaining_quantity numeric(18, 3);
begin
  if p_material_code is null or trim(p_material_code) = '' then
    raise exception 'Material code is required.';
  end if;

  if p_target_location_code is null or trim(p_target_location_code) = '' then
    raise exception 'Target location code is required.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Putaway quantity must be greater than zero.';
  end if;

  if p_production_date is null then
    raise exception 'Production date is required.';
  end if;

  select id
    into v_warehouse_id
  from public.warehouses
  where warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and is_active = true
  limit 1;

  if v_warehouse_id is null then
    raise exception 'Warehouse % does not exist or is inactive.', coalesce(p_warehouse_code, 'MAIN');
  end if;

  select
    pip.id,
    pip.material_id,
    pip.quantity,
    m.material_code
    into v_pool_id,
    v_material_id,
    v_remaining_quantity,
    v_material_code
  from public.pending_inventory_pool pip
  join public.materials m on m.id = pip.material_id
  where pip.warehouse_id = v_warehouse_id
    and pip.deleted_at is null
    and pip.quantity > 0
    and lower(m.material_code) = lower(trim(p_material_code))
  limit 1
  for update of pip;

  if v_pool_id is null then
    raise exception 'Pending inventory for material % does not exist.', p_material_code;
  end if;

  if p_quantity > v_remaining_quantity then
    raise exception 'Putaway quantity % exceeds pending quantity % for material %.', p_quantity, v_remaining_quantity, v_material_code;
  end if;

  update public.pending_inventory_pool
  set
    quantity = quantity - p_quantity,
    operator_name = coalesce(nullif(trim(coalesce(p_operator_name, '')), ''), operator_name),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'receiving_location_code', 'IN-01',
      'last_putaway_target', upper(trim(p_target_location_code))
    )
  where id = v_pool_id
  returning quantity into v_remaining_quantity;

  select public.create_inbound_batch(
    upper(trim(p_target_location_code)),
    v_material_code,
    p_quantity,
    p_production_date,
    coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN'),
    p_lot_no,
    p_box_barcode,
    p_operator_name,
    coalesce(nullif(trim(coalesce(p_note, '')), ''), format('Putaway from pending pool (%s).', 'IN-01')),
    'import'
  )
    into batch_id;

  material_code := v_material_code;
  moved_quantity := p_quantity;
  target_location_code := upper(trim(p_target_location_code));
  remaining_pending_quantity := v_remaining_quantity;
  return next;
end;
$$;

grant execute on function public.bulk_import_pending_inventory(jsonb, text, text, text) to anon, authenticated;
grant execute on function public.get_pending_inventory_pool(text, integer, text) to anon, authenticated;
grant execute on function public.putaway_pending_inventory(text, text, numeric, date, text, text, text, text, text) to anon, authenticated;
