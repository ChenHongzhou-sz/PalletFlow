export type ImportMode = "materials" | "barcode_aliases" | "pending_inventory";

export interface MaterialImportRow {
  rowNumber: number;
  material_code: string;
  short_code?: string;
  description?: string;
  category?: string;
  specification?: string;
  specification_raw?: string;
  image_url?: string;
  brand?: string;
  series?: string;
  manufacturer_part_no?: string;
  internal_part_no?: string;
  voltage_v?: number;
  capacitance_value?: number;
  capacitance_unit?: string;
  diameter_mm?: number;
  height_mm?: number;
  lifetime_h?: number;
  temperature_c?: number;
  standard_box_qty?: number;
  moq?: number;
  mpq?: number;
  search_aliases?: string[];
  alias_type?: string;
  alias_value?: string;
  customer_name?: string;
  supplier_name?: string;
  remark?: string;
}

export interface BarcodeAliasImportRow {
  rowNumber: number;
  barcode: string;
  material_code: string;
  remark?: string;
}

export interface PendingInventoryImportRow {
  rowNumber: number;
  material_code: string;
  quantity: number;
}

export interface ImportIssue {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ImportPreviewResult<T> {
  totalRows: number;
  validRows: T[];
  issues: ImportIssue[];
  duplicateKeys: string[];
}

export interface MasterDataImportRun {
  id: string;
  importType: ImportMode;
  sourceFileName: string | null;
  operatorName: string | null;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  rejectedRows: number;
  createdAt: string;
}
