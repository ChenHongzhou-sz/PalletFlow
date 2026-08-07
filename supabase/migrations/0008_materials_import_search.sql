alter table public.materials
  add column if not exists brand text,
  add column if not exists series text,
  add column if not exists manufacturer_part_no text,
  add column if not exists internal_part_no text,
  add column if not exists voltage_v numeric(12, 3),
  add column if not exists capacitance_value numeric(18, 6),
  add column if not exists capacitance_unit text,
  add column if not exists diameter_mm numeric(12, 3),
  add column if not exists height_mm numeric(12, 3),
  add column if not exists lifetime_h integer,
  add column if not exists temperature_c integer,
  add column if not exists standard_box_qty numeric(18, 3),
  add column if not exists moq numeric(18, 3),
  add column if not exists mpq numeric(18, 3),
  add column if not exists specification_raw text,
  add column if not exists search_aliases text[] not null default '{}'::text[];

alter table public.inventory_batches
  add column if not exists date_code text,
  add column if not exists stock_form text not null default 'SEALED'
    check (stock_form in ('SEALED', 'OPEN')),
  add column if not exists received_at timestamptz not null default timezone('utc', now());

create table if not exists public.material_aliases (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  alias_type text not null
    check (alias_type in ('CUSTOMER_PART_NO', 'SUPPLIER_PART_NO', 'OLD_PART_NO', 'MANUFACTURER_PART_NO', 'INTERNAL_PART_NO', 'SEARCH_ALIAS')),
  alias_value text not null,
  customer_name text,
  supplier_name text,
  remark text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create index if not exists material_aliases_material_idx
  on public.material_aliases (material_id)
  where deleted_at is null and is_active = true;

create index if not exists material_aliases_alias_trgm_idx
  on public.material_aliases
  using gin (lower(alias_value) gin_trgm_ops)
  where deleted_at is null and is_active = true;

create unique index if not exists material_aliases_material_alias_uk
  on public.material_aliases (material_id, alias_type, lower(alias_value))
  where deleted_at is null;

create index if not exists materials_voltage_idx
  on public.materials (voltage_v)
  where deleted_at is null and is_active = true and voltage_v is not null;

create index if not exists materials_capacitance_idx
  on public.materials (capacitance_value)
  where deleted_at is null and is_active = true and capacitance_value is not null;

create index if not exists materials_series_idx
  on public.materials (series)
  where deleted_at is null and is_active = true and series is not null;

create or replace function public.merge_text_arrays(
  p_left text[],
  p_right text[]
)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct value order by value), '{}'::text[])
  from unnest(coalesce(p_left, '{}'::text[]) || coalesce(p_right, '{}'::text[])) value
  where nullif(trim(value), '') is not null;
$$;

create or replace function public.normalize_material_query(p_value text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(lower(coalesce(p_value, '')), 'μ', 'u'),
              'µ', 'u'),
            '×', 'x'),
          '*', 'x'),
        'φ', ''),
      'Φ', ''),
      '[^a-z0-9.]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.parse_voltage_v(p_value text)
returns numeric
language sql
immutable
as $$
  with normalized as (
    select replace(public.normalize_material_query(p_value), ' ', '') as q
  )
  select case
    when q ~ '^[0-9]+(\.[0-9]+)?v?$'
      then regexp_replace(q, 'v$', '')::numeric
    else null
  end
  from normalized;
$$;

create or replace function public.parse_capacitance_uf(p_value text)
returns numeric
language sql
immutable
as $$
  with normalized as (
    select replace(public.normalize_material_query(p_value), ' ', '') as q
  )
  select case
    when q ~ '^[0-9]+(\.[0-9]+)?uf?$'
      then regexp_replace(q, 'u?f$', '')::numeric
    when q ~ '^[0-9]+(\.[0-9]+)?mf$'
      then regexp_replace(q, 'mf$', '')::numeric * 1000
    when q ~ '^[0-9]+(\.[0-9]+)?nf$'
      then regexp_replace(q, 'nf$', '')::numeric / 1000
    when q ~ '^[0-9]+(\.[0-9]+)?pf$'
      then regexp_replace(q, 'pf$', '')::numeric / 1000000
    when q ~ '^[0-9]+(\.[0-9]+)?f$'
      then regexp_replace(q, 'f$', '')::numeric * 1000000
    when q ~ '^[0-9]+(\.[0-9]+)?$'
      then q::numeric
    else null
  end
  from normalized;
