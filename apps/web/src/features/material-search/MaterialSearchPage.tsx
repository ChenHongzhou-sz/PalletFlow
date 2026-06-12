import { useDeferredValue, useEffect, useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { ScanActionButton } from "@/components/scanner/ScanActionButton";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth, formatDateTime } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { getMaterialDistribution, searchMaterials } from "@/services/search/search-service";
import type { MaterialDistributionRow, MaterialSearchItem } from "@/types/domain";

export function MaterialSearchPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [results, setResults] = useState<MaterialSearchItem[]>([]);
  const [selectedMaterialCode, setSelectedMaterialCode] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<MaterialDistributionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = results.find((item) => item.materialCode === selectedMaterialCode) ?? null;

  useEffect(() => {
    let cancelled = false;

    if (deferredQuery.length < 2) {
      setResults([]);
      setSelectedMaterialCode(null);
      setDistribution([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    searchMaterials(deferredQuery)
      .then((items) => {
        if (cancelled) {
          return;
        }

        setResults(items);
        setSelectedMaterialCode((current) => current && items.some((item) => item.materialCode === current) ? current : (items[0]?.materialCode ?? null));
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setResults([]);
          setSelectedMaterialCode(null);
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
  }, [deferredQuery]);

  useEffect(() => {
    let cancelled = false;

    if (!selected) {
      setDistribution([]);
      return;
    }

    getMaterialDistribution(selected.materialCode)
      .then((rows) => {
        if (!cancelled) {
          setDistribution(rows);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setDistribution([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Search Material" title="查物料" description="支持完整料号、简称、描述和条码入口。先找到物料，再看它分布在哪些卡板。" />
      <ConfigNotice />

      <section className="pf-panel space-y-4 p-5">
        <SearchField label="输入料号 / 简称 / 描述" value={query} placeholder="例如 100UF、SZ121、SZ1005G121TF" onChange={setQuery} action={<ScanActionButton />} />
        <p className="text-xs leading-6 text-slate-500">搜索结果默认优先显示精确料号、简称和条码命中，再显示模糊搜索。</p>
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_1.25fr]">
        <section className="space-y-3">
          {deferredQuery.length < 2 ? (
            <EmptyState title="先输入至少 2 个字符" description="例如输入 100UF、35V、磁珠、SZ121，系统就会开始检索。" />
          ) : null}
          {loading ? <div className="pf-panel p-5 text-sm text-slate-500">正在搜索物料...</div> : null}
          {!loading && deferredQuery.length >= 2 && results.length === 0 ? (
            <EmptyState title="未找到对应物料" description="可以换完整料号、简称或条码再试，后续也可以直接通过 Excel 导入新物料主数据。" />
          ) : null}

          {results.map((item) => {
            const isActive = item.materialCode === selectedMaterialCode;

            return (
              <button
                key={item.materialCode}
                type="button"
                onClick={() => setSelectedMaterialCode(item.materialCode)}
                className={`pf-panel w-full p-5 text-left transition ${isActive ? "border-ember bg-white" : "hover:-translate-y-0.5"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-display text-2xl font-semibold text-ink">{item.shortCode || item.materialCode}</p>
                    <p className="mt-1 text-sm font-medium text-slate-600">{item.materialCode}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{item.description || "未填写描述"}</p>
                  </div>
                  <span className="pf-pill bg-slate-100 text-slate-600">{item.matchedBy}</span>
                </div>
              </button>
            );
          })}
        </section>

        <section className="space-y-4">
          {selected ? (
            <>
              <div className="pf-panel p-5">
                <p className="text-sm font-semibold text-slate-500">当前物料</p>
                <h2 className="mt-2 font-display text-3xl font-semibold text-ink">{selected.shortCode || selected.materialCode}</h2>
                <p className="mt-1 text-sm font-medium text-slate-600">{selected.materialCode}</p>
                <p className="mt-4 text-sm leading-7 text-slate-600">{selected.description || "暂无描述"}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="总库存" value={`${formatQuantity(selected.totalQuantity)} PCS`} tone="dark" />
                  <StatCard label="卡板数" value={String(selected.palletCount)} />
                  <StatCard label="最早生产" value={formatProductionMonth(selected.earliestProductionDate)} />
                  <StatCard label="最新生产" value={formatProductionMonth(selected.latestProductionDate)} tone="accent" />
                </div>
              </div>

              <div className="pf-panel p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-xl font-semibold text-ink">库存分布</h3>
                  <span className="text-xs text-slate-500">按生产年月升序</span>
                </div>
                <div className="mt-4 space-y-3">
                  {distribution.map((row) => (
                    <div key={row.batchId} className="rounded-[1.6rem] bg-slate-100/90 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-xl font-semibold text-ink">{row.palletCode}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            生产年月 {formatProductionMonth(row.productionDate)} {row.lotNo ? `· 批次 ${row.lotNo}` : ""}
                          </p>
                          {row.boxBarcode ? <p className="mt-1 text-xs text-slate-500">外箱条码 {row.boxBarcode}</p> : null}
                        </div>
                        <span className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(row.quantity)} PCS</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">明细更新时间跟随正式数据库写入。缓存清空不会删除这些原始库存数据。</p>
              </div>
            </>
          ) : (
            <EmptyState title="搜索结果会显示在这里" description="选中某个物料后，就会看到总库存、卡板数和按 FIFO 排序的分布明细。" />
          )}
        </section>
      </div>
    </div>
  );
}

