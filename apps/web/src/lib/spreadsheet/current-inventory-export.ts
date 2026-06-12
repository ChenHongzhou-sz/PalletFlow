import type { CurrentInventoryExportRow } from "@/types/domain";

function formatTimestampForFile(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export interface InventoryExportSummary {
  exportedAt: string;
  batchCount: number;
  palletCount: number;
  materialCount: number;
  totalQuantity: number;
}

export function buildInventoryExportSummary(rows: CurrentInventoryExportRow[]): InventoryExportSummary {
  const palletCodes = new Set(rows.map((row) => `${row.warehouseCode}:${row.palletCode}`));
  const materialCodes = new Set(rows.map((row) => row.materialCode));
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);

  return {
    exportedAt: formatDateTime(new Date().toISOString()),
    batchCount: rows.length,
    palletCount: palletCodes.size,
    materialCount: materialCodes.size,
    totalQuantity,
  };
}

export async function exportCurrentInventoryWorkbook(rows: CurrentInventoryExportRow[]) {
  const xlsx = await import("xlsx");
  const summary = buildInventoryExportSummary(rows);

  const detailRows = rows.map((row) => ({
    仓库: row.warehouseCode,
    卡板号: row.palletCode,
    卡板位置: row.palletArea || row.palletCode,
    物料型号: row.materialCode,
    物料简称: row.shortCode || "",
    描述: row.description || "",
    分类: row.category || "",
    规格: row.specification || "",
    数量: row.quantity,
    生产年月: row.productionDate.slice(0, 7),
    批次号: row.lotNo || "",
    外箱条码: row.boxBarcode || "",
    入板时间: formatDateTime(row.inboundAt),
    最后更新时间: formatDateTime(row.lastUpdatedAt),
  }));

  const summaryRows = [
    { 指标: "导出时间", 值: summary.exportedAt },
    { 指标: "在库批次数", 值: summary.batchCount },
    { 指标: "在库卡板数", 值: summary.palletCount },
    { 指标: "在库物料种数", 值: summary.materialCount },
    { 指标: "总数量", 值: summary.totalQuantity },
  ];

  const workbook = xlsx.utils.book_new();
  const summarySheet = xlsx.utils.json_to_sheet(summaryRows);
  const detailSheet = xlsx.utils.json_to_sheet(detailRows);

  summarySheet["!cols"] = [{ wch: 16 }, { wch: 20 }];
  detailSheet["!cols"] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
    { wch: 14 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 20 },
    { wch: 20 },
  ];

  xlsx.utils.book_append_sheet(workbook, summarySheet, "summary");
  xlsx.utils.book_append_sheet(workbook, detailSheet, "current_inventory");

  const fileName = `PalletFlow-current-inventory-${formatTimestampForFile(new Date())}.xlsx`;
  xlsx.writeFileXLSX(workbook, fileName);
}
