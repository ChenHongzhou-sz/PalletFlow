import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { SegmentedSwitch } from "@/components/mobile/SegmentedSwitch";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatLocationType } from "@/lib/formatters/location";
import { formatQuantity } from "@/lib/formatters/number";
import { allocateTransferQuantity } from "@/lib/inventory/inventory-allocation";
import { aggregatePalletInventoryRows } from "@/lib/inventory/inventory-aggregation";
import { transferInventoryBatch, transferLocationInventory } from "@/services/inventory/inventory-service";
import { getPalletInventory } from "@/services/search/search-service";
import type { PalletInventoryRow } from "@/types/domain";

function formatStockForm(value: string | null | undefined) {
  switch (value) {
    case "OPEN":
      return "散料";
    case "SEALED":
      return "整箱";
    case "MIXED":
      return "混合";
    default:
      return value ?? "未标记";
  }
}

function useLocationInventory(locationCode: string) {
  const normalizedCode = useDeferredValue(locationCode.trim().toUpperCase());
  const [rows, setRows] = useState<PalletInventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (normalizedCode.length < 2) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getPalletInventory(normalizedCode)
      .then((items) => {
        if (!cancelled) {
          setRows(items);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setRows([]);
          setError(resolveErrorMessage(reason));
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
  }, [normalizedCode, reloadKey]);

  return {
    normalizedCode,
    rows,
    loading,
    error,
    refresh() {
      setReloadKey((current) => current + 1);
    },
  };
}

export function TransferPage() {
  const [transferMode, setTransferMode] = useState<"location" | "batch">("location");
  const [operatorName, setOperatorName] = useState("");

  const [moveSourceCode, setMoveSourceCode] = useState("");
  const [moveTargetCode, setMoveTargetCode] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  const moveInventory = useLocationInventory(moveSourceCode);
  const moveAggregatedRows = useMemo(() => aggregatePalletInventoryRows(moveInventory.rows), [moveInventory.rows]);
  const moveTotalQuantity = moveAggregatedRows.reduce((sum, row) => sum + row.quantity, 0);

  const [batchSourceCode, setBatchSourceCode] = useState("");
  const [batchTargetCode, setBatchTargetCode] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [batchQuantity, setBatchQuantity] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const batchInventory = useLocationInventory(batchSourceCode);
  const batchAggregatedRows = useMemo(() => aggregatePalletInventoryRows(batchInventory.rows), [batchInventory.rows]);

  const selectedGroup = useMemo(
    () => batchAggregatedRows.find((row) => row.groupKey === selectedGroupKey) ?? null,
    [batchAggregatedRows, selectedGroupKey],
  );

  useEffect(() => {
    if (selectedGroupKey && !batchAggregatedRows.some((row) => row.groupKey === selectedGroupKey)) {
      setSelectedGroupKey("");
      setBatchQuantity("");
    }
  }, [batchAggregatedRows, selectedGroupKey]);

  useEffect(() => {
    if (!selectedGroup) {
      return;
    }

    const numericQuantity = Number(batchQuantity);
    if (numericQuantity > selectedGroup.quantity) {
      setBatchQuantity(String(selectedGroup.quantity));
    }
  }, [batchQuantity, selectedGroup]);

  async function handleMoveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!moveInventory.normalizedCode || moveInventory.rows.length === 0) {
      setMoveError("请先选择一个有库存的源库位。");
      return;
    }

    if (!moveTargetCode.trim()) {
      setMoveError("请输入目标卡板库位。");
      return;
    }

    setMoveSubmitting(true);
    setMoveError(null);
    setMoveMessage(null);

    try {
      const result = await transferLocationInventory(moveInventory.normalizedCode, moveTargetCode, operatorName, moveNote);
      if (!result.length) {
        throw new Error("移库已提交，但没有返回任何批次摘要。请到日志里确认结果。");
      }
      const movedTotal = result.reduce((sum, row) => sum + row.movedQuantity, 0);
      setMoveMessage(`已将 ${result.length} 个批次、共 ${formatQuantity(movedTotal)} PCS 从 ${moveInventory.normalizedCode} 转到 ${moveTargetCode.trim().toUpperCase()}。`);
      setMoveTargetCode("");
      setMoveNote("");
      moveInventory.refresh();
    } catch (reason) {
      setMoveError(resolveErrorMessage(reason));
    } finally {
      setMoveSubmitting(false);
    }
  }

  async function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedGroup || !batchInventory.normalizedCode) {
      setBatchError("请先选中要转移的汇总项。");
      return;
    }

    const normalizedTargetCode = batchTargetCode.trim().toUpperCase();
    if (!normalizedTargetCode) {
      setBatchError("请输入目标库位。");
      return;
    }

    const numericQuantity = Number(batchQuantity);
    if (!numericQuantity || numericQuantity <= 0) {
      setBatchError("请输入大于 0 的转移数量。");
      return;
    }

    if (numericQuantity > selectedGroup.quantity) {
      setBatchError(`转移数量不能超过当前汇总项的 ${formatQuantity(selectedGroup.quantity)} PCS。`);
      return;
    }

    setBatchSubmitting(true);
    setBatchError(null);
    setBatchMessage(null);

    try {
      const allocations = allocateTransferQuantity(selectedGroup.sourceRows, numericQuantity);
      const results = [];

      for (const allocation of allocations) {
        const [result] = await transferInventoryBatch({
          sourceLocationCode: batchInventory.normalizedCode,
          batchId: allocation.batchId,
          targetLocationCode: normalizedTargetCode,
          quantity: allocation.quantity,
          operatorName,
          note: batchNote,
        });

        if (!result) {
          throw new Error("转移已提交，但没有返回批次摘要。请到日志里确认结果。");
        }

        results.push(result);
      }

      const movedTotal = results.reduce((sum, row) => sum + row.movedQuantity, 0);
      const remainingGroupQuantity = Math.max(0, selectedGroup.quantity - movedTotal);
      setBatchMessage(
        `已将 ${selectedGroup.materialCode} 的 ${formatQuantity(movedTotal)} PCS 从 ${batchInventory.normalizedCode} 转到 ${normalizedTargetCode}，共涉及 ${results.length} 个底层批次。`,
      );
      setBatchTargetCode("");
      setBatchNote("");
      if (remainingGroupQuantity > 0) {
        setSelectedGroupKey(selectedGroup.groupKey);
        setBatchQuantity(String(remainingGroupQuantity));
      } else {
        setSelectedGroupKey("");
        setBatchQuantity("");
      }
      batchInventory.refresh();
    } catch (reason) {
      setBatchError(resolveErrorMessage(reason));
    } finally {
      setBatchSubmitting(false);
    }
  }

  const batchSelectionList =
    batchAggregatedRows.length > 0 ? (
      <div className="space-y-3">
        {batchAggregatedRows.map((row) => {
          const isActive = row.groupKey === selectedGroupKey;

          return (
            <button
              key={row.groupKey}
              type="button"
              onClick={() => {
                setSelectedGroupKey(row.groupKey);
                setBatchQuantity(String(row.quantity));
                setBatchError(null);
                setBatchMessage(null);
              }}
              className={`block w-full rounded-[1.6rem] border p-4 text-left transition ${
                isActive ? "border-ember bg-ember/[0.12]" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-semibold text-ink">{row.shortCode || row.materialCode}</p>
                  <p className="mt-1 text-sm text-slate-600">{row.materialCode}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {row.locationType ? `${formatLocationType(row.locationType)} · ` : ""}生产年月 {formatProductionMonth(row.productionDate)}
                    {row.dateCodeSummary ? ` · DC ${row.dateCodeSummary}` : ""}
                    {row.mergedEntryCount > 1 ? ` · 已合并 ${row.mergedEntryCount} 次入库` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(row.quantity)} PCS</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="pf-pill bg-white text-slate-600">{formatStockForm(row.stockFormSummary)}</span>
                {row.lotSummary ? <span className="pf-pill bg-white text-slate-600">{row.lotSummary === "多批号" ? "批号已汇总" : `批号 ${row.lotSummary}`}</span> : null}
                {row.boxBarcodeSummary ? <span className="pf-pill bg-white text-slate-600">{row.boxBarcodeSummary === "多箱码" ? "箱码已汇总" : "有箱码"}</span> : null}
                {isActive ? <span className="pf-pill bg-ink text-white">已选中</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Transfer" title="移库 / 转移" description="先补上现场最关键的移库动作：整库位换位，以及把单个批次转到另一张卡板或散料位。" />
      <ConfigNotice />

      <details className="pf-panel p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">
          更多设置{operatorName ? ` · 操作人 ${operatorName}` : ""}
        </summary>
        <div className="mt-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
            <input className="pf-input" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="可选，例如 张三" />
          </label>
        </div>
      </details>

      <SegmentedSwitch
        label="移库方式"
        options={[
          { value: "location", label: "整库位" },
          { value: "batch", label: "按汇总项" },
        ]}
        value={transferMode}
        onChange={setTransferMode}
      />

      {transferMode === "location" ? (
        <section className="pf-panel space-y-5 p-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">整库位转移</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">适合整板换位。界面会先按“同料号 + 同生产月”汇总预览，但系统仍会保留原底层批次和 FIFO 顺序去执行移库。</p>
          </div>

          <form className="space-y-4" onSubmit={handleMoveSubmit}>
            <PalletCodeField
              label="源库位"
              value={moveSourceCode}
              placeholder="例如 P01、M01、S01"
              onChange={setMoveSourceCode}
              helperText="这里必须选择已经有库存的现有库位。"
            />

            <PalletCodeField
              label="目标卡板库位"
              value={moveTargetCode}
              placeholder="例如 P07、M02"
              onChange={setMoveTargetCode}
              allowCustom
              helperText="支持直接转到新卡板位，例如 P07。整库位转移只建议转到卡板库位。"
            />

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">备注</span>
              <input className="pf-input" value={moveNote} onChange={(event) => setMoveNote(event.target.value)} placeholder="可选，例如 现场调整库位" />
            </label>

            {moveInventory.loading ? <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-600">正在读取源库位库存...</div> : null}
            {moveInventory.error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{moveInventory.error}</div> : null}

            {moveInventory.rows.length > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <StatCard label="源库位" value={moveInventory.normalizedCode} tone="dark" />
                  <StatCard label="底层批次" value={String(moveInventory.rows.length)} />
                  <StatCard label="汇总项" value={String(moveAggregatedRows.length)} />
                  <StatCard label="总数量" value={`${formatQuantity(moveTotalQuantity)} PCS`} tone="accent" />
                </div>

                <details className="rounded-[1.8rem] bg-slate-100/90 p-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">查看将一起移动的汇总项</summary>
                  <div className="mt-3 space-y-2">
                    {moveAggregatedRows.slice(0, 6).map((row) => (
                      <div key={row.groupKey} className="flex items-center justify-between gap-3 text-sm text-slate-600">
                        <span>
                          {row.shortCode || row.materialCode}
                          <span className="ml-2 text-xs text-slate-500">生产月 {formatProductionMonth(row.productionDate)}</span>
                          {row.mergedEntryCount > 1 ? <span className="ml-2 text-xs text-slate-500">已合并 {row.mergedEntryCount} 次入库</span> : null}
                        </span>
                        <span>{formatQuantity(row.quantity)} PCS</span>
                      </div>
                    ))}
                    {moveAggregatedRows.length > 6 ? <p className="pt-1 text-xs text-slate-500">其余 {moveAggregatedRows.length - 6} 条汇总项也会一起移动。</p> : null}
                  </div>
                </details>
              </>
            ) : null}

            {moveError ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{moveError}</div> : null}
            {moveMessage ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{moveMessage}</div> : null}

            <button type="submit" disabled={moveSubmitting || moveInventory.rows.length === 0} className="pf-button-primary w-full">
              {moveSubmitting ? "正在转移..." : "确认整库位转移"}
            </button>
          </form>

          {!moveInventory.loading && moveInventory.normalizedCode.length >= 2 && moveInventory.rows.length === 0 && !moveInventory.error ? (
            <EmptyState title="这个源库位当前没有在库批次" description="整库位转移只会移动当前还在库的库存。可以换一个源库位，或切到“按汇总项”处理。" />
          ) : null}
        </section>
      ) : (
        <section className="pf-panel space-y-5 p-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">按汇总项 / 部分数量转移</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">适合把某个物料从卡板挪到另一张卡板，或者拆一部分转去散料货架。界面按“同料号 + 同生产月”合并显示，提交时系统会自动拆回对应底层批次执行。</p>
          </div>

          <PalletCodeField
            label="源库位"
            value={batchSourceCode}
            placeholder="例如 P01、S01、S01-01"
            onChange={setBatchSourceCode}
            helperText="先选源库位，再从下面的汇总列表中点选要转移的那一条。"
          />

          {batchInventory.loading ? <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-600">正在读取可转移批次...</div> : null}
          {batchInventory.error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{batchInventory.error}</div> : null}

          {selectedGroup ? (
            <>
              <form className="space-y-4 rounded-[1.8rem] bg-slate-100/90 p-4" onSubmit={handleBatchSubmit}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label="已选物料" value={selectedGroup.shortCode || selectedGroup.materialCode} tone="dark" />
                  <StatCard label="当前数量" value={`${formatQuantity(selectedGroup.quantity)} PCS`} />
                  <StatCard label="库存形态" value={formatStockForm(selectedGroup.stockFormSummary)} tone="accent" />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-600">转移数量</span>
                    <input
                      className="pf-input"
                      type="number"
                      min="0"
                      step="1"
                      value={batchQuantity}
                      onChange={(event) => setBatchQuantity(event.target.value)}
                      placeholder={`最多 ${formatQuantity(selectedGroup.quantity)}`}
                    />
                  </label>

                  <PalletCodeField
                    label="目标库位"
                    value={batchTargetCode}
                    placeholder="例如 P07、S01、S01-01"
                    onChange={setBatchTargetCode}
                    allowCustom
                    helperText="支持转到新卡板位或散料位。散料格会阻止不同物料混放。"
                  />
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">备注</span>
                  <input className="pf-input" value={batchNote} onChange={(event) => setBatchNote(event.target.value)} placeholder="可选，例如 拆箱后转散料" />
                </label>

                {batchError ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{batchError}</div> : null}
                {batchMessage ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{batchMessage}</div> : null}

                <button type="submit" disabled={batchSubmitting} className="pf-button-primary w-full">
                  {batchSubmitting ? "正在转移..." : "确认按批次转移"}
                </button>
              </form>

              <details className="rounded-[1.8rem] bg-slate-100/90 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">更换汇总项</summary>
                <div className="mt-3">{batchSelectionList}</div>
              </details>
            </>
          ) : (
            batchSelectionList
          )}

          {!batchInventory.loading && batchInventory.normalizedCode.length >= 2 && batchInventory.rows.length === 0 && !batchInventory.error ? (
            <EmptyState title="这个源库位没有可转移库存" description="可以换一个源库位试试；如果你只是想整板换位，请切到“整库位”处理。" />
          ) : null}
        </section>
      )}
    </div>
  );
}
