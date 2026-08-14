import { useDeferredValue, useEffect, useMemo, useState } from "react";
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

type PalletInventoryGroup = {
  groupKey: string;
  palletCode: string;
  locationCode: string;
  locationName: string | null;
  locationType: string | null;
  materialCode: string;
  shortCode: string | null;
  description: string | null;
  productionDate: string;
  lotNo: string | null;
  stockForm: string | null;
  totalQuantity: number;
  batchCount: number;
  batches: PalletInventoryRow[];
};

function normalizeGroupToken(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function buildPalletInventoryGroups(rows: PalletInventoryRow[]) {
  const groups = new Map<string, PalletInventoryGroup>();

  for (const row of rows) {
    const groupKey = [
      normalizeGroupToken(row.locationCode),
      normalizeGroupToken(row.materialCode),
      normalizeGroupToken(row.productionDate),
      normalizeGroupToken(row.lotNo),
      normalizeGroupToken(row.stockForm),
    ].join("|");

    const existing = groups.get(groupKey);

    if (existing) {
      existing.totalQuantity += row.quantity;
      existing.batchCount += 1;
      existing.batches.push(row);
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
      lotNo: row.lotNo,
      stockForm: row.stockForm,
      totalQuantity: row.quantity,
      batchCount: 1,
      batches: [row],
    });
  }

  return Array.from(groups.values());
}

export function PalletSearchPage() {
  const [palletCode, setPalletCode] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
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
          setSelectedGroupKey("");
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setRows([]);
          setSelectedGroupKey("");
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

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (!deferredMaterialFilter) {
          return true;
        }

        return [row.materialCode, row.shortCode || "", row.description || ""]
          .join(" ")
          .toLowerCase()
          .includes(deferredMaterialFilter);
      }),
    [deferredMaterialFilter, rows],
  );

  const groupedRows = useMemo(() => buildPalletInventoryGroups(filteredRows), [filteredRows]);
  const totalQuantity = useMemo(() => filteredRows.reduce((sum, row) => sum + row.quantity, 0), [filteredRows]);

  useEffect(() => {
    if (!groupedRows.length) {
      setSelectedGroupKey("");
      return;
    }

    if (!groupedRows.some((row) => row.groupKey === selectedGroupKey)) {
      setSelectedGroupKey(groupedRows[0]?.groupKey ?? "");
    }
  }, [groupedRows, selectedGroupKey]);

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
        <EmptyState title="先输入库位号" description="系统会按物料汇总显示该库位当前还在库的库存，并支持展开查看每个入库批次。" />
      ) : null}
      {loading ? <div className="pf-panel p-5 text-sm text-slate-500">正在读取库位库存...</div> : null}
      {!loading && deferredPalletCode.length >= 2 && rows.length === 0 ? (
        <EmptyState title="这个库位当前没有在库批次" description="可能是库位尚未使用，或者它已经被清空。如果后续进库，会自动重新出现库存明细。" />
      ) : null}

      {rows.length > 0 ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="库位号" value={deferredPalletCode} tone="dark" />
            <StatCard label="物料项数" value={String(groupedRows.length)} />
            <StatCard label="入库批次" value={String(filteredRows.length)} />
            <StatCard label="筛选后数量" value={`${formatQuantity(totalQuantity)} PCS`} tone="accent" />
          </section>

          <section className="space-y-3">
            {groupedRows.length ? (
              groupedRows.map((group) => {
                const isActive = group.groupKey === selectedGroupKey;
                const batchLabel = group.batchCount > 1 ? `${group.batchCount} 个入库批次` : "1 个入库批次";

                return (
                  <div key={group.groupKey} className="pf-panel overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSelectedGroupKey(group.groupKey)}
                      className="flex w-full items-start justify-between gap-3 p-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="font-display text-xl font-semibold text-ink">{group.shortCode || group.materialCode}</p>
                        <p className="mt-1 text-sm font-medium text-slate-600">{group.materialCode}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {group.locationType ? `${formatLocationType(group.locationType)} · ` : ""}生产年月 {formatProductionMonth(group.productionDate)}
                          {group.lotNo ? ` · 批号 ${group.lotNo}` : ""}
                          {` · ${batchLabel}`}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(group.totalQuantity)} PCS</span>
                    </button>

                    {isActive ? (
                      <div className="space-y-3 border-t border-white/60 bg-slate-100/90 p-4">
                        <p className="text-sm leading-6 text-slate-600">{group.description || "暂无描述"}</p>
                        {group.batchCount > 1 ? (
                          <p className="text-xs leading-6 text-slate-500">当前页面已按“同料号 + 同生产年月 + 同批号”合并显示，下面仍保留每次入库的批次明细，不影响 FIFO。</p>
                        ) : null}
                        <div className="space-y-2">
                          {group.batches.map((batch, index) => (
                            <div key={batch.batchId} className="rounded-[1.1rem] bg-white/80 px-3 py-3 text-sm text-slate-600">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-ink">入库批次 {index + 1}</p>
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-ink">{formatQuantity(batch.quantity)} PCS</span>
                              </div>
                              <p className="mt-2 text-xs leading-6 text-slate-500">
                                {batch.boxBarcode ? `箱码 ${batch.boxBarcode}` : "无箱码"}
                                {batch.dateCode ? ` · Date Code ${batch.dateCode}` : ""}
                                {batch.stockForm ? ` · 形态 ${batch.stockForm}` : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <EmptyState title="当前筛选没有命中物料" description="可以换一个关键词，或先清空筛选词查看这个库位下的全部库存。" />
            )}
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
