import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  canUseNativeBarcodeDetector,
  canUseCameraScanner,
  getCameraScannerUnsupportedMessage,
  startCameraBarcodeScanner,
  type BarcodeScannerSession,
} from "@/services/scanner/browser-barcode";
import { canUseNativeTextDetector, recognizeTextFromImage, type OcrCandidate } from "@/services/scanner/image-ocr";

interface CameraScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
}

type ScannerMode = "camera" | "image";

function resolveReasonMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function CameraScannerDialog({ open, onClose, onDetected }: CameraScannerDialogProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<BarcodeScannerSession | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const [mode, setMode] = useState<ScannerMode>("camera");

  const [cameraStatusText, setCameraStatusText] = useState("正在启动摄像头...");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraEngineName, setCameraEngineName] = useState<string | null>(null);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrStatusText, setOcrStatusText] = useState("请选择一张清晰的物料标签图片，系统会尝试提取料号或规格文本。");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrCandidates, setOcrCandidates] = useState<OcrCandidate[]>([]);
  const [ocrRawText, setOcrRawText] = useState("");
  const [ocrImageUrl, setOcrImageUrl] = useState<string | null>(null);
  const [ocrImageName, setOcrImageName] = useState("");
  const [ocrEngine, setOcrEngine] = useState<"native-text-detector" | "tesseract" | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "camera" || !previewRef.current) {
      return;
    }

    if (!canUseCameraScanner()) {
      setCameraError(getCameraScannerUnsupportedMessage());
      setCameraStatusText("当前设备不支持直接扫码。");
      return;
    }

    let disposed = false;
    setCameraError(null);
    setCameraEngineName(null);
    setCameraStatusText("正在启动摄像头...");

    startCameraBarcodeScanner({
      container: previewRef.current,
      onDetected: ({ text }) => {
        onDetected(text);
      },
    })
      .then((session) => {
        if (disposed) {
          void session.stop();
          return;
        }

        sessionRef.current = session;
        setCameraEngineName(session.engine);
        setCameraStatusText("正在识别条码，识别成功后会自动回填。");
      })
      .catch((reason) => {
        if (disposed) {
          return;
        }

        setCameraError(resolveReasonMessage(reason, "扫码启动失败，请刷新页面后重试。"));
        setCameraStatusText("扫码暂时不可用。");
      });

    return () => {
      disposed = true;
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) {
        void activeSession.stop();
      }
    };
  }, [mode, onDetected, open]);

  useEffect(() => {
    if (!open || mode !== "camera" || cameraError || !cameraEngineName) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCameraStatusText((current) =>
        current === "正在识别条码，识别成功后会自动回填。"
          ? "正在识别中，如无反应请让条码尽量铺满长条框，再前后微调 5 到 10 厘米。"
          : current,
      );
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [cameraEngineName, cameraError, mode, open]);

  useEffect(() => {
    if (!open) {
      setMode("camera");
      setCameraError(null);
      setCameraEngineName(null);
      setCameraStatusText("正在启动摄像头...");
      setOcrBusy(false);
      setOcrStatusText("请选择一张清晰的物料标签图片，系统会尝试提取料号或规格文本。");
      setOcrError(null);
      setOcrCandidates([]);
      setOcrRawText("");
      setOcrImageName("");
      setOcrEngine(null);
      setOcrImageUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }

        return null;
      });
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (ocrImageUrl) {
        URL.revokeObjectURL(ocrImageUrl);
      }
    };
  }, [ocrImageUrl]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  function handleOverlayKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onClose();
    }
  }

  async function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setOcrBusy(true);
    setOcrError(null);
    setOcrCandidates([]);
    setOcrRawText("");
    setOcrEngine(null);
    setOcrStatusText("正在准备图片...");
    setOcrImageName(file.name);

    setOcrImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return URL.createObjectURL(file);
    });

    try {
      const result = await recognizeTextFromImage(file, setOcrStatusText);
      setOcrEngine(result.engine);
      setOcrCandidates(result.candidates);
      setOcrRawText(result.rawText);
      setOcrStatusText(
        result.candidates.length === 1
          ? "已识别到 1 个候选内容，点一下即可回填。"
          : `已识别到 ${result.candidates.length} 个候选内容，请点选最接近的一项。`,
      );
    } catch (reason) {
      setOcrError(resolveReasonMessage(reason, "图片识别失败，请换一张更清晰的标签图片。"));
      setOcrStatusText("识图暂时不可用。");
    } finally {
      setOcrBusy(false);
    }
  }

  function handleSelectCandidate(candidate: OcrCandidate) {
    onDetected(candidate.queryText.trim());
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/65 px-3 py-3 sm:px-4 sm:py-6"
      role="presentation"
      onClick={onClose}
      onKeyDown={handleOverlayKeyDown}
    >
      <section
        className="pf-touch-scroll mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col rounded-[2rem] bg-white p-4 shadow-2xl sm:min-h-0 sm:max-h-[calc(100dvh-3rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="pf-pill bg-ink text-white">{mode === "camera" ? "摄像头扫码" : "图片识字"}</p>
            <h2 id={titleId} className="mt-3 font-display text-2xl font-semibold text-ink">
              扫码或识图录入
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
              条码好扫时继续用摄像头；标签难扫时可以直接上传图片，自动提取料号或规格文本。
            </p>
          </div>

          <button type="button" className="pf-button-secondary px-4 py-2" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-full bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode("camera")}
            className={`rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "camera" ? "bg-ink text-white" : "text-slate-600"}`}
          >
            摄像头扫码
          </button>
          <button
            type="button"
            onClick={() => setMode("image")}
            className={`rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "image" ? "bg-ink text-white" : "text-slate-600"}`}
          >
            上传图片识字
          </button>
        </div>

        {mode === "camera" ? (
          <>
            <div className="mt-4 shrink-0 overflow-hidden rounded-[1.75rem] bg-slate-950">
              <div className="relative aspect-[3/4] w-full bg-slate-900">
                <div ref={previewRef} className="pf-scanner-preview h-full w-full" />
                {!cameraError ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-36 w-[88%] rounded-[1.75rem] border-2 border-dashed border-white/80 bg-white/5 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)] sm:h-40" />
                  </div>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-xs leading-6 text-slate-500">商品条形码和箱标都尽量横着放进长条框里，让左右两端完整露出来，识别会更稳。</p>

            <div className="mt-4 rounded-[1.5rem] bg-slate-100 px-4 py-3 text-sm text-slate-600">
              <p>{cameraStatusText}</p>
              <p className="mt-2 text-xs text-slate-500">
                {cameraEngineName === "native"
                  ? "当前浏览器正在使用原生条码识别。"
                  : canUseNativeBarcodeDetector()
                    ? "当前浏览器也支持原生识别，但页面优先启用兼容性更高的摄像头扫码。"
                    : "当前浏览器会自动切换到兼容扫码组件，首次打开可能会稍慢 1 到 2 秒。"}
              </p>
            </div>

            {cameraError ? (
              <div className="mt-4 rounded-[1.5rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {cameraError}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="pf-button-primary flex-1">
                {ocrBusy ? "正在识图..." : ocrImageUrl ? "更换图片继续识别" : "选择标签图片"}
              </button>
              {ocrCandidates.length ? (
                <button
                  type="button"
                  onClick={() => handleSelectCandidate(ocrCandidates[0])}
                  className="pf-button-secondary flex-1"
                >
                  直接填入第 1 个结果
                </button>
              ) : null}
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.75rem] bg-slate-100">
              {ocrImageUrl ? (
                <img src={ocrImageUrl} alt={ocrImageName || "待识别标签"} className="aspect-[4/3] w-full object-contain bg-white" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-sm leading-7 text-slate-500">
                  建议只拍标签上的料号那一行，或从相册选择已经拍好的物料标签图片。
                </div>
              )}
            </div>

            <div className="mt-4 rounded-[1.5rem] bg-slate-100 px-4 py-3 text-sm text-slate-600">
              <p>{ocrStatusText}</p>
              <p className="mt-2 text-xs text-slate-500">
                {ocrEngine === "native-text-detector"
                  ? "当前浏览器正在使用原生图片文字识别。"
                  : canUseNativeTextDetector()
                    ? "当前浏览器支持原生图片识字，若识别不稳定会自动回退到 OCR 引擎。"
                    : "首次使用 OCR 可能需要下载识别包，请保持网络畅通并尽量选择清晰图片。"}
              </p>
            </div>

            {ocrCandidates.length ? (
              <div className="mt-4 space-y-2">
                {ocrCandidates.map((candidate, index) => (
                  <button
                    key={`${candidate.queryText}-${index}`}
                    type="button"
                    onClick={() => handleSelectCandidate(candidate)}
                    className={`block w-full rounded-[1.5rem] border p-4 text-left ${index === 0 ? "border-ember bg-ember/[0.12]" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-display text-xl font-semibold text-ink">{candidate.queryText}</p>
                        {candidate.displayText !== candidate.queryText ? (
                          <p className="mt-2 text-xs leading-6 text-slate-500">原始识别: {candidate.displayText}</p>
                        ) : null}
                      </div>
                      {index === 0 ? <span className="pf-pill bg-ink text-white">推荐</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {ocrRawText ? (
              <details className="mt-4 rounded-[1.5rem] bg-slate-100/90 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">查看原始识别文本</summary>
                <pre className="mt-3 whitespace-pre-wrap break-all text-xs leading-6 text-slate-600">{ocrRawText}</pre>
              </details>
            ) : null}

            {ocrError ? (
              <div className="mt-4 rounded-[1.5rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {ocrError}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
