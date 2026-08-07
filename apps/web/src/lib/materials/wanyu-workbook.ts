import { resolveImportColumns } from "@/lib/import/import-schema";
import {
  mergeSearchAliases,
  parseCapacitanceToUf,
  parseDimensionValue,
  parseLifetimeHours,
  parseMaterialSpecification,
  parseOptionalNumber,
  parseSeriesValue,
  parseVoltageValue,
} from "@/lib/materials/material-spec";

const phase2MaterialHeaders = [
  "material_code",
  "short_code",
  "description",
  "category",
  "specification",
  "specification_raw",
  "brand",
  "series",
  "manufacturer_part_no",
  "internal_part_no",
  "voltage_v",
  "capacitance_value",
  "capacitance_unit",
  "diameter_mm",
  "height_mm",
  "lifetime_h",
  "temperature_c",
  "standard_box_qty",
  "moq",
  "mpq",
  "search_aliases",
  "alias_type",
  "alias_value",
  "customer_name",
  "supplier_name",
  "remark",
  "image_url",
] as const;

type Phase2MaterialRow = Partial<Record<(typeof phase2MaterialHeaders)[number], string | number | string[]>> & {
  material_code: string;
};

function readCell(row: string[], index: number | undefined) {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function pickPreferredText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function buildMaterialRowFromSpec(materialCode: string, category: string, description: string, specificationRaw: string): Phase2MaterialRow {
  const parsed = parseMaterialSpecification(specificationRaw);

  return {
    material_code: materialCode,
    category: category || undefined,
    description: description || undefined,
    specification: specificationRaw || undefined,
    specification_raw: specificationRaw || undefined,
    series: parsed.series,
    voltage_v: parsed.voltageV,
    capacitance_value: parsed.capacitanceValue,
    capacitance_unit: parsed.capacitanceUnit,
    diameter_mm: parsed.diameterMm,
    height_mm: parsed.heightMm,
    lifetime_h: parsed.lifetimeH,
    temperature_c: parsed.temperatureC,
    search_aliases: parsed.searchAliases,
  };
}

function mergeSearchAliasField(currentValue: string | number | string[] | undefined, nextAliases: string[]) {
  const currentAliases = Array.isArray(currentValue) ? currentValue : typeof currentValue === "string" ? currentValue.split("|") : [];
  return mergeSearchAliases(currentAliases, nextAliases);
}

export function buildWanyuMaterialsMatrix(materialsMatrix: string[][], enrichmentMatrix: string[][]) {
  const rowsByCode = new Map<string, Phase2MaterialRow>();

  const materialColumns = resolveImportColumns(materialsMatrix[0] ?? [], "materials");
  for (let rowIndex = 1; rowIndex < materialsMatrix.length; rowIndex += 1) {
    const row = materialsMatrix[rowIndex];
    if (!row) {
      continue;
    }

    const materialCode = readCell(row, materialColumns.material_code);
    if (!materialCode) {
      continue;
    }

    const category = readCell(row, materialColumns.category);
    const description = pickPreferredText(readCell(row, materialColumns.description), category) ?? "";
    const specificationRaw = pickPreferredText(readCell(row, materialColumns.specification_raw), readCell(row, materialColumns.specification)) ?? "";

    rowsByCode.set(materialCode, buildMaterialRowFromSpec(materialCode, category, description, specificationRaw));
  }

  const enrichmentColumns = resolveImportColumns(enrichmentMatrix[0] ?? [], "materials");
  for (let rowIndex = 1; rowIndex < enrichmentMatrix.length; rowIndex += 1) {
    const row = enrichmentMatrix[rowIndex];
    if (!row) {
      continue;
    }

    const materialCode = readCell(row, enrichmentColumns.material_code);
    if (!materialCode) {
      continue;
    }

    const aliasValue = readCell(row, enrichmentColumns.alias_value);
    const specificationRaw = pickPreferredText(readCell(row, enrichmentColumns.specification_raw), readCell(row, enrichmentColumns.description)) ?? "";
    const explicitVoltage = parseVoltageValue(readCell(row, enrichmentColumns.voltage_v));
    const explicitCapacitance = parseCapacitanceToUf(readCell(row, enrichmentColumns.capacitance_value));
    const explicitDimension = parseDimensionValue(readCell(row, enrichmentColumns.diameter_mm));
    const explicitHeight = parseOptionalNumber(readCell(row, enrichmentColumns.height_mm));
    const explicitLifetime = parseLifetimeHours(readCell(row, enrichmentColumns.lifetime_h));
    const explicitMoq = parseOptionalNumber(readCell(row, enrichmentColumns.moq));
    const explicitMpq = parseOptionalNumber(readCell(row, enrichmentColumns.mpq));
    const parsed = parseMaterialSpecification(specificationRaw);
    const current = rowsByCode.get(materialCode) ?? { material_code: materialCode };
    const mergedAliases = mergeSearchAliases(
      Array.isArray(current.search_aliases) ? current.search_aliases : [],
      parsed.searchAliases,
      explicitDimension.searchAliases,
      aliasValue ? [aliasValue] : [],
      readCell(row, enrichmentColumns.series),
    );

    rowsByCode.set(materialCode, {
      ...current,
      description:
        pickPreferredText(
          typeof current.description === "string" && typeof current.category === "string" && current.description === current.category ? undefined : String(current.description ?? ""),
          specificationRaw,
          String(current.description ?? ""),
        ) ?? current.description,
      specification: pickPreferredText(String(current.specification ?? ""), specificationRaw) ?? current.specification,
      specification_raw: pickPreferredText(specificationRaw, String(current.specification_raw ?? "")) ?? current.specification_raw,
      series: pickPreferredText(readCell(row, enrichmentColumns.series), parsed.series, parseSeriesValue(materialCode), String(current.series ?? "")) ?? current.series,
      voltage_v: explicitVoltage ?? parsed.voltageV ?? current.voltage_v,
      capacitance_value: explicitCapacitance ?? parsed.capacitanceValue ?? current.capacitance_value,
      capacitance_unit:
        explicitCapacitance !== undefined || parsed.capacitanceValue !== undefined
          ? "uF"
          : (current.capacitance_unit as string | undefined),
      diameter_mm: explicitDimension.diameterMm ?? parsed.diameterMm ?? current.diameter_mm,
      height_mm: explicitHeight ?? explicitDimension.heightMm ?? parsed.heightMm ?? current.height_mm,
      lifetime_h: explicitLifetime ?? parsed.lifetimeH ?? current.lifetime_h,
      moq: explicitMoq ?? current.moq,
      mpq: explicitMpq ?? current.mpq,
      alias_type: aliasValue ? "CUSTOMER_PART_NO" : current.alias_type,
      alias_value: aliasValue || current.alias_value,
      customer_name: aliasValue ? "德方" : current.customer_name,
      search_aliases: mergedAliases,
    });
  }

  return [
    [...phase2MaterialHeaders],
    ...[...rowsByCode.values()]
      .sort((left, right) => left.material_code.localeCompare(right.material_code))
      .map((row) =>
        phase2MaterialHeaders.map((header) => {
          const value = row[header];

          if (Array.isArray(value)) {
            return value.join("|");
          }

          return value === undefined ? "" : String(value);
        }),
      ),
  ];
}
