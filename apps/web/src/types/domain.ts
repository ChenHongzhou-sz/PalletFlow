export interface MaterialSearchItem {
  materialId: string;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  category: string | null;
  specification: string | null;
  matchedBy: string;
  score: number;
  totalQuantity: number;
  palletCount: number;
  earliestProductionDate: string | null;
  latestProductionDate: string | null;
}

export interface MaterialDistributionRow {
  batchId: string;
  palletCode: string;
  quantity: number;
  productionDate: string;
  lotNo: string | null;
  boxBarcode: string | null;
}

export interface PalletInventoryRow {
  batchId: string;
  palletCode: string;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  quantity: number;
  productionDate: string;
  lotNo: string | null;
  boxBarcode: string | null;
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

