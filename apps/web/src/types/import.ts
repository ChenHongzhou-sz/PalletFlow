export type ImportMode = "materials" | "barcode_aliases";

export interface MaterialImportRow {
  rowNumber: number;
  material_code: string;
  short_code?: string;
  description?: string;
  category?: string;
  specification?: string;
  image_url?: string;
}

export interface BarcodeAliasImportRow {
  rowNumber: number;
  barcode: string;
  material_code: string;
  remark?: string;
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
