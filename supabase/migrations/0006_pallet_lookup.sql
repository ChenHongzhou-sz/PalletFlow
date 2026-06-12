create or replace view public.v_pallet_lookup as
select
  p.id as pallet_id,
  w.warehouse_code,
  p.pallet_code,
  p.area as pallet_area,
  p.status,
  p.created_at,
  coalesce(count(ib.id), 0)::integer as active_batch_count
from public.pallets p
join public.warehouses w on w.id = p.warehouse_id
left join public.inventory_batches ib
  on ib.pallet_id = p.id
 and ib.deleted_at is null
 and ib.quantity > 0
where p.deleted_at is null
  and w.is_active = true
group by
  p.id,
  w.warehouse_code,
  p.pallet_code,
  p.area,
  p.status,
  p.created_at;

grant select on public.v_pallet_lookup to anon, authenticated;
