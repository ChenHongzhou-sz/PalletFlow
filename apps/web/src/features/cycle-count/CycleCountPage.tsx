import { useState } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { completeCycleCount } from "@/services/inventory/inventory-service";
import { getPalletInventory } from "@/services/search/search-service";
import type { CycleCountInputRow, PalletInventoryRow } from "@/types/domain";

export function CycleCountPage() {
  const [palletCode, setPalletCode] = useState("");
  const [rows, setRows] = useState<PalletInventoryRow[]>([]);
  const [countedMap, setCountedMap] = useState<Record<string, string>>({});
  const [operatorName, setOperatorName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleLoadPallet() {
    if (palletCode.trim().length < 2) {
      setError("请先输入卡板号。");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const inventoryRows = await getPalletInventory(palletCode.trim().toUpperCase());
      setRows(inventoryRows);
      setCountedMap(
        Object.fromEntries(inventoryRows.map((row) => [row.batchId, String(row.quantity)])),
      );
    } catch (reason) {
      setError(resolveErrorMessage(reason));
      setRows([]);
      setCountedMap({});
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!rows.length) {
      return;
    }

    const items: CycleCountInputRow[] = rows.map((row) => ({
      batchId: row.batchId,
      countedQuantity: Number(countedMap[row.batchId] ?? row.quantity),
    }));

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await completeCycleCount(palletCode.trim().toUpperCase(), items, operatorName);
      const changedLines = result.filter((row) => Number(row.variance_quantity ?? 0) !== 0).length;
      setMessage(`盘点已保存。共处理 ${rows.length} 个批次，产生 ${changedLines} 条差异调整。`);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cycle Count" title="盘点" description="从卡板开始盘点，系统先拉出当前库存，再由你录入实际数量并生成差异。" />
      <ConfigNotice />

      <section className="pf-panel space-y-4 p-5">
        <PalletCodeField
          label="盘点卡板号"
          value={palletCode}
          placeholder="例如 A01"
          onChange={setPalletCode}
          helperText="建议从已有卡板里直接选，减少手输错误。"
        />
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
          <input className="pf-input" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="可选，例如 王五" />
        </label>
        <button type="button" onClick={handleLoadPallet} disabled={loading} className="pf-button-secondary">
          {loading ? "正在加载..." : "开始盘点"}
        </button>
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}
      {message ? <div className="pf-panel border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-800">{message}</div> : null}

      {!rows.length ? (
        <EmptyState title="先选择一个卡板开始盘点" description="系统会按当前卡板上的批次逐行给出系统数量，你只需要输入实际数量即可。" />
      ) : (
        <>
          <section className="space-y-3">
            {rows.map((row) => {
              const countedQuantity = Number(countedMap[row.batchId] ?? row.quantity);
              const variance = countedQuantity - row.quantity;

              return (
                <div key={row.batchId} className="pf-panel p-5">
                  <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] lg:items-end">
                    <div>
                      <p className="font-display text-xl font-semibold text-ink">{row.shortCode || row.materialCode}</p>
                      <p className="mt-1 text-sm text-slate-600">{row.materialCode}</p>
                      <p className="mt-3 text-xs text-slate-500">生产年月 {formatProductionMonth(row.productionDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">系统数量</p>
                      <p className="mt-2 text-lg font-semibold text-ink">{formatQuantity(row.quantity)}</p>
                    </div>
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
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">差异</p>
                      <p className={`mt-2 text-lg font-semibold ${variance === 0 ? "text-slate-600" : variance > 0 ? "text-pine" : "text-danger"}`}>
                        {variance > 0 ? "+" : ""}
                        {formatQuantity(variance)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          <button type="button" onClick={handleSubmit} disabled={submitting} className="pf-button-primary w-full">
            {submitting ? "正在保存盘点..." : "保存盘点差异"}
          </button>
        </>
      )}
    </div>
  );
}