$$;

create or replace function public.extract_dimension_token(p_value text)
returns text
language sql
immutable
as $$
  with normalized as (
    select public.normalize_material_query(p_value) as q
  ),
  matched as (
    select regexp_match(q, '([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)(?:\s*x\s*([0-9]+(?:\.[0-9]+)?))?') as m
    from normalized
  )
  select case
    when m is null then null
    else m[1] || 'x' || coalesce(m[3], m[2])
  end
  from matched;
$$;

create or replace function public.set_material_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_aliases := coalesce(new.search_aliases, '{}'::text[]);

  new.search_text := public.normalize_material_query(
    concat_ws(
      ' ',
      coalesce(new.material_code, ''),
      coalesce(new.short_code, ''),
      coalesce(new.description, ''),
      coalesce(new.category, ''),
      coalesce(new.specification, ''),
      coalesce(new.specification_raw, ''),
      coalesce(new.brand, ''),
      coalesce(new.series, ''),
      coalesce(new.manufacturer_part_no, ''),
      coalesce(new.internal_part_no, ''),
      case when new.voltage_v is not null then new.voltage_v::text || 'V' end,
      case when new.capacitance_value is not null then new.capacitance_value::text || coalesce(new.capacitance_unit, 'uF') end,
      case when new.diameter_mm is not null and new.height_mm is not null then new.diameter_mm::text || 'x' || new.height_mm::text end,
      case when new.lifetime_h is not null then new.lifetime_h::text || 'H' end,
      array_to_string(new.search_aliases, ' ')
    )
  );

  return new;
end;
$$;

drop trigger if exists material_aliases_set_updated_at on public.material_aliases;
create trigger material_aliases_set_updated_at
before update on public.material_aliases
for each row execute function public.set_updated_at();

update public.inventory_batches
set
  date_code = coalesce(date_code, to_char(production_date, 'YYMM')),
  stock_form = coalesce(stock_form, 'SEALED'),
  received_at = coalesce(received_at, created_at, timezone('utc', now()));

