import { requireSupabase } from "@/services/supabase/client";
import type { BarcodeAliasImportRow, MaterialImportRow } from "@/types/import";

function stripRowNumber<T extends { rowNumber: number }>(rows: T[]) {
  return rows.map(({ rowNumber: _rowNumber, ...rest }) => rest);
}

export async function commitMaterialImport(
  rows: MaterialImportRow[],
  sourceFileName?: string,
  operatorName?: string,
) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("bulk_upsert_materials", {
    p_rows: stripRowNumber(rows),
    p_source_file_name: sourceFileName || null,
    p_operator_name: operatorName || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as {
    import_run_id: string;
    processed_count: number;
    created_count: number;
    updated_count: number;
    rejected_count: number;
  };
}

export async function commitBarcodeAliasImport(
  rows: BarcodeAliasImportRow[],
  sourceFileName?: string,
  operatorName?: string,
) {
  const db = requireSupabase();
  const { data, error } = await db.rpc("bulk_upsert_barcode_aliases", {
    p_rows: stripRowNumber(rows),
    p_source_file_name: sourceFileName || null,
    p_operator_name: operatorName || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as {
    import_run_id: string;
    processed_count: number;
    created_count: number;
    updated_count: number;
    rejected_count: number;
  };
}
