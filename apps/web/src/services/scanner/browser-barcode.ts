const HTML5_QRCODE_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";

const NATIVE_BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "itf",
  "upc_a",
  "upc_e",
  "qr_code",
  "data_matrix",
] as const;

type NativeBarcode = {
  rawValue?: string;
  format?: string;
};

type NativeBarcodeDetector = {
  detect: (source: ImageBitmapSource) => Promise<NativeBarcode[]>;
};

type NativeBarcodeDetectorConstructor = new (options?: {
  formats?: readonly string[];
}) => NativeBarcodeDetector;

type Html5QrcodeCameraConfig = {
  facingMode?: "user" | "environment" | { exact: string } | { ideal: string };
};

type Html5QrcodeScanConfig = {
  fps?: number;
  qrbox?:
    | number
    | { width: number; height: number }
    | ((viewfinderWidth: number, viewfinderHeight: number) => { width: number; height: number });
  aspectRatio?: number;
  disableFlip?: boolean;
};

type Html5QrcodeInstance = {
  start: (
    cameraConfig: Html5QrcodeCameraConfig,
    config: Html5QrcodeScanConfig,
    onSuccess: (decodedText: string, decodedResult: { result?: { format?: { formatName?: string } } }) => void,
    onError?: (errorMessage: string) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => Promise<void> | void;
};

type Html5QrcodeConstructor = new (
  elementId: string,
  config?: {
    verbose?: boolean;
  },
) => Html5QrcodeInstance;

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
    Html5Qrcode?: Html5QrcodeConstructor;
  }
}

export interface BarcodeScanResult {
  text: string;
  format: string | null;
}

export interface BarcodeScannerSession {
  engine: "native" | "html5-qrcode";
  stop: () => Promise<void>;
}

interface StartBarcodeScannerOptions {
  container: HTMLElement;
  onDetected: (result: BarcodeScanResult) => void;
}

let html5QrcodeLoader: Promise<Html5QrcodeConstructor> | null = null;

function getBarcodeScanBox(viewfinderWidth: number, viewfinderHeight: number) {
  const width = Math.max(220, Math.min(Math.floor(viewfinderWidth * 0.88), 380));
  const height = Math.max(90, Math.min(Math.floor(viewfinderHeight * 0.24), 140));

  return {
    width,
    height,
  };
}

export function canUseCameraScanner() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function canUseNativeBarcodeDetector() {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

export function getCameraScannerUnsupportedMessage() {
  return "当前浏览器无法调用摄像头。请在手机上使用 HTTPS 打开的 Chrome、Edge 或 Safari。";
}

export async function startCameraBarcodeScanner({
  container,
  onDetected,
}: StartBarcodeScannerOptions): Promise<BarcodeScannerSession> {
  if (!canUseCameraScanner()) {
    throw new Error(getCameraScannerUnsupportedMessage());
  }

  try {
    return await startHtml5QrcodeScanner(container, onDetected);
  } catch (error) {
    if (!canUseNativeBarcodeDetector() || !shouldFallbackToNativeScanner(error)) {
      throw error;
    }
  }

  return startNativeBarcodeScanner(container, onDetected);
}

function shouldFallbackToNativeScanner(error: unknown) {
  if (!(error instanceof Error)) {
    return true;
  }

  return !/permission|denied|notallowed|security/i.test(error.message);
}

async function startNativeBarcodeScanner(
  container: HTMLElement,
  onDetected: (result: BarcodeScanResult) => void,
): Promise<BarcodeScannerSession> {
  const BarcodeDetector = window.BarcodeDetector;

  if (!BarcodeDetector) {
    throw new Error("当前浏览器没有原生条码识别能力。");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: {
        ideal: "environment",
      },
    },
  });

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.className = "h-full w-full object-cover";
  video.setAttribute("aria-label", "Camera preview");
  video.srcObject = stream;

  container.replaceChildren(video);

  try {
    await video.play();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    container.replaceChildren();
    throw error;
  }

  const detector = new BarcodeDetector({
    formats: NATIVE_BARCODE_FORMATS,
  });

  let stopped = false;
  let frameId = 0;
  let detecting = false;

  const stop = async () => {
    if (stopped) {
      return;
    }

    stopped = true;

    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }

    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    container.replaceChildren();
  };

  const tick = async () => {
    if (stopped) {
      return;
    }

    if (!detecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      detecting = true;

      try {
        const results = await detector.detect(video);
        const matched = results.find((item) => typeof item.rawValue === "string" && item.rawValue.trim().length > 0);

        if (matched?.rawValue) {
          const text = matched.rawValue.trim();
          await stop();
          onDetected({
            text,
            format: matched.format ?? null,
          });
          return;
        }
      } catch {
        // Ignore intermittent detector errors while the camera is still warming up.
      } finally {
        detecting = false;
      }
    }

    frameId = window.requestAnimationFrame(() => {
      void tick();
    });
  };

  frameId = window.requestAnimationFrame(() => {
    void tick();
  });

  return {
    engine: "native",
    stop,
  };
}

