import { useEffect, useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/mobile/PageHeader";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatDateTime, formatProductionMonth } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { listOperationLogs } from "@/services/logs/log-service";
import type { OperationLogRow } from "@/types/domain";

export function OperationLogPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [palletCode, setPalletCode] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [rows, setRows] = useState<OperationLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLogs() {
    setLoading(true);
    setError(null);

    try {
      const result = await listOperationLogs({
        dateFrom,
        dateTo,
        palletCode,
        materialCode,
      });
      setRows(result);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs().catch(() => {
      // handled inside loadLogs
    });
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Operation Logs" title="操作记录" description="查看进卡板、出卡板、盘点、清空卡板的历史记录，支持按日期、卡板和物料过滤。" />
      <ConfigNotice />

      <section className="pf-panel grid gap-4 p-5 lg:grid-cols-4">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">开始日期</span>
          <input className="pf-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">结束日期</span>
          <input className="pf-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">卡板</span>
          <input className="pf-input" value={palletCode} onChange={(event) => setPalletCode(event.target.value.toUpperCase())} placeholder="A01" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">物料</span>
          <input className="pf-input" value={materialCode} onChange={(event) => setMaterialCode(event.target.value)} placeholder="SZ121 / 100UF" />
        </label>
        <button type="button" onClick={loadLogs} disabled={loading} className="pf-button-secondary lg:col-span-4">
          {loading ? "正在筛选..." : "刷新记录"}
        </button>
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}

      {rows.length === 0 && !loading ? (
        <EmptyState title="还没有匹配记录" description="等正式连接数据库后，这里会显示最近 100 条操作明细。" />
      ) : null}

      <section className="space-y-3">
        {rows.map((row) => (
          <div key={`${row.operationId}-${row.palletCode}-${row.materialCode}-${row.createdAt}`} className="pf-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pf-pill bg-ink text-white">{row.operationType}</span>
                  <span className="pf-pill bg-slate-100 text-slate-600">{formatDateTime(row.createdAt)}</span>
                </div>
                <p className="mt-3 font-display text-2xl font-semibold text-ink">
                  {row.palletCode} · {row.shortCode || row.materialCode}
                </p>
                <p className="mt-1 text-sm text-slate-600">{row.materialCode}</p>
                <p className="mt-3 text-xs text-slate-500">
                  生产年月 {formatProductionMonth(row.productionDate)}
                  {row.lotNo ? ` · 批次 ${row.lotNo}` : ""}
                  {row.operatorName ? ` · 操作人 ${row.operatorName}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-2xl font-semibold ${row.quantityChange >= 0 ? "text-pine" : "text-danger"}`}>
                  {row.quantityChange >= 0 ? "+" : ""}
                  {formatQuantity(row.quantityChange)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {formatQuantity(row.quantityBefore)} → {formatQuantity(row.quantityAfter)}
                </p>
              </div>
            </div>
            {row.operationNote || row.lineRemark ? (
              <p className="mt-4 rounded-2xl bg-slate-100/80 px-4 py-3 text-sm text-slate-600">
                {[row.operationNote, row.lineRemark].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}

