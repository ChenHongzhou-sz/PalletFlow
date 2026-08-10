import { useDeferredValue, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PalletCodeField } from "@/components/forms/PalletCodeField";
import { SearchField } from "@/components/forms/SearchField";
import { PageHeader } from "@/components/mobile/PageHeader";
import { SegmentedSwitch } from "@/components/mobile/SegmentedSwitch";
import { StepStrip } from "@/components/mobile/StepStrip";
import { ScanActionButton } from "@/components/scanner/ScanActionButton";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/formatters/date";
import { formatQuantity } from "@/lib/formatters/number";
import { createInboundBatch, listPendingInventoryPool, putawayPendingInventory, type PendingInventoryPoolItem } from "@/services/inventory/inventory-service";
import { searchMaterials } from "@/services/search/search-service";
import type { MaterialSearchItem } from "@/types/domain";

export function InboundPage() {
  const [inboundMode, setInboundMode] = useState<"manual" | "pending">("manual");
  const [palletCode, setPalletCode] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const deferredMaterialQuery = useDeferredValue(materialQuery.trim());
  const [materialOptions, setMaterialOptions] = useState<MaterialSearchItem[]>([]);
  const [selectedMaterialCode, setSelectedMaterialCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [productionMonth, setProductionMonth] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [boxBarcode, setBoxBarcode] = useState("");

  const [pendingQuery, setPendingQuery] = useState("");
  const deferredPendingQuery = useDeferredValue(pendingQuery.trim());
  const [pendingItems, setPendingItems] = useState<PendingInventoryPoolItem[]>([]);
  const [selectedPendingMaterialCode, setSelectedPendingMaterialCode] = useState("");
  const [pendingTargetLocationCode, setPendingTargetLocationCode] = useState("");
  const [pendingQuantity, setPendingQuantity] = useState("");
  const [pendingProductionMonth, setPendingProductionMonth] = useState("");
  const [pendingLotNo, setPendingLotNo] = useState("");
  const [pendingBoxBarcode, setPendingBoxBarcode] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingReloadKey, setPendingReloadKey] = useState(0);

  const [operatorName, setOperatorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMaterial = materialOptions.find((item) => item.materialCode === selectedMaterialCode) ?? null;
  const selectedPendingItem = pendingItems.find((item) => item.materialCode === selectedPendingMaterialCode) ?? null;
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

  useEffect(() => {
    let cancelled = false;

    if (inboundMode !== "pending") {
      return;
    }

    if (deferredPendingQuery.length === 1) {
      setPendingItems([]);
      setSelectedPendingMaterialCode("");
      return;
    }

    setPendingLoading(true);

    listPendingInventoryPool(deferredPendingQuery, 12)
      .then((items) => {
        if (cancelled) {
          return;
        }

        setPendingItems(items);
        setSelectedPendingMaterialCode((current) =>
          current && items.some((item) => item.materialCode === current) ? current : (items[0]?.materialCode ?? ""),
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(resolveErrorMessage(reason));
          setPendingItems([]);
          setSelectedPendingMaterialCode("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPendingLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredPendingQuery, inboundMode, pendingReloadKey]);

  useEffect(() => {
    if (!selectedPendingItem) {
      return;
    }

    const numericQuantity = Number(pendingQuantity);
    if (!pendingQuantity) {
      setPendingQuantity(String(selectedPendingItem.pendingQuantity));
      return;
    }

    if (numericQuantity > selectedPendingItem.pendingQuantity) {
      setPendingQuantity(String(selectedPendingItem.pendingQuantity));
    }
  }, [pendingQuantity, selectedPendingItem]);

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

  async function handlePendingPutawaySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPendingItem) {
      setError("请先选中待上架物料。");
      return;
    }

    if (!pendingTargetLocationCode.trim()) {
      setError("请输入目标库位。");
      return;
    }

    const numericQuantity = Number(pendingQuantity);
    if (!numericQuantity || numericQuantity <= 0) {
      setError("请输入大于 0 的上架数量。");
      return;
    }

    if (numericQuantity > selectedPendingItem.pendingQuantity) {
      setError(`上架数量不能超过当前待分配的 ${formatQuantity(selectedPendingItem.pendingQuantity)} PCS。`);
      return;
    }

    if (!pendingProductionMonth) {
      setError("请选择生产年月。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const [result] = await putawayPendingInventory({
        materialCode: selectedPendingItem.materialCode,
        targetLocationCode: pendingTargetLocationCode,
        quantity: numericQuantity,
        productionDate: `${pendingProductionMonth}-01`,
        lotNo: pendingLotNo,
        boxBarcode: pendingBoxBarcode,
        operatorName,
        note: pendingNote,
      });

      if (!result) {
        throw new Error("上架已提交，但没有返回结果摘要。请到日志里确认结果。");
      }

      setMessage(
        `已将 ${result.materialCode} 的 ${formatQuantity(result.movedQuantity)} PCS 从待分配池上架到 ${result.targetLocationCode}。`,
      );
      setPendingTargetLocationCode("");
      setPendingProductionMonth("");
      setPendingLotNo("");
      setPendingBoxBarcode("");
      setPendingNote("");
      if (result.remainingPendingQuantity > 0) {
        setPendingQuantity(String(result.remainingPendingQuantity));
      } else {
        setSelectedPendingMaterialCode("");
        setPendingQuantity("");
      }
      setPendingReloadKey((current) => current + 1);
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Inbound" title="入库 / 上架" description="支持两种入口：手动录入正式入库，或把待分配池里的库存上架到具体库位并补录生产月。" />
      <ConfigNotice />

      <SegmentedSwitch
        label="操作方式"
        options={[
          { value: "manual", label: "手动入库" },
          { value: "pending", label: "待上架分配" },
        ]}
        value={inboundMode}
        onChange={setInboundMode}
      />

      <details className="pf-panel p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">
          更多设置{operatorName ? ` · 操作人 ${operatorName}` : ""}
        </summary>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
          <input className="pf-input" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="可选，例如 张三" />
        </label>
      </details>

      {inboundMode === "manual" ? (
        <section className="pf-panel space-y-5 p-5">
          <StepStrip current={currentStep} labels={["库位", "物料", "保存"]} />

          <form className="space-y-4" onSubmit={handleSubmit}>
            <PalletCodeField
              label="1. 目标库位"
              value={palletCode}
              placeholder="例如 P01、M01、S01、IN-01"
              onChange={setPalletCode}
              allowCustom
              helperText="优先使用已初始化库位；如输入新库位，系统会按编码自动识别类型并建立。"
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
                      <p className="font-display text-xl font-semibold text-ink">{item.materialCode}</p>
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

            {error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
            {message ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}

            <button type="submit" disabled={submitting} className="pf-button-primary w-full">
              {submitting ? "正在保存..." : "保存入库"}
            </button>
          </form>
        </section>
      ) : (
        <section className="pf-panel space-y-5 p-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">待上架分配</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">先从 `IN-01` 待分配池选物料，再填写目标库位和生产年月，系统才会生成正式 FIFO 库存。</p>
          </div>

          <SearchField
            label="1. 搜索待上架物料"
            value={pendingQuery}
            placeholder="输入料号或描述；留空时显示最近导入的待上架库存"
            onChange={setPendingQuery}
          />

          {pendingLoading ? <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-600">正在读取待上架库存...</div> : null}

          {pendingItems.length > 0 ? (
            <div className="space-y-3">
              {pendingItems.map((item) => {
                const isActive = item.materialCode === selectedPendingMaterialCode;

                return (
                  <button
                    key={item.materialId}
                    type="button"
                    onClick={() => {
                      setSelectedPendingMaterialCode(item.materialCode);
                      setPendingQuantity(String(item.pendingQuantity));
                      setError(null);
                      setMessage(null);
                    }}
                    className={`block w-full rounded-[1.6rem] border p-4 text-left transition ${
                      isActive ? "border-ember bg-ember/[0.12]" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl font-semibold text-ink">{item.shortCode || item.materialCode}</p>
                        <p className="mt-1 text-sm text-slate-600">{item.materialCode}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          待分配 {formatQuantity(item.pendingQuantity)} PCS
                          {item.updatedAt ? ` · 最近更新 ${formatDateTime(item.updatedAt)}` : ""}
                        </p>
                      </div>
                      {isActive ? <span className="pf-pill bg-ink text-white">已选中</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {selectedPendingItem ? (
            <form className="space-y-4 rounded-[1.8rem] bg-slate-100/90 p-4" onSubmit={handlePendingPutawaySubmit}>
              <div className="rounded-[1.6rem] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-slate-500">已选待上架物料</p>
                <p className="mt-2 font-display text-2xl font-semibold text-ink">{selectedPendingItem.materialCode}</p>
                <p className="mt-2 text-sm text-slate-600">当前待分配数量 {formatQuantity(selectedPendingItem.pendingQuantity)} PCS</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <PalletCodeField
                  label="2. 目标库位"
                  value={pendingTargetLocationCode}
                  placeholder="例如 P01、S01、M01"
                  onChange={setPendingTargetLocationCode}
                  allowCustom
                  helperText="这里填写实际上架后的正式库位。"
                />
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">上架数量</span>
                  <input
                    className="pf-input"
                    type="number"
                    min="0"
                    step="1"
                    value={pendingQuantity}
                    onChange={(event) => setPendingQuantity(event.target.value)}
                    placeholder={`最多 ${formatQuantity(selectedPendingItem.pendingQuantity)}`}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">生产年月</span>
                  <input className="pf-input" type="month" value={pendingProductionMonth} onChange={(event) => setPendingProductionMonth(event.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">批次号</span>
                  <input className="pf-input" value={pendingLotNo} onChange={(event) => setPendingLotNo(event.target.value)} placeholder="可选" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">外箱条码</span>
                  <input className="pf-input" value={pendingBoxBarcode} onChange={(event) => setPendingBoxBarcode(event.target.value)} placeholder="可选" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">备注</span>
                  <input className="pf-input" value={pendingNote} onChange={(event) => setPendingNote(event.target.value)} placeholder="可选，例如 首次上架" />
                </label>
              </div>

              {error ? <div className="rounded-3xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
              {message ? <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}

              <button type="submit" disabled={submitting} className="pf-button-primary w-full">
                {submitting ? "正在上架..." : "确认上架到正式库位"}
              </button>
            </form>
          ) : null}
        </section>
      )}

      {inboundMode === "manual" && !materialOptions.length && deferredMaterialQuery.length >= 2 ? (
        <EmptyState title="没有找到匹配物料" description="后续你可以继续通过 Excel 导入物料主数据，导完后这里就能立即搜索到。" />
      ) : null}

      {inboundMode === "pending" && !pendingLoading && !pendingItems.length ? (
        <EmptyState title="当前没有待上架库存" description="先去“数据导入”里上传料号和数量，系统会先把它们放进待分配池，之后你再到这里分配正式库位和生产月。" />
      ) : null}
    </div>
  );
}
