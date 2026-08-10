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

type CycleCountRpcItem = {
  batch_id: string;
  counted_quantity: number;
  note?: string;
};

type LocationTransferRpcRow = {
  operation_id: string;
  batch_id: string;
  material_code: string;
  moved_quantity: number;
  source_location_code: string;
  target_location_code: string;
};

type BatchTransferRpcRow = {
  operation_id: string;
  source_batch_id: string;
  target_batch_id: string;
  material_code: string;
  moved_quantity: number;
  source_location_code: string;
  target_location_code: string;
  source_remaining_quantity: number;
  target_quantity: number;
};

type PendingInventoryPoolRpcRow = {
  material_id: string;
  material_code: string;
  short_code: string | null;
  description: string | null;
  pending_quantity: number;
  source_file_name: string | null;
  operator_name: string | null;
  updated_at: string;
};

type PutawayPendingInventoryRpcRow = {
  batch_id: string;
  material_code: string;
  moved_quantity: number;
  target_location_code: string;
  remaining_pending_quantity: number;
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

export interface LocationTransferSummary {
  operationId: string;
  batchId: string;
  materialCode: string;
  movedQuantity: number;
  sourceLocationCode: string;
  targetLocationCode: string;
}

export interface BatchTransferInput {
  sourceLocationCode: string;
  batchId: string;
  targetLocationCode: string;
  quantity: number;
  operatorName?: string;
  note?: string;
}

export interface BatchTransferSummary {
  operationId: string;
  sourceBatchId: string;
  targetBatchId: string;
  materialCode: string;
  movedQuantity: number;
  sourceLocationCode: string;
  targetLocationCode: string;
  sourceRemainingQuantity: number;
  targetQuantity: number;
}

export interface PendingInventoryPoolItem {
  materialId: string;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  pendingQuantity: number;
  sourceFileName: string | null;
  operatorName: string | null;
  updatedAt: string;
}

export interface PutawayPendingInventoryInput {
  materialCode: string;
  targetLocationCode: string;
  quantity: number;
  productionDate: string;
  lotNo?: string;
  boxBarcode?: string;
  operatorName?: string;
  note?: string;
}

export interface PutawayPendingInventorySummary {
  batchId: string;
  materialCode: string;
  movedQuantity: number;
  targetLocationCode: string;
  remainingPendingQuantity: number;
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
  const payload: CycleCountRpcItem[] = items.map((item) => ({
    batch_id: item.batchId,
    counted_quantity: item.countedQuantity,
    note: item.note,
  }));

  const { data, error } = await db.rpc("complete_cycle_count", {
    p_warehouse_code: "MAIN",
    p_pallet_code: palletCode.trim().toUpperCase(),
    p_items: payload,
    p_operator_name: operatorName || null,
    p_note: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CycleCountResultRow[];
}

export async function transferLocationInventory(sourceLocationCode: string, targetLocationCode: string, operatorName?: string, note?: string) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("transfer_location_inventory", {
    p_source_location_code: sourceLocationCode.trim().toUpperCase(),
    p_target_location_code: targetLocationCode.trim().toUpperCase(),
    p_warehouse_code: "MAIN",
    p_operator_name: operatorName || null,
    p_note: note || null,
    p_source: "manual",
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as LocationTransferRpcRow[]).map((row) => ({
    operationId: row.operation_id,
    batchId: row.batch_id,
    materialCode: row.material_code,
    movedQuantity: Number(row.moved_quantity ?? 0),
    sourceLocationCode: row.source_location_code,
    targetLocationCode: row.target_location_code,
  })) as LocationTransferSummary[];
}

export async function transferInventoryBatch(input: BatchTransferInput) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("transfer_inventory_batch", {
    p_source_location_code: input.sourceLocationCode.trim().toUpperCase(),
    p_batch_id: input.batchId,
    p_target_location_code: input.targetLocationCode.trim().toUpperCase(),
    p_transfer_quantity: input.quantity,
    p_warehouse_code: "MAIN",
    p_operator_name: input.operatorName || null,
    p_note: input.note || null,
    p_source: "manual",
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as BatchTransferRpcRow[]).map((row) => ({
    operationId: row.operation_id,
    sourceBatchId: row.source_batch_id,
    targetBatchId: row.target_batch_id,
    materialCode: row.material_code,
    movedQuantity: Number(row.moved_quantity ?? 0),
    sourceLocationCode: row.source_location_code,
    targetLocationCode: row.target_location_code,
    sourceRemainingQuantity: Number(row.source_remaining_quantity ?? 0),
    targetQuantity: Number(row.target_quantity ?? 0),
  })) as BatchTransferSummary[];
}

export async function listPendingInventoryPool(query = "", limit = 20) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("get_pending_inventory_pool", {
    p_query: query.trim(),
    p_limit: limit,
    p_warehouse_code: "MAIN",
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PendingInventoryPoolRpcRow[]).map((row) => ({
    materialId: row.material_id,
    materialCode: row.material_code,
    shortCode: row.short_code,
    description: row.description,
    pendingQuantity: Number(row.pending_quantity ?? 0),
    sourceFileName: row.source_file_name ?? null,
    operatorName: row.operator_name ?? null,
    updatedAt: row.updated_at,
  })) as PendingInventoryPoolItem[];
}

export async function putawayPendingInventory(input: PutawayPendingInventoryInput) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("putaway_pending_inventory", {
    p_material_code: input.materialCode.trim(),
    p_target_location_code: input.targetLocationCode.trim().toUpperCase(),
    p_quantity: input.quantity,
    p_production_date: input.productionDate,
    p_warehouse_code: "MAIN",
    p_lot_no: input.lotNo || null,
    p_box_barcode: input.boxBarcode || null,
    p_operator_name: input.operatorName || null,
    p_note: input.note || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PutawayPendingInventoryRpcRow[]).map((row) => ({
    batchId: row.batch_id,
    materialCode: row.material_code,
    movedQuantity: Number(row.moved_quantity ?? 0),
    targetLocationCode: row.target_location_code,
    remainingPendingQuantity: Number(row.remaining_pending_quantity ?? 0),
  })) as PutawayPendingInventorySummary[];
}