update public.materials
set
  specification_raw = coalesce(specification_raw, specification),
  search_aliases = coalesce(search_aliases, '{}'::text[]);

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
  ib.date_code,
  ib.stock_form,
  ib.received_at,
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
  count(distinct coalesce(ib.pallet_id, ib.location_id)) as pallet_count,
  count(distinct ib.location_id) as location_count,
  sum(case when ib.stock_form = 'OPEN' then ib.quantity else 0 end) as open_quantity,
  min(ib.production_date) as earliest_production_date,
  max(ib.production_date) as latest_production_date,
  min(ib.date_code) as oldest_date_code
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
  ib.date_code,
  ib.stock_form,
  ib.lot_no,
  ib.box_barcode,
  coalesce(ib.received_at, ib.created_at) as inbound_at,
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
  specification_raw text,
  brand text,
  series text,
  manufacturer_part_no text,
  internal_part_no text,
  voltage_v numeric,
  capacitance_value numeric,
  capacitance_unit text,
  diameter_mm numeric,
  height_mm numeric,
  lifetime_h integer,
  temperature_c integer,
  standard_box_qty numeric,
  moq numeric,
  mpq numeric,
  matched_by text,
  score real,
  total_quantity numeric,
  location_count integer,
  open_quantity numeric,
  oldest_date_code text,
  earliest_production_date date,
  latest_production_date date
)
language sql
stable
security definer
set search_path = public, extensions
as $$
with normalized as (
  select public.normalize_material_query(p_query) as q
),
tokens as (
  select token
  from normalized, regexp_split_to_table(q, '\s+') token
  where token <> ''
),
token_count as (
  select count(*) as total
  from tokens
),
alias_rows as (
  select
    ma.material_id,
    string_agg(public.normalize_material_query(ma.alias_value), ' ') as alias_blob,
    bool_or(public.normalize_material_query(ma.alias_value) = (select q from normalized)) as alias_exact,
    bool_or(public.normalize_material_query(ma.alias_value) like (select q from normalized) || '%') as alias_prefix
  from public.material_aliases ma
  where ma.deleted_at is null
    and ma.is_active = true
  group by ma.material_id
),
barcode_rows as (
  select
    ba.material_id,
    bool_or(public.normalize_material_query(ba.barcode) = (select q from normalized)) as barcode_exact
  from public.barcode_aliases ba
  where ba.deleted_at is null
    and ba.is_active = true
  group by ba.material_id
),
base as (
  select
    m.id as material_id,
    m.material_code,
    m.short_code,
    m.description,
    m.category,
    m.specification,
    m.specification_raw,
    m.brand,
    m.series,
    m.manufacturer_part_no,
    m.internal_part_no,
    m.voltage_v,
    m.capacitance_value,
    m.capacitance_unit,
    m.diameter_mm,
    m.height_mm,
    m.lifetime_h,
    m.temperature_c,
    m.standard_box_qty,
    m.moq,
    m.mpq,
    m.search_text,
    coalesce(array_to_string(m.search_aliases, ' '), '') as material_alias_blob,
    coalesce(ar.alias_blob, '') as alias_blob,
    coalesce(ar.alias_exact, false) as alias_exact,
    coalesce(ar.alias_prefix, false) as alias_prefix,
    coalesce(br.barcode_exact, false) as barcode_exact,
    public.extract_dimension_token(coalesce(m.diameter_mm::text, '') || 'x' || coalesce(m.height_mm::text, '')) as dimension_token
  from public.materials m
  left join alias_rows ar on ar.material_id = m.id
  left join barcode_rows br on br.material_id = m.id
  where m.deleted_at is null
    and m.is_active = true
),
token_scored as (
  select
    b.*,
    n.q,
    coalesce(summary.total_quantity, 0) as total_quantity,
    coalesce(summary.location_count, 0)::integer as location_count,
    coalesce(summary.open_quantity, 0) as open_quantity,
    summary.oldest_date_code,
    summary.earliest_production_date,
    summary.latest_production_date,
    (
      select count(*)
      from tokens t
      where
        b.search_text like '%' || t.token || '%'
        or public.normalize_material_query(b.material_alias_blob) like '%' || t.token || '%'
        or public.normalize_material_query(b.alias_blob) like '%' || t.token || '%'
        or public.normalize_material_query(coalesce(b.manufacturer_part_no, '')) like '%' || t.token || '%'
        or public.normalize_material_query(coalesce(b.internal_part_no, '')) like '%' || t.token || '%'
        or public.normalize_material_query(coalesce(b.series, '')) like '%' || t.token || '%'
        or (public.parse_voltage_v(t.token) is not null and b.voltage_v is not null and b.voltage_v = public.parse_voltage_v(t.token))
        or (public.parse_capacitance_uf(t.token) is not null and b.capacitance_value is not null and b.capacitance_value = public.parse_capacitance_uf(t.token))
        or (public.extract_dimension_token(t.token) is not null and b.dimension_token is not null and b.dimension_token = public.extract_dimension_token(t.token))
    ) as matched_token_count,
    (
      select count(*)
      from tokens t
      where
        (public.parse_voltage_v(t.token) is not null and b.voltage_v is not null and b.voltage_v = public.parse_voltage_v(t.token))
        or (public.parse_capacitance_uf(t.token) is not null and b.capacitance_value is not null and b.capacitance_value = public.parse_capacitance_uf(t.token))
        or (public.extract_dimension_token(t.token) is not null and b.dimension_token is not null and b.dimension_token = public.extract_dimension_token(t.token))
        or (length(t.token) >= 2 and public.normalize_material_query(coalesce(b.series, '')) like '%' || t.token || '%')
    ) as structured_match_count,
    greatest(
      similarity(public.normalize_material_query(b.material_code), n.q),
      similarity(public.normalize_material_query(coalesce(b.short_code, '')), n.q),
      similarity(public.normalize_material_query(coalesce(b.description, '')), n.q),
      similarity(public.normalize_material_query(coalesce(b.specification_raw, '')), n.q),
      similarity(public.normalize_material_query(coalesce(b.series, '')), n.q),
      similarity(public.normalize_material_query(coalesce(b.alias_blob, '')), n.q),
      similarity(public.normalize_material_query(coalesce(b.search_text, '')), n.q)
    ) as fuzzy_score
  from base b
  cross join normalized n
  left join public.v_material_inventory_summary summary on summary.material_id = b.material_id
),
scored as (
  select
    ts.*,
    case
      when ts.barcode_exact then 'barcode'
      when public.normalize_material_query(ts.material_code) = ts.q then 'material_code_exact'
      when ts.alias_exact then 'material_alias_exact'
      when public.normalize_material_query(coalesce(ts.short_code, '')) = ts.q then 'short_code_exact'
      when public.normalize_material_query(coalesce(ts.manufacturer_part_no, '')) = ts.q then 'manufacturer_part_no_exact'
      when public.normalize_material_query(coalesce(ts.internal_part_no, '')) = ts.q then 'internal_part_no_exact'
      when public.normalize_material_query(ts.material_code) like ts.q || '%' then 'material_code_prefix'
      when ts.alias_prefix then 'material_alias_prefix'
      when ts.structured_match_count >= 2 then 'structured'
      when ts.matched_token_count >= greatest((select total from token_count), 1) then 'contains'
      else 'fuzzy'
    end as matched_by,
    (
      case
        when ts.barcode_exact then 1000
        when public.normalize_material_query(ts.material_code) = ts.q then 900
        when ts.alias_exact then 850
        when public.normalize_material_query(coalesce(ts.short_code, '')) = ts.q then 800
        when public.normalize_material_query(coalesce(ts.manufacturer_part_no, '')) = ts.q then 780
        when public.normalize_material_query(coalesce(ts.internal_part_no, '')) = ts.q then 760
        when public.normalize_material_query(ts.material_code) like ts.q || '%' then 700
        when ts.alias_prefix then 680
        when ts.structured_match_count >= 2 then 620
        when ts.matched_token_count >= greatest((select total from token_count), 1) then 540
        else 400
      end
      + ts.structured_match_count * 50
      + ts.matched_token_count * 10
      + ts.fuzzy_score * 100
      + case when ts.total_quantity > 0 then 5 else 0 end
    )::real as score
  from token_scored ts
),
filtered as (
  select *
  from scored
  where q <> ''
    and (
      barcode_exact
      or public.normalize_material_query(material_code) like '%' || q || '%'
      or public.normalize_material_query(coalesce(short_code, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(description, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(category, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(specification_raw, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(brand, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(series, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(manufacturer_part_no, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(internal_part_no, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(alias_blob, '')) like '%' || q || '%'
      or public.normalize_material_query(coalesce(material_alias_blob, '')) like '%' || q || '%'
      or matched_token_count >= greatest((select total from token_count), 1)
      or structured_match_count > 0
      or fuzzy_score >= 0.10
    )
)
select
  material_id,
  material_code,
  short_code,
  description,
  category,
  specification,
  specification_raw,
  brand,
  series,
  manufacturer_part_no,
  internal_part_no,
  voltage_v,
  capacitance_value,
  capacitance_unit,
  diameter_mm,
  height_mm,
  lifetime_h,
  temperature_c,
  standard_box_qty,
  moq,
  mpq,
  matched_by,
  score,
  total_quantity,
  location_count,
  open_quantity,
  oldest_date_code,
  earliest_production_date,
  latest_production_date
from filtered
order by
  case matched_by
    when 'barcode' then 1
    when 'material_code_exact' then 2
    when 'material_alias_exact' then 3
    when 'short_code_exact' then 4
    when 'manufacturer_part_no_exact' then 5
    when 'internal_part_no_exact' then 6
    when 'material_code_prefix' then 7
    when 'material_alias_prefix' then 8
    when 'structured' then 9
    when 'contains' then 10
    else 11
  end,
  structured_match_count desc,
  matched_token_count desc,
  total_quantity desc,
  score desc,
  material_code
limit greatest(coalesce(p_limit, 20), 1);
$$;

create or replace function public.bulk_upsert_materials(
  p_rows jsonb,
  p_source_file_name text default null,
  p_operator_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec record;
  v_material_id uuid;
  v_existing_id uuid;
  v_existing_alias_id uuid;
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
  v_specification_raw text;
  v_image_url text;
  v_brand text;
  v_series text;
  v_manufacturer_part_no text;
  v_internal_part_no text;
  v_voltage_v numeric(12, 3);
  v_capacitance_value numeric(18, 6);
  v_capacitance_unit text;
  v_diameter_mm numeric(12, 3);
  v_height_mm numeric(12, 3);
  v_lifetime_h integer;
  v_temperature_c integer;
  v_standard_box_qty numeric(18, 3);
  v_moq numeric(18, 3);
  v_mpq numeric(18, 3);
  v_search_aliases text[];
  v_alias_type text;
  v_alias_value text;
  v_customer_name text;
  v_supplier_name text;
  v_remark text;
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
      item->>'specification_raw' as specification_raw,
      item->>'image_url' as image_url,
      item->>'brand' as brand,
      item->>'series' as series,
      item->>'manufacturer_part_no' as manufacturer_part_no,
      item->>'internal_part_no' as internal_part_no,
      item->>'voltage_v' as voltage_v,
      item->>'capacitance_value' as capacitance_value,
      item->>'capacitance_unit' as capacitance_unit,
      item->>'diameter_mm' as diameter_mm,
      item->>'height_mm' as height_mm,
      item->>'lifetime_h' as lifetime_h,
      item->>'temperature_c' as temperature_c,
      item->>'standard_box_qty' as standard_box_qty,
      item->>'moq' as moq,
      item->>'mpq' as mpq,
      coalesce(item->'search_aliases', '[]'::jsonb) as search_aliases,
      item->>'alias_type' as alias_type,
      item->>'alias_value' as alias_value,
      item->>'customer_name' as customer_name,
      item->>'supplier_name' as supplier_name,
      item->>'remark' as remark
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
    v_specification_raw := nullif(trim(coalesce(rec.specification_raw, '')), '');
    v_image_url := nullif(trim(coalesce(rec.image_url, '')), '');
    v_brand := nullif(trim(coalesce(rec.brand, '')), '');
    v_series := nullif(trim(coalesce(rec.series, '')), '');
    v_manufacturer_part_no := nullif(trim(coalesce(rec.manufacturer_part_no, '')), '');
    v_internal_part_no := nullif(trim(coalesce(rec.internal_part_no, '')), '');
    v_voltage_v := nullif(trim(coalesce(rec.voltage_v, '')), '')::numeric;
    v_capacitance_value := nullif(trim(coalesce(rec.capacitance_value, '')), '')::numeric;
    v_capacitance_unit := nullif(trim(coalesce(rec.capacitance_unit, '')), '');
    v_diameter_mm := nullif(trim(coalesce(rec.diameter_mm, '')), '')::numeric;
    v_height_mm := nullif(trim(coalesce(rec.height_mm, '')), '')::numeric;
    v_lifetime_h := nullif(trim(coalesce(rec.lifetime_h, '')), '')::integer;
    v_temperature_c := nullif(trim(coalesce(rec.temperature_c, '')), '')::integer;
    v_standard_box_qty := nullif(trim(coalesce(rec.standard_box_qty, '')), '')::numeric;
    v_moq := nullif(trim(coalesce(rec.moq, '')), '')::numeric;
    v_mpq := nullif(trim(coalesce(rec.mpq, '')), '')::numeric;
    v_alias_type := nullif(trim(coalesce(rec.alias_type, '')), '');
    v_alias_value := nullif(trim(coalesce(rec.alias_value, '')), '');
    v_customer_name := nullif(trim(coalesce(rec.customer_name, '')), '');
    v_supplier_name := nullif(trim(coalesce(rec.supplier_name, '')), '');
    v_remark := nullif(trim(coalesce(rec.remark, '')), '');

    select coalesce(array_agg(distinct alias order by alias), '{}'::text[])
      into v_search_aliases
    from (
      select public.normalize_material_query(raw.value) as alias
      from jsonb_array_elements_text(rec.search_aliases) as raw(value)
    ) aliases
    where alias is not null
      and alias <> '';

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
        specification_raw,
        image_url,
        brand,
        series,
        manufacturer_part_no,
        internal_part_no,
        voltage_v,
        capacitance_value,
        capacitance_unit,
        diameter_mm,
        height_mm,
        lifetime_h,
        temperature_c,
        standard_box_qty,
        moq,
        mpq,
        search_aliases,
        is_active
      )
      values (
        v_material_code,
        v_short_code,
        v_description,
        v_category,
        coalesce(v_specification, v_specification_raw),
        coalesce(v_specification_raw, v_specification),
        v_image_url,
        v_brand,
        v_series,
        v_manufacturer_part_no,
        v_internal_part_no,
        v_voltage_v,
        v_capacitance_value,
        v_capacitance_unit,
        v_diameter_mm,
        v_height_mm,
        v_lifetime_h,
        v_temperature_c,
        v_standard_box_qty,
        v_moq,
        v_mpq,
        coalesce(v_search_aliases, '{}'::text[]),
        true
      )
      returning id into v_material_id;

      v_created_count := v_created_count + 1;
    else
      update public.materials
      set
        short_code = coalesce(v_short_code, short_code),
        description = coalesce(v_description, description),
        category = coalesce(v_category, category),
        specification = coalesce(v_specification, v_specification_raw, specification),
        specification_raw = coalesce(v_specification_raw, v_specification, specification_raw),
        image_url = coalesce(v_image_url, image_url),
        brand = coalesce(v_brand, brand),
        series = coalesce(v_series, series),
        manufacturer_part_no = coalesce(v_manufacturer_part_no, manufacturer_part_no),
        internal_part_no = coalesce(v_internal_part_no, internal_part_no),
        voltage_v = coalesce(v_voltage_v, voltage_v),
        capacitance_value = coalesce(v_capacitance_value, capacitance_value),
        capacitance_unit = coalesce(v_capacitance_unit, capacitance_unit),
        diameter_mm = coalesce(v_diameter_mm, diameter_mm),
        height_mm = coalesce(v_height_mm, height_mm),
        lifetime_h = coalesce(v_lifetime_h, lifetime_h),
        temperature_c = coalesce(v_temperature_c, temperature_c),
        standard_box_qty = coalesce(v_standard_box_qty, standard_box_qty),
        moq = coalesce(v_moq, moq),
        mpq = coalesce(v_mpq, mpq),
        search_aliases = case
          when coalesce(array_length(v_search_aliases, 1), 0) > 0
            then public.merge_text_arrays(search_aliases, v_search_aliases)
          else search_aliases
        end,
        is_active = true
      where id = v_existing_id
      returning id into v_material_id;

      v_updated_count := v_updated_count + 1;
    end if;

    if v_alias_value is not null then
      v_alias_type := coalesce(v_alias_type, 'CUSTOMER_PART_NO');

      select id
        into v_existing_alias_id
      from public.material_aliases
      where material_id = v_material_id
        and alias_type = v_alias_type
        and lower(alias_value) = lower(v_alias_value)
        and deleted_at is null
      limit 1;

      if v_existing_alias_id is null then
        insert into public.material_aliases (
          material_id,
          alias_type,
          alias_value,
          customer_name,
          supplier_name,
          remark,
          is_active
        )
        values (
          v_material_id,
          v_alias_type,
          v_alias_value,
          v_customer_name,
          v_supplier_name,
          v_remark,
          true
        );
      else
        update public.material_aliases
        set
          customer_name = coalesce(v_customer_name, customer_name),
          supplier_name = coalesce(v_supplier_name, supplier_name),
          remark = coalesce(v_remark, remark),
          is_active = true
        where id = v_existing_alias_id;
      end if;
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

grant select on public.v_current_inventory_batches to anon, authenticated;
grant select on public.v_material_inventory_summary to anon, authenticated;
grant select on public.v_inventory_export_rows to anon, authenticated;
grant execute on function public.search_materials(text, integer) to anon, authenticated;
grant execute on function public.bulk_upsert_materials(jsonb, text, text) to anon, authenticated;
