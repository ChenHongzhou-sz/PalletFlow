import { useDeferredValue, useEffect, useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { StatCard } from "@/components/feedback/StatCard";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { clearPalletInventory } from "@/services/inventory/inventory-service";
import { getPalletInventory } from "@/services/search/search-service";
import type { PalletInventoryRow } from "@/types/domain";

export function PalletSearchPage() {
  const [palletCode, setPalletCode] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const deferredPalletCode = useDeferredValue(palletCode.trim().toUpperCase());
  const deferredMaterialFilter = useDeferredValue(materialFilter.trim().toLowerCase());
  const [rows, setRows] = useState<PalletInventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (deferredPalletCode.length < 2) {
      setRows([]);
      setError(null);
      setMessage(null);
      return;
    }

    setLoading(true);
    setError(null);

    getPalletInventory(deferredPalletCode)
      .then((items) => {
        if (!cancelled) {
          setRows(items);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredPalletCode]);

  const filteredRows = rows.filter((row) => {
    if (!deferredMaterialFilter) {
      return true;
    }

    return [row.materialCode, row.shortCode || "", row.description || ""]
      .join(" ")
      .toLowerCase()
      .includes(deferredMaterialFilter);
  });

  const totalQuantity = filteredRows.reduce((sum, row) => sum + row.quantity, 0);

  async function handleClearPallet() {
    if (!deferredPalletCode || !rows.length) {
      return;
    }

    const firstConfirm = window.confirm(`确认要清空卡板 ${deferredPalletCode} 吗？`);
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm("清空后当前库存会归零，但历史记录会保留。确定继续吗？");
    if (!secondConfirm) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      await clearPalletInventory(deferredPalletCode);
      setRows([]);
      setMessage(`卡板 ${deferredPalletCode} 已清空，历史日志已保留。`);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Search Pallet" title="查卡板" description="直接输入卡板号，先看这个卡板里有哪些物料，再决定盘点、出库或清空。" />
      <ConfigNotice />

      <section className="pf-panel space-y-4 p-5">
        <PalletCodeField
          label="卡板号"
          value={palletCode}
          placeholder="例如 A01、B15、C08"
          onChange={setPalletCode}
          helperText="下拉建议来自系统里已存在的卡板号，输入越接近，候选会越少。"
        />
        <SearchField label="卡板内筛选物料" value={materialFilter} placeholder="可输入简称、料号或描述再筛一次" onChange={setMaterialFilter} />
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}
      {message ? <div className="pf-panel border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-800">{message}</div> : null}

      {deferredPalletCode.length < 2 ? (
        <EmptyState title="先输入卡板号" description="系统会显示该卡板当前还在库的所有批次，并支持按物料再次筛选。" />
      ) : null}
      {loading ? <div className="pf-panel p-5 text-sm text-slate-500">正在读取卡板库存...</div> : null}
      {!loading && deferredPalletCode.length >= 2 && rows.length === 0 ? (
        <EmptyState title="这个卡板当前没有在库批次" description="可能是卡板未使用，或者它已经被清空。如果后续进库，会自动重新变成活跃卡板。" />
      ) : null}

      {rows.length > 0 ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <StatCard label="卡板号" value={deferredPalletCode} tone="dark" />
            <StatCard label="在库批次" value={String(filteredRows.length)} />
            <StatCard label="筛选后数量" value={`${formatQuantity(totalQuantity)} PCS`} tone="accent" />
          </section>

          <section className="space-y-3">
            {filteredRows.map((row) => (
              <div key={row.batchId} className="pf-panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl font-semibold text-ink">{row.shortCode || row.materialCode}</p>
                    <p className="mt-1 text-sm font-medium text-slate-600">{row.materialCode}</p>
                    <p className="mt-3 text-sm text-slate-600">{row.description || "暂无描述"}</p>
                    <p className="mt-3 text-xs text-slate-500">
                      生产年月 {formatProductionMonth(row.productionDate)}
                      {row.lotNo ? ` · 批次 ${row.lotNo}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(row.quantity)} PCS</span>
                </div>
              </div>
            ))}
          </section>

          <section className="pf-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-xl font-semibold text-ink">危险操作</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">清空卡板会把当前卡板的所有批次库存归零，并写入完整历史记录。</p>
            </div>
            <button type="button" onClick={handleClearPallet} disabled={submitting} className="pf-button-danger">
              {submitting ? "正在清空..." : "清空卡板"}
            </button>
          </section>
        </>
      ) : null}
    </div>
  );
}
