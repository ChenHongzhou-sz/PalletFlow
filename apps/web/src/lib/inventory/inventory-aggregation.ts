import type { CurrentInventoryExportRow, MaterialDistributionRow, PalletInventoryRow } from "@/types/domain";

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
