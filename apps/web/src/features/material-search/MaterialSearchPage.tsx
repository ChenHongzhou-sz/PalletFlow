import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { SegmentedSwitch } from "@/components/mobile/SegmentedSwitch";
import { ScanActionButton } from "@/components/scanner/ScanActionButton";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatDateTime, formatProductionMonth } from "@/lib/formatters/date";
import { formatLocationType } from "@/lib/formatters/location";
import { formatQuantity } from "@/lib/formatters/number";
import { aggregateMaterialDistributionRows } from "@/lib/inventory/inventory-aggregation";
import { buildMaterialSpecChips } from "@/lib/materials/material-spec";
import {
  readRecentMaterialSearches,
  readRecentMaterialViews,
  saveRecentMaterialSearch,
  saveRecentMaterialView,
  type RecentMaterialView,
} from "@/lib/materials/recent-materials";
import { getMaterialDistribution, searchMaterials } from "@/services/search/search-service";
import type { MaterialDistributionRow, MaterialSearchItem } from "@/types/domain";

type StockFilter = "all" | "in_stock" | "open_stock";

const stockFilterOptions: Array<{ value: StockFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "in_stock", label: "有库存" },
  { value: "open_stock", label: "有散料" },
];

const matchedByLabels: Record<string, string> = {
  barcode: "条码",
  material_code_exact: "精确料号",
  material_alias_exact: "客户料号",
  short_code_exact: "简称",
  manufacturer_part_no_exact: "厂商料号",
  internal_part_no_exact: "内部料号",
  material_code_prefix: "料号前缀",
  material_alias_prefix: "别名前缀",
  structured: "规格组合",
  contains: "模糊包含",
  fuzzy: "模糊相似",
};

function formatMatchedByLabel(value: string) {
  return matchedByLabels[value] ?? value.replace(/_/gu, " ");
}

function formatStockForm(value: string | null | undefined) {
  if (value === "MIXED") {
    return "混合";
  }

  if (value === "OPEN") {
    return "散料";
  }

  if (value === "SEALED") {
    return "整箱";
  }

  return value ?? "--";
}

function formatPackValue(value: number | null | undefined) {
  return value === null || value === undefined ? "--" : `${formatQuantity(value)} PCS`;
}

function buildRecentViewLabel(item: MaterialSearchItem) {
  return item.materialCode;
}

function buildSpecChips(item: MaterialSearchItem) {
  return buildMaterialSpecChips({
    voltageV: item.voltageV,
    capacitanceValue: item.capacitanceValue,
    diameterMm: item.diameterMm,
    heightMm: item.heightMm,
    series: item.series,
    lifetimeH: item.lifetimeH,
    temperatureC: item.temperatureC,
  });
}

