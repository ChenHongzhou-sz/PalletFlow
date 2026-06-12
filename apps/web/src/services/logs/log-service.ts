import { requireSupabase } from "@/services/supabase/client";
import type { OperationLogRow } from "@/types/domain";

export interface LogFilters {
  dateFrom?: string;
  dateTo?: string;
  palletCode?: string;
  materialCode?: string;
}

type OperationLogViewRow = {
  operation_id: string;
  operation_type: string;
  created_at: string;
  operator_name: string | null;
  pallet_code: string;
  material_code: string;
  short_code: string | null;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  production_date: string;
  lot_no: string | null;
  operation_note: string | null;
  line_remark: string | null;
};

export async function listOperationLogs(filters: LogFilters) {
  const db = requireSupabase();
  let query = db
    .from("v_operation_log_lines")
    .select(
      "operation_id, operation_type, created_at, operator_name, pallet_code, material_code, short_code, quantity_change, quantity_before, quantity_after, production_date, lot_no, operation_note, line_remark",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.dateFrom) {
    query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
  }

  if (filters.dateTo) {
    query = query.lte("created_at", `${filters.dateTo}T23:59:59`);
  }

  if (filters.palletCode?.trim()) {
    query = query.ilike("pallet_code", `%${filters.palletCode.trim().toUpperCase()}%`);
  }

  if (filters.materialCode?.trim()) {
    const term = filters.materialCode.trim();
    query = query.or(
      `material_code.ilike.*${term}*,short_code.ilike.*${term}*`,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as OperationLogViewRow[]).map((row) => ({
    operationId: row.operation_id,
    operationType: row.operation_type,
    createdAt: row.created_at,
    operatorName: row.operator_name,
    palletCode: row.pallet_code,
    materialCode: row.material_code,
    shortCode: row.short_code,
    quantityChange: Number(row.quantity_change ?? 0),
    quantityBefore: Number(row.quantity_before ?? 0),
    quantityAfter: Number(row.quantity_after ?? 0),
    productionDate: row.production_date,
    lotNo: row.lot_no,
    operationNote: row.operation_note,
    lineRemark: row.line_remark,
  }));
}
