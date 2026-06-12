create or replace view public.v_inventory_export_rows as
select
  ib.id as batch_id,
  w.warehouse_code,
  p.pallet_code,
  p.area as pallet_area,
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
  ib.updated_at as last_updated_at
from public.inventory_batches ib
join public.warehouses w on w.id = ib.warehouse_id
join public.pallets p on p.id = ib.pallet_id
join public.materials m on m.id = ib.material_id
where ib.deleted_at is null
  and ib.quantity > 0;

grant select on public.v_inventory_export_rows to anon, authenticated;
