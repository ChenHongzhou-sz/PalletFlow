import { useDeferredValue, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { StepStrip } from "@/components/mobile/StepStrip";
import { ScanActionButton } from "@/components/scanner/ScanActionButton";
import { resolveErrorMessage } from "@/lib/api/errors";
import { createInboundBatch } from "@/services/inventory/inventory-service";
import { searchMaterials } from "@/services/search/search-service";
import type { MaterialSearchItem } from "@/types/domain";

export function InboundPage() {
  const [palletCode, setPalletCode] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const deferredMaterialQuery = useDeferredValue(materialQuery.trim());
  const [materialOptions, setMaterialOptions] = useState<MaterialSearchItem[]>([]);
  const [selectedMaterialCode, setSelectedMaterialCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [productionMonth, setProductionMonth] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [boxBarcode, setBoxBarcode] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMaterial = materialOptions.find((item) => item.materialCode === selectedMaterialCode) ?? null;
  const currentStep: 1 | 2 | 3 = !palletCode.trim() ? 1 : !selectedMaterial ? 2 : 3;

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedMaterial) {
      setError("请先选中物料。");
      return;
    }

    if (!quantity || Number(quantity) <= 0) {
      setError("请输入大于 0 的数量。");
      return;
    }

    if (!productionMonth) {
      setError("请选择生产年月。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      await createInboundBatch({
        palletCode: palletCode.trim().toUpperCase(),
        materialCode: selectedMaterial.materialCode,
        quantity: Number(quantity),
        productionDate: `${productionMonth}-01`,
        lotNo,
        boxBarcode,
        operatorName,
      });

      setMessage(`已完成入库：${palletCode.trim().toUpperCase()} / ${selectedMaterial.materialCode} / ${quantity} PCS`);
      setQuantity("");
      setProductionMonth("");
      setLotNo("");
      setBoxBarcode("");
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Inbound" title="进卡板" description="按现场节奏压成 3 步：卡板、物料、数量和批次。卡板如果不存在，会在正式写入时自动建立。" />
      <ConfigNotice />

      <section className="pf-panel space-y-5 p-5">
        <StepStrip current={currentStep} labels={["卡板", "物料", "保存"]} />

        <form className="space-y-4" onSubmit={handleSubmit}>
          <PalletCodeField
            label="1. 卡板号"
            value={palletCode}
            placeholder="例如 A01"
            onChange={setPalletCode}
            allowCustom
          />

          <SearchField
            label="2. 搜索物料"
            value={materialQuery}
            placeholder="支持料号、简称、描述、条码入口"
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
              <span className="mb-2 block text-sm font-semibold text-slate-600">3. 数量</span>
              <input className="pf-input" type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="例如 300" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">生产年月</span>
              <input className="pf-input" type="month" value={productionMonth} onChange={(event) => setProductionMonth(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">批次号</span>
              <input className="pf-input" value={lotNo} onChange={(event) => setLotNo(event.target.value)} placeholder="可选" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">外箱条码</span>
              <input className="pf-input" value={boxBarcode} onChange={(event) => setBoxBarcode(event.target.value)} placeholder="可选" />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
            <input className="pf-input" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="可选，例如 张三" />
          </label>

          {error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
          {message ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}

          <button type="submit" disabled={submitting} className="pf-button-primary w-full">
            {submitting ? "正在保存..." : "保存入卡板"}
          </button>
        </form>
      </section>

      {!materialOptions.length && deferredMaterialQuery.length >= 2 ? (
        <EmptyState title="没有找到匹配物料" description="后续你可以继续通过 Excel 导入物料主数据，导完后这里就能立即搜索到。" />
      ) : null}
    </div>
  );
}
