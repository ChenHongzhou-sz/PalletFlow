import type { ImportMode } from "@/types/import";

type MaterialImportField =
  | "material_code"
  | "short_code"
  | "description"
  | "category"
  | "specification"
  | "image_url";

type BarcodeAliasImportField = "barcode" | "material_code" | "remark";

type ImportFieldByMode = {
  materials: MaterialImportField;
  barcode_aliases: BarcodeAliasImportField;
};

export type ImportColumnMap<T extends ImportMode> = Partial<Record<ImportFieldByMode[T], number>>;

const preferredSheetNames: Record<ImportMode, string[]> = {
  materials: ["materials", "material", "物料", "物料主数据", "主数据", "sheet1"],
  barcode_aliases: ["barcode_aliases", "barcode aliases", "barcode", "条码", "条码映射", "条码别名"],
};

const fieldAliases: Record<ImportMode, Record<string, string[]>> = {
  materials: {
    material_code: ["material_code", "materialcode", "料号", "完整料号", "物料型号", "型号", "pn", "partnumber"],
    short_code: ["short_code", "shortcode", "short code", "简称", "物料代码", "物料编码", "内部代码"],
    description: ["description", "desc", "描述", "物料描述"],
    category: ["category", "分类"],
    specification: ["specification", "spec", "规格"],
    image_url: ["image_url", "imageurl", "image url", "图片", "图片链接", "物料图片"],
  },
  barcode_aliases: {
    barcode: ["barcode", "条码", "箱条码", "外箱条码"],
    material_code: ["material_code", "materialcode", "料号", "完整料号", "物料型号", "型号", "pn", "partnumber"],
    remark: ["remark", "remarks", "备注"],
  },
};

const requiredFields: Record<ImportMode, string[]> = {
  materials: ["material_code"],
  barcode_aliases: ["barcode", "material_code"],
};

export function normalizeImportToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/[_-]+/g, "_");
}

function buildAliasSet(field: string, aliases: string[]) {
  return new Set([field, ...aliases].map(normalizeImportToken));
}

export function getPreferredImportSheetNames(mode: ImportMode) {
  return preferredSheetNames[mode];
}

export function resolveImportColumns<T extends ImportMode>(headers: string[], mode: T): ImportColumnMap<T> {
  const normalizedHeaders = headers.map((header) => normalizeImportToken(header));
  const columns: Record<string, number> = {};

  for (const [field, aliases] of Object.entries(fieldAliases[mode])) {
    const aliasSet = buildAliasSet(field, aliases);
    const index = normalizedHeaders.findIndex((header) => aliasSet.has(header));

    if (index !== -1) {
      columns[field] = index;
    }
  }

  return columns as ImportColumnMap<T>;
}

export function getMissingImportFields(headers: string[], mode: ImportMode) {
  const columns = resolveImportColumns(headers, mode);
  return requiredFields[mode].filter((field) => columns[field as keyof typeof columns] === undefined);
}

export function hasRequiredImportColumns(headers: string[], mode: ImportMode) {
  return getMissingImportFields(headers, mode).length === 0;
}
