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
const CAMERA_VISIBLE_FRAME_MAX_SIDE = 1280;
const CAMERA_SCAN_BAND_WIDTH_RATIO = 0.92;
const CAMERA_SCAN_BAND_HEIGHT_RATIO = 0.42;
const CAMERA_SCAN_LOOSE_BAND_HEIGHT_RATIO = 0.62;

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

type ZxingResultLike = {
  text?: string;
  format?: unknown;
  getText?: () => string;
  getBarcodeFormat?: () => unknown;
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

  const stream = await openPreferredCameraStream();

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.className = "h-full w-full object-cover";
  video.setAttribute("aria-label", "Camera preview");
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
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
  const looseCropCanvas = document.createElement("canvas");
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
          looseCropCanvas,
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
      try {
        results.push(...normalizeBarcodeResults(await nativeDetector.detect(variant.canvas)));
      } catch {
        // Keep trying the ZXing decoder below.
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
  looseCropCanvas,
  rotatedCanvas,
}: {
  video: HTMLVideoElement;
  nativeDetector: NativeBarcodeDetector | null;
  zxing: ZxingModule;
  zxingReader: unknown;
  workingCanvas: HTMLCanvasElement;
  cropCanvas: HTMLCanvasElement;
  looseCropCanvas: HTMLCanvasElement;
  rotatedCanvas: HTMLCanvasElement;
}) {
  drawVisibleVideoFrameToCanvas(video, workingCanvas);

  const scanBandCanvas = renderCameraScanBand(workingCanvas, cropCanvas, CAMERA_SCAN_BAND_HEIGHT_RATIO);
  const looseScanBandCanvas = renderCameraScanBand(workingCanvas, looseCropCanvas, CAMERA_SCAN_LOOSE_BAND_HEIGHT_RATIO);

  if (nativeDetector) {
    for (const canvas of [scanBandCanvas, looseScanBandCanvas]) {
      const nativeResult = pickBestBarcodeResult(normalizeBarcodeResults(await nativeDetector.detect(canvas)));
      if (nativeResult) {
        return nativeResult;
      }
    }
  }

  for (const canvas of [scanBandCanvas, looseScanBandCanvas]) {
    const directResult = decodeCanvasWithZxing(canvas, zxing, zxingReader);
    if (directResult) {
      return directResult;
    }

    for (const angle of [90, 270] as const) {
      const rotatedResult = decodeCanvasWithZxing(renderRotatedCanvas(canvas, rotatedCanvas, angle), zxing, zxingReader);
      if (rotatedResult) {
        return rotatedResult;
      }
    }
  }

  return null;
}

async function openPreferredCameraStream() {
  const cameraAttempts: MediaStreamConstraints[] = [
    {
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
          ideal: 30,
          max: 30,
        },
      },
    },
    {
      audio: false,
      video: {
        facingMode: "environment",
        width: {
          ideal: 1280,
        },
        height: {
          ideal: 720,
        },
      },
    },
    {
      audio: false,
      video: {
        facingMode: "environment",
      },
    },
    {
      audio: false,
      video: true,
    },
  ];

  let lastError: unknown = null;

  for (const constraints of cameraAttempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(getCameraScannerUnsupportedMessage());
}

function drawVisibleVideoFrameToCanvas(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const containerWidth = video.clientWidth || video.parentElement?.clientWidth || sourceWidth;
  const containerHeight = video.clientHeight || video.parentElement?.clientHeight || sourceHeight;
  const targetAspect = containerWidth > 0 && containerHeight > 0 ? containerWidth / containerHeight : sourceWidth / sourceHeight;
  const sourceAspect = sourceWidth / sourceHeight;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceAspect > targetAspect) {
    sw = Math.round(sourceHeight * targetAspect);
    sx = Math.floor((sourceWidth - sw) / 2);
  } else if (sourceAspect < targetAspect) {
    sh = Math.round(sourceWidth / targetAspect);
    sy = Math.floor((sourceHeight - sh) / 2);
  }

  const scale = Math.min(1, CAMERA_VISIBLE_FRAME_MAX_SIDE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("当前浏览器无法处理扫码画面。");
  }

  context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
}

function renderCameraScanBand(source: HTMLCanvasElement, target: HTMLCanvasElement, heightRatio: number) {
  const cropWidth = Math.floor(source.width * CAMERA_SCAN_BAND_WIDTH_RATIO);
  const cropHeight = Math.floor(source.height * heightRatio);
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
  const luminanceSource = new zxing.HTMLCanvasElementLuminanceSource(canvas);
  const binarizers: unknown[] = [new zxing.HybridBinarizer(luminanceSource)];
  const GlobalHistogramBinarizer = (zxing as unknown as { GlobalHistogramBinarizer?: new (source: unknown) => unknown }).GlobalHistogramBinarizer;

  if (GlobalHistogramBinarizer) {
    binarizers.push(new GlobalHistogramBinarizer(luminanceSource));
  }

  for (const binarizer of binarizers) {
    try {
      const binaryBitmap = new (zxing.BinaryBitmap as unknown as new (value: unknown) => unknown)(binarizer);
      const decoded = (reader as { decode: (bitmap: unknown) => ZxingResultLike }).decode(binaryBitmap);
      const text = (decoded.text ?? decoded.getText?.())?.trim();

      if (!text) {
        continue;
      }

      return {
        text,
        format: formatZxingBarcodeKind(decoded.format ?? decoded.getBarcodeFormat?.(), zxing),
      };
    } catch {
      // Some 1D labels decode better with histogram thresholding, so keep trying.
    }
  }

  return null;
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

function pickBestBarcodeResult(results: BarcodeScanResult[]) {
  return [...results].sort((left, right) => scoreBarcodeResult(right) - scoreBarcodeResult(left))[0] ?? null;
}

function scoreBarcodeResult(result: BarcodeScanResult) {
  const text = result.text.trim();
  let score = 0;

  if (/[a-z]/iu.test(text) && /\d/u.test(text)) {
    score += 80;
  }

  if (/^[A-Z0-9\-_/().]+$/iu.test(text)) {
    score += 30;
  }

  if (text.length >= 8 && text.length <= 28) {
    score += 24;
  }

  if (/^\d+$/u.test(text)) {
    score -= 16;
  }

  if (/qr/iu.test(result.format ?? "")) {
    score -= 24;
  }

  return score;
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
