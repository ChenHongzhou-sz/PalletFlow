import { requireSupabase } from "@/services/supabase/client";
import type { MasterDataImportRun } from "@/types/import";

type ImportRunRow = {
  id: string;
  import_type: "materials" | "barcode_aliases";
  source_file_name: string | null;
  operator_name: string | null;
  processed_rows: number;
  created_rows: number;
  updated_rows: number;
  rejected_rows: number;
  created_at: string;
};

export async function listRecentImportRuns() {
  const db = requireSupabase();
  const { data, error } = await db
    .from("v_master_data_import_runs")
    .select("id, import_type, source_file_name, operator_name, processed_rows, created_rows, updated_rows, rejected_rows, created_at")
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as ImportRunRow[]).map((row) => ({
    id: row.id,
    importType: row.import_type,
    sourceFileName: row.source_file_name,
    operatorName: row.operator_name,
    processedRows: row.processed_rows,
    createdRows: row.created_rows,
    updatedRows: row.updated_rows,
    rejectedRows: row.rejected_rows,
    createdAt: row.created_at,
  })) as MasterDataImportRun[];
}
