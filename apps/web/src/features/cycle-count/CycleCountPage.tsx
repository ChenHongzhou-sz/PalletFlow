import { useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { SegmentedSwitch } from "@/components/mobile/SegmentedSwitch";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { completeCycleCount } from "@/services/inventory/inventory-service";
import { getPalletInventory } from "@/services/search/search-service";
import type { CycleCountInputRow, PalletInventoryRow } from "@/types/domain";

export function CycleCountPage() {
  const [palletCode, setPalletCode] = useState("");
  const [loadedPalletCode, setLoadedPalletCode] = useState<string | null>(null);
  const [rows, setRows] = useState<PalletInventoryRow[]>([]);
  const [countedMap, setCountedMap] = useState<Record<string, string>>({});
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"setup" | "count">("setup");
  const [showOnlyVariance, setShowOnlyVariance] = useState(false);
  const [operatorName, setOperatorName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function clearLoadedRows() {
    setRows([]);
    setCountedMap({});
    setLoadedPalletCode(null);
    setSelectedBatchId("");
    setShowOnlyVariance(false);
  }

  function handlePalletCodeChange(value: string) {
    const normalized = value.trim().toUpperCase();
    setPalletCode(value);
    setError(null);
    setMessage(null);

    if (loadedPalletCode && loadedPalletCode !== normalized) {
      clearLoadedRows();
      setMobilePanel("setup");
    }
  }

  async function handleLoadPallet() {
    const normalized = palletCode.trim().toUpperCase();

    if (normalized.length < 2) {
      clearLoadedRows();
      setError("请先输入卡板号。");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    clearLoadedRows();

    try {
      const inventoryRows = await getPalletInventory(normalized);
      setRows(inventoryRows);
      setCountedMap(Object.fromEntries(inventoryRows.map((row) => [row.batchId, String(row.quantity)])));
      setLoadedPalletCode(normalized);
      setSelectedBatchId(inventoryRows[0]?.batchId ?? "");
      setShowOnlyVariance(false);
      setMobilePanel("count");
    } catch (reason) {
      clearLoadedRows();
      setError(resolveErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!rows.length) {
      return;
    }

    const normalized = palletCode.trim().toUpperCase();
    const items: CycleCountInputRow[] = rows.map((row) => ({
      batchId: row.batchId,
      countedQuantity: Number(countedMap[row.batchId] ?? row.quantity),
    }));

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await completeCycleCount(normalized, items, operatorName);
      const changedLines = result.filter((row) => Number(row.variance_quantity ?? 0) !== 0).length;
      setMessage(`盘点已保存。共处理 ${rows.length} 个批次，产生 ${changedLines} 条差异调整。`);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  const varianceCount = rows.filter((row) => Number(countedMap[row.batchId] ?? row.quantity) !== row.quantity).length;
  const totalSystemQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const visibleRows = showOnlyVariance
    ? rows.filter((row) => Number(countedMap[row.batchId] ?? row.quantity) !== row.quantity)
    : rows;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Cycle Count"
        title="盘点"
        description="先选库位，再改实际数量并保存差异。"
      />
      <ConfigNotice />

      <section className="pf-panel space-y-4 p-5">
        <PalletCodeField
          label="盘点库位号"
          value={palletCode}
          placeholder="例如 P01、S01、OUT-01"
          onChange={handlePalletCodeChange}
          helperText="建议从已有库位里直接选，减少手输错误。"
        />
        <details className="rounded-[1.8rem] bg-slate-100/90 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">
            更多设置{operatorName ? ` · 操作人 ${operatorName}` : ""}
          </summary>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
            <input
              className="pf-input"
              value={operatorName}
              onChange={(event) => setOperatorName(event.target.value)}
              placeholder="可选，例如 王五"
            />
          </label>
        </details>
        <button type="button" onClick={handleLoadPallet} disabled={loading} className="pf-button-secondary">
          {loading ? "正在加载..." : "开始盘点"}
        </button>
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}
      {message ? <div className="pf-panel border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-800">{message}</div> : null}

      {rows.length > 0 ? (
        <div className="lg:hidden">
          <SegmentedSwitch
            label="手机视图"
            options={[
              { value: "setup", label: "库位" },
              { value: "count", label: `明细 (${rows.length})` },
            ]}
            value={mobilePanel}
            onChange={setMobilePanel}
          />
        </div>
      ) : null}

      {!rows.length ? (
        <EmptyState title="先选择一个库位开始盘点" description="系统会按当前库位上的批次逐行给出系统数量，你只需要输入实际数量即可。" />
      ) : (
        <div className={`space-y-5 ${mobilePanel === "count" ? "block lg:block" : "hidden lg:block"}`}>
          <section className="pf-panel space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard label="库位号" value={loadedPalletCode || palletCode.trim().toUpperCase()} tone="dark" />
              <StatCard label="在库批次" value={String(rows.length)} />
              <StatCard label="系统总数" value={`${formatQuantity(totalSystemQuantity)} PCS`} />
              <StatCard label="差异条数" value={String(varianceCount)} tone={varianceCount > 0 ? "accent" : "default"} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowOnlyVariance(false)}
                className={`pf-pill ${showOnlyVariance ? "bg-slate-100 text-slate-600" : "bg-ink text-white"}`}
              >
                全部批次
              </button>
              <button
                type="button"
                onClick={() => setShowOnlyVariance(true)}
                className={`pf-pill ${showOnlyVariance ? "bg-ink text-white" : "bg-slate-100 text-slate-600"}`}
              >
                仅看差异
              </button>
              <button type="button" onClick={() => setMobilePanel("setup")} className="pf-pill bg-white text-slate-600 lg:hidden">
                返回库位
              </button>
            </div>

            <button type="button" onClick={handleSubmit} disabled={submitting} className="pf-button-primary w-full">
              {submitting ? "正在保存盘点..." : "保存盘点差异"}
            </button>
          </section>

          {!visibleRows.length ? (
            <EmptyState title="当前没有差异条目" description="如果你只看差异，说明目前实际数量和系统数量一致。" />
          ) : (
            <section className="space-y-3">
              {visibleRows.map((row) => {
                const countedQuantity = Number(countedMap[row.batchId] ?? row.quantity);
                const variance = countedQuantity - row.quantity;
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
                        <p className="mt-1 text-sm text-slate-600">{row.materialCode}</p>
                        <p className="mt-2 text-xs text-slate-500">生产年月 {formatProductionMonth(row.productionDate)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-slate-500">系统 {formatQuantity(row.quantity)}</p>
                        <p className="mt-1 text-sm font-semibold text-ink">实际 {formatQuantity(countedQuantity)}</p>
                        <p className={`mt-2 text-sm font-semibold ${variance === 0 ? "text-slate-500" : variance > 0 ? "text-pine" : "text-danger"}`}>
                          差异 {variance > 0 ? "+" : ""}
                          {formatQuantity(variance)}
                        </p>
                      </div>
                    </button>

                    {isActive ? (
                      <div className="border-t border-white/60 bg-slate-100/90 p-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">实际数量</span>
                          <input
                            className="pf-input mt-2"
                            type="number"
                            min="0"
                            step="1"
                            value={countedMap[row.batchId] ?? String(row.quantity)}
                            onChange={(event) =>
                              setCountedMap((current) => ({
                                ...current,
                                [row.batchId]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
