import { requireSupabase } from "@/services/supabase/client";
import type { MaterialDistributionRow, MaterialSearchItem, PalletInventoryRow, PalletLookupItem } from "@/types/domain";

type SearchMaterialsRpcRow = {
  material_id: string;
  material_code: string;
  short_code: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  specification_raw: string | null;
  brand: string | null;
  series: string | null;
  manufacturer_part_no: string | null;
  internal_part_no: string | null;
  voltage_v: number | null;
  capacitance_value: number | null;
  capacitance_unit: string | null;
  diameter_mm: number | null;
  height_mm: number | null;
  lifetime_h: number | null;
  temperature_c: number | null;
  standard_box_qty: number | null;
  moq: number | null;
  mpq: number | null;
  matched_by: string;
  score: number;
  total_quantity: number;
  location_count: number;
  open_quantity: number;
  oldest_date_code: string | null;
  earliest_production_date: string | null;
  latest_production_date: string | null;
};

type CurrentInventoryBatchRow = {
  batch_id: string;
  location_code: string;
  location_name: string | null;
  location_type: string | null;
  material_code: string;
  short_code: string | null;
  description: string | null;
  quantity: number;
  production_date: string;
  lot_no: string | null;
  box_barcode: string | null;
};

type PalletLookupViewRow = {
  location_id: string;
  warehouse_code: string;
  location_code: string;
  location_name: string | null;
  location_type: string;
  is_temporary: boolean;
  status: string;
  created_at: string;
  active_batch_count: number;
};

type MaterialDistributionViewRow = {
  batch_id: string;
  location_code: string;
  location_type: string | null;
  quantity: number;
  production_date: string;
  date_code: string | null;
  stock_form: string | null;
  received_at: string | null;
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

  return searchRows.map((row) => {
    return {
      materialId: row.material_id,
      materialCode: row.material_code,
      shortCode: row.short_code,
      description: row.description,
      category: row.category,
      specification: row.specification,
      specificationRaw: row.specification_raw ?? null,
      brand: row.brand ?? null,
      series: row.series ?? null,
      manufacturerPartNo: row.manufacturer_part_no ?? null,
      internalPartNo: row.internal_part_no ?? null,
      voltageV: row.voltage_v ?? null,
      capacitanceValue: row.capacitance_value ?? null,
      capacitanceUnit: row.capacitance_unit ?? null,
      diameterMm: row.diameter_mm ?? null,
      heightMm: row.height_mm ?? null,
      lifetimeH: row.lifetime_h ?? null,
      temperatureC: row.temperature_c ?? null,
      standardBoxQty: row.standard_box_qty ?? null,
      moq: row.moq ?? null,
      mpq: row.mpq ?? null,
      matchedBy: row.matched_by,
      score: row.score ?? 0,
      totalQuantity: Number(row.total_quantity ?? 0),
      palletCount: Number(row.location_count ?? 0),
      locationCount: Number(row.location_count ?? 0),
      openStockQuantity: Number(row.open_quantity ?? 0),
      oldestDateCode: row.oldest_date_code ?? null,
      earliestProductionDate: row.earliest_production_date ?? null,
      latestProductionDate: row.latest_production_date ?? null,
    };
  });
}

export async function getMaterialDistribution(materialCode: string) {
  const db = requireSupabase();
  const { data, error } = await db
    .from("v_current_inventory_batches")
    .select("batch_id, location_code, location_type, quantity, production_date, date_code, stock_form, received_at, lot_no, box_barcode")
    .eq("material_code", materialCode)
    .order("production_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as MaterialDistributionViewRow[]).map((row) => ({
    batchId: row.batch_id,
    palletCode: row.location_code,
    locationCode: row.location_code,
    locationType: row.location_type ?? null,
    quantity: Number(row.quantity ?? 0),
    productionDate: row.production_date,
    dateCode: row.date_code ?? null,
    stockForm: row.stock_form ?? null,
    receivedAt: row.received_at ?? null,
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
    .select("batch_id, location_code, location_name, location_type, material_code, short_code, description, quantity, production_date, lot_no, box_barcode")
    .eq("location_code", normalized)
    .order("production_date", { ascending: true })
    .order("material_code", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CurrentInventoryBatchRow[]).map((row) => ({
    batchId: row.batch_id,
    palletCode: row.location_code,
    locationCode: row.location_code,
    locationName: row.location_name ?? null,
    locationType: row.location_type ?? null,
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
    .from("v_location_lookup")
    .select("location_id, warehouse_code, location_code, location_name, location_type, is_temporary, status, created_at, active_batch_count")
    .order("location_code", { ascending: true })
    .limit(limit * 3);

  if (normalized) {
    request = request.ilike("location_code", `%${normalized}%`);
  }

  const { data, error } = await request;

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as PalletLookupViewRow[])
    .map(
      (row): PalletLookupItem => ({
        palletId: row.location_id,
        warehouseCode: row.warehouse_code,
        palletCode: row.location_code,
        palletArea: row.location_name ?? null,
        locationCode: row.location_code,
        locationName: row.location_name ?? null,
        locationType: row.location_type,
        isTemporary: row.is_temporary,
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
