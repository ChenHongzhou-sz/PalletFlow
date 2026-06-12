import { requireSupabase } from "@/services/supabase/client";
import type { CurrentInventoryExportRow } from "@/types/domain";

type InventoryExportViewRow = {
  batch_id: string;
  warehouse_code: string;
  pallet_code: string;
  pallet_area: string | null;
  material_code: string;
  short_code: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  quantity: number;
  initial_quantity: number;
  production_date: string;
  lot_no: string | null;
  box_barcode: string | null;
  inbound_at: string;
  last_updated_at: string;
};

export async function listCurrentInventoryExportRows() {
  const db = requireSupabase();
  const { data, error } = await db
    .from("v_inventory_export_rows")
    .select(
      "batch_id, warehouse_code, pallet_code, pallet_area, material_code, short_code, description, category, specification, quantity, initial_quantity, production_date, lot_no, box_barcode, inbound_at, last_updated_at",
    )
    .order("warehouse_code", { ascending: true })
    .order("pallet_code", { ascending: true })
    .order("material_code", { ascending: true })
    .order("production_date", { ascending: true })
    .order("inbound_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as InventoryExportViewRow[]).map(
    (row): CurrentInventoryExportRow => ({
      batchId: row.batch_id,
      warehouseCode: row.warehouse_code,
      palletCode: row.pallet_code,
      palletArea: row.pallet_area ?? null,
      materialCode: row.material_code,
      shortCode: row.short_code ?? null,
      description: row.description ?? null,
      category: row.category ?? null,
      specification: row.specification ?? null,
      quantity: Number(row.quantity ?? 0),
      initialQuantity: Number(row.initial_quantity ?? 0),
      productionDate: row.production_date,
      lotNo: row.lot_no ?? null,
      boxBarcode: row.box_barcode ?? null,
      inboundAt: row.inbound_at,
      lastUpdatedAt: row.last_updated_at,
    }),
  );
}
