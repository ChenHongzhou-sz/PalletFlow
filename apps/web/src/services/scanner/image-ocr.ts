type NativeDetectedText = {
  rawValue?: string;
};

type NativeTextDetector = {
  detect: (source: ImageBitmapSource) => Promise<NativeDetectedText[]>;
};

type NativeTextDetectorConstructor = {
  new (): NativeTextDetector;
};

declare global {
  interface Window {
    TextDetector?: NativeTextDetectorConstructor;
  }
}

export interface OcrCandidate {
  queryText: string;
  displayText: string;
  score: number;
  confidence: number;
}

export interface ImageOcrResult {
  engine: "native-text-detector" | "tesseract";
  rawText: string;
  candidates: OcrCandidate[];
}

interface OcrFragment {
  text: string;
  confidence: number;
}

const OCR_CHAR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/(). ";

export function canUseNativeTextDetector() {
  return typeof window !== "undefined" && typeof window.TextDetector === "function" && typeof createImageBitmap === "function";
}

export async function recognizeTextFromImage(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ImageOcrResult> {
  const nativeResult = await tryRecognizeWithNativeTextDetector(file);
  if (nativeResult && nativeResult.candidates.length) {
    return nativeResult;
  }

  return recognizeWithTesseract(file, onProgress);
}

async function tryRecognizeWithNativeTextDetector(file: File): Promise<ImageOcrResult | null> {
  if (!canUseNativeTextDetector()) {
    return null;
  }

  const TextDetector = window.TextDetector;
  if (!TextDetector) {
    return null;
  }

  const detector = new TextDetector();
  const bitmap = await createImageBitmap(file);

  try {
    const blocks = await detector.detect(bitmap);
    const rawText = blocks
      .map((block) => block.rawValue?.trim() ?? "")
      .filter(Boolean)
      .join("\n");

    if (!rawText) {
      return null;
    }

    return {
      engine: "native-text-detector",
      rawText,
      candidates: buildOcrCandidates([{ text: rawText, confidence: 90 }], rawText),
    };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

async function recognizeWithTesseract(file: File, onProgress?: (message: string) => void): Promise<ImageOcrResult> {
  onProgress?.("正在加载识图引擎，首次使用会稍慢一些...");

  const tesseract = await import("tesseract.js");
  const preparedImage = await buildHighContrastImage(file);

  const worker = await tesseract.createWorker("eng", 1, {
    logger(message) {
      onProgress?.(formatTesseractProgress(message.status, message.progress));
    },
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
      tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    });

    const result = await worker.recognize(preparedImage);
    const fragments = collectOcrFragments(result.data);
    const rawText = result.data.text?.trim() ?? "";
    const candidates = buildOcrCandidates(fragments, rawText);

    if (!candidates.length) {
      throw new Error("图片里没有识别到稳定的料号或规格文本。请尽量拍清楚标签上的料号行。");
    }

    return {
      engine: "tesseract",
      rawText,
      candidates,
    };
  } catch (reason) {
    if (reason instanceof Error) {
      throw reason;
    }

    throw new Error("图片识别失败，请换一张更清晰的标签图片再试。");
  } finally {
    await worker.terminate();
  }
}

function collectOcrFragments(data: {
  text?: string;
  lines?: Array<{ text?: string; confidence?: number }>;
  words?: Array<{ text?: string; confidence?: number }>;
}) {
  const fragments: OcrFragment[] = [];

  if (Array.isArray(data.lines)) {
    for (const line of data.lines) {
      const text = line.text?.trim();
      if (!text) {
        continue;
      }

      fragments.push({
        text,
        confidence: Number.isFinite(line.confidence) ? Number(line.confidence) : 70,
      });
    }
  }

  if (Array.isArray(data.words)) {
    for (const word of data.words) {
      const text = word.text?.trim();
      if (!text || text.length < 4) {
        continue;
      }

      fragments.push({
        text,
        confidence: Number.isFinite(word.confidence) ? Number(word.confidence) : 55,
      });
    }
  }

  if (!fragments.length && data.text?.trim()) {
    fragments.push({
      text: data.text.trim(),
      confidence: 60,
    });
  }

  return fragments;
}

function buildOcrCandidates(fragments: OcrFragment[], rawText: string) {
  const candidates = new Map<string, OcrCandidate>();
  const seeds = new Map<string, number>();

  for (const fragment of fragments) {
    pushSeed(seeds, fragment.text, fragment.confidence);
  }

  for (const line of rawText.split(/\r?\n/gu)) {
    pushSeed(seeds, line, 50);
  }

  for (const [seed, confidence] of seeds) {
    for (const variant of buildCandidateVariants(seed)) {
      const queryText = normalizeCandidateForQuery(variant);
      if (!queryText) {
        continue;
      }

      const candidate = {
        queryText,
        displayText: variant,
        confidence,
        score: scoreCandidate(queryText, variant, confidence),
      };

      if (candidate.score < 35) {
        continue;
      }

      const existing = candidates.get(queryText);
      if (!existing || candidate.score > existing.score) {
        candidates.set(queryText, candidate);
      }
    }
  }

  return Array.from(candidates.values())
    .sort((left, right) => right.score - left.score || right.confidence - left.confidence || right.queryText.length - left.queryText.length)
    .slice(0, 6);
}

function pushSeed(store: Map<string, number>, input: string, confidence: number) {
  const cleaned = sanitizeOcrText(input);
  if (!cleaned) {
    return;
  }

  const current = store.get(cleaned) ?? 0;
  if (confidence > current) {
    store.set(cleaned, confidence);
  }
}

function buildCandidateVariants(input: string) {
  const variants = new Set<string>();
  const cleaned = sanitizeOcrText(input);

  if (!cleaned) {
    return [];
  }

  variants.add(cleaned);

  const tokens = cleaned.split(/\s+/gu).filter((token) => token.length >= 4);
  if (tokens.length > 1) {
    variants.add(tokens.join(" "));
    variants.add(tokens.join(""));
  }

  const compact = cleaned.replace(/\s+/gu, "");
  if (compact.length >= 6) {
    variants.add(compact);
  }

  return Array.from(variants);
}

function sanitizeOcrText(input: string) {
  return input
    .toUpperCase()
    .replace(/[|]/gu, "I")
    .replace(/[‘’'"]/gu, "")
    .replace(/[，、；;:]/gu, " ")
    .replace(/[^A-Z0-9\-_/().\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeCandidateForQuery(input: string) {
  const cleaned = sanitizeOcrText(input);
  if (!cleaned) {
    return "";
  }

  if (looksLikeMaterialCode(cleaned)) {
    return cleaned.replace(/\s+/gu, "");
  }

  return cleaned;
}

function looksLikeMaterialCode(input: string) {
  const compact = input.replace(/\s+/gu, "");
  return compact.length >= 6 && /[A-Z]/u.test(compact) && /\d/u.test(compact) && /^[A-Z0-9\-_/().]+$/u.test(compact);
}

function scoreCandidate(queryText: string, displayText: string, confidence: number) {
  const compact = queryText.replace(/\s+/gu, "");
  let score = confidence;

  if (looksLikeMaterialCode(displayText)) {
    score += 85;
  }

  if (/^[A-Z]{2,}/u.test(compact)) {
    score += 18;
  }

  if (/\d/u.test(compact)) {
    score += 14;
  }

  if (compact.length >= 8 && compact.length <= 24) {
    score += 24;
  }

  if (/^\d+$/u.test(compact)) {
    score -= 32;
  }

  if (compact.length > 28) {
    score -= 18;
  }

  if (queryText.includes(" ") && looksLikeMaterialCode(displayText)) {
    score -= 4;
  }

  if (!looksLikeMaterialCode(displayText) && queryText.split(" ").length >= 2) {
    score += 10;
  }

  return score;
}

function formatTesseractProgress(status: string, progress: number) {
  const percent = `${Math.max(1, Math.round(progress * 100))}%`;

  if (/loading tesseract core/iu.test(status)) {
    return `正在加载识图核心 ${percent}`;
  }

  if (/initializing tesseract/iu.test(status)) {
    return `正在初始化识图引擎 ${percent}`;
  }

  if (/loading language traineddata/iu.test(status)) {
    return `正在下载英文数字识别包 ${percent}`;
  }

  if (/initializing api/iu.test(status)) {
    return `正在准备识图参数 ${percent}`;
  }

  if (/recognizing text/iu.test(status)) {
    return `正在识别图片字符 ${percent}`;
  }

  return `正在识图 ${percent}`;
}

async function buildHighContrastImage(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement("canvas");
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前浏览器无法处理图片。");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.filter = "grayscale(1) contrast(1.65) brightness(1.08)";
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，请换一张图片重试。"));
    image.src = src;
  });
}
