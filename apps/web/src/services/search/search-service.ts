import { requireSupabase } from "@/services/supabase/client";
import type { MaterialDistributionRow, MaterialSearchItem, PalletInventoryRow } from "@/types/domain";

type SearchMaterialsRpcRow = {
  material_id: string;
  material_code: string;
  short_code: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  matched_by: string;
  score: number;
};

type MaterialSummaryRow = {
  material_id: string;
  total_quantity: number;
  pallet_count: number;
  earliest_production_date: string | null;
  latest_production_date: string | null;
};

type CurrentInventoryBatchRow = {
  batch_id: string;
  pallet_code: string;
  material_code: string;
  short_code: string | null;
  description: string | null;
  quantity: number;
  production_date: string;
  lot_no: string | null;
  box_barcode: string | null;
};

type MaterialDistributionViewRow = {
  batch_id: string;
  pallet_code: string;
  quantity: number;
  production_date: string;
  lot_no: string | null;
  box_barcode: string | null;
};

export async function searchMaterials(query: string) {
  const db = requireSupabase();
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [] as MaterialSearchItem[];
  }

  const { data: rpcRows, error: rpcError } = await db.rpc("search_materials", {
    p_query: trimmed,
    p_limit: 20,
  });

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const searchRows = ((rpcRows ?? []) as SearchMaterialsRpcRow[]).filter(Boolean);

  if (!searchRows.length) {
    return [] as MaterialSearchItem[];
  }

  const materialIds = searchRows.map((row) => row.material_id);
  const { data: summaryRows, error: summaryError } = await db
    .from("v_material_inventory_summary")
    .select("material_id, total_quantity, pallet_count, earliest_production_date, latest_production_date")
    .in("material_id", materialIds);

  if (summaryError) {
    throw new Error(summaryError.message);
  }

  const summaryMap = new Map<string, MaterialSummaryRow>(
    ((summaryRows ?? []) as MaterialSummaryRow[]).map((row) => [row.material_id, row]),
  );

  return searchRows.map((row) => {
    const summary = summaryMap.get(row.material_id);

    return {
      materialId: row.material_id,
      materialCode: row.material_code,
      shortCode: row.short_code,
      description: row.description,
      category: row.category,
      specification: row.specification,
      matchedBy: row.matched_by,
      score: row.score ?? 0,
      totalQuantity: summary?.total_quantity ?? 0,
      palletCount: summary?.pallet_count ?? 0,
      earliestProductionDate: summary?.earliest_production_date ?? null,
      latestProductionDate: summary?.latest_production_date ?? null,
    };
  });
}

export async function getMaterialDistribution(materialCode: string) {
  const db = requireSupabase();
  const { data, error } = await db
    .from("v_current_inventory_batches")
    .select("batch_id, pallet_code, quantity, production_date, lot_no, box_barcode")
    .eq("material_code", materialCode)
    .order("production_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as MaterialDistributionViewRow[]).map((row) => ({
    batchId: row.batch_id,
    palletCode: row.pallet_code,
    quantity: Number(row.quantity ?? 0),
    productionDate: row.production_date,
    lotNo: row.lot_no ?? null,
    boxBarcode: row.box_barcode ?? null,
  }));
}

export async function getPalletInventory(palletCode: string) {
  const db = requireSupabase();
  const normalized = palletCode.trim().toUpperCase();

  if (normalized.length < 2) {
    return [] as PalletInventoryRow[];
  }

  const { data, error } = await db
    .from("v_current_inventory_batches")
    .select("batch_id, pallet_code, material_code, short_code, description, quantity, production_date, lot_no, box_barcode")
    .eq("pallet_code", normalized)
    .order("production_date", { ascending: true })
    .order("material_code", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CurrentInventoryBatchRow[]).map((row) => ({
    batchId: row.batch_id,
    palletCode: row.pallet_code,
    materialCode: row.material_code,
    shortCode: row.short_code,
    description: row.description,
    quantity: Number(row.quantity ?? 0),
    productionDate: row.production_date,
    lotNo: row.lot_no,
    boxBarcode: row.box_barcode,
  }));
}
