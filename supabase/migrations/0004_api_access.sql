create or replace view public.v_master_data_import_runs as
select
  id,
  import_type,
  source_file_name,
  operator_name,
  processed_rows,
  created_rows,
  updated_rows,
  rejected_rows,
  created_at
from public.master_data_import_runs;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on public.v_current_inventory_batches to anon, authenticated;
grant select on public.v_material_inventory_summary to anon, authenticated;
grant select on public.v_operation_log_lines to anon, authenticated;
grant select on public.v_master_data_import_runs to anon, authenticated;

alter function public.search_materials(text, integer) security definer;
alter function public.search_materials(text, integer) set search_path = public, extensions;

alter function public.get_fifo_suggestions(uuid, numeric) security definer;
alter function public.get_fifo_suggestions(uuid, numeric) set search_path = public, extensions;

alter function public.create_inbound_batch(text, text, numeric, date, text, text, text, text, text, text) security definer;
alter function public.create_inbound_batch(text, text, numeric, date, text, text, text, text, text, text) set search_path = public, extensions;

alter function public.confirm_outbound_pick(text, numeric, text, text, text) security definer;
alter function public.confirm_outbound_pick(text, numeric, text, text, text) set search_path = public, extensions;

alter function public.clear_pallet_inventory(text, text, text, text) security definer;
alter function public.clear_pallet_inventory(text, text, text, text) set search_path = public, extensions;

alter function public.complete_cycle_count(text, jsonb, text, text, text) security definer;
alter function public.complete_cycle_count(text, jsonb, text, text, text) set search_path = public, extensions;

alter function public.bulk_upsert_materials(jsonb, text, text) security definer;
alter function public.bulk_upsert_materials(jsonb, text, text) set search_path = public, extensions;

alter function public.bulk_upsert_barcode_aliases(jsonb, text, text) security definer;
alter function public.bulk_upsert_barcode_aliases(jsonb, text, text) set search_path = public, extensions;

grant execute on function public.search_materials(text, integer) to anon, authenticated;
grant execute on function public.get_fifo_suggestions(uuid, numeric) to anon, authenticated;
grant execute on function public.create_inbound_batch(text, text, numeric, date, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.confirm_outbound_pick(text, numeric, text, text, text) to anon, authenticated;
grant execute on function public.clear_pallet_inventory(text, text, text, text) to anon, authenticated;
grant execute on function public.complete_cycle_count(text, jsonb, text, text, text) to anon, authenticated;
grant execute on function public.bulk_upsert_materials(jsonb, text, text) to anon, authenticated;
grant execute on function public.bulk_upsert_barcode_aliases(jsonb, text, text) to anon, authenticated;
