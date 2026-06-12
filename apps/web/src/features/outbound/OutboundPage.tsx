import { useDeferredValue, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { StepStrip } from "@/components/mobile/StepStrip";
import { ScanActionButton } from "@/components/scanner/ScanActionButton";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatProductionMonth } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { confirmOutboundPick, getFifoSuggestions } from "@/services/inventory/inventory-service";
import { searchMaterials } from "@/services/search/search-service";
import type { FifoSuggestionRow, MaterialSearchItem } from "@/types/domain";

export function OutboundPage() {
  const [materialQuery, setMaterialQuery] = useState("");
  const deferredMaterialQuery = useDeferredValue(materialQuery.trim());
  const [materialOptions, setMaterialOptions] = useState<MaterialSearchItem[]>([]);
  const [selectedMaterialCode, setSelectedMaterialCode] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [suggestions, setSuggestions] = useState<FifoSuggestionRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMaterial = materialOptions.find((item) => item.materialCode === selectedMaterialCode) ?? null;
  const currentStep: 1 | 2 | 3 = !selectedMaterial ? 1 : !requestedQuantity ? 2 : 3;

  useEffect(() => {
    let cancelled = false;

    if (deferredMaterialQuery.length < 2) {
      setMaterialOptions([]);
      setSelectedMaterialCode("");
      return;
    }

    searchMaterials(deferredMaterialQuery)
      .then((items) => {
        if (cancelled) {
          return;
        }

        setMaterialOptions(items);
        setSelectedMaterialCode((current) => current && items.some((item) => item.materialCode === current) ? current : (items[0]?.materialCode ?? ""));
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setMaterialOptions([]);
          setSelectedMaterialCode("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredMaterialQuery]);

  useEffect(() => {
    let cancelled = false;
    const numericQuantity = Number(requestedQuantity);

    if (!selectedMaterial || !numericQuantity || numericQuantity <= 0) {
      setSuggestions([]);
      return;
    }

    getFifoSuggestions(selectedMaterial.materialId, numericQuantity)
      .then((rows) => {
        if (!cancelled) {
          setSuggestions(rows);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setSuggestions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMaterial, requestedQuantity]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedMaterial) {
      setError("请先选中物料。");
      return;
    }

    if (!requestedQuantity || Number(requestedQuantity) <= 0) {
      setError("请输入出库需求数量。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await confirmOutboundPick(selectedMaterial.materialCode, Number(requestedQuantity), operatorName);
      const picked = result.reduce((sum, row) => sum + Number(row.picked_quantity ?? 0), 0);
      setMessage(`已按 FIFO 出库 ${formatQuantity(picked)} PCS，共涉及 ${result.length} 个批次。`);
      setRequestedQuantity("");
      setSuggestions([]);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Outbound" title="出卡板" description="先找物料，再填需求数量，系统按生产年月自动给出 FIFO 扣减建议。" />
      <ConfigNotice />

      <section className="pf-panel space-y-5 p-5">
        <StepStrip current={currentStep} labels={["物料", "数量", "确认"]} />

        <form className="space-y-4" onSubmit={handleSubmit}>
          <SearchField
            label="1. 搜索物料"
            value={materialQuery}
            placeholder="例如 SZ121、100UF、完整料号"
            onChange={setMaterialQuery}
            action={
              <ScanActionButton
                onScan={(value) => {
                  setError(null);
                  setMessage(null);
                  setMaterialQuery(value);
                }}
              />
            }
          />

          {materialOptions.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {materialOptions.slice(0, 6).map((item) => {
                const isActive = item.materialCode === selectedMaterialCode;
                return (
                  <button
                    key={item.materialCode}
                    type="button"
                    onClick={() => setSelectedMaterialCode(item.materialCode)}
                    className={`rounded-[1.5rem] border p-4 text-left ${isActive ? "border-ember bg-ember/[0.12]" : "border-slate-200 bg-white"}`}
                  >
                    <p className="font-display text-xl font-semibold text-ink">{item.shortCode || item.materialCode}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.materialCode}</p>
                    <p className="mt-2 text-sm text-slate-600">{item.description || "暂无描述"}</p>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">2. 需求数量</span>
              <input className="pf-input" type="number" min="0" step="1" value={requestedQuantity} onChange={(event) => setRequestedQuantity(event.target.value)} placeholder="例如 400" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
              <input className="pf-input" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="可选，例如 李四" />
            </label>
          </div>

          {suggestions.length > 0 ? (
            <div className="space-y-3">
              {suggestions.map((row) => (
                <div key={row.batchId} className="rounded-[1.6rem] bg-slate-100/90 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-xl font-semibold text-ink">{row.palletCode}</p>
                      <p className="mt-1 text-sm text-slate-600">生产年月 {formatProductionMonth(row.productionDate)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        可用 {formatQuantity(row.availableQuantity)} PCS
                        {row.lotNo ? ` · 批次 ${row.lotNo}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-ink">
                      建议扣减 {formatQuantity(row.suggestedQuantity)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
          {message ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}

          <button type="submit" disabled={submitting || !suggestions.length} className="pf-button-primary w-full">
            {submitting ? "正在出库..." : "确认按 FIFO 出库"}
          </button>
        </form>
      </section>

      {!materialOptions.length && deferredMaterialQuery.length >= 2 ? (
        <EmptyState title="未找到可出库的物料" description="确认主数据已导入后再试，或者检查输入的是简称、料号还是描述。" />
      ) : null}
    </div>
  );
}
