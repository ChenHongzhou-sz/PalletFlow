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
  "pdf417",
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
  "pdf417",
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

type Html5QrcodeImageScanResult = {
  decodedText: string;
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
  scanFileV2: (imageFile: File, showImage?: boolean) => Promise<Html5QrcodeImageScanResult>;
};

type Html5QrcodeModule = typeof import("html5-qrcode");

type BarcodeImageVariant = {
  file: File;
  label: string;
};

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

export interface BarcodeImageDecodeResult {
  engine: "native" | "html5-qrcode";
  results: BarcodeScanResult[];
}

interface StartBarcodeScannerOptions {
  container: HTMLElement;
  onDetected: (result: BarcodeScanResult) => void;
}

let html5QrcodeLoader: Promise<Html5QrcodeModule> | null = null;

function getBarcodeScanBox(viewfinderWidth: number, viewfinderHeight: number) {
  const width = Math.max(280, Math.min(Math.floor(viewfinderWidth * 0.92), 520));
  const height = Math.max(260, Math.min(Math.floor(viewfinderHeight * 0.72), 560));

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

export async function decodeBarcodeImageFile(
  file: File,
  onStatus?: (message: string) => void,
): Promise<BarcodeImageDecodeResult> {
  const nativeCapabilities = await resolveNativeBarcodeCapabilities();

  if (nativeCapabilities.fallbackFormats.length) {
    const nativeResult = await tryDecodeBarcodeImageWithNative(file, nativeCapabilities.fallbackFormats, onStatus);
    if (nativeResult.results.length) {
      return nativeResult;
    }
  }

  return decodeBarcodeImageWithHtml5Qrcode(file, onStatus);
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
        ideal: 1920,
      },
      height: {
        ideal: 1080,
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
        const results = normalizeBarcodeResults(await detector.detect(video));
        const matched = results.find((item) => item.text.length > 0);

        if (matched) {
          await stop();
          onDetected(matched);
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
  const module = await loadHtml5QrcodeModule();
  const mountNode = document.createElement("div");
  const elementId = `pf-scanner-${Math.random().toString(36).slice(2, 10)}`;
  mountNode.id = elementId;
  mountNode.className = "h-full w-full";
  container.replaceChildren(mountNode);

  const scanner: Html5QrcodeInstance = new module.Html5Qrcode(elementId, {
    verbose: false,
    useBarCodeDetectorIfSupported: options.useNativeBarcodeDetector,
    formatsToSupport: getHtml5SupportedFormats(module),
  }) as Html5QrcodeInstance;

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
        aspectRatio: 0.75,
        disableFlip: true,
        videoConstraints: {
          facingMode: {
            ideal: "environment",
          },
          width: {
            ideal: 1920,
          },
          height: {
            ideal: 1080,
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

async function tryDecodeBarcodeImageWithNative(
  file: File,
  formats: readonly string[],
  onStatus?: (message: string) => void,
): Promise<BarcodeImageDecodeResult> {
  const BarcodeDetector = window.BarcodeDetector;
  if (!BarcodeDetector) {
    return {
      engine: "native",
      results: [],
    };
  }

  const detector = new BarcodeDetector({
    formats,
  });

  const image = await loadImageFromFile(file);
  const variants = buildImageCanvasVariants(image);

  for (const variant of variants) {
    onStatus?.(`正在尝试${variant.label}条码解码...`);
    const bitmap = await createImageBitmap(variant.canvas);

    try {
      const results = normalizeBarcodeResults(await detector.detect(bitmap));
      if (results.length) {
        return {
          engine: "native",
          results,
        };
      }
    } catch {
      // Continue trying rotated variants.
    } finally {
      bitmap.close();
    }
  }

  return {
    engine: "native",
    results: [],
  };
}

async function decodeBarcodeImageWithHtml5Qrcode(
  file: File,
  onStatus?: (message: string) => void,
): Promise<BarcodeImageDecodeResult> {
  const module = await loadHtml5QrcodeModule();
  const host = document.createElement("div");
  const hostId = `pf-image-scanner-${Math.random().toString(36).slice(2, 10)}`;
  host.id = hostId;
  host.className = "hidden";
  document.body.appendChild(host);

  const scanner: Html5QrcodeInstance = new module.Html5Qrcode(hostId, {
    verbose: false,
    useBarCodeDetectorIfSupported: true,
    formatsToSupport: getHtml5SupportedFormats(module),
  }) as Html5QrcodeInstance;

  try {
    const variants = await buildImageFileVariants(file);

    for (const variant of variants) {
      onStatus?.(`正在尝试${variant.label}条码解码...`);

      try {
        const result = await scanner.scanFileV2(variant.file, false);
        const text = result.decodedText.trim();

        if (text) {
          return {
            engine: "html5-qrcode",
            results: [
              {
                text,
                format: result.result?.format?.formatName ?? null,
              },
            ],
          };
        }
      } catch {
        // Continue trying rotated variants.
      } finally {
        try {
          scanner.clear();
        } catch {
          // Ignore clear errors between image attempts.
        }
      }
    }
  } finally {
    try {
      scanner.clear();
    } catch {
      // Ignore clear errors during cleanup.
    }

    host.remove();
  }

  throw new Error("这张图片里没有识别到条码。请尽量只拍目标条码，或把手机横过来再扫。");
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

function getHtml5SupportedFormats(module: Html5QrcodeModule) {
  return [
    module.Html5QrcodeSupportedFormats.CODE_128,
    module.Html5QrcodeSupportedFormats.CODE_39,
    module.Html5QrcodeSupportedFormats.CODE_93,
    module.Html5QrcodeSupportedFormats.CODABAR,
    module.Html5QrcodeSupportedFormats.ITF,
    module.Html5QrcodeSupportedFormats.EAN_13,
    module.Html5QrcodeSupportedFormats.EAN_8,
    module.Html5QrcodeSupportedFormats.PDF_417,
    module.Html5QrcodeSupportedFormats.UPC_A,
    module.Html5QrcodeSupportedFormats.UPC_E,
    module.Html5QrcodeSupportedFormats.QR_CODE,
    module.Html5QrcodeSupportedFormats.DATA_MATRIX,
  ];
}

async function loadHtml5QrcodeModule() {
  if (!html5QrcodeLoader) {
    html5QrcodeLoader = import("html5-qrcode")
      .then((module: Html5QrcodeModule) => {
        if (typeof module.Html5Qrcode === "function") {
          return module;
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

function normalizeBarcodeResults(results: NativeBarcode[] | BarcodeScanResult[]) {
  const normalized = results
    .map((item) => {
      if ("text" in item) {
        return {
          text: item.text.trim(),
          format: item.format ?? null,
        };
      }

      return {
        text: item.rawValue?.trim() ?? "",
        format: item.format ?? null,
      };
    })
    .filter((item) => item.text.length > 0);

  const deduped = new Map<string, BarcodeScanResult>();

  for (const item of normalized) {
    const key = `${item.text}::${item.format ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
}

async function buildImageFileVariants(file: File) {
  const image = await loadImageFromFile(file);
  const canvasVariants = buildImageCanvasVariants(image);
  const variants: BarcodeImageVariant[] = [{ file, label: "原图" }];

  for (const variant of canvasVariants) {
    if (variant.angle === 0) {
      continue;
    }

    variants.push({
      file: await canvasToFile(variant.canvas, file, variant.angle),
      label: variant.label,
    });
  }

  return variants;
}

function buildImageCanvasVariants(image: HTMLImageElement) {
  return [
    { angle: 0, label: "原图", canvas: renderRotatedCanvas(image, 0) },
    { angle: 90, label: "顺时针旋转 90°", canvas: renderRotatedCanvas(image, 90) },
    { angle: 270, label: "逆时针旋转 90°", canvas: renderRotatedCanvas(image, 270) },
    { angle: 180, label: "旋转 180°", canvas: renderRotatedCanvas(image, 180) },
  ];
}

function renderRotatedCanvas(image: HTMLImageElement, angle: 0 | 90 | 180 | 270) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  const rotateRightAngle = angle === 90 || angle === 270;
  canvas.width = rotateRightAngle ? sourceHeight : sourceWidth;
  canvas.height = rotateRightAngle ? sourceWidth : sourceHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法处理图片。");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (angle === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (angle === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (angle === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  return canvas;
}

async function canvasToFile(canvas: HTMLCanvasElement, file: File, angle: number) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
        return;
      }

      reject(new Error("图片转换失败，请换一张图片再试。"));
    }, file.type || "image/jpeg");
  });

  const dotIndex = file.name.lastIndexOf(".");
  const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
  const extension = dotIndex > 0 ? file.name.slice(dotIndex) : ".jpg";

  return new File([blob], `${baseName}-rot${angle}${extension}`, {
    type: blob.type || file.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}

function loadImageFromFile(file: File) {
  const objectUrl = URL.createObjectURL(file);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败，请换一张更清晰的条码图片。"));
    };
    image.src = objectUrl;
  });
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
