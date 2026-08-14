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

const CAMERA_SCAN_INTERVAL_MS = 80;
const CAMERA_SCAN_BAND_WIDTH_RATIO = 0.94;
const CAMERA_SCAN_BAND_HEIGHT_RATIO = 0.34;

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

type ZxingModule = typeof import("html5-qrcode/third_party/zxing-js.umd");

type CanvasVariant = {
  canvas: HTMLCanvasElement;
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
  engine: "native" | "zxing" | "hybrid";
  stop: () => Promise<void>;
}

export interface BarcodeImageDecodeResult {
  engine: "native" | "zxing" | "hybrid";
  results: BarcodeScanResult[];
}

interface StartBarcodeScannerOptions {
  container: HTMLElement;
  onDetected: (result: BarcodeScanResult) => void;
}

let zxingLoader: Promise<ZxingModule> | null = null;

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

  const [zxing, nativeFormats] = await Promise.all([loadZxingModule(), getSupportedNativeBarcodeFormats()]);
  const nativeDetector = createNativeBarcodeDetector(nativeFormats);
  const zxingReader = createZxingReader(zxing);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: {
        ideal: "environment",
      },
      width: {
        ideal: 1920,
        min: 640,
      },
      height: {
        ideal: 1080,
        min: 480,
      },
      frameRate: {
        ideal: 30,
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
  applyTrackOptimizations(stream);

  try {
    await video.play();
  } catch (error) {
    stopMediaStream(stream);
    container.replaceChildren();
    throw error;
  }

  const workingCanvas = document.createElement("canvas");
  const cropCanvas = document.createElement("canvas");
  const rotatedCanvas = document.createElement("canvas");

  let stopped = false;
  let frameId = 0;
  let scanning = false;
  let lastScanAt = 0;

  const stop = async () => {
    if (stopped) {
      return;
    }

    stopped = true;

    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }

    stopMediaStream(stream);
    video.pause();
    video.srcObject = null;
    container.replaceChildren();
  };

  const tick = async (timestamp: number) => {
    if (stopped) {
      return;
    }

    if (!scanning && timestamp - lastScanAt >= CAMERA_SCAN_INTERVAL_MS && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      scanning = true;
      lastScanAt = timestamp;

      try {
        const result = await scanVideoFrame({
          video,
          nativeDetector,
          zxing,
          zxingReader,
          workingCanvas,
          cropCanvas,
          rotatedCanvas,
        });

        if (result) {
          await stop();
          onDetected(result);
          return;
        }
      } catch {
        // Keep scanning. Camera frames often fail until focus and exposure settle.
      } finally {
        scanning = false;
      }
    }

    frameId = window.requestAnimationFrame(tick);
  };

  frameId = window.requestAnimationFrame(tick);

  return {
    engine: nativeDetector ? "hybrid" : "zxing",
    stop,
  };
}

export async function decodeBarcodeImageFile(
  file: File,
  onStatus?: (message: string) => void,
): Promise<BarcodeImageDecodeResult> {
  const [zxing, nativeFormats] = await Promise.all([loadZxingModule(), getSupportedNativeBarcodeFormats()]);
  const nativeDetector = createNativeBarcodeDetector(nativeFormats);
  const zxingReader = createZxingReader(zxing);
  const image = await loadImageFromFile(file);
  const variants = buildImageCanvasVariants(image);
  const results: BarcodeScanResult[] = [];

  for (const variant of variants) {
    onStatus?.(`正在尝试${variant.label}条码解码...`);

    if (nativeDetector) {
      const bitmap = await createImageBitmap(variant.canvas);
      try {
        results.push(...normalizeBarcodeResults(await nativeDetector.detect(bitmap)));
      } catch {
        // Keep trying the ZXing decoder below.
      } finally {
        bitmap.close();
      }
    }

    const zxingResult = decodeCanvasWithZxing(variant.canvas, zxing, zxingReader);
    if (zxingResult) {
      results.push(zxingResult);
    }
  }

  const deduped = dedupeBarcodeResults(results);

  if (!deduped.length) {
    throw new Error("这张图片里没有识别到条码。请尽量只拍目标条码，或把手机横过来再扫。");
  }

  return {
    engine: nativeDetector ? "hybrid" : "zxing",
    results: deduped,
  };
}

