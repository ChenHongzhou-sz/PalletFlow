import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatLocationType } from "@/lib/formatters/location";
import { formatQuantity } from "@/lib/formatters/number";
import { transferInventoryBatch, transferLocationInventory } from "@/services/inventory/inventory-service";
import { getPalletInventory } from "@/services/search/search-service";
import type { PalletInventoryRow } from "@/types/domain";

function formatStockForm(value: string | null | undefined) {
  switch (value) {
    case "OPEN":
      return "散料";
    case "SEALED":
      return "整箱";
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
  const [operatorName, setOperatorName] = useState("");

  const [moveSourceCode, setMoveSourceCode] = useState("");
  const [moveTargetCode, setMoveTargetCode] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  const moveInventory = useLocationInventory(moveSourceCode);
  const moveTotalQuantity = moveInventory.rows.reduce((sum, row) => sum + row.quantity, 0);

  const [batchSourceCode, setBatchSourceCode] = useState("");
  const [batchTargetCode, setBatchTargetCode] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [batchQuantity, setBatchQuantity] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const batchInventory = useLocationInventory(batchSourceCode);

  const selectedBatch = useMemo(
    () => batchInventory.rows.find((row) => row.batchId === selectedBatchId) ?? null,
    [batchInventory.rows, selectedBatchId],
  );

  useEffect(() => {
    if (selectedBatchId && !batchInventory.rows.some((row) => row.batchId === selectedBatchId)) {
      setSelectedBatchId("");
      setBatchQuantity("");
    }
  }, [batchInventory.rows, selectedBatchId]);

  useEffect(() => {
    if (!selectedBatch) {
      return;
    }

    const numericQuantity = Number(batchQuantity);
    if (numericQuantity > selectedBatch.quantity) {
      setBatchQuantity(String(selectedBatch.quantity));
    }
  }, [batchQuantity, selectedBatch]);

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

    if (!selectedBatch || !batchInventory.normalizedCode) {
      setBatchError("请先选中要转移的批次。");
      return;
    }

    if (!batchTargetCode.trim()) {
      setBatchError("请输入目标库位。");
      return;
    }

    const numericQuantity = Number(batchQuantity);
    if (!numericQuantity || numericQuantity <= 0) {
      setBatchError("请输入大于 0 的转移数量。");
      return;
    }

    if (numericQuantity > selectedBatch.quantity) {
      setBatchError(`转移数量不能超过当前批次的 ${formatQuantity(selectedBatch.quantity)} PCS。`);
      return;
    }

    setBatchSubmitting(true);
    setBatchError(null);
    setBatchMessage(null);

    try {
      const [result] = await transferInventoryBatch({
        sourceLocationCode: batchInventory.normalizedCode,
        batchId: selectedBatch.batchId,
        targetLocationCode: batchTargetCode,
        quantity: numericQuantity,
        operatorName,
        note: batchNote,
      });
      if (!result) {
        throw new Error("转移已提交，但没有返回批次摘要。请到日志里确认结果。");
      }

      setBatchMessage(
        `已将 ${selectedBatch.materialCode} 的 ${formatQuantity(result.movedQuantity)} PCS 从 ${result.sourceLocationCode} 转到 ${result.targetLocationCode}。`,
      );
      setBatchTargetCode("");
      setBatchNote("");
      if (result.sourceRemainingQuantity > 0) {
        setSelectedBatchId(result.sourceBatchId);
        setBatchQuantity(String(result.sourceRemainingQuantity));
      } else {
        setSelectedBatchId("");
        setBatchQuantity("");
      }
      batchInventory.refresh();
    } catch (reason) {
      setBatchError(resolveErrorMessage(reason));
    } finally {
      setBatchSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Transfer" title="移库 / 转移" description="先补上现场最关键的移库动作：整库位换位，以及把单个批次转到另一张卡板或散料位。" />
      <ConfigNotice />

      <section className="pf-panel p-5">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
          <input className="pf-input" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="可选，例如 张三" />
        </label>
      </section>

      <section className="pf-panel space-y-5 p-5">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">整库位转移</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">适合整板换位。系统会保留原批次和 FIFO 顺序，只把整库位当前所有在库批次移动到新的卡板库位。</p>
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
            helperText="支持直接转到新卡板位，例如 P07。整库位转移只建议转到卡板库位，不建议整库位直接转去散料位。"
          />

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-600">备注</span>
            <input className="pf-input" value={moveNote} onChange={(event) => setMoveNote(event.target.value)} placeholder="可选，例如 现场调整库位" />
          </label>

          {moveInventory.loading ? <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-600">正在读取源库位库存...</div> : null}
          {moveInventory.error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{moveInventory.error}</div> : null}

          {moveInventory.rows.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="源库位" value={moveInventory.normalizedCode} tone="dark" />
                <StatCard label="在库批次" value={String(moveInventory.rows.length)} />
                <StatCard label="总数量" value={`${formatQuantity(moveTotalQuantity)} PCS`} tone="accent" />
              </div>

              <div className="space-y-2 rounded-[1.6rem] bg-slate-100/90 p-4">
                {moveInventory.rows.slice(0, 4).map((row) => (
                  <div key={row.batchId} className="flex items-center justify-between gap-3 text-sm text-slate-600">
                    <span>{row.shortCode || row.materialCode}</span>
                    <span>{formatQuantity(row.quantity)} PCS</span>
                  </div>
                ))}
                {moveInventory.rows.length > 4 ? (
                  <p className="pt-1 text-xs text-slate-500">其余 {moveInventory.rows.length - 4} 个批次也会一起移动。</p>
                ) : null}
              </div>
            </>
          ) : null}

          {moveError ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{moveError}</div> : null}
          {moveMessage ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{moveMessage}</div> : null}

          <button type="submit" disabled={moveSubmitting || moveInventory.rows.length === 0} className="pf-button-primary w-full">
            {moveSubmitting ? "正在转移..." : "确认整库位转移"}
          </button>
        </form>

        {!moveInventory.loading && moveInventory.normalizedCode.length >= 2 && moveInventory.rows.length === 0 && !moveInventory.error ? (
          <EmptyState title="这个源库位当前没有在库批次" description="整库位转移只会移动当前还在库的批次。可以换一个源库位，或先用下方的按批次转移。" />
        ) : null}
      </section>

      <section className="pf-panel space-y-5 p-5">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">按批次 / 部分数量转移</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">适合把某个物料从卡板挪到另一张卡板，或者拆一部分转去散料货架。部分转移后，系统会自动把拆开的那部分按散料逻辑记录。</p>
        </div>

        <PalletCodeField
          label="源库位"
          value={batchSourceCode}
          placeholder="例如 P01、S01、S01-01"
          onChange={setBatchSourceCode}
          helperText="先选源库位，再从下面的批次列表中点选要转移的那一条。"
        />

        {batchInventory.loading ? <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-600">正在读取可转移批次...</div> : null}
        {batchInventory.error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{batchInventory.error}</div> : null}

        {batchInventory.rows.length > 0 ? (
          <div className="space-y-3">
            {batchInventory.rows.map((row) => {
              const isActive = row.batchId === selectedBatchId;

              return (
                <button
                  key={row.batchId}
                  type="button"
                  onClick={() => {
                    setSelectedBatchId(row.batchId);
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
                        {row.dateCode ? ` · DC ${row.dateCode}` : ""}
                        {row.lotNo ? ` · 批次 ${row.lotNo}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-ink">{formatQuantity(row.quantity)} PCS</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="pf-pill bg-white text-slate-600">{formatStockForm(row.stockForm)}</span>
                    {row.boxBarcode ? <span className="pf-pill bg-white text-slate-600">有箱码</span> : null}
                    {isActive ? <span className="pf-pill bg-ink text-white">已选中</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {selectedBatch ? (
          <form className="space-y-4 rounded-[1.8rem] bg-slate-100/90 p-4" onSubmit={handleBatchSubmit}>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="已选物料" value={selectedBatch.shortCode || selectedBatch.materialCode} tone="dark" />
              <StatCard label="当前数量" value={`${formatQuantity(selectedBatch.quantity)} PCS`} />
              <StatCard label="库存形态" value={formatStockForm(selectedBatch.stockForm)} tone="accent" />
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
                  placeholder={`最多 ${formatQuantity(selectedBatch.quantity)}`}
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
        ) : null}

        {!batchInventory.loading && batchInventory.normalizedCode.length >= 2 && batchInventory.rows.length === 0 && !batchInventory.error ? (
          <EmptyState title="这个源库位没有可转移批次" description="可以换一个源库位试试；如果你只是想整板换位，请用上面的整库位转移。" />
        ) : null}
      </section>
    </div>
  );
}
