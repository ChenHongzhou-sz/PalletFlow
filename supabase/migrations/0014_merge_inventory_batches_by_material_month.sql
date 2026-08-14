create or replace function public.merge_batch_text_value(
  p_existing text,
  p_incoming text
)
returns text
language sql
immutable
as $$
  with values_cte as (
    select
      nullif(trim(coalesce(p_existing, '')), '') as existing_value,
      nullif(trim(coalesce(p_incoming, '')), '') as incoming_value
  )
  select case
    when existing_value is null then incoming_value
    when incoming_value is null then existing_value
    when lower(existing_value) = lower(incoming_value) then existing_value
    else null
  end
  from values_cte;
$$;

create or replace function public.upsert_active_inventory_batch(
  p_warehouse_id uuid,
  p_pallet_id uuid,
  p_location_id uuid,
  p_material_id uuid,
  p_quantity_delta numeric,
  p_initial_quantity_delta numeric,
  p_production_date date,
  p_lot_no text default null,
  p_box_barcode text default null,
  p_date_code text default null,
  p_stock_form text default 'SEALED',
  p_received_at timestamptz default timezone('utc', now()),
  p_created_at timestamptz default timezone('utc', now()),
  p_remark text default null
)
returns table (
  batch_id uuid,
  quantity_before numeric,
  quantity_after numeric,
  lot_no text,
  box_barcode text,
  date_code text,
  stock_form text,
  received_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing record;
  v_incoming_lot_no text;
  v_incoming_box_barcode text;
  v_incoming_date_code text;
  v_production_month date;
  v_received_at timestamptz;
  v_created_at timestamptz;
  v_remark text;
  v_merged_lot_no text;
  v_merged_box_barcode text;
  v_merged_date_code text;
  v_merged_stock_form text;
  v_merged_received_at timestamptz;
  v_merged_created_at timestamptz;
begin
  if p_warehouse_id is null or p_location_id is null or p_material_id is null then
    raise exception 'Warehouse, location and material are required to upsert inventory batch.';
  end if;

  if p_quantity_delta is null or p_quantity_delta <= 0 then
    raise exception 'Quantity delta must be greater than zero.';
  end if;

  if p_initial_quantity_delta is null or p_initial_quantity_delta < 0 then
    raise exception 'Initial quantity delta cannot be negative.';
  end if;

  if p_production_date is null then
    raise exception 'Production date is required.';
  end if;

  if coalesce(p_stock_form, 'SEALED') not in ('SEALED', 'OPEN') then
    raise exception 'Unsupported stock form %.', p_stock_form;
  end if;

  v_incoming_lot_no := nullif(trim(coalesce(p_lot_no, '')), '');
  v_incoming_box_barcode := nullif(trim(coalesce(p_box_barcode, '')), '');
  v_production_month := date_trunc('month', p_production_date)::date;
  v_incoming_date_code := coalesce(nullif(trim(coalesce(p_date_code, '')), ''), to_char(v_production_month, 'YYMM'));
  v_received_at := coalesce(p_received_at, timezone('utc', now()));
  v_created_at := coalesce(p_created_at, v_received_at);
  v_remark := nullif(trim(coalesce(p_remark, '')), '');

  select
    ib.id,
    ib.pallet_id,
    ib.initial_quantity,
    ib.quantity,
    ib.lot_no,
    ib.box_barcode,
    ib.date_code,
    ib.stock_form,
    ib.received_at,
    ib.created_at,
    ib.remark
    into v_existing
  from public.inventory_batches ib
  where ib.warehouse_id = p_warehouse_id
    and ib.location_id = p_location_id
    and ib.material_id = p_material_id
    and ib.production_date = v_production_month
    and ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0
  order by coalesce(ib.received_at, ib.created_at), ib.created_at, ib.id
  limit 1
  for update of ib;

  if found then
    batch_id := v_existing.id;
    quantity_before := v_existing.quantity;
    quantity_after := v_existing.quantity + p_quantity_delta;
    v_merged_lot_no := public.merge_batch_text_value(v_existing.lot_no, v_incoming_lot_no);
    v_merged_box_barcode := public.merge_batch_text_value(v_existing.box_barcode, v_incoming_box_barcode);
    v_merged_date_code := coalesce(public.merge_batch_text_value(v_existing.date_code, v_incoming_date_code), to_char(v_production_month, 'YYMM'));
    v_merged_stock_form := case
      when coalesce(v_existing.stock_form, 'SEALED') = 'OPEN' or coalesce(p_stock_form, 'SEALED') = 'OPEN' then 'OPEN'
      else 'SEALED'
    end;
    v_merged_received_at := coalesce(least(v_existing.received_at, v_received_at), v_existing.received_at, v_received_at);
    v_merged_created_at := coalesce(least(v_existing.created_at, v_created_at), v_existing.created_at, v_created_at);

    update public.inventory_batches
    set
      pallet_id = coalesce(p_pallet_id, inventory_batches.pallet_id),
      location_id = p_location_id,
      initial_quantity = v_existing.initial_quantity + p_initial_quantity_delta,
      quantity = quantity_after,
      lot_no = v_merged_lot_no,
      box_barcode = v_merged_box_barcode,
      batch_status = 'active',
      remark = coalesce(v_remark, inventory_batches.remark),
      date_code = v_merged_date_code,
      stock_form = v_merged_stock_form,
      received_at = v_merged_received_at,
      created_at = v_merged_created_at,
      closed_at = null,
      deleted_at = null,
      updated_at = timezone('utc', now())
    where id = v_existing.id;

    lot_no := v_merged_lot_no;
    box_barcode := v_merged_box_barcode;
    date_code := v_merged_date_code;
    stock_form := v_merged_stock_form;
    received_at := v_merged_received_at;
    created_at := v_merged_created_at;

    return next;
    return;
  end if;

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
    remark,
    date_code,
    stock_form,
    received_at,
    created_at
  )
  values (
    p_warehouse_id,
    p_pallet_id,
    p_location_id,
    p_material_id,
    greatest(p_initial_quantity_delta, p_quantity_delta),
    p_quantity_delta,
    v_production_month,
    v_incoming_lot_no,
    v_incoming_box_barcode,
    'active',
    v_remark,
    v_incoming_date_code,
    coalesce(p_stock_form, 'SEALED'),
    v_received_at,
    v_created_at
  )
  returning id into batch_id;

  quantity_before := 0;
  quantity_after := p_quantity_delta;
  lot_no := v_incoming_lot_no;
  box_barcode := v_incoming_box_barcode;
  date_code := v_incoming_date_code;
  stock_form := coalesce(p_stock_form, 'SEALED');
  received_at := v_received_at;
  created_at := v_created_at;
  return next;
