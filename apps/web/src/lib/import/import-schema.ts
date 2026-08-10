import type { ImportMode } from "@/types/import";

type MaterialImportField =
  | "material_code"
  | "short_code"
  | "description"
  | "category"
  | "specification"
  | "specification_raw"
  | "image_url"
  | "brand"
  | "series"
  | "manufacturer_part_no"
  | "internal_part_no"
  | "voltage_v"
  | "capacitance_value"
  | "capacitance_unit"
  | "diameter_mm"
  | "height_mm"
  | "lifetime_h"
  | "temperature_c"
  | "standard_box_qty"
  | "moq"
  | "mpq"
  | "search_aliases"
  | "alias_type"
  | "alias_value"
  | "customer_name"
  | "supplier_name"
  | "remark";

type BarcodeAliasImportField = "barcode" | "material_code" | "remark";
type PendingInventoryImportField = "material_code" | "quantity";

type ImportFieldByMode = {
  materials: MaterialImportField;
  barcode_aliases: BarcodeAliasImportField;
  pending_inventory: PendingInventoryImportField;
};

export type ImportColumnMap<T extends ImportMode> = Partial<Record<ImportFieldByMode[T], number>>;

const preferredSheetNames: Record<ImportMode, string[]> = {
  materials: ["materials", "material", "物料", "物料主数据", "主数据", "sheet1"],
  barcode_aliases: ["barcode_aliases", "barcode aliases", "barcode", "条码", "条码映射", "条码别名"],
  pending_inventory: ["pending_inventory", "pending inventory", "待上架库存", "库存初始化", "待分配库存", "inventory"],
};

const fieldAliases: Record<ImportMode, Record<string, string[]>> = {
  materials: {
    material_code: ["material_code", "materialcode", "料号", "完整料号", "物料型号", "型号", "物料编号", "代码", "pn", "partnumber"],
    short_code: ["short_code", "shortcode", "short code", "简称", "物料代码", "物料编码", "内部代码"],
    description: ["description", "desc", "描述", "物料描述", "全名", "物料名称"],
    category: ["category", "分类", "名称"],
    specification: ["specification", "spec", "规格"],
    specification_raw: ["specification_raw", "specification raw", "规格型号", "规格描述", "原始规格"],
    image_url: ["image_url", "imageurl", "image url", "图片", "图片链接", "物料图片"],
    brand: ["brand", "品牌"],
    series: ["series", "系列"],
    manufacturer_part_no: ["manufacturer_part_no", "manufacturerpartno", "manufacturer pn", "厂商料号", "制造商料号"],
    internal_part_no: ["internal_part_no", "internalpartno", "internal pn", "内部料号"],
    voltage_v: ["voltage_v", "voltage", "电压", "电压(v)"],
    capacitance_value: ["capacitance_value", "capacitance", "容值", "电容量"],
    capacitance_unit: ["capacitance_unit", "容值单位", "电容量单位"],
    diameter_mm: ["diameter_mm", "diameter", "直径", "直径(mm）", "直径(mm)"],
    height_mm: ["height_mm", "height", "高度", "高度(mm）", "高度(mm)"],
    lifetime_h: ["lifetime_h", "lifetime", "寿命", "寿命(h)"],
    temperature_c: ["temperature_c", "temperature", "温度", "温度(℃)", "温度(c)"],
    standard_box_qty: ["standard_box_qty", "box_qty", "每箱数量", "标准箱数"],
    moq: ["moq"],
    mpq: ["mpq"],
    search_aliases: ["search_aliases", "searchaliases", "搜索别名", "搜索关键词"],
    alias_type: ["alias_type", "aliastype", "别名类型"],
    alias_value: ["alias_value", "aliasvalue", "别名", "德方对应料号", "客户料号", "供应商料号"],
    customer_name: ["customer_name", "customername", "客户名称"],
    supplier_name: ["supplier_name", "suppliername", "供应商名称"],
    remark: ["remark", "remarks", "备注"],
  },
  barcode_aliases: {
    barcode: ["barcode", "条码", "箱条码", "外箱条码"],
    material_code: ["material_code", "materialcode", "料号", "完整料号", "物料型号", "型号", "pn", "partnumber"],
    remark: ["remark", "remarks", "备注"],
  },
  pending_inventory: {
    material_code: ["material_code", "materialcode", "料号", "完整料号", "物料型号", "型号", "pn", "partnumber"],
    quantity: ["quantity", "qty", "数量", "库存数量", "当前库存", "pcs"],
  },
};

const requiredFields: Record<ImportMode, string[]> = {
  materials: ["material_code"],
  barcode_aliases: ["barcode", "material_code"],
  pending_inventory: ["material_code", "quantity"],
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