export function MaterialSearchPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [mobilePanel, setMobilePanel] = useState<"results" | "details">("results");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentViews, setRecentViews] = useState<RecentMaterialView[]>([]);
  const [results, setResults] = useState<MaterialSearchItem[]>([]);
  const [selectedMaterialCode, setSelectedMaterialCode] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<MaterialDistributionRow[]>([]);
  const [showAllDistribution, setShowAllDistribution] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRecentSearches(readRecentMaterialSearches());
    setRecentViews(readRecentMaterialViews());
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (deferredQuery.length < 2) {
      setResults([]);
      setSelectedMaterialCode(null);
      setDistribution([]);
      setMobilePanel("results");
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
        setRecentSearches(saveRecentMaterialSearch(deferredQuery));
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setResults([]);
          setSelectedMaterialCode(null);
          setDistribution([]);
          setMobilePanel("results");
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

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      if (stockFilter === "in_stock") {
        return item.totalQuantity > 0;
      }

      if (stockFilter === "open_stock") {
        return item.openStockQuantity > 0;
      }

      return true;
    });
  }, [results, stockFilter]);

  useEffect(() => {
    if (!filteredResults.length) {
      setSelectedMaterialCode(null);
      return;
    }

    setSelectedMaterialCode((current) => {
      if (current && filteredResults.some((item) => item.materialCode === current)) {
        return current;
      }

      return filteredResults[0]?.materialCode ?? null;
    });
  }, [filteredResults]);

  const selected = filteredResults.find((item) => item.materialCode === selectedMaterialCode) ?? null;
  const selectedChips = selected ? buildSpecChips(selected) : [];
  const aggregatedDistribution = useMemo(() => aggregateMaterialDistributionRows(distribution), [distribution]);
  const visibleDistribution = showAllDistribution ? aggregatedDistribution : aggregatedDistribution.slice(0, 6);

  useEffect(() => {
    setShowAllDistribution(false);
  }, [selectedMaterialCode]);

  useEffect(() => {
    let cancelled = false;

    if (!selected) {
      setDistribution([]);
      return;
    }

    setRecentViews(
      saveRecentMaterialView({
        materialCode: selected.materialCode,
        label: buildRecentViewLabel(selected),
      }),
    );

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

  const resultSection = (
    <section className="space-y-3">
      {deferredQuery.length < 2 ? (
        <EmptyState title="先输入至少 2 个字符" description="例如输入 450、470uF、35x50、EP、完整料号或客户料号，系统就会开始检索。" />
      ) : null}

      {loading ? <div className="pf-panel p-5 text-sm text-slate-500">正在搜索物料...</div> : null}

      {!loading && deferredQuery.length >= 2 && results.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {stockFilterOptions.map((option) => {
            const active = stockFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setStockFilter(option.value)}
                className={`pf-pill ${active ? "bg-ink text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {!loading && deferredQuery.length >= 2 && results.length === 0 ? (
        <EmptyState title="未找到对应物料" description="可以换完整料号、客户料号、系列、电压容量组合或尺寸再试，后续也可以继续通过 Excel 导入新主数据。" />
      ) : null}

      {!loading && deferredQuery.length >= 2 && results.length > 0 && filteredResults.length === 0 ? (
        <EmptyState title="当前筛选条件下没有结果" description="搜索结果里有物料，但当前过滤器只显示有库存或有散料的项目。可以切回“全部”查看。" />
      ) : null}

      {filteredResults.map((item) => {
        const isActive = item.materialCode === selectedMaterialCode;
        const specChips = buildSpecChips(item);

        return (
          <button
            key={item.materialCode}
            type="button"
            onClick={() => {
              setSelectedMaterialCode(item.materialCode);
              setMobilePanel("details");
            }}
            className={`pf-panel w-full p-5 text-left transition ${isActive ? "border-ember bg-white" : "hover:-translate-y-0.5"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold text-ink">{item.materialCode}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.description || item.specificationRaw || "暂无描述"}</p>
              </div>
              <span className="pf-pill bg-slate-100 text-slate-600">{formatMatchedByLabel(item.matchedBy)}</span>
            </div>

            {specChips.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {specChips.map((chip) => (
                  <span key={chip} className="pf-pill bg-white text-slate-600">
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="pf-pill bg-slate-100 text-slate-600">库存 {formatQuantity(item.totalQuantity)} PCS</span>
              <span className="pf-pill bg-slate-100 text-slate-600">库位 {item.locationCount}</span>
              {item.openStockQuantity > 0 ? (
                <span className="pf-pill bg-amber-100 text-amber-800">散料 {formatQuantity(item.openStockQuantity)} PCS</span>
              ) : null}
              {item.oldestDateCode ? <span className="pf-pill bg-slate-100 text-slate-600">最老 DC {item.oldestDateCode}</span> : null}
            </div>
          </button>
        );
      })}
    </section>
  );

  const detailSection = selected ? (
    <section className="space-y-4">
      <div className="pf-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-500">当前物料</p>
            <h2 className="mt-2 break-all font-display text-3xl font-semibold text-ink">{selected.materialCode}</h2>
          </div>
          <button
            type="button"
            onClick={() => setMobilePanel("results")}
            className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 lg:hidden"
          >
            返回结果
          </button>
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-600">{selected.description || selected.specificationRaw || "暂无描述"}</p>

        {selectedChips.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedChips.map((chip) => (
              <span key={chip} className="pf-pill bg-slate-100 text-slate-600">
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="总库存" value={`${formatQuantity(selected.totalQuantity)} PCS`} tone="dark" />
          <StatCard label="库位数" value={String(selected.locationCount)} />
          <StatCard label="散料库存" value={`${formatQuantity(selected.openStockQuantity)} PCS`} />
          <StatCard label="最老 DC" value={selected.oldestDateCode || "--"} tone="accent" />
        </div>

        <details className="mt-5 rounded-[1.8rem] bg-slate-100/90 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">更多参数</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { label: "品牌", value: selected.brand || "--" },
              { label: "系列", value: selected.series || "--" },
              { label: "厂商料号", value: selected.manufacturerPartNo || "--" },
              { label: "内部料号", value: selected.internalPartNo || "--" },
              { label: "标准箱数", value: formatPackValue(selected.standardBoxQty) },
              { label: "MOQ", value: formatPackValue(selected.moq) },
              { label: "MPQ", value: formatPackValue(selected.mpq) },
              { label: "生产月份", value: `${formatProductionMonth(selected.earliestProductionDate)} -> ${formatProductionMonth(selected.latestProductionDate)}` },
            ].map((field) => (
              <div key={field.label} className="rounded-[1.4rem] bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{field.label}</p>
                <p className="mt-2 text-sm font-medium text-ink">{field.value}</p>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="pf-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-ink">库存分布</h3>
            <p className="mt-1 text-xs text-slate-500">按库位 + 生产年月汇总显示，仍保持 FIFO 的生产年月顺序。</p>
          </div>
          <span className="text-xs text-slate-500">{aggregatedDistribution.length} 条汇总</span>
        </div>

        {aggregatedDistribution.length ? (
          <div className="mt-4 space-y-3">
            {visibleDistribution.map((row) => (
              <div key={row.groupKey} className="rounded-[1.6rem] bg-slate-100/90 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-xl font-semibold text-ink">{row.locationCode}</p>
                      {row.stockFormSummary ? (
                        <span className={`pf-pill ${row.stockFormSummary === "OPEN" ? "bg-amber-100 text-amber-800" : "bg-white text-slate-600"}`}>
                          {formatStockForm(row.stockFormSummary)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {row.locationType ? `${formatLocationType(row.locationType)} / ` : ""}
                      生产月 {formatProductionMonth(row.productionDate)}
                      {row.dateCodeSummary ? ` / DC ${row.dateCodeSummary}` : ""}
                      {row.lotSummary ? ` / 批号 ${row.lotSummary}` : ""}
                      {` / 已合并 ${row.mergedEntryCount} 次入库`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      {row.boxBarcodeSummary ? <span>箱码 {row.boxBarcodeSummary}</span> : null}
                      {row.receivedAt ? <span>入库 {formatDateTime(row.receivedAt)}</span> : null}
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(row.quantity)} PCS</span>
                </div>
              </div>
            ))}

            {aggregatedDistribution.length > visibleDistribution.length ? (
              <button type="button" onClick={() => setShowAllDistribution(true)} className="pf-button-secondary w-full">
                展开剩余 {aggregatedDistribution.length - visibleDistribution.length} 条
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState title="当前没有可展示的库存" description="这个物料已经在主数据里，但目前没有可汇总的有效库存，后续入库后会自动显示在这里。" />
          </div>
        )}
      </div>
    </section>
  ) : (
    <EmptyState title="搜索结果会显示在这里" description="选中某个物料后，就会看到总库存、库位数、散料数量和按 FIFO 排序的分布明细。" />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Search Material"
        title="查物料"
        description="支持料号、客户料号、系列、电压、容量、尺寸、描述和条码入口。先找到物料，再看库存分布、散料和最老 Date Code。"
      />
      <ConfigNotice />

      <section className="pf-panel space-y-4 p-5">
        <SearchField
          label="输入料号 / 电压 / 容量 / 尺寸 / 系列 / 描述"
          value={query}
          placeholder="例如 450 470 35x50 / 450V 470uF / EP / 德方料号"
          onChange={setQuery}
          action={
            <ScanActionButton
              onScan={(value) => {
                setError(null);
                setQuery(value);
              }}
            />
          }
        />
        <p className="text-xs leading-6 text-slate-500">优先显示条码、精确料号、客户料号和规格组合命中的物料。</p>

        {recentSearches.length || recentViews.length ? (
          <details className="rounded-[1.8rem] bg-slate-100/90 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">最近记录</summary>
            <div className="mt-3 space-y-3">
              {recentSearches.length ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">最近搜索</p>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((item) => (
                      <button key={item} type="button" onClick={() => setQuery(item)} className="pf-pill bg-white text-slate-600">
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {recentViews.length ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">最近查看</p>
                  <div className="flex flex-wrap gap-2">
                    {recentViews.map((item) => (
                      <button key={item.materialCode} type="button" onClick={() => setQuery(item.materialCode)} className="pf-pill bg-white text-slate-600">
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}

      <div className="lg:hidden">
        <SegmentedSwitch
          label="手机视图"
          options={[
            { value: "results", label: `结果${filteredResults.length ? ` (${filteredResults.length})` : ""}` },
            { value: "details", label: selected ? "详情" : "详情" },
          ]}
          value={mobilePanel}
          onChange={setMobilePanel}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.25fr]">
        <div className={mobilePanel === "results" ? "block lg:block" : "hidden lg:block"}>{resultSection}</div>
        <div className={mobilePanel === "details" ? "block lg:block" : "hidden lg:block"}>{detailSection}</div>
      </div>
    </div>
  );
}
