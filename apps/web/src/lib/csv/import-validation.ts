import { parseCsv } from "@/lib/csv/parseCsv";
import { getMissingImportFields, resolveImportColumns } from "@/lib/import/import-schema";
import type { BarcodeAliasImportRow, ImportIssue, ImportPreviewResult, MaterialImportRow } from "@/types/import";

function isBlankRow(row: string[]) {
  return row.every((cell) => cell.trim() === "");
}

function buildDuplicateIssues(
  rows: Array<{ rowNumber: number; key: string }>,
  field: string,
  label: string,
) {
  const counts = new Map<string, number>();
  const issues: ImportIssue[] = [];

  for (const row of rows) {
    counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  }

  const duplicateKeys = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  if (!duplicateKeys.length) {
    return { duplicateKeys, issues };
  }

  for (const row of rows) {
    if (duplicateKeys.includes(row.key)) {
      issues.push({
        rowNumber: row.rowNumber,
        field,
        message: `${label} 在同一次上传里重复：${row.key}`,
      });
    }
  }

  return { duplicateKeys, issues };
}

export function validateMaterialsCsv(text: string): ImportPreviewResult<MaterialImportRow> {
  return validateMaterialsMatrix(parseCsv(text));
}

export function validateMaterialsMatrix(matrix: string[][]): ImportPreviewResult<MaterialImportRow> {
  const issues: ImportIssue[] = [];

  if (!matrix.length || isBlankRow(matrix[0] ?? [])) {
    return {
      totalRows: 0,
      validRows: [],
      issues: [
        {
          rowNumber: 1,
          field: "file",
          message: "CSV 为空，或者没有表头。",
        },
      ],
      duplicateKeys: [],
    };
  }

  const headers = matrix[0];
  const columns = resolveImportColumns(headers, "materials");
  const missingFields = getMissingImportFields(headers, "materials");

  if (missingFields.length) {
    return {
      totalRows: 0,
      validRows: [],
      issues: [
        {
          rowNumber: 1,
          field: missingFields.join(","),
          message: `缺少必需列 ${missingFields.join("、")}。可直接使用英文模板，或使用“物料型号 / 物料代码 / 物料描述”这类中文表头。`,
        },
      ],
      duplicateKeys: [],
    };
  }

  const rows: MaterialImportRow[] = [];

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex];

    if (!row || isBlankRow(row)) {
      continue;
    }

    const rowNumber = rowIndex + 1;
    const read = (field: keyof typeof columns) => {
      const columnIndex = columns[field];
      return columnIndex === undefined ? "" : (row[columnIndex] ?? "").trim();
    };

    const materialCode = read("material_code");

    if (!materialCode) {
      issues.push({
        rowNumber,
        field: "material_code",
        message: "material_code 不能为空。",
      });
      continue;
    }

    rows.push({
      rowNumber,
      material_code: materialCode,
      short_code: read("short_code") || undefined,
      description: read("description") || undefined,
      category: read("category") || undefined,
      specification: read("specification") || undefined,
      image_url: read("image_url") || undefined,
    });
  }

  const duplicateInfo = buildDuplicateIssues(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      key: row.material_code.toLowerCase(),
    })),
    "material_code",
    "material_code",
  );

  issues.push(...duplicateInfo.issues);

  const duplicateRowNumbers = new Set(duplicateInfo.issues.map((issue) => issue.rowNumber));

  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => !duplicateRowNumbers.has(row.rowNumber)),
    issues,
    duplicateKeys: duplicateInfo.duplicateKeys,
  };
}

export function validateBarcodeAliasesCsv(text: string): ImportPreviewResult<BarcodeAliasImportRow> {
  return validateBarcodeAliasesMatrix(parseCsv(text));
}

export function validateBarcodeAliasesMatrix(matrix: string[][]): ImportPreviewResult<BarcodeAliasImportRow> {
  const issues: ImportIssue[] = [];

  if (!matrix.length || isBlankRow(matrix[0] ?? [])) {
    return {
      totalRows: 0,
      validRows: [],
      issues: [
        {
          rowNumber: 1,
          field: "file",
          message: "CSV 为空，或者没有表头。",
        },
      ],
      duplicateKeys: [],
    };
  }

  const headers = matrix[0];
  const columns = resolveImportColumns(headers, "barcode_aliases");
  const missingFields = getMissingImportFields(headers, "barcode_aliases");

  if (missingFields.length) {
    return {
      totalRows: 0,
      validRows: [],
      issues: [
        {
          rowNumber: 1,
          field: missingFields.join(","),
          message: `缺少必需列 ${missingFields.join("、")}。可使用英文模板，也可使用“条码 / 物料型号 / 备注”这类中文表头。`,
        },
      ],
      duplicateKeys: [],
    };
  }

  const rows: BarcodeAliasImportRow[] = [];

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex];

    if (!row || isBlankRow(row)) {
      continue;
    }

    const rowNumber = rowIndex + 1;
    const read = (field: keyof typeof columns) => {
      const columnIndex = columns[field];
      return columnIndex === undefined ? "" : (row[columnIndex] ?? "").trim();
    };

    if (!read("barcode")) {
      issues.push({
        rowNumber,
        field: "barcode",
        message: "barcode 不能为空。",
      });
      continue;
    }

    if (!read("material_code")) {
      issues.push({
        rowNumber,
        field: "material_code",
        message: "material_code 不能为空。",
      });
      continue;
    }

    rows.push({
      rowNumber,
      barcode: read("barcode"),
      material_code: read("material_code"),
      remark: read("remark") || undefined,
    });
  }

  const duplicateInfo = buildDuplicateIssues(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      key: row.barcode,
    })),
    "barcode",
    "barcode",
  );

  issues.push(...duplicateInfo.issues);

  const duplicateRowNumbers = new Set(duplicateInfo.issues.map((issue) => issue.rowNumber));

  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => !duplicateRowNumbers.has(row.rowNumber)),
    issues,
    duplicateKeys: duplicateInfo.duplicateKeys,
  };
}
