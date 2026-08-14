import type { CurrentInventoryExportRow, FifoSuggestionRow, MaterialDistributionRow, PalletInventoryRow } from "@/types/domain";

function normalizeToken(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(normalizeToken).filter(Boolean)));
}

function summarizeSingleOrMultiple(values: Array<string | null | undefined>, multipleLabel: string) {
  const uniqueValues = uniqueNonEmpty(values);

  if (!uniqueValues.length) {
    return null;
  }

  if (uniqueValues.length === 1) {
    return uniqueValues[0] ?? null;
  }

  return multipleLabel;
}

function summarizeStockForm(values: Array<string | null | undefined>) {
  const uniqueValues = uniqueNonEmpty(values);

  if (!uniqueValues.length) {
    return null;
  }

  if (uniqueValues.length === 1) {
    return uniqueValues[0] ?? null;
  }

  return "MIXED";
}

function pickEarliestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))[0] ?? null;
}

function pickLatestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function summarizeLocationQuantities(rows: Array<{ locationCode: string; quantity: number }>) {
  const locationMap = new Map<string, number>();

  for (const row of rows) {
    const locationCode = normalizeToken(row.locationCode);
    if (!locationCode) {
      continue;
    }

    locationMap.set(locationCode, (locationMap.get(locationCode) ?? 0) + row.quantity);
  }

  return Array.from(locationMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([locationCode, quantity]) => `${locationCode}(${quantity})`);
}

export interface AggregatedPalletInventoryRow {
  groupKey: string;
  palletCode: string;
  locationCode: string;
  locationName: string | null;
  locationType: string | null;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  productionDate: string;
  quantity: number;
  mergedEntryCount: number;
  stockFormSummary: string | null;
  lotSummary: string | null;
  boxBarcodeSummary: string | null;
  dateCodeSummary: string | null;
  sourceRows: PalletInventoryRow[];
}

