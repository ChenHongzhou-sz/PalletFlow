import { useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { PageHeader } from "@/components/mobile/PageHeader";
import { resolveErrorMessage } from "@/lib/api/errors";
import { buildInventoryExportSummary, exportCurrentInventoryWorkbook } from "@/lib/spreadsheet/current-inventory-export";
import { formatDateTime } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { listCurrentInventoryExportRows } from "@/services/export/inventory-export-service";

export function InventoryExportPage() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);
  const [lastBatchCount, setLastBatchCount] = useState<number>(0);
  const [lastPalletCount, setLastPalletCount] = useState<number>(0);
  const [lastMaterialCount, setLastMaterialCount] = useState<number>(0);
  const [lastTotalQuantity, setLastTotalQuantity] = useState<number>(0);

  async function handleExportCurrentInventory() {
    setExporting(true);
    setError(null);
    setMessage(null);

    try {
      const rows = await listCurrentInventoryExportRows();

      if (!rows.length) {
        setLastExportedAt(null);
        setLastBatchCount(0);
        setLastPalletCount(0);
        setLastMaterialCount(0);
        setLastTotalQuantity(0);
        setMessage("当前没有在库批次，暂时没有可导出的库存明细。");
        return;
      }

      const summary = buildInventoryExportSummary(rows);
      await exportCurrentInventoryWorkbook(rows);

      setLastExportedAt(new Date().toISOString());
      setLastBatchCount(summary.batchCount);
      setLastPalletCount(summary.palletCount);
      setLastMaterialCount(summary.materialCount);
      setLastTotalQuantity(summary.totalQuantity);
      setMessage(`已导出 ${summary.batchCount} 条在库批次，覆盖 ${summary.palletCount} 个卡板。`);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Inventory Export"
        title="数据导出"
        description="一键导出当前所有卡板的在库批次，给仓库、采购或管理层直接看库存分布。"
      />
      <ConfigNotice />

      <section className="pf-panel space-y-5 p-5">
        <div className="rounded-[1.8rem] bg-slate-100/85 p-4 text-sm leading-7 text-slate-600">
          导出的 Excel 会包含当前还在库的全部批次，字段包括仓库、卡板号、卡板位置、物料型号、简称、描述、数量、
          生产年月、批次号、外箱条码、入板时间和最后更新时间。
        </div>

        <button type="button" onClick={handleExportCurrentInventory} disabled={exporting} className="pf-button-primary w-full">
          {exporting ? "正在导出当前库存..." : "导出当前库存 Excel"}
        </button>

        {error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      </section>

      {lastExportedAt ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="在库批次" value={String(lastBatchCount)} tone="dark" />
            <StatCard label="卡板数量" value={String(lastPalletCount)} />
            <StatCard label="物料种数" value={String(lastMaterialCount)} />
            <StatCard label="总数量" value={`${formatQuantity(lastTotalQuantity)} PCS`} tone="accent" />
          </section>

          <section className="pf-panel p-5 text-sm text-slate-600">
            <p className="font-semibold text-ink">最近一次导出</p>
            <p className="mt-2">导出时间：{formatDateTime(lastExportedAt)}</p>
            <p className="mt-2">下载文件名会自动带上时间戳，方便你留底和追溯。</p>
          </section>
        </>
      ) : (
        <EmptyState title="还没开始导出" description="点上面的按钮，系统会直接从 Supabase 拉取当前在库批次并生成 Excel。" />
      )}
    </div>
  );
}
