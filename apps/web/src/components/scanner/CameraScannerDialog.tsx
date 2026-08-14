import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  canUseNativeBarcodeDetector,
  canUseCameraScanner,
  decodeBarcodeImageFile,
  getCameraScannerUnsupportedMessage,
  startCameraBarcodeScanner,
  type BarcodeImageDecodeResult,
  type BarcodeScanResult,
  type BarcodeScannerSession,
} from "@/services/scanner/browser-barcode";

interface CameraScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
}

type ScannerMode = "camera" | "gallery";

function resolveReasonMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function formatBarcodeKind(format: string | null) {
  if (!format) {
    return "未标明格式";
  }

  if (/qr/iu.test(format)) {
    return "二维码";
  }

  if (/data_matrix|pdf417/iu.test(format)) {
    return format.toUpperCase();
  }

  return `条形码 ${format.toUpperCase()}`;
}

function scoreBarcodeResult(result: BarcodeScanResult) {
  const text = result.text.trim().toUpperCase();
  let score = 0;

  if (/[A-Z]/u.test(text) && /\d/u.test(text)) {
    score += 100;
  }

  if (/^[A-Z0-9\-_/().]+$/u.test(text)) {
    score += 28;
  }

  if (text.length >= 8 && text.length <= 28) {
    score += 24;
  }

  if (/^\d+$/u.test(text)) {
    score -= 26;
  }

  if (/qr/iu.test(result.format ?? "")) {
    score -= 18;
  }

  return score;
}