end;
$$;

with duplicate_groups as (
  select
    ib.warehouse_id,
    ib.location_id,
    ib.material_id,
    ib.production_date,
    (array_agg(ib.id order by coalesce(ib.received_at, ib.created_at), ib.created_at, ib.id))[1] as canonical_batch_id,
    sum(ib.initial_quantity) as total_initial_quantity,
    sum(ib.quantity) as total_quantity,
    case
      when count(distinct nullif(trim(coalesce(ib.lot_no, '')), '')) = 1 then min(nullif(trim(coalesce(ib.lot_no, '')), ''))
      else null
    end as merged_lot_no,
    case
      when count(distinct nullif(trim(coalesce(ib.box_barcode, '')), '')) = 1 then min(nullif(trim(coalesce(ib.box_barcode, '')), ''))
      else null
    end as merged_box_barcode,
    case
      when count(distinct nullif(trim(coalesce(ib.date_code, '')), '')) = 1 then min(nullif(trim(coalesce(ib.date_code, '')), ''))
      else to_char(ib.production_date, 'YYMM')
    end as merged_date_code,
    case
      when bool_or(coalesce(ib.stock_form, 'SEALED') = 'OPEN') then 'OPEN'
      else 'SEALED'
    end as merged_stock_form,
    min(coalesce(ib.received_at, ib.created_at)) as merged_received_at,
    min(ib.created_at) as merged_created_at,
    max(ib.updated_at) as merged_updated_at
  from public.inventory_batches ib
  where ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0
  group by
    ib.warehouse_id,
    ib.location_id,
    ib.material_id,
    ib.production_date
  having count(*) > 1
),
duplicate_rows as (
  select
    ib.id,
    dg.canonical_batch_id
  from public.inventory_batches ib
  join duplicate_groups dg
    on dg.warehouse_id = ib.warehouse_id
   and dg.location_id = ib.location_id
   and dg.material_id = ib.material_id
   and dg.production_date = ib.production_date
  where ib.id <> dg.canonical_batch_id
)
update public.inventory_batches ib
set
  initial_quantity = dg.total_initial_quantity,
  quantity = dg.total_quantity,
  lot_no = dg.merged_lot_no,
  box_barcode = dg.merged_box_barcode,
  batch_status = 'active',
  date_code = dg.merged_date_code,
  stock_form = dg.merged_stock_form,
  received_at = dg.merged_received_at,
  created_at = dg.merged_created_at,
  updated_at = greatest(ib.updated_at, dg.merged_updated_at),
  closed_at = null
