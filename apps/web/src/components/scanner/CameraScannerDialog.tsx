import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  canUseNativeBarcodeDetector,
  canUseCameraScanner,
  getCameraScannerUnsupportedMessage,
  startCameraBarcodeScanner,
  type BarcodeScannerSession,
} from "@/services/scanner/browser-barcode";

interface CameraScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
}

export function CameraScannerDialog({ open, onClose, onDetected }: CameraScannerDialogProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<BarcodeScannerSession | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [statusText, setStatusText] = useState("正在启动摄像头...");
  const [error, setError] = useState<string | null>(null);
  const [engineName, setEngineName] = useState<string | null>(null);

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
    if (!open || !previewRef.current) {
      return;
    }

    if (!canUseCameraScanner()) {
      setError(getCameraScannerUnsupportedMessage());
      setStatusText("当前设备不支持直接扫码。");
      return;
    }

    let disposed = false;
    setError(null);
    setEngineName(null);
    setStatusText("正在启动摄像头...");

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
        setEngineName(session.engine);
        setStatusText("请将条码放入取景框中央，识别成功后会自动回填。");
      })
      .catch((reason) => {
        if (disposed) {
          return;
        }

        const message = reason instanceof Error ? reason.message : "扫码启动失败，请刷新页面后重试。";
        setError(message);
        setStatusText("扫码暂时不可用。");
      });

    return () => {
      disposed = true;
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) {
        void activeSession.stop();
      }
    };
  }, [onDetected, open]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setEngineName(null);
      setStatusText("正在启动摄像头...");
    }
  }, [open]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 px-4 pb-4 pt-10 sm:items-center"
      role="presentation"
      onClick={onClose}
      onKeyDown={handleOverlayKeyDown}
    >
      <section
        className="w-full max-w-md rounded-[2rem] bg-white p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="pf-pill bg-ink text-white">{engineName === "native" ? "原生扫码" : "摄像头扫码"}</p>
            <h2 id={titleId} className="mt-3 font-display text-2xl font-semibold text-ink">
              使用手机摄像头扫码
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
              建议对准外箱条码或物料标签，距离 15 到 25 厘米，保持光线充足。
            </p>
          </div>

          <button type="button" className="pf-button-secondary px-4 py-2" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-[1.75rem] bg-slate-950">
          <div className="relative aspect-[3/4] w-full bg-slate-900">
            <div ref={previewRef} className="pf-scanner-preview h-full w-full" />
            {!error ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-36 w-[78%] rounded-[1.75rem] border-2 border-dashed border-white/80 bg-white/5 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)]" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-[1.5rem] bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <p>{statusText}</p>
          <p className="mt-2 text-xs text-slate-500">
            {engineName === "native"
              ? "当前浏览器正在使用原生条码识别。"
              : canUseNativeBarcodeDetector()
                ? "当前浏览器也支持原生识别，但页面优先启用兼容性更高的摄像头扫码。"
                : "当前浏览器会自动切换到兼容扫码组件，首次打开可能会稍慢 1 到 2 秒。"}
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-[1.5rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </section>
    </div>
  );
}
