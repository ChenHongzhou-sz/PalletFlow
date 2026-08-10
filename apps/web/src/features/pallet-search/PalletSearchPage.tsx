import { useDeferredValue, useEffect, useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { StatCard } from "@/components/feedback/StatCard";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatLocationType } from "@/lib/formatters/location";
import { formatQuantity } from "@/lib/formatters/number";
import { clearPalletInventory } from "@/services/inventory/inventory-service";
import { getPalletInventory } from "@/services/search/search-service";
import type { PalletInventoryRow } from "@/types/domain";

export function PalletSearchPage() {
  const [palletCode, setPalletCode] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
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
          setSelectedBatchId(items[0]?.batchId ?? "");
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setRows([]);
          setSelectedBatchId("");
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

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedBatchId("");
      return;
    }

    if (!filteredRows.some((row) => row.batchId === selectedBatchId)) {
      setSelectedBatchId(filteredRows[0]?.batchId ?? "");
    }
  }, [filteredRows, selectedBatchId]);

  function isMissingLocationError(value: string) {
    return /location\s+.+\s+does not exist\./i.test(value);
  }

  async function handleClearPallet() {
    if (!deferredPalletCode || !rows.length) {
      return;
    }

    const firstConfirm = window.confirm(`确认要清空库位 ${deferredPalletCode} 吗？`);
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
      setMessage(`库位 ${deferredPalletCode} 已清空，历史日志已保留。`);
    } catch (reason) {
      const nextError = resolveErrorMessage(reason);

      if (isMissingLocationError(nextError)) {
        setRows([]);
        setError(`库位 ${deferredPalletCode} 在当前数据库里不存在。当前页面显示的库存很可能来自旧缓存，请刷新页面后再重试。`);
        return;
      }

      setError(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Search Location" title="查库位" description="直接查这个库位现在有哪些物料，必要时再筛选或清空。" />
      <ConfigNotice />

      <section className="pf-panel space-y-4 p-5">
        <PalletCodeField
          label="库位号"
          value={palletCode}
          placeholder="例如 P01、S01、IN-01"
          onChange={setPalletCode}
          helperText="下拉建议来自系统里已存在的库位号，输入越接近，候选会越少。"
        />
        <details className="rounded-[1.8rem] bg-slate-100/90 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">
            库位内筛选{materialFilter ? ` · ${materialFilter}` : ""}
          </summary>
          <div className="mt-4">
            <SearchField label="筛选物料" value={materialFilter} placeholder="可输入简称、料号或描述再筛一次" onChange={setMaterialFilter} />
          </div>
        </details>
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}
      {message ? <div className="pf-panel border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-800">{message}</div> : null}

      {deferredPalletCode.length < 2 ? (
        <EmptyState title="先输入库位号" description="系统会显示该库位当前还在库的所有批次，并支持按物料再次筛选。" />
      ) : null}
      {loading ? <div className="pf-panel p-5 text-sm text-slate-500">正在读取库位库存...</div> : null}
      {!loading && deferredPalletCode.length >= 2 && rows.length === 0 ? (
        <EmptyState title="这个库位当前没有在库批次" description="可能是库位尚未使用，或者它已经被清空。如果后续进库，会自动重新出现库存明细。" />
      ) : null}

      {rows.length > 0 ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <StatCard label="库位号" value={deferredPalletCode} tone="dark" />
            <StatCard label="在库批次" value={String(filteredRows.length)} />
            <StatCard label="筛选后数量" value={`${formatQuantity(totalQuantity)} PCS`} tone="accent" />
          </section>

          <section className="space-y-3">
            {filteredRows.map((row) => {
              const isActive = row.batchId === selectedBatchId;

              return (
                <div key={row.batchId} className="pf-panel overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSelectedBatchId(row.batchId)}
                    className="flex w-full items-start justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0">
                      <p className="font-display text-xl font-semibold text-ink">{row.shortCode || row.materialCode}</p>
                      <p className="mt-1 text-sm font-medium text-slate-600">{row.materialCode}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {row.locationType ? `${formatLocationType(row.locationType)} · ` : ""}生产年月 {formatProductionMonth(row.productionDate)}
                        {row.lotNo ? ` · 批次 ${row.lotNo}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(row.quantity)} PCS</span>
                  </button>

                  {isActive ? (
                    <div className="border-t border-white/60 bg-slate-100/90 p-4">
                      <p className="text-sm leading-6 text-slate-600">{row.description || "暂无描述"}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>

          <details className="pf-panel p-5">
            <summary className="cursor-pointer list-none font-display text-xl font-semibold text-ink">危险操作</summary>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-slate-600">清空库位会把当前库位的所有批次库存归零，并写入完整历史记录。</p>
              <button type="button" onClick={handleClearPallet} disabled={submitting} className="pf-button-danger">
                {submitting ? "正在清空..." : "清空库位"}
              </button>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
