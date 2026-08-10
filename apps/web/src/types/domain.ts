export interface MaterialSearchItem {
  materialId: string;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  specificationRaw: string | null;
  brand: string | null;
  series: string | null;
  manufacturerPartNo: string | null;
  internalPartNo: string | null;
  voltageV: number | null;
  capacitanceValue: number | null;
  capacitanceUnit: string | null;
  diameterMm: number | null;
  heightMm: number | null;
  lifetimeH: number | null;
  temperatureC: number | null;
  standardBoxQty: number | null;
  moq: number | null;
  mpq: number | null;
  matchedBy: string;
  score: number;
  totalQuantity: number;
  palletCount: number;
  locationCount: number;
  openStockQuantity: number;
  oldestDateCode: string | null;
  earliestProductionDate: string | null;
  latestProductionDate: string | null;
}

export interface MaterialDistributionRow {
  batchId: string;
  palletCode: string;
  locationCode: string;
  locationType: string | null;
  quantity: number;
  productionDate: string;
  dateCode: string | null;
  stockForm: string | null;
  receivedAt: string | null;
  lotNo: string | null;
  boxBarcode: string | null;
}

export interface PalletInventoryRow {
  batchId: string;
  palletCode: string;
  locationCode: string;
  locationName: string | null;
  locationType: string | null;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  quantity: number;
  productionDate: string;
  lotNo: string | null;
  boxBarcode: string | null;
  dateCode: string | null;
  stockForm: string | null;
}

export interface CurrentInventoryExportRow {
  batchId: string;
  warehouseCode: string;
  palletCode: string;
  palletArea: string | null;
  locationCode: string;
  locationName: string | null;
  locationType: string | null;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  quantity: number;
  initialQuantity: number;
  productionDate: string;
  lotNo: string | null;
  boxBarcode: string | null;
  inboundAt: string;
  lastUpdatedAt: string;
}

export interface PalletLookupItem {
  palletId: string;
  warehouseCode: string;
  palletCode: string;
  palletArea: string | null;
  locationCode: string;
  locationName: string | null;
  locationType: string;
  isTemporary: boolean;
  status: string;
  createdAt: string;
  activeBatchCount: number;
}

export interface FifoSuggestionRow {
  batchId: string;
  palletId: string;
  palletCode: string;
  availableQuantity: number;
  productionDate: string;
  lotNo: string | null;
  boxBarcode: string | null;
  suggestedQuantity: number;
}

export interface OperationLogRow {
  operationId: string;
  operationType: string;
  createdAt: string;
  operatorName: string | null;
  palletCode: string;
  locationCode: string;
  locationName: string | null;
  locationType: string | null;
  materialCode: string;
  shortCode: string | null;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  productionDate: string;
  lotNo: string | null;
  operationNote: string | null;
  lineRemark: string | null;
}

export interface CycleCountInputRow {
  batchId: string;
  countedQuantity: number;
  note?: string;
}
