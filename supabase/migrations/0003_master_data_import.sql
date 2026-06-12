create table if not exists public.master_data_import_runs (
  id uuid primary key default gen_random_uuid(),
  import_type text not null check (import_type in ('materials', 'barcode_aliases')),
  source_file_name text,
  operator_name text,
  processed_rows integer not null default 0 check (processed_rows >= 0),
  created_rows integer not null default 0 check (created_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists master_data_import_runs_type_created_idx
  on public.master_data_import_runs (import_type, created_at desc);

create or replace function public.bulk_upsert_materials(
  p_rows jsonb,
  p_source_file_name text default null,
  p_operator_name text default null
)
returns jsonb
language plpgsql
as $$
declare
  rec record;
  v_existing_id uuid;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_processed_count integer := 0;
  v_import_run_id uuid;
  v_duplicate_codes text;
  v_material_code text;
  v_short_code text;
  v_description text;
  v_category text;
  v_specification text;
  v_image_url text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Material import payload must be a JSON array.';
  end if;

  select string_agg(material_code, ', ')
    into v_duplicate_codes
  from (
    select lower(trim(item->>'material_code')) as material_code
    from jsonb_array_elements(p_rows) item
    where nullif(trim(coalesce(item->>'material_code', '')), '') is not null
    group by lower(trim(item->>'material_code'))
    having count(*) > 1
  ) duplicates;

  if v_duplicate_codes is not null then
    raise exception 'Duplicate material_code values found in one upload: %', v_duplicate_codes;
  end if;

  for rec in
    select
      item->>'material_code' as material_code,
      item->>'short_code' as short_code,
      item->>'description' as description,
      item->>'category' as category,
      item->>'specification' as specification,
      item->>'image_url' as image_url
    from jsonb_array_elements(p_rows) item
  loop
    v_material_code := nullif(trim(coalesce(rec.material_code, '')), '');

    if v_material_code is null then
      raise exception 'material_code is required for every materials import row.';
    end if;

    v_short_code := nullif(trim(coalesce(rec.short_code, '')), '');
    v_description := nullif(trim(coalesce(rec.description, '')), '');
    v_category := nullif(trim(coalesce(rec.category, '')), '');
    v_specification := nullif(trim(coalesce(rec.specification, '')), '');
    v_image_url := nullif(trim(coalesce(rec.image_url, '')), '');

    select id
      into v_existing_id
    from public.materials
    where lower(material_code) = lower(v_material_code)
      and deleted_at is null
    limit 1;

    if v_existing_id is null then
      insert into public.materials (
        material_code,
        short_code,
        description,
        category,
        specification,
        image_url,
        is_active
      )
      values (
        v_material_code,
        v_short_code,
        v_description,
        v_category,
        v_specification,
        v_image_url,
        true
      );

      v_created_count := v_created_count + 1;
    else
      update public.materials
      set
        short_code = coalesce(v_short_code, short_code),
        description = coalesce(v_description, description),
        category = coalesce(v_category, category),
        specification = coalesce(v_specification, specification),
        image_url = coalesce(v_image_url, image_url),
        is_active = true
      where id = v_existing_id;

      v_updated_count := v_updated_count + 1;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

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
    'materials',
    nullif(trim(coalesce(p_source_file_name, '')), ''),
    nullif(trim(coalesce(p_operator_name, '')), ''),
    v_processed_count,
    v_created_count,
    v_updated_count,
    0,
    jsonb_build_object(
      'preserve_empty_fields', true,
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

create or replace function public.bulk_upsert_barcode_aliases(
  p_rows jsonb,
  p_source_file_name text default null,
  p_operator_name text default null
)
returns jsonb
language plpgsql
as $$
declare
  rec record;
  v_material_id uuid;
  v_existing_id uuid;
  v_existing_material_id uuid;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_processed_count integer := 0;
  v_import_run_id uuid;
  v_duplicate_barcodes text;
  v_barcode text;
  v_material_code text;
  v_remark text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Barcode import payload must be a JSON array.';
  end if;

  select string_agg(barcode, ', ')
    into v_duplicate_barcodes
  from (
    select trim(item->>'barcode') as barcode
    from jsonb_array_elements(p_rows) item
    where nullif(trim(coalesce(item->>'barcode', '')), '') is not null
    group by trim(item->>'barcode')
    having count(*) > 1
  ) duplicates;

  if v_duplicate_barcodes is not null then
    raise exception 'Duplicate barcode values found in one upload: %', v_duplicate_barcodes;
  end if;

  for rec in
    select
      item->>'barcode' as barcode,
      item->>'material_code' as material_code,
      item->>'remark' as remark
    from jsonb_array_elements(p_rows) item
  loop
    v_barcode := nullif(trim(coalesce(rec.barcode, '')), '');
    v_material_code := nullif(trim(coalesce(rec.material_code, '')), '');
    v_remark := nullif(trim(coalesce(rec.remark, '')), '');

    if v_barcode is null then
      raise exception 'barcode is required for every barcode import row.';
    end if;

    if v_material_code is null then
      raise exception 'material_code is required for every barcode import row.';
    end if;

    select id
      into v_material_id
    from public.materials
    where lower(material_code) = lower(v_material_code)
      and deleted_at is null
      and is_active = true
    limit 1;

    if v_material_id is null then
      raise exception 'material_code % does not exist in active materials.', v_material_code;
    end if;

    select id, material_id
      into v_existing_id, v_existing_material_id
    from public.barcode_aliases
    where barcode = v_barcode
      and deleted_at is null
    limit 1;

    if v_existing_id is null then
      insert into public.barcode_aliases (
        material_id,
        barcode,
        remark,
        is_active
      )
      values (
        v_material_id,
        v_barcode,
        v_remark,
        true
      );

      v_created_count := v_created_count + 1;
    else
      if v_existing_material_id <> v_material_id then
        raise exception 'barcode % already belongs to another material.', v_barcode;
      end if;

      update public.barcode_aliases
      set
        remark = coalesce(v_remark, remark),
        is_active = true
      where id = v_existing_id;

      v_updated_count := v_updated_count + 1;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

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
    'barcode_aliases',
    nullif(trim(coalesce(p_source_file_name, '')), ''),
    nullif(trim(coalesce(p_operator_name, '')), ''),
    v_processed_count,
    v_created_count,
    v_updated_count,
    0,
    jsonb_build_object(
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
