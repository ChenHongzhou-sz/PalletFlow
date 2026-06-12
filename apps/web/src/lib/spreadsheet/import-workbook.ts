import { getPreferredImportSheetNames, hasRequiredImportColumns, normalizeImportToken } from "@/lib/import/import-schema";
import type { ImportMode } from "@/types/import";

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function readSheetMatrix(workbookPackage: typeof import("xlsx"), sheet: import("xlsx").WorkSheet) {
  const matrix = workbookPackage.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  return matrix.map((row) => row.map(normalizeCell));
}

export async function readImportWorkbook(file: File, mode: ImportMode) {
  const workbookPackage = await import("xlsx");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = workbookPackage.read(arrayBuffer, {
    type: "array",
    raw: false,
  });

  const preferredSheetNames = getPreferredImportSheetNames(mode).map(normalizeImportToken);

  const exactMatch = workbook.SheetNames.find((sheetName) => {
    if (!preferredSheetNames.includes(normalizeImportToken(sheetName))) {
      return false;
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return false;
    }

    const matrix = readSheetMatrix(workbookPackage, sheet);
    return hasRequiredImportColumns(matrix[0] ?? [], mode);
  });

  if (exactMatch) {
    return readSheetMatrix(workbookPackage, workbook.Sheets[exactMatch]!);
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      continue;
    }

    const matrix = readSheetMatrix(workbookPackage, sheet);

    if (hasRequiredImportColumns(matrix[0] ?? [], mode)) {
      return matrix;
    }
  }

  const expectedType = mode === "materials" ? "物料主数据" : "条码映射";
  throw new Error(
    `没有找到可导入的 ${expectedType} 工作表。你可以继续使用系统模板里的 ${getPreferredImportSheetNames(mode)[0]}，也可以直接上传像“Sheet1”这样但表头匹配的工作表。`,
  );
}
