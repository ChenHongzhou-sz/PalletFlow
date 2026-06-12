export interface DecodedImportText {
  text: string;
  encoding: string;
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function tryDecode(bytes: Uint8Array, encoding: string, fatal = false) {
  try {
    const decoder = new TextDecoder(encoding, fatal ? { fatal: true } : undefined);
    return stripBom(decoder.decode(bytes));
  } catch {
    return null;
  }
}

export async function decodeImportFile(file: File): Promise<DecodedImportText> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const utf8 = tryDecode(bytes, "utf-8", true);
  if (utf8 !== null) {
    return { text: utf8, encoding: "UTF-8" };
  }

  const gb18030 = tryDecode(bytes, "gb18030");
  if (gb18030 !== null) {
    return { text: gb18030, encoding: "GB18030" };
  }

  const gbk = tryDecode(bytes, "gbk");
  if (gbk !== null) {
    return { text: gbk, encoding: "GBK" };
  }

  const fallback = tryDecode(bytes, "utf-8") ?? "";
  return { text: fallback, encoding: "UTF-8" };
}