async function scanVideoFrame({
  video,
  nativeDetector,
  zxing,
  zxingReader,
  workingCanvas,
  cropCanvas,
  rotatedCanvas,
}: {
  video: HTMLVideoElement;
  nativeDetector: NativeBarcodeDetector | null;
  zxing: ZxingModule;
  zxingReader: unknown;
  workingCanvas: HTMLCanvasElement;
  cropCanvas: HTMLCanvasElement;
  rotatedCanvas: HTMLCanvasElement;
}) {
  drawVideoToCanvas(video, workingCanvas);

  const scanBandCanvas = renderCameraScanBand(workingCanvas, cropCanvas);

  if (nativeDetector) {
    const nativeResults = normalizeBarcodeResults(await nativeDetector.detect(scanBandCanvas));
    if (nativeResults.length) {
      return nativeResults[0];
    }
  }

  const variants = [
    { canvas: scanBandCanvas, label: "长条取景区" },
    { canvas: renderRotatedCanvas(scanBandCanvas, rotatedCanvas, 90), label: "长条取景区旋转 90 度" },
  ];

  for (const variant of variants) {
    const result = decodeCanvasWithZxing(variant.canvas, zxing, zxingReader);
    if (result) {
      return result;
    }
  }

  return null;
}

function drawVideoToCanvas(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("当前浏览器无法处理扫码画面。");
  }

  context.drawImage(video, 0, 0, width, height);
}

function renderCameraScanBand(source: HTMLCanvasElement, target: HTMLCanvasElement) {
  const cropWidth = Math.floor(source.width * CAMERA_SCAN_BAND_WIDTH_RATIO);
  const cropHeight = Math.floor(source.height * CAMERA_SCAN_BAND_HEIGHT_RATIO);
  const sx = Math.floor((source.width - cropWidth) / 2);
  const sy = Math.floor((source.height - cropHeight) / 2);
  target.width = cropWidth;
  target.height = cropHeight;

  const context = target.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("当前浏览器无法处理扫码画面。");
  }

  context.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return target;
}

function renderCenterCrop(source: HTMLCanvasElement, target: HTMLCanvasElement) {
  const cropWidth = Math.floor(source.width * 0.92);
  const cropHeight = Math.floor(source.height * 0.7);
  const sx = Math.floor((source.width - cropWidth) / 2);
  const sy = Math.floor((source.height - cropHeight) / 2);
  target.width = cropWidth;
  target.height = cropHeight;

  const context = target.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("当前浏览器无法处理扫码画面。");
  }

  context.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return target;
}

function renderRotatedCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement, angle: 90 | 270) {
  target.width = source.height;
  target.height = source.width;

  const context = target.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("当前浏览器无法处理扫码画面。");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, target.width, target.height);

  if (angle === 90) {
    context.translate(target.width, 0);
    context.rotate(Math.PI / 2);
  } else {
    context.translate(0, target.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(source, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return target;
}

function buildImageCanvasVariants(image: HTMLImageElement): CanvasVariant[] {
  const source = renderImageToCanvas(image);
  const clockwise = document.createElement("canvas");
  const counterClockwise = document.createElement("canvas");
  const centerCrop = document.createElement("canvas");

  return [
    { canvas: source, label: "原图" },
    { canvas: renderCenterCrop(source, centerCrop), label: "中心区域" },
    { canvas: renderRotatedCanvas(source, clockwise, 90), label: "顺时针旋转 90 度" },
    { canvas: renderRotatedCanvas(source, counterClockwise, 270), label: "逆时针旋转 90 度" },
  ];
}

function renderImageToCanvas(image: HTMLImageElement) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("当前浏览器无法处理图片。");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function decodeCanvasWithZxing(canvas: HTMLCanvasElement, zxing: ZxingModule, reader: unknown): BarcodeScanResult | null {
  try {
    const luminanceSource = new zxing.HTMLCanvasElementLuminanceSource(canvas);
    const binaryBitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(luminanceSource));
    const decoded = (reader as { decode: (bitmap: unknown) => { text?: string; format?: unknown } }).decode(binaryBitmap);
    const text = decoded.text?.trim();

    if (!text) {
      return null;
    }

    return {
      text,
      format: formatZxingBarcodeKind(decoded.format, zxing),
    };
  } catch {
    return null;
  }
}

function createZxingReader(zxing: ZxingModule) {
  const hints = new Map<unknown, unknown>();
  hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [
    zxing.BarcodeFormat.CODE_128,
    zxing.BarcodeFormat.EAN_13,
    zxing.BarcodeFormat.EAN_8,
    zxing.BarcodeFormat.UPC_A,
    zxing.BarcodeFormat.UPC_E,
    zxing.BarcodeFormat.CODE_39,
    zxing.BarcodeFormat.CODE_93,
    zxing.BarcodeFormat.ITF,
    zxing.BarcodeFormat.CODABAR,
    zxing.BarcodeFormat.QR_CODE,
    zxing.BarcodeFormat.DATA_MATRIX,
    zxing.BarcodeFormat.PDF_417,
  ]);
  hints.set(zxing.DecodeHintType.TRY_HARDER, true);

  return new zxing.MultiFormatReader(false, hints);
}

function formatZxingBarcodeKind(format: unknown, zxing: ZxingModule) {
  const entry = Object.entries(zxing.BarcodeFormat).find(([, value]) => value === format);
  return entry?.[0] ?? null;
}

function createNativeBarcodeDetector(formats: string[]) {
  const BarcodeDetector = window.BarcodeDetector;

  if (!BarcodeDetector || !formats.length) {
    return null;
  }

  try {
    return new BarcodeDetector({
      formats,
    });
  } catch {
    return null;
  }
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

async function loadZxingModule() {
  if (!zxingLoader) {
    zxingLoader = import("html5-qrcode/third_party/zxing-js.umd").catch((error) => {
      zxingLoader = null;
      if (error instanceof Error) {
        throw error;
      }

      throw new Error("Unable to load the barcode scanner module.");
    });
  }

  return zxingLoader;
}

function normalizeBarcodeResults(results: NativeBarcode[] | BarcodeScanResult[]) {
  return dedupeBarcodeResults(
    results
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
      .filter((item) => item.text.length > 0),
  );
}

function dedupeBarcodeResults(results: BarcodeScanResult[]) {
  const deduped = new Map<string, BarcodeScanResult>();

  for (const item of results) {
    const key = `${item.text.trim()}::${item.format ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        text: item.text.trim(),
        format: item.format ?? null,
      });
    }
  }

  return Array.from(deduped.values());
}

function applyTrackOptimizations(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.applyConstraints !== "function") {
    return;
  }

  const capabilities = typeof track.getCapabilities === "function" ? (track.getCapabilities() as Record<string, unknown>) : {};
  const advanced: Record<string, unknown> = {};

  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
    advanced.focusMode = "continuous";
  }

  if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) {
    advanced.exposureMode = "continuous";
  }

  if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) {
    advanced.whiteBalanceMode = "continuous";
  }

  if (typeof capabilities.zoom === "object" && capabilities.zoom !== null) {
    const zoomCapability = capabilities.zoom as { min?: number; max?: number };
    const min = typeof zoomCapability.min === "number" ? zoomCapability.min : 1;
    const max = typeof zoomCapability.max === "number" ? zoomCapability.max : 1;
    const targetZoom = Math.min(max, Math.max(min, 1.4));
    if (targetZoom > min) {
      advanced.zoom = targetZoom;
    }
  }

  if (!Object.keys(advanced).length) {
    return;
  }

  void track.applyConstraints({
    advanced: [advanced],
  } as MediaTrackConstraints).catch(() => {
    // Some mobile browsers expose capabilities but reject one or more values.
  });
}

function stopMediaStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
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
