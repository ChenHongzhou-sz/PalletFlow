insert into public.warehouses (warehouse_code, warehouse_name)
values ('MAIN', 'Default Warehouse')
on conflict (warehouse_code) do nothing;
