import { parseCsv } from "@/lib/csv/parseCsv";
import { getMissingImportFields, resolveImportColumns } from "@/lib/import/import-schema";
import {
  mergeSearchAliases,
  parseCapacitanceToUf,
  parseDimensionValue,
  parseLifetimeHours,
  parseMaterialSpecification,
  parseOptionalNumber,
  parseSeriesValue,
  parseTemperatureC,
  parseVoltageValue,
} from "@/lib/materials/material-spec";
import type { BarcodeAliasImportRow, ImportIssue, ImportPreviewResult, MaterialImportRow, PendingInventoryImportRow } from "@/types/import";

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

function parseSearchAliases(value: string) {
  return mergeSearchAliases(value.split(/[|,\n]/u).map((item) => item.trim()));
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

    const specificationRaw = read("specification_raw") || read("specification");
    const parsedSpec = parseMaterialSpecification(specificationRaw);
    const parsedDimension = parseDimensionValue(read("diameter_mm"));
    const voltageV = parseVoltageValue(read("voltage_v")) ?? parsedSpec.voltageV;
    const capacitanceValue = parseCapacitanceToUf(read("capacitance_value")) ?? parsedSpec.capacitanceValue;
    const heightMm = parseOptionalNumber(read("height_mm")) ?? parsedDimension.heightMm ?? parsedSpec.heightMm;
    const series = read("series") || parsedSpec.series || parseSeriesValue(specificationRaw) || undefined;
    const searchAliases = mergeSearchAliases(
      parseSearchAliases(read("search_aliases")),
      parsedSpec.searchAliases,
      parsedDimension.searchAliases,
      read("alias_value"),
      series,
    );

    rows.push({
      rowNumber,
      material_code: materialCode,
      short_code: read("short_code") || undefined,
      description: read("description") || undefined,
      category: read("category") || undefined,
      specification: read("specification") || specificationRaw || undefined,
      specification_raw: specificationRaw || undefined,
      image_url: read("image_url") || undefined,
      brand: read("brand") || undefined,
      series,
      manufacturer_part_no: read("manufacturer_part_no") || undefined,
      internal_part_no: read("internal_part_no") || undefined,
      voltage_v: voltageV,
      capacitance_value: capacitanceValue,
      capacitance_unit: capacitanceValue !== undefined ? "uF" : read("capacitance_unit") || undefined,
      diameter_mm: parseOptionalNumber(read("diameter_mm")) ?? parsedDimension.diameterMm ?? parsedSpec.diameterMm,
      height_mm: heightMm,
      lifetime_h: parseLifetimeHours(read("lifetime_h")) ?? parsedSpec.lifetimeH,
      temperature_c: parseTemperatureC(read("temperature_c")) ?? parsedSpec.temperatureC,
      standard_box_qty: parseOptionalNumber(read("standard_box_qty")),
      moq: parseOptionalNumber(read("moq")),
      mpq: parseOptionalNumber(read("mpq")),
      search_aliases: searchAliases.length ? searchAliases : undefined,
      alias_type: read("alias_type") || undefined,
      alias_value: read("alias_value") || undefined,
      customer_name: read("customer_name") || undefined,
      supplier_name: read("supplier_name") || undefined,
      remark: read("remark") || undefined,
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

export function validatePendingInventoryCsv(text: string): ImportPreviewResult<PendingInventoryImportRow> {
  return validatePendingInventoryMatrix(parseCsv(text));
}

export function validatePendingInventoryMatrix(matrix: string[][]): ImportPreviewResult<PendingInventoryImportRow> {
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
  const columns = resolveImportColumns(headers, "pending_inventory");
  const missingFields = getMissingImportFields(headers, "pending_inventory");

  if (missingFields.length) {
    return {
      totalRows: 0,
      validRows: [],
      issues: [
        {
          rowNumber: 1,
          field: missingFields.join(","),
          message: `缺少必需列 ${missingFields.join("、")}。请至少提供“料号 / 数量”这两列。`,
        },
      ],
      duplicateKeys: [],
    };
  }

  const rows: PendingInventoryImportRow[] = [];

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
    const quantity = parseOptionalNumber(read("quantity"));

    if (!materialCode) {
      issues.push({
        rowNumber,
        field: "material_code",
        message: "material_code 不能为空。",
      });
      continue;
    }

    if (quantity === null || quantity === undefined || quantity <= 0) {
      issues.push({
        rowNumber,
        field: "quantity",
        message: "quantity 必须是大于 0 的数字。",
      });
      continue;
    }

    rows.push({
      rowNumber,
      material_code: materialCode,
      quantity,
    });
  }

  return {
    totalRows: rows.length,
    validRows: rows,
    issues,
    duplicateKeys: [],
  };
}