async function startHtml5QrcodeScanner(
  container: HTMLElement,
  onDetected: (result: BarcodeScanResult) => void,
): Promise<BarcodeScannerSession> {
  const Html5Qrcode = await loadHtml5Qrcode();
  const mountNode = document.createElement("div");
  const elementId = `pf-scanner-${Math.random().toString(36).slice(2, 10)}`;
  mountNode.id = elementId;
  mountNode.className = "h-full w-full";
  container.replaceChildren(mountNode);

  const scanner = new Html5Qrcode(elementId, {
    verbose: false,
  });

  let stopped = false;

  const stop = async () => {
    if (stopped) {
      return;
    }

    stopped = true;

    try {
      await scanner.stop();
    } catch {
      // Ignore stop errors when the camera did not finish booting.
    }

    try {
      await scanner.clear();
    } catch {
      // Ignore clear errors after the DOM has already been removed.
    }

    container.replaceChildren();
  };

  try {
    await scanner.start(
      {
        facingMode: "environment",
      },
      {
        fps: 12,
        qrbox: getBarcodeScanBox,
        aspectRatio: 1.333334,
        disableFlip: false,
      },
      async (decodedText, decodedResult) => {
        const text = decodedText.trim();

        if (!text) {
          return;
        }

        await stop();
        onDetected({
          text,
          format: decodedResult?.result?.format?.formatName ?? null,
        });
      },
      () => {
        // html5-qrcode reports every non-match here; we intentionally keep the UI quiet.
      },
    );
  } catch (error) {
    await stop();
    throw normalizeScannerStartError(error);
  }

  return {
    engine: "html5-qrcode",
    stop,
  };
}

async function loadHtml5Qrcode() {
  if (window.Html5Qrcode) {
    return window.Html5Qrcode;
  }

  if (!html5QrcodeLoader) {
    html5QrcodeLoader = new Promise<Html5QrcodeConstructor>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-palletflow-html5-qrcode="true"]');

      const handleLoad = () => {
        if (window.Html5Qrcode) {
          resolve(window.Html5Qrcode);
          return;
        }

        html5QrcodeLoader = null;
        reject(new Error("扫码组件已加载，但浏览器没有暴露 Html5Qrcode 对象。"));
      };

      const handleError = () => {
        html5QrcodeLoader = null;
        reject(new Error("无法加载扫码组件。请检查网络后重试。"));
      };

      if (existingScript) {
        existingScript.addEventListener("load", handleLoad, {
          once: true,
        });
        existingScript.addEventListener("error", handleError, {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.src = HTML5_QRCODE_SCRIPT_URL;
      script.crossOrigin = "anonymous";
      script.dataset.palletflowHtml5Qrcode = "true";
      script.addEventListener("load", handleLoad, {
        once: true,
      });
      script.addEventListener("error", handleError, {
        once: true,
      });
      document.head.appendChild(script);
    });
  }

  return html5QrcodeLoader;
}

function normalizeScannerStartError(error: unknown) {
  if (error instanceof Error) {
    if (/permission|denied|notallowed/i.test(error.message)) {
      return new Error("没有拿到摄像头权限。请允许浏览器访问相机后再试。");
    }

    if (/notfound|devicesnotfound|overconstrained/i.test(error.message)) {
      return new Error("没有找到可用的后置摄像头。请检查手机相机权限或换一台设备。");
    }

    return error;
  }

  return new Error("扫码初始化失败，请刷新页面后重试。");
}