export function aggregatePalletInventoryRows(rows: PalletInventoryRow[]) {
  const groups = new Map<string, AggregatedPalletInventoryRow>();

  for (const row of rows) {
    const groupKey = [normalizeToken(row.locationCode), normalizeToken(row.materialCode), normalizeToken(row.productionDate)].join("|");
    const existing = groups.get(groupKey);

    if (existing) {
      existing.quantity += row.quantity;
      existing.mergedEntryCount += 1;
      existing.stockFormSummary = summarizeStockForm([existing.stockFormSummary, row.stockForm]);
      existing.lotSummary = summarizeSingleOrMultiple([existing.lotSummary, row.lotNo], "多批号");
      existing.boxBarcodeSummary = summarizeSingleOrMultiple([existing.boxBarcodeSummary, row.boxBarcode], "多箱码");
      existing.dateCodeSummary = summarizeSingleOrMultiple([existing.dateCodeSummary, row.dateCode], "多编码");
      existing.sourceRows.push(row);
      continue;
    }

    groups.set(groupKey, {
      groupKey,
      palletCode: row.palletCode,
      locationCode: row.locationCode,
      locationName: row.locationName,
      locationType: row.locationType,
      materialCode: row.materialCode,
      shortCode: row.shortCode,
      description: row.description,
      productionDate: row.productionDate,
      quantity: row.quantity,
      mergedEntryCount: 1,
      stockFormSummary: row.stockForm ?? null,
      lotSummary: row.lotNo ?? null,
      boxBarcodeSummary: row.boxBarcode ?? null,
      dateCodeSummary: row.dateCode ?? null,
      sourceRows: [row],
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const materialCompare = left.materialCode.localeCompare(right.materialCode);
    if (materialCompare !== 0) {
      return materialCompare;
    }

    return left.productionDate.localeCompare(right.productionDate);
  });
}

export interface AggregatedMaterialDistributionRow {
  groupKey: string;
  locationCode: string;
  locationType: string | null;
  quantity: number;
  productionDate: string;
  stockFormSummary: string | null;
  mergedEntryCount: number;
  receivedAt: string | null;
  lotSummary: string | null;
  boxBarcodeSummary: string | null;
  dateCodeSummary: string | null;
}

export function aggregateMaterialDistributionRows(rows: MaterialDistributionRow[]) {
  const groups = new Map<string, AggregatedMaterialDistributionRow>();

  for (const row of rows) {
    const groupKey = [normalizeToken(row.locationCode), normalizeToken(row.productionDate)].join("|");
    const existing = groups.get(groupKey);

    if (existing) {
      existing.quantity += row.quantity;
      existing.mergedEntryCount += 1;
      existing.stockFormSummary = summarizeStockForm([existing.stockFormSummary, row.stockForm]);
      existing.receivedAt = pickEarliestTimestamp([existing.receivedAt, row.receivedAt]);
      existing.lotSummary = summarizeSingleOrMultiple([existing.lotSummary, row.lotNo], "多批号");
      existing.boxBarcodeSummary = summarizeSingleOrMultiple([existing.boxBarcodeSummary, row.boxBarcode], "多箱码");
      existing.dateCodeSummary = summarizeSingleOrMultiple([existing.dateCodeSummary, row.dateCode], "多编码");
      continue;
    }

    groups.set(groupKey, {
      groupKey,
      locationCode: row.locationCode,
      locationType: row.locationType,
      quantity: row.quantity,
      productionDate: row.productionDate,
      stockFormSummary: row.stockForm ?? null,
      mergedEntryCount: 1,
      receivedAt: row.receivedAt ?? null,
      lotSummary: row.lotNo ?? null,
      boxBarcodeSummary: row.boxBarcode ?? null,
      dateCodeSummary: row.dateCode ?? null,
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const dateCompare = left.productionDate.localeCompare(right.productionDate);
    if (dateCompare !== 0) {
      return dateCompare;
    }

    return left.locationCode.localeCompare(right.locationCode);
  });
}

export interface AggregatedCurrentInventoryExportRow extends CurrentInventoryExportRow {
  mergedEntryCount: number;
  lotSummary: string | null;
  boxBarcodeSummary: string | null;
}

export function aggregateCurrentInventoryExportRows(rows: CurrentInventoryExportRow[]) {
  const groups = new Map<string, AggregatedCurrentInventoryExportRow>();

  for (const row of rows) {
    const locationCode = row.locationCode || row.palletCode;
    const groupKey = [
      normalizeToken(row.warehouseCode),
      normalizeToken(locationCode),
      normalizeToken(row.materialCode),
      normalizeToken(row.productionDate),
    ].join("|");
    const existing = groups.get(groupKey);

    if (existing) {
      existing.quantity += row.quantity;
      existing.initialQuantity += row.initialQuantity;
      existing.mergedEntryCount += 1;
      existing.lotSummary = summarizeSingleOrMultiple([existing.lotSummary, row.lotNo], "多批号");
      existing.boxBarcodeSummary = summarizeSingleOrMultiple([existing.boxBarcodeSummary, row.boxBarcode], "多箱码");
      existing.inboundAt = pickEarliestTimestamp([existing.inboundAt, row.inboundAt]) ?? existing.inboundAt;
      existing.lastUpdatedAt = pickLatestTimestamp([existing.lastUpdatedAt, row.lastUpdatedAt]) ?? existing.lastUpdatedAt;
      continue;
    }

    groups.set(groupKey, {
      ...row,
      quantity: row.quantity,
      initialQuantity: row.initialQuantity,
      mergedEntryCount: 1,
      lotSummary: row.lotNo ?? null,
      boxBarcodeSummary: row.boxBarcode ?? null,
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const warehouseCompare = left.warehouseCode.localeCompare(right.warehouseCode);
    if (warehouseCompare !== 0) {
      return warehouseCompare;
    }

    const locationCompare = (left.locationCode || left.palletCode).localeCompare(right.locationCode || right.palletCode);
    if (locationCompare !== 0) {
      return locationCompare;
    }

    const materialCompare = left.materialCode.localeCompare(right.materialCode);
    if (materialCompare !== 0) {
      return materialCompare;
    }

    return left.productionDate.localeCompare(right.productionDate);
  });
}

export interface AggregatedMaterialMonthInventoryExportRow {
  groupKey: string;
  warehouseCode: string;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  quantity: number;
  initialQuantity: number;
  productionDate: string;
  mergedEntryCount: number;
  locationCount: number;
  locationSummary: string;
  lotSummary: string | null;
  boxBarcodeSummary: string | null;
  inboundAt: string;
  lastUpdatedAt: string;
}

export function aggregateMaterialMonthInventoryExportRows(rows: CurrentInventoryExportRow[]) {
  const groups = new Map<string, AggregatedMaterialMonthInventoryExportRow>();
  const locationRows = new Map<string, Array<{ locationCode: string; quantity: number }>>();

  for (const row of rows) {
    const groupKey = [normalizeToken(row.warehouseCode), normalizeToken(row.materialCode), normalizeToken(row.productionDate)].join("|");
    const existing = groups.get(groupKey);
    const locationCode = row.locationCode || row.palletCode;
    const locations = locationRows.get(groupKey) ?? [];
    locations.push({ locationCode, quantity: row.quantity });
    locationRows.set(groupKey, locations);

    if (existing) {
      existing.quantity += row.quantity;
      existing.initialQuantity += row.initialQuantity;
      existing.mergedEntryCount += 1;
      existing.locationCount = new Set(locations.map((item) => normalizeToken(item.locationCode))).size;
      existing.locationSummary = summarizeLocationQuantities(locations).join(" / ");
      existing.lotSummary = summarizeSingleOrMultiple([existing.lotSummary, row.lotNo], "多批号");
      existing.boxBarcodeSummary = summarizeSingleOrMultiple([existing.boxBarcodeSummary, row.boxBarcode], "多箱码");
      existing.inboundAt = pickEarliestTimestamp([existing.inboundAt, row.inboundAt]) ?? existing.inboundAt;
      existing.lastUpdatedAt = pickLatestTimestamp([existing.lastUpdatedAt, row.lastUpdatedAt]) ?? existing.lastUpdatedAt;
      continue;
    }

    groups.set(groupKey, {
      groupKey,
      warehouseCode: row.warehouseCode,
      materialCode: row.materialCode,
      shortCode: row.shortCode ?? null,
      description: row.description ?? null,
      category: row.category ?? null,
      specification: row.specification ?? null,
      quantity: row.quantity,
      initialQuantity: row.initialQuantity,
      productionDate: row.productionDate,
      mergedEntryCount: 1,
      locationCount: 1,
      locationSummary: summarizeLocationQuantities(locations).join(" / "),
      lotSummary: row.lotNo ?? null,
      boxBarcodeSummary: row.boxBarcode ?? null,
      inboundAt: row.inboundAt,
      lastUpdatedAt: row.lastUpdatedAt,
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const warehouseCompare = left.warehouseCode.localeCompare(right.warehouseCode);
    if (warehouseCompare !== 0) {
      return warehouseCompare;
    }

    const materialCompare = left.materialCode.localeCompare(right.materialCode);
    if (materialCompare !== 0) {
      return materialCompare;
    }

    return left.productionDate.localeCompare(right.productionDate);
  });
}

export interface AggregatedFifoSuggestionRow {
  groupKey: string;
  productionDate: string;
  availableQuantity: number;
  suggestedQuantity: number;
  mergedEntryCount: number;
  palletCount: number;
  palletSummary: string;
  lotSummary: string | null;
  boxBarcodeSummary: string | null;
  sourceRows: FifoSuggestionRow[];
}

export function aggregateFifoSuggestionRows(rows: FifoSuggestionRow[]) {
  const groups = new Map<string, AggregatedFifoSuggestionRow>();

  for (const row of rows) {
    const groupKey = normalizeToken(row.productionDate);
    const existing = groups.get(groupKey);

    if (existing) {
      existing.availableQuantity += row.availableQuantity;
      existing.suggestedQuantity += row.suggestedQuantity;
      existing.mergedEntryCount += 1;
      existing.lotSummary = summarizeSingleOrMultiple([existing.lotSummary, row.lotNo], "多批号");
      existing.boxBarcodeSummary = summarizeSingleOrMultiple([existing.boxBarcodeSummary, row.boxBarcode], "多箱码");
      existing.sourceRows.push(row);
      existing.palletCount = new Set(existing.sourceRows.map((item) => normalizeToken(item.palletCode))).size;
      existing.palletSummary = Array.from(new Set(existing.sourceRows.map((item) => normalizeToken(item.palletCode))))
        .sort((left, right) => left.localeCompare(right))
        .join(" / ");
      continue;
    }

    groups.set(groupKey, {
      groupKey,
      productionDate: row.productionDate,
      availableQuantity: row.availableQuantity,
      suggestedQuantity: row.suggestedQuantity,
      mergedEntryCount: 1,
      palletCount: 1,
      palletSummary: normalizeToken(row.palletCode),
      lotSummary: row.lotNo ?? null,
      boxBarcodeSummary: row.boxBarcode ?? null,
      sourceRows: [row],
    });
  }

  return Array.from(groups.values()).sort((left, right) => left.productionDate.localeCompare(right.productionDate));
}
