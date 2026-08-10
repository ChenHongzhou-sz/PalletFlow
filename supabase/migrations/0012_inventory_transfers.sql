alter table public.stock_operations
  drop constraint if exists stock_operations_operation_type_check;

alter table public.stock_operations
  add constraint stock_operations_operation_type_check
  check (operation_type in ('inbound', 'outbound', 'cycle_count', 'clear_pallet', 'adjustment', 'transfer'));

create or replace function public.ensure_transfer_location(
  p_warehouse_id uuid,
  p_location_code text,
  p_allow_fallback_other boolean default false
)
returns table (
  location_id uuid,
  pallet_id uuid,
  location_code text,
  location_name text,
  location_type text,
  location_status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_location_code text;
  v_parent_location_id uuid;
begin
  if p_warehouse_id is null then
    raise exception 'Warehouse is required.';
  end if;

  if p_location_code is null or trim(p_location_code) = '' then
    raise exception 'Target location code is required.';
  end if;

  v_location_code := upper(trim(p_location_code));

  select
    l.id,
    linked_pallet.id,
    l.location_name,
    l.location_type,
    l.status
    into location_id,
    pallet_id,
    location_name,
    location_type,
    location_status
  from public.locations l
  left join public.pallets linked_pallet
    on linked_pallet.location_id = l.id
   and linked_pallet.deleted_at is null
  where l.warehouse_id = p_warehouse_id
    and l.location_code = v_location_code
    and l.deleted_at is null
  limit 1;

  if location_id is null then
    if v_location_code ~ '^S[0-9]{2,}-[0-9]{2,}$' then
      select id
        into v_parent_location_id
      from public.locations
      where warehouse_id = p_warehouse_id
        and location_code = split_part(v_location_code, '-', 1)
        and deleted_at is null
      limit 1;
    end if;

    location_type := case
      when v_location_code ~ '^P[0-9]{2,}$' then 'FIXED_PALLET'
      when v_location_code ~ '^M[0-9]{2,}$' then 'MOBILE_PALLET'
      when v_location_code ~ '^S[0-9]{2,}-[0-9]{2,}$' then 'OPEN_STOCK_BIN'
      when v_location_code ~ '^S[0-9]{2,}$' then 'OPEN_STOCK_SHELF'
      when p_allow_fallback_other then 'OTHER'
      else null
    end;

    if location_type is null then
      raise exception 'Target location % is not a supported transfer destination. Use Pxx, Mxx, Sxx or Sxx-yy.', v_location_code;
    end if;

    location_name := v_location_code;
    location_status := 'active';

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
      p_warehouse_id,
      v_location_code,
      location_name,
      location_type,
      v_parent_location_id,
      'active',
      true,
      case when location_type = 'MOBILE_PALLET' then true else false end,
      1000
    )
    returning id into location_id;
  end if;

  if location_type in ('FIXED_PALLET', 'MOBILE_PALLET') then
    insert into public.pallets (warehouse_id, pallet_code, status, location_id)
    values (p_warehouse_id, v_location_code, 'active', location_id)
    on conflict (warehouse_id, pallet_code)
    do update set
      status = 'active',
      location_id = excluded.location_id,
      updated_at = timezone('utc', now())
    returning id into pallet_id;
  else
    select existing_pallet.id
      into pallet_id
    from public.pallets existing_pallet
    where existing_pallet.location_id = location_id
      and existing_pallet.deleted_at is null
    limit 1;
  end if;

  location_code := v_location_code;
  return next;
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
  v_target_location_name text;
  v_target_location_type text;
  v_target_location_status text;
  v_source_code text;
  v_target_code text;
  v_operation_id uuid;
  v_line_no integer := 0;
  v_total_quantity numeric(18, 3);
  v_operation_note text;
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
    resolved.location_name,
    resolved.location_type,
    resolved.location_status
    into v_target_location_id,
    v_target_pallet_id,
    v_target_code,
    v_target_location_name,
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
      ib.stock_form
    from public.inventory_batches ib
    join public.materials m on m.id = ib.material_id
    where ib.warehouse_id = v_warehouse_id
      and ib.location_id = v_source_location_id
      and ib.deleted_at is null
      and ib.batch_status = 'active'
      and ib.quantity > 0
    order by ib.production_date, ib.created_at, ib.id
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

    update public.inventory_batches
    set
      pallet_id = v_target_pallet_id,
      location_id = v_target_location_id,
      stock_form = coalesce(rec.stock_form, 'SEALED'),
      closed_at = null
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
      rec.batch_id,
      v_target_pallet_id,
      v_target_location_id,
      rec.material_id,
      rec.quantity,
      0,
      rec.quantity,
      rec.production_date,
      rec.lot_no,
      rec.box_barcode,
      format('Transfer in from %s', v_source_code)
    );

    operation_id := v_operation_id;
    batch_id := rec.batch_id;
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
  v_target_location_name text;
  v_target_location_type text;
  v_target_location_status text;
  v_source_code text;
  v_target_code text;
  v_operation_id uuid;
  v_line_no integer := 0;
  v_target_stock_form text;
  v_operation_note text;
  v_is_full_transfer boolean;
  v_has_other_material boolean;
  v_new_target_batch_id uuid;
  v_source_after_quantity numeric(18, 3);
  v_target_after_quantity numeric(18, 3);
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
    resolved.location_name,
    resolved.location_type,
    resolved.location_status
    into v_target_location_id,
    v_target_pallet_id,
    v_target_code,
    v_target_location_name,
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

  v_is_full_transfer := p_transfer_quantity = v_source_batch.quantity;
  v_target_stock_form := case
    when v_target_location_type in ('OPEN_STOCK_SHELF', 'OPEN_STOCK_BIN') then 'OPEN'
    when not v_is_full_transfer then 'OPEN'
    else coalesce(v_source_batch.stock_form, 'SEALED')
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

  if v_is_full_transfer then
    v_source_after_quantity := 0;
    v_target_after_quantity := v_source_batch.quantity;
    v_target_box_barcode := case
      when v_target_location_type in ('OPEN_STOCK_SHELF', 'OPEN_STOCK_BIN') then null
      else v_source_batch.box_barcode
    end;

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
      -v_source_batch.quantity,
      v_source_batch.quantity,
      0,
      v_source_batch.production_date,
      v_source_batch.lot_no,
      v_source_batch.box_barcode,
      format('Transfer out to %s', v_target_code)
    );

    update public.inventory_batches
    set
      pallet_id = v_target_pallet_id,
      location_id = v_target_location_id,
      stock_form = v_target_stock_form,
      box_barcode = v_target_box_barcode,
      closed_at = null
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
      v_target_pallet_id,
      v_target_location_id,
      v_source_batch.material_id,
      v_source_batch.quantity,
      0,
      v_source_batch.quantity,
      v_source_batch.production_date,
      v_source_batch.lot_no,
      v_target_box_barcode,
      format('Transfer in from %s', v_source_code)
    );

    v_new_target_batch_id := v_source_batch.batch_id;
  else
    v_source_after_quantity := v_source_batch.quantity - p_transfer_quantity;
    v_target_after_quantity := p_transfer_quantity;
    v_target_box_barcode := null;

    update public.inventory_batches
    set
      quantity = v_source_after_quantity,
      stock_form = 'OPEN',
      batch_status = 'active',
      closed_at = null
    where id = v_source_batch.batch_id;

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
      v_warehouse_id,
      v_target_pallet_id,
      v_target_location_id,
      v_source_batch.material_id,
      p_transfer_quantity,
      p_transfer_quantity,
      v_source_batch.production_date,
      v_source_batch.lot_no,
      null,
      'active',
      v_source_batch.remark,
      v_source_batch.date_code,
      v_target_stock_form,
      v_source_batch.received_at,
      v_source_batch.created_at
    )
    returning id into v_new_target_batch_id;

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
      0,
      p_transfer_quantity,
      v_source_batch.production_date,
      v_source_batch.lot_no,
      v_target_box_barcode,
      format('Transfer in from %s', v_source_code)
    );
  end if;

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

revoke all on function public.ensure_transfer_location(uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.transfer_location_inventory(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.transfer_inventory_batch(text, uuid, text, numeric, text, text, text, text) to anon, authenticated;
