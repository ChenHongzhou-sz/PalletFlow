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

const COMMON_LINEAR_BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "itf",
  "upc_a",
  "upc_e",
] as const;

type NativeBarcode = {
  rawValue?: string;
  format?: string;
};

type NativeBarcodeDetector = {
  detect: (source: ImageBitmapSource) => Promise<NativeBarcode[]>;
};

type NativeBarcodeDetectorConstructor = {
  new (options?: {
    formats?: readonly string[];
  }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

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
  videoConstraints?: MediaTrackConstraints;
};

type Html5QrcodeDecodedResult = {
  result?: {
    format?: {
      formatName?: string;
    };
  };
};

type Html5QrcodeInstance = {
  start: (
    cameraConfig: Html5QrcodeCameraConfig,
    config: Html5QrcodeScanConfig,
    onSuccess: (decodedText: string, decodedResult: Html5QrcodeDecodedResult) => void,
    onError?: (errorMessage: string) => void,
  ) => Promise<unknown>;
  stop: () => Promise<void>;
  clear: () => void;
};

type Html5QrcodeConstructor = new (
  elementId: string,
  config?:
    | boolean
    | {
        verbose?: boolean;
        useBarCodeDetectorIfSupported?: boolean;
      },
) => Html5QrcodeInstance;

type Html5QrcodeModule = typeof import("html5-qrcode");

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
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
  const width = Math.max(260, Math.min(Math.floor(viewfinderWidth * 0.9), 440));
  const height = Math.max(132, Math.min(Math.floor(viewfinderHeight * 0.28), 176));

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

  const nativeCapabilities = await resolveNativeBarcodeCapabilities();

  try {
    return await startHtml5QrcodeScanner(container, onDetected, {
      useNativeBarcodeDetector: nativeCapabilities.preferNativeAssist,
    });
  } catch (error) {
    if (!nativeCapabilities.fallbackFormats.length || !shouldFallbackToNativeScanner(error)) {
      throw error;
    }
  }

  return startNativeBarcodeScanner(container, onDetected, nativeCapabilities.fallbackFormats);
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
  formats: readonly string[],
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
      width: {
        ideal: 1280,
      },
      height: {
        ideal: 720,
      },
      frameRate: {
        ideal: 24,
        max: 30,
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
    formats,
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
        // Ignore intermittent detector errors while the camera is warming up.
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
  options: {
    useNativeBarcodeDetector: boolean;
  },
): Promise<BarcodeScannerSession> {
  const Html5Qrcode = await loadHtml5Qrcode();
  const mountNode = document.createElement("div");
  const elementId = `pf-scanner-${Math.random().toString(36).slice(2, 10)}`;
  mountNode.id = elementId;
  mountNode.className = "h-full w-full";
  container.replaceChildren(mountNode);

  const scanner = new Html5Qrcode(elementId, {
    verbose: false,
    useBarCodeDetectorIfSupported: options.useNativeBarcodeDetector,
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
        fps: 18,
        qrbox: getBarcodeScanBox,
        aspectRatio: 1.333334,
        disableFlip: false,
        videoConstraints: {
          facingMode: {
            ideal: "environment",
          },
          width: {
            ideal: 1280,
          },
          height: {
            ideal: 720,
          },
          frameRate: {
            ideal: 24,
            max: 30,
          },
        },
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
        // html5-qrcode reports every non-match here; keep the UI quiet.
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

async function resolveNativeBarcodeCapabilities() {
  const supportedFormats = await getSupportedNativeBarcodeFormats();

  if (!supportedFormats.length) {
    return {
      preferNativeAssist: false,
      fallbackFormats: [] as string[],
    };
  }

  const supportsCommonLinearCodes = supportedFormats.some((format) =>
    COMMON_LINEAR_BARCODE_FORMATS.includes(format as (typeof COMMON_LINEAR_BARCODE_FORMATS)[number]),
  );

  if (!supportsCommonLinearCodes) {
    return {
      preferNativeAssist: false,
      fallbackFormats: [] as string[],
    };
  }

  return {
    preferNativeAssist: true,
    fallbackFormats: supportedFormats,
  };
}

async function getSupportedNativeBarcodeFormats() {
  const BarcodeDetector = window.BarcodeDetector;

  if (!BarcodeDetector || typeof BarcodeDetector.getSupportedFormats !== "function") {
    return [];
  }

  try {
    const supportedFormats = await BarcodeDetector.getSupportedFormats();

    if (!Array.isArray(supportedFormats) || !supportedFormats.length) {
      return [];
    }

    return NATIVE_BARCODE_FORMATS.filter((format) => supportedFormats.includes(format));
  } catch {
    return [];
  }
}

async function loadHtml5Qrcode() {
  if (!html5QrcodeLoader) {
    // Bundle the fallback scanner with the app so scan still works even
    // when the device cannot reach a third-party CDN.
    html5QrcodeLoader = import("html5-qrcode")
      .then((module: Html5QrcodeModule) => {
        if (typeof module.Html5Qrcode === "function") {
          return module.Html5Qrcode as Html5QrcodeConstructor;
        }

        html5QrcodeLoader = null;
        throw new Error("Scanner module loaded without Html5Qrcode.");
      })
      .catch((error) => {
        html5QrcodeLoader = null;
        if (error instanceof Error) {
          throw error;
        }

        throw new Error("Unable to load the barcode scanner module.");
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

    if (/load|import|chunk/i.test(error.message)) {
      return new Error("扫码组件加载失败，请刷新页面后重试。");
    }

    return error;
  }

  return new Error("扫码初始化失败，请刷新页面后重试。");
}
