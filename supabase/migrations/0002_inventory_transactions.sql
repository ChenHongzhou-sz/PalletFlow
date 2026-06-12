create or replace view public.v_operation_log_lines as
select
  so.id as operation_id,
  so.operation_type,
  so.created_at,
  so.operator_name,
  so.note as operation_note,
  w.warehouse_code,
  p.pallet_code,
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
  sol.remark as line_remark
from public.stock_operation_lines sol
join public.stock_operations so on so.id = sol.operation_id
join public.pallets p on p.id = sol.pallet_id
join public.warehouses w on w.id = so.warehouse_id
join public.materials m on m.id = sol.material_id;

create or replace function public.create_inbound_batch(
  p_warehouse_code text default 'MAIN',
  p_pallet_code text,
  p_material_code text,
  p_quantity numeric,
  p_production_date date,
  p_lot_no text default null,
  p_box_barcode text default null,
  p_operator_name text default null,
  p_note text default null,
  p_source text default 'manual'
)
returns uuid
language plpgsql
as $$
declare
  v_warehouse_id uuid;
  v_pallet_id uuid;
  v_material_id uuid;
  v_operation_id uuid;
  v_batch_id uuid;
  v_pallet_code text;
  v_production_date date;
begin
  if p_pallet_code is null or trim(p_pallet_code) = '' then
    raise exception 'Pallet code is required.';
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

  v_pallet_code := upper(trim(p_pallet_code));
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

  insert into public.pallets (warehouse_id, pallet_code, status)
  values (v_warehouse_id, v_pallet_code, 'active')
  on conflict (warehouse_id, pallet_code)
  do update set
    status = 'active',
    updated_at = timezone('utc', now())
  returning id into v_pallet_id;

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
      p.pallet_code,
      ib.material_id,
      ib.quantity as available_quantity,
      ib.production_date,
      ib.lot_no,
      ib.box_barcode,
      ib.batch_status
    from public.inventory_batches ib
    join public.pallets p on p.id = ib.pallet_id
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
  p_warehouse_code text default 'MAIN',
  p_pallet_code text,
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
as $$
declare
  v_warehouse_id uuid;
  v_pallet_id uuid;
  v_operation_id uuid;
  v_line_no integer := 0;
  rec record;
begin
  if p_pallet_code is null or trim(p_pallet_code) = '' then
    raise exception 'Pallet code is required.';
  end if;

  select w.id, p.id
    into v_warehouse_id, v_pallet_id
  from public.pallets p
  join public.warehouses w on w.id = p.warehouse_id
  where w.warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and p.pallet_code = upper(trim(p_pallet_code))
    and p.deleted_at is null
  limit 1;

  if v_pallet_id is null then
    raise exception 'Pallet % does not exist.', p_pallet_code;
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
      ib.material_id,
      ib.quantity,
      ib.production_date,
      ib.lot_no,
      ib.box_barcode,
      m.material_code
    from public.inventory_batches ib
    join public.materials m on m.id = ib.material_id
    where ib.pallet_id = v_pallet_id
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
      rec.material_id,
      -rec.quantity,
      rec.quantity,
      0,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      'Pallet cleared'
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
  p_warehouse_code text default 'MAIN',
  p_pallet_code text,
  p_items jsonb,
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
as $$
declare
  v_warehouse_id uuid;
  v_pallet_id uuid;
  v_count_id uuid;
  v_operation_id uuid;
  v_line_no integer := 0;
  rec record;
  v_batch record;
  v_variance numeric(18, 3);
begin
  if p_pallet_code is null or trim(p_pallet_code) = '' then
    raise exception 'Pallet code is required.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Cycle count items must be a JSON array.';
  end if;

  select w.id, p.id
    into v_warehouse_id, v_pallet_id
  from public.pallets p
  join public.warehouses w on w.id = p.warehouse_id
  where w.warehouse_code = coalesce(nullif(trim(p_warehouse_code), ''), 'MAIN')
    and p.pallet_code = upper(trim(p_pallet_code))
    and p.deleted_at is null
  limit 1;

  if v_pallet_id is null then
    raise exception 'Pallet % does not exist.', p_pallet_code;
  end if;

  insert into public.inventory_counts (
    warehouse_id,
    pallet_id,
    count_status,
    operator_name,
    note,
    snapshot_at,
    completed_at
  )
  values (
    v_warehouse_id,
    v_pallet_id,
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
      and ib.pallet_id = v_pallet_id
      and ib.deleted_at is null
    for update of ib;

    if not found then
      raise exception 'Batch % does not belong to pallet %.', rec.batch_id, p_pallet_code;
    end if;

    v_line_no := v_line_no + 1;
    v_variance := rec.counted_quantity - v_batch.system_quantity;

    insert into public.inventory_count_items (
      count_id,
      line_no,
      batch_id,
      pallet_id,
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
