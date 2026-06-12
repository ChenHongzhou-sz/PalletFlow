import { requireSupabase } from "@/services/supabase/client";
import type { CycleCountInputRow, FifoSuggestionRow } from "@/types/domain";

type FifoRpcRow = {
  batch_id: string;
  pallet_id: string;
  pallet_code: string;
  available_quantity: number;
  production_date: string;
  lot_no: string | null;
  box_barcode: string | null;
  suggested_quantity: number;
};

type OutboundResultRow = {
  operation_id: string;
  line_no: number;
  batch_id: string;
  pallet_code: string;
  picked_quantity: number;
  remaining_quantity: number;
};

type CycleCountResultRow = {
  count_id: string;
  operation_id: string;
  line_no: number;
  batch_id: string;
  material_code: string;
  variance_quantity: number;
};

export interface CreateInboundInput {
  palletCode: string;
  materialCode: string;
  quantity: number;
  productionDate: string;
  lotNo?: string;
  boxBarcode?: string;
  operatorName?: string;
}

export async function createInboundBatch(input: CreateInboundInput) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("create_inbound_batch", {
    p_warehouse_code: "MAIN",
    p_pallet_code: input.palletCode.trim().toUpperCase(),
    p_material_code: input.materialCode.trim(),
    p_quantity: input.quantity,
    p_production_date: input.productionDate,
    p_lot_no: input.lotNo || null,
    p_box_barcode: input.boxBarcode || null,
    p_operator_name: input.operatorName || null,
    p_note: null,
    p_source: "manual",
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function getFifoSuggestions(materialId: string, requestedQuantity: number) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("get_fifo_suggestions", {
    p_material_id: materialId,
    p_requested_qty: requestedQuantity,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as FifoRpcRow[]).map((row) => ({
    batchId: row.batch_id,
    palletId: row.pallet_id,
    palletCode: row.pallet_code,
    availableQuantity: Number(row.available_quantity ?? 0),
    productionDate: row.production_date,
    lotNo: row.lot_no,
    boxBarcode: row.box_barcode,
    suggestedQuantity: Number(row.suggested_quantity ?? 0),
  })) as FifoSuggestionRow[];
}

export async function confirmOutboundPick(materialCode: string, requestedQuantity: number, operatorName?: string) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("confirm_outbound_pick", {
    p_material_code: materialCode,
    p_requested_qty: requestedQuantity,
    p_operator_name: operatorName || null,
    p_note: null,
    p_source: "manual",
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as OutboundResultRow[];
}

export async function clearPalletInventory(palletCode: string, operatorName?: string) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("clear_pallet_inventory", {
    p_warehouse_code: "MAIN",
    p_pallet_code: palletCode.trim().toUpperCase(),
    p_operator_name: operatorName || null,
    p_note: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function completeCycleCount(palletCode: string, items: CycleCountInputRow[], operatorName?: string) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("complete_cycle_count", {
    p_warehouse_code: "MAIN",
    p_pallet_code: palletCode.trim().toUpperCase(),
    p_items: items,
    p_operator_name: operatorName || null,
    p_note: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CycleCountResultRow[];
}