function sortBarcodeResults(results: BarcodeScanResult[]) {
  return [...results].sort((left, right) => {
    const scoreGap = scoreBarcodeResult(right) - scoreBarcodeResult(left);
    if (scoreGap !== 0) {
      return scoreGap;
    }

    return right.text.length - left.text.length;
  });
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
  const [cameraEngineName, setCameraEngineName] = useState<BarcodeScannerSession["engine"] | null>(null);

  const [imageBusy, setImageBusy] = useState(false);
  const [imageStatusText, setImageStatusText] = useState("可以直接拍一张箱标，系统会只解里面的条码，不再做文字识别。");
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageResults, setImageResults] = useState<BarcodeScanResult[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageEngine, setImageEngine] = useState<BarcodeImageDecodeResult["engine"] | null>(null);

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
          ? "如果是像你箱标那样竖着的一维码，请把手机横过来，让黑线横着穿过取景框。"
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
      setImageBusy(false);
      setImageStatusText("可以直接拍一张箱标，系统会只解里面的条码，不再做文字识别。");
      setImageError(null);
      setImageResults([]);
      setImageName("");
      setImageEngine(null);
      setImageUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }

        return null;
      });
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

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

    setImageBusy(true);
    setImageError(null);
    setImageResults([]);
    setImageEngine(null);
    setImageStatusText("正在准备条码图片...");
    setImageName(file.name);

    setImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return URL.createObjectURL(file);
    });

    try {
      const result = await decodeBarcodeImageFile(file, setImageStatusText);
      const rankedResults = sortBarcodeResults(result.results);
      setImageEngine(result.engine);
      setImageResults(rankedResults);
      setImageStatusText(
        rankedResults.length === 1
          ? "已识别到 1 个条码，点一下即可回填。"
          : `已识别到 ${rankedResults.length} 个条码，请选择要回填的那个。`,
      );
    } catch (reason) {
      setImageError(resolveReasonMessage(reason, "图片条码识别失败，请换一张更清晰的条码图片。"));
      setImageStatusText("相册识码暂时不可用。");
    } finally {
      setImageBusy(false);
    }
  }

  function handleSelectResult(result: BarcodeScanResult) {
    onDetected(result.text.trim());
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
            <p className="pf-pill bg-ink text-white">{mode === "camera" ? "摄像头扫码" : "相册识码"}</p>
            <h2 id={titleId} className="mt-3 font-display text-2xl font-semibold text-ink">
              扫码录入
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
              先用摄像头扫；如果像你这张箱标一样是一维条码又细又竖，就切到“相册识码”，直接解图片里的条码。
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
            onClick={() => setMode("gallery")}
            className={`rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "gallery" ? "bg-ink text-white" : "text-slate-600"}`}
          >
            相册识码
          </button>
        </div>

        {mode === "camera" ? (
          <>
            <div className="mt-4 shrink-0 overflow-hidden rounded-[1.75rem] bg-slate-950">
              <div className="relative aspect-[3/4] w-full bg-slate-900">
                <div ref={previewRef} className="pf-scanner-preview h-full w-full" />
                {!cameraError ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative h-[72%] w-[88%] rounded-[1.75rem] border-2 border-dashed border-white/80 bg-white/5 shadow-[0_0_0_9999px_rgba(15,23,42,0.14)]">
                      <div className="absolute inset-x-6 top-1/2 border-t border-white/70" />
                      <div className="absolute inset-y-6 left-1/2 border-l border-white/35" />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-xs leading-6 text-slate-500">一维码建议让整段黑线完整进入框内。若条码是竖着的，请把手机横过来再扫。</p>

            <div className="mt-4 rounded-[1.5rem] bg-slate-100 px-4 py-3 text-sm text-slate-600">
              <p>{cameraStatusText}</p>
              <p className="mt-2 text-xs text-slate-500">
                {cameraEngineName === "hybrid"
                  ? "当前正在同时使用原生识别和高强度一维码解码。"
                  : cameraEngineName === "native"
                    ? "当前浏览器正在使用原生条码识别。"
                    : canUseNativeBarcodeDetector()
                      ? "当前会优先尝试原生识别，并用一维码解码兜底。"
                      : "当前正在使用高强度一维码解码，首次打开可能会稍慢 1 到 2 秒。"}
              </p>
            </div>

            <button type="button" onClick={() => setMode("gallery")} className="mt-4 pf-button-secondary w-full">
              这种箱标难扫？改用相册识码
            </button>

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
                {imageBusy ? "正在识码..." : imageUrl ? "更换图片继续识码" : "选择箱标图片"}
              </button>
              {imageResults.length ? (
                <button type="button" onClick={() => handleSelectResult(imageResults[0])} className="pf-button-secondary flex-1">
                  直接填入推荐结果
                </button>
              ) : null}
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.75rem] bg-slate-100">
              {imageUrl ? (
                <img src={imageUrl} alt={imageName || "待识别条码"} className="aspect-[4/3] w-full object-contain bg-white" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-sm leading-7 text-slate-500">
                  可以从相册选一张箱标，系统会自动尝试原图、顺时针 90 度和逆时针 90 度再解条码。
                </div>
              )}
            </div>

            <div className="mt-4 rounded-[1.5rem] bg-slate-100 px-4 py-3 text-sm text-slate-600">
              <p>{imageStatusText}</p>
              <p className="mt-2 text-xs text-slate-500">
                {imageEngine === "hybrid"
                  ? "当前正在同时尝试原生图片识别和高强度条码解码。"
                  : imageEngine === "native"
                    ? "当前浏览器正在使用原生图片条码识别。"
                    : imageEngine === "zxing"
                      ? "当前正在使用高强度条码解码。"
                      : "这里只识条码和二维码，不再识别文字。"}
              </p>
            </div>

            {imageResults.length ? (
              <div className="mt-4 space-y-2">
                {imageResults.map((result, index) => (
                  <button
                    key={`${result.text}-${index}`}
                    type="button"
                    onClick={() => handleSelectResult(result)}
                    className={`block w-full rounded-[1.5rem] border p-4 text-left ${index === 0 ? "border-ember bg-ember/[0.12]" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-display text-xl font-semibold text-ink">{result.text}</p>
                        <p className="mt-2 text-xs leading-6 text-slate-500">{formatBarcodeKind(result.format)}</p>
                      </div>
                      {index === 0 ? <span className="pf-pill bg-ink text-white">推荐</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {imageError ? (
              <div className="mt-4 rounded-[1.5rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {imageError}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
