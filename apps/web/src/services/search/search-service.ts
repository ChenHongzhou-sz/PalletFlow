import { requireSupabase } from "@/services/supabase/client";
import type { MaterialDistributionRow, MaterialSearchItem, PalletInventoryRow, PalletLookupItem } from "@/types/domain";

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

type PalletLookupViewRow = {
  pallet_id: string;
  warehouse_code: string;
  pallet_code: string;
  pallet_area: string | null;
  status: string;
  created_at: string;
  active_batch_count: number;
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

export async function listPalletLookupItems(query: string, limit = 8) {
  const db = requireSupabase();
  const normalized = query.trim().toUpperCase();

  let request = db
    .from("v_pallet_lookup")
    .select("pallet_id, warehouse_code, pallet_code, pallet_area, status, created_at, active_batch_count")
    .order("pallet_code", { ascending: true })
    .limit(limit * 3);

  if (normalized) {
    request = request.ilike("pallet_code", `%${normalized}%`);
  }

  const { data, error } = await request;

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as PalletLookupViewRow[])
    .map(
      (row): PalletLookupItem => ({
        palletId: row.pallet_id,
        warehouseCode: row.warehouse_code,
        palletCode: row.pallet_code,
        palletArea: row.pallet_area ?? null,
        status: row.status,
        createdAt: row.created_at,
        activeBatchCount: Number(row.active_batch_count ?? 0),
      }),
    )
    .sort((a, b) => {
      const aCode = a.palletCode.toUpperCase();
      const bCode = b.palletCode.toUpperCase();
      const aExact = normalized && aCode === normalized ? 1 : 0;
      const bExact = normalized && bCode === normalized ? 1 : 0;
      if (aExact !== bExact) {
        return bExact - aExact;
      }

      const aPrefix = normalized && aCode.startsWith(normalized) ? 1 : 0;
      const bPrefix = normalized && bCode.startsWith(normalized) ? 1 : 0;
      if (aPrefix !== bPrefix) {
        return bPrefix - aPrefix;
      }

      return aCode.localeCompare(bCode);
    })
    .slice(0, limit);

  return rows;
}