from duplicate_groups dg
where ib.id = dg.canonical_batch_id;

with duplicate_groups as (
  select
    ib.warehouse_id,
    ib.location_id,
    ib.material_id,
    ib.production_date,
    (array_agg(ib.id order by coalesce(ib.received_at, ib.created_at), ib.created_at, ib.id))[1] as canonical_batch_id
  from public.inventory_batches ib
  where ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0
  group by
    ib.warehouse_id,
    ib.location_id,
    ib.material_id,
    ib.production_date
  having count(*) > 1
)
update public.inventory_batches ib
set
  quantity = 0,
  batch_status = 'archived',
  box_barcode = null,
  closed_at = coalesce(ib.closed_at, timezone('utc', now())),
  updated_at = timezone('utc', now())
from duplicate_groups dg
where ib.warehouse_id = dg.warehouse_id
  and ib.location_id = dg.location_id
  and ib.material_id = dg.material_id
  and ib.production_date = dg.production_date
  and ib.id <> dg.canonical_batch_id;

create unique index if not exists inventory_batches_active_material_month_location_uk
  on public.inventory_batches (warehouse_id, location_id, material_id, production_date)
  where deleted_at is null and batch_status = 'active' and quantity > 0;

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
    coalesce(ib.received_at, ib.created_at) as fifo_at,
    ib.created_at,
    coalesce(
      sum(ib.quantity) over (
        order by ib.production_date, coalesce(ib.received_at, ib.created_at), ib.created_at, ib.id
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
order by production_date, fifo_at, created_at, batch_id;
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
  v_stock_form text;
  v_batch_before numeric(18, 3);
  v_batch_after numeric(18, 3);
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
      and deleted_at is null
    limit 1;
  end if;

  v_stock_form := case
    when v_location_type in ('OPEN_STOCK_SHELF', 'OPEN_STOCK_BIN') then 'OPEN'
    else 'SEALED'
  end;

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

  select
    merged.batch_id,
    merged.quantity_before,
    merged.quantity_after
    into v_batch_id,
    v_batch_before,
    v_batch_after
  from public.upsert_active_inventory_batch(
    v_warehouse_id,
    v_pallet_id,
    v_location_id,
    v_material_id,
    p_quantity,
    p_quantity,
    v_production_date,
    p_lot_no,
    case when v_stock_form = 'OPEN' then null else p_box_barcode end,
    to_char(v_production_date, 'YYMM'),
    v_stock_form,
    timezone('utc', now()),
    timezone('utc', now()),
    p_note
  ) merged;

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
    v_batch_before,
    v_batch_after,
    v_production_date,
    nullif(trim(coalesce(p_lot_no, '')), ''),
    case when v_stock_form = 'OPEN' then null else nullif(trim(coalesce(p_box_barcode, '')), '') end,
    case when v_batch_before > 0 then 'Inbound quantity merged into existing batch' else 'Inbound batch created' end
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
      ib.box_barcode
    from public.inventory_batches ib
    join public.locations l on l.id = ib.location_id
    where ib.material_id = v_material_id
      and ib.deleted_at is null
      and ib.batch_status = 'active'
      and ib.quantity > 0
    order by ib.production_date, coalesce(ib.received_at, ib.created_at), ib.created_at, ib.id
    for update of ib
  loop
    exit when v_remaining <= 0;

    v_pick := least(rec.available_quantity, v_remaining);
    v_line_no := v_line_no + 1;

    update public.inventory_batches
    set
      quantity = rec.available_quantity - v_pick,
      batch_status = case when rec.available_quantity - v_pick = 0 then 'empty' else 'active' end,
      closed_at = case when rec.available_quantity - v_pick = 0 then timezone('utc', now()) else null end
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

create or replace function public.transfer_location_inventory(
  p_source_location_code text,
  p_target_location_code text,
  p_warehouse_code text default 'MAIN',
  p_operator_name text default null,
  p_note text default null,
  p_source text default 'manual'
)
returns table (
  operation_id uuid,
  batch_id uuid,
  material_code text,
  moved_quantity numeric,
  source_location_code text,
  target_location_code text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_warehouse_id uuid;
  v_source_location_id uuid;
  v_source_location_status text;
  v_target_location_id uuid;
  v_target_pallet_id uuid;
  v_target_location_type text;
  v_target_location_status text;
  v_source_code text;
  v_target_code text;
  v_operation_id uuid;
  v_line_no integer := 0;
  v_total_quantity numeric(18, 3);
  v_operation_note text;
  v_target_batch_id uuid;
  v_target_before numeric(18, 3);
  v_target_after numeric(18, 3);
  rec record;
begin
  if p_source_location_code is null or trim(p_source_location_code) = '' then
    raise exception 'Source location code is required.';
  end if;

  if p_target_location_code is null or trim(p_target_location_code) = '' then
    raise exception 'Target location code is required.';
  end if;

  v_source_code := upper(trim(p_source_location_code));
  v_target_code := upper(trim(p_target_location_code));

  if v_source_code = v_target_code then
    raise exception 'Source and target locations must be different.';
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
    l.id,
    l.status
    into v_source_location_id,
    v_source_location_status
  from public.locations l
  where l.warehouse_id = v_warehouse_id
    and l.location_code = v_source_code
    and l.deleted_at is null
  limit 1;

  if v_source_location_id is null then
    raise exception 'Source location % does not exist.', p_source_location_code;
  end if;

  if v_source_location_status = 'disabled' then
    raise exception 'Source location % is disabled.', v_source_code;
  end if;

  select coalesce(sum(ib.quantity), 0)
    into v_total_quantity
  from public.inventory_batches ib
  where ib.warehouse_id = v_warehouse_id
    and ib.location_id = v_source_location_id
    and ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0;

  if v_total_quantity <= 0 then
    raise exception 'Source location % has no active inventory to move.', v_source_code;
  end if;

  select
    resolved.location_id,
    resolved.pallet_id,
    resolved.location_code,
    resolved.location_type,
    resolved.location_status
    into v_target_location_id,
    v_target_pallet_id,
    v_target_code,
    v_target_location_type,
    v_target_location_status
  from public.ensure_transfer_location(v_warehouse_id, v_target_code, false) resolved;

  if v_target_location_status <> 'active' then
    raise exception 'Target location % is not active.', v_target_code;
  end if;

  if v_target_location_type not in ('FIXED_PALLET', 'MOBILE_PALLET') then
    raise exception 'Whole-location transfer only supports pallet destinations. Use a Pxx or Mxx target.';
  end if;

  v_operation_note := nullif(trim(coalesce(p_note, '')), '');
  if v_operation_note is null then
    v_operation_note := format('Location transfer %s -> %s', v_source_code, v_target_code);
  end if;

  insert into public.stock_operations (
    warehouse_id,
    operation_type,
    source,
    requested_quantity,
    operator_name,
    note
  )
  values (
    v_warehouse_id,
    'transfer',
    coalesce(nullif(trim(p_source), ''), 'manual'),
    v_total_quantity,
    nullif(trim(coalesce(p_operator_name, '')), ''),
    v_operation_note
  )
  returning id into v_operation_id;

  for rec in
    select
      ib.id as batch_id,
      ib.pallet_id as source_pallet_id,
      ib.material_id,
      m.material_code,
      ib.quantity,
      ib.production_date,
      ib.lot_no,
      ib.box_barcode,
      ib.stock_form,
      ib.date_code,
      ib.received_at,
      ib.created_at,
      ib.remark
    from public.inventory_batches ib
    join public.materials m on m.id = ib.material_id
    where ib.warehouse_id = v_warehouse_id
      and ib.location_id = v_source_location_id
      and ib.deleted_at is null
      and ib.batch_status = 'active'
      and ib.quantity > 0
    order by ib.production_date, coalesce(ib.received_at, ib.created_at), ib.created_at, ib.id
    for update of ib
  loop
    v_line_no := v_line_no + 1;
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
      rec.source_pallet_id,
      v_source_location_id,
      rec.material_id,
      -rec.quantity,
      rec.quantity,
      0,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      format('Transfer out to %s', v_target_code)
    );

    select
      merged.batch_id,
      merged.quantity_before,
      merged.quantity_after
      into v_target_batch_id,
      v_target_before,
      v_target_after
    from public.upsert_active_inventory_batch(
      v_warehouse_id,
      v_target_pallet_id,
      v_target_location_id,
      rec.material_id,
      rec.quantity,
      rec.quantity,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      rec.date_code,
      coalesce(rec.stock_form, 'SEALED'),
      rec.received_at,
      rec.created_at,
      rec.remark
    ) merged;

    update public.inventory_batches
    set
      quantity = 0,
      batch_status = 'archived',
      box_barcode = null,
      closed_at = timezone('utc', now())
    where id = rec.batch_id;

    v_line_no := v_line_no + 1;
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
      v_target_batch_id,
      v_target_pallet_id,
      v_target_location_id,
      rec.material_id,
      rec.quantity,
      v_target_before,
      v_target_after,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      format('Transfer in from %s', v_source_code)
    );

    operation_id := v_operation_id;
    batch_id := v_target_batch_id;
    material_code := rec.material_code;
    moved_quantity := rec.quantity;
    source_location_code := v_source_code;
    target_location_code := v_target_code;
    return next;
  end loop;
end;
$$;

create or replace function public.transfer_inventory_batch(
  p_source_location_code text,
  p_batch_id uuid,
  p_target_location_code text,
  p_transfer_quantity numeric,
  p_warehouse_code text default 'MAIN',
  p_operator_name text default null,
  p_note text default null,
  p_source text default 'manual'
)
returns table (
  operation_id uuid,
  source_batch_id uuid,
  target_batch_id uuid,
  material_code text,
  moved_quantity numeric,
  source_location_code text,
  target_location_code text,
  source_remaining_quantity numeric,
  target_quantity numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_warehouse_id uuid;
  v_source_location_id uuid;
  v_source_location_status text;
  v_target_location_id uuid;
  v_target_pallet_id uuid;
  v_target_location_type text;
  v_target_location_status text;
  v_source_code text;
  v_target_code text;
  v_operation_id uuid;
  v_line_no integer := 0;
  v_target_stock_form text;
  v_operation_note text;
  v_has_other_material boolean;
  v_new_target_batch_id uuid;
  v_source_after_quantity numeric(18, 3);
  v_target_after_quantity numeric(18, 3);
  v_target_before_quantity numeric(18, 3);
  v_target_box_barcode text;
  v_source_batch record;
begin
  if p_source_location_code is null or trim(p_source_location_code) = '' then
    raise exception 'Source location code is required.';
  end if;

  if p_batch_id is null then
    raise exception 'Batch id is required.';
  end if;

  if p_target_location_code is null or trim(p_target_location_code) = '' then
    raise exception 'Target location code is required.';
  end if;

  if p_transfer_quantity is null or p_transfer_quantity <= 0 then
    raise exception 'Transfer quantity must be greater than zero.';
  end if;

  v_source_code := upper(trim(p_source_location_code));
  v_target_code := upper(trim(p_target_location_code));

  if v_source_code = v_target_code then
    raise exception 'Source and target locations must be different.';
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
    l.id,
    l.status
    into v_source_location_id,
    v_source_location_status
  from public.locations l
  where l.warehouse_id = v_warehouse_id
    and l.location_code = v_source_code
    and l.deleted_at is null
  limit 1;

  if v_source_location_id is null then
    raise exception 'Source location % does not exist.', p_source_location_code;
  end if;

  if v_source_location_status = 'disabled' then
    raise exception 'Source location % is disabled.', v_source_code;
  end if;

  select
    ib.id as batch_id,
    ib.pallet_id,
    ib.location_id,
    ib.material_id,
    m.material_code,
    ib.quantity,
    ib.production_date,
    ib.lot_no,
    ib.box_barcode,
    ib.stock_form,
    ib.date_code,
    ib.received_at,
    ib.created_at,
    ib.remark
    into v_source_batch
  from public.inventory_batches ib
  join public.materials m on m.id = ib.material_id
  where ib.id = p_batch_id
    and ib.warehouse_id = v_warehouse_id
    and ib.location_id = v_source_location_id
    and ib.deleted_at is null
    and ib.batch_status = 'active'
    and ib.quantity > 0
  for update of ib;

  if not found then
    raise exception 'Batch % does not belong to source location %.', p_batch_id, v_source_code;
  end if;

  if p_transfer_quantity > v_source_batch.quantity then
    raise exception 'Transfer quantity % exceeds available quantity % for batch %.', p_transfer_quantity, v_source_batch.quantity, p_batch_id;
  end if;

  select
    resolved.location_id,
    resolved.pallet_id,
    resolved.location_code,
    resolved.location_type,
    resolved.location_status
    into v_target_location_id,
    v_target_pallet_id,
    v_target_code,
    v_target_location_type,
    v_target_location_status
  from public.ensure_transfer_location(v_warehouse_id, v_target_code, false) resolved;

  if v_target_location_status <> 'active' then
    raise exception 'Target location % is not active.', v_target_code;
  end if;

  if v_target_location_type in ('RECEIVING', 'SHIPPING') then
    raise exception 'Target location % cannot receive transfer inventory.', v_target_code;
  end if;

  if v_target_location_type = 'OPEN_STOCK_BIN' then
    select exists (
      select 1
      from public.inventory_batches ib
      where ib.location_id = v_target_location_id
        and ib.deleted_at is null
        and ib.batch_status = 'active'
        and ib.quantity > 0
        and ib.material_id <> v_source_batch.material_id
    )
      into v_has_other_material;

    if v_has_other_material then
      raise exception 'Open-stock bin % already contains another material.', v_target_code;
    end if;
  end if;

  v_target_stock_form := case
    when v_target_location_type in ('OPEN_STOCK_SHELF', 'OPEN_STOCK_BIN') then 'OPEN'
    when p_transfer_quantity < v_source_batch.quantity then 'OPEN'
    else coalesce(v_source_batch.stock_form, 'SEALED')
  end;
  v_target_box_barcode := case
    when v_target_stock_form = 'OPEN' then null
    else v_source_batch.box_barcode
  end;
  v_operation_note := nullif(trim(coalesce(p_note, '')), '');
  if v_operation_note is null then
    v_operation_note := format('Batch transfer %s -> %s', v_source_code, v_target_code);
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
    'transfer',
    coalesce(nullif(trim(p_source), ''), 'manual'),
    v_source_batch.material_id,
    p_transfer_quantity,
    nullif(trim(coalesce(p_operator_name, '')), ''),
    v_operation_note
  )
  returning id into v_operation_id;

  v_source_after_quantity := v_source_batch.quantity - p_transfer_quantity;

  update public.inventory_batches
  set
    quantity = v_source_after_quantity,
    stock_form = case when v_source_after_quantity > 0 then 'OPEN' else inventory_batches.stock_form end,
    batch_status = case when v_source_after_quantity = 0 then 'archived' else 'active' end,
    box_barcode = case when v_source_after_quantity = 0 then null else inventory_batches.box_barcode end,
    closed_at = case when v_source_after_quantity = 0 then timezone('utc', now()) else null end
  where id = v_source_batch.batch_id;

  v_line_no := v_line_no + 1;
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
    v_source_batch.batch_id,
    v_source_batch.pallet_id,
    v_source_location_id,
    v_source_batch.material_id,
    -p_transfer_quantity,
    v_source_batch.quantity,
    v_source_after_quantity,
    v_source_batch.production_date,
    v_source_batch.lot_no,
    v_source_batch.box_barcode,
    format('Transfer out to %s', v_target_code)
  );

  select
    merged.batch_id,
    merged.quantity_before,
    merged.quantity_after
    into v_new_target_batch_id,
    v_target_before_quantity,
    v_target_after_quantity
  from public.upsert_active_inventory_batch(
    v_warehouse_id,
    v_target_pallet_id,
    v_target_location_id,
    v_source_batch.material_id,
    p_transfer_quantity,
    p_transfer_quantity,
    v_source_batch.production_date,
    v_source_batch.lot_no,
    v_target_box_barcode,
    v_source_batch.date_code,
    v_target_stock_form,
    v_source_batch.received_at,
    v_source_batch.created_at,
    v_source_batch.remark
  ) merged;

  v_line_no := v_line_no + 1;
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
    v_new_target_batch_id,
    v_target_pallet_id,
    v_target_location_id,
    v_source_batch.material_id,
    p_transfer_quantity,
    v_target_before_quantity,
    v_target_after_quantity,
    v_source_batch.production_date,
    v_source_batch.lot_no,
    v_target_box_barcode,
    format('Transfer in from %s', v_source_code)
  );

  operation_id := v_operation_id;
  source_batch_id := v_source_batch.batch_id;
  target_batch_id := v_new_target_batch_id;
  material_code := v_source_batch.material_code;
  moved_quantity := p_transfer_quantity;
  source_location_code := v_source_code;
  target_location_code := v_target_code;
  source_remaining_quantity := v_source_after_quantity;
  target_quantity := v_target_after_quantity;
  return next;
end;
$$;
