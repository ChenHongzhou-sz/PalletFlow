export interface ParsedDimension {
  diameterMm?: number;
  heightMm?: number;
  dimensionToken?: string;
  searchAliases: string[];
}

export interface ParsedMaterialSpec {
  voltageV?: number;
  capacitanceValue?: number;
  capacitanceUnit?: "uF";
  diameterMm?: number;
  heightMm?: number;
  lifetimeH?: number;
  temperatureC?: number;
  series?: string;
  searchAliases: string[];
}

function trimNumericToken(value: number | string) {
  const text = typeof value === "number" ? value.toString() : value.trim();
  return text.replace(/\.0+$/u, "").replace(/(\.\d*?[1-9])0+$/u, "$1");
}

export function normalizeMaterialSearchText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[µμ渭碌]/gu, "u")
    .replace(/[×✕╳脳＊*]/gu, "x")
    .replace(/[Φφ⌀Ø桅]/gu, " ")
    .replace(/[℃°]/gu, "c")
    .replace(/[()]/gu, " ")
    .replace(/[,/\\|;:_~+=-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim().replace(/,/gu, "");
  if (!normalized) {
    return undefined;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseVoltageValue(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = normalizeMaterialSearchText(String(value)).replace(/\s+/gu, "");
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)v?$/u);
  if (!match) {
    return undefined;
  }

  return parseOptionalNumber(match[1]);
}

export function parseCapacitanceToUf(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = normalizeMaterialSearchText(String(value)).replace(/\s+/gu, "");
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(uf|mf|nf|pf|f)?$/u);
  if (!match) {
    return undefined;
  }

  const amount = parseOptionalNumber(match[1]);
  if (amount === undefined) {
    return undefined;
  }

  switch (match[2] ?? "uf") {
    case "pf":
      return amount / 1_000_000;
    case "nf":
      return amount / 1_000;
    case "mf":
      return amount * 1_000;
    case "f":
      return amount * 1_000_000;
    case "uf":
    default:
      return amount;
  }
}

export function buildCapacitanceAliases(capacitanceValueUf: number | null | undefined) {
  if (capacitanceValueUf === null || capacitanceValueUf === undefined) {
    return [] as string[];
  }

  const aliases = new Set<string>();
  aliases.add(`${trimNumericToken(capacitanceValueUf)}uf`);

  if (capacitanceValueUf >= 1_000) {
    aliases.add(`${trimNumericToken(capacitanceValueUf / 1_000)}mf`);
  }

  if (capacitanceValueUf >= 1_000_000 || capacitanceValueUf % 1_000_000 === 0) {
    aliases.add(`${trimNumericToken(capacitanceValueUf / 1_000_000)}f`);
  }

  if (capacitanceValueUf < 1) {
    aliases.add(`${trimNumericToken(capacitanceValueUf * 1_000)}nf`);
  }

  if (capacitanceValueUf < 0.001) {
    aliases.add(`${trimNumericToken(capacitanceValueUf * 1_000_000)}pf`);
  }

  return [...aliases];
}

export function parseDimensionValue(value: unknown): ParsedDimension {
  const normalized = normalizeMaterialSearchText(value === null || value === undefined ? "" : String(value));
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)(?:\s*x\s*([0-9]+(?:\.[0-9]+)?))?/u);

  if (!match) {
    return { searchAliases: [] };
  }

  const first = parseOptionalNumber(match[1]);
  const second = parseOptionalNumber(match[2]);
  const third = parseOptionalNumber(match[3]);
  const height = third ?? second;
  const aliases = new Set<string>();
  aliases.add(`${trimNumericToken(match[1])}x${trimNumericToken(match[2])}`);

  if (match[3]) {
    aliases.add(`${trimNumericToken(match[1])}x${trimNumericToken(match[2])}x${trimNumericToken(match[3])}`);
    aliases.add(`${trimNumericToken(match[1])}x${trimNumericToken(match[3])}`);
  }

  return {
    diameterMm: first,
    heightMm: height,
    dimensionToken: first !== undefined && height !== undefined ? `${trimNumericToken(first)}x${trimNumericToken(height)}` : undefined,
    searchAliases: [...aliases],
  };
}

export function parseLifetimeHours(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = normalizeMaterialSearchText(String(value)).replace(/\s+/gu, "");
  const match = normalized.match(/([0-9]{3,6})h\b/u);
  if (match) {
    return parseOptionalNumber(match[1]);
  }

  return parseOptionalNumber(String(value));
}

export function parseTemperatureC(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = normalizeMaterialSearchText(String(value)).replace(/\s+/gu, "");
  const match = normalized.match(/([0-9]{2,3})c\b/u);
  return match ? parseOptionalNumber(match[1]) : undefined;
}

export function parseSeriesValue(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const raw = String(value).trim();
  const directMatch = raw.match(/([A-Za-z][A-Za-z0-9-]{1,15})\s*(?:系列|series)/iu);
  if (directMatch) {
    return directMatch[1].toUpperCase();
  }

  const normalized = normalizeMaterialSearchText(raw);
  const fallbackMatch = normalized.match(/(?:^|[\s,])([a-z][a-z0-9-]{1,15})(?=\s*(?:series|[0-9]{3,6}h))/u);
  return fallbackMatch ? fallbackMatch[1].toUpperCase() : undefined;
}

export function parseMaterialSpecification(specificationRaw: string | null | undefined): ParsedMaterialSpec {
  const raw = (specificationRaw ?? "").trim();
  if (!raw) {
    return { searchAliases: [] };
  }

  const voltageMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*V\b/iu);
  const capacitanceMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*([uµμmnp]?\s*F)\b/iu);
  const lifetimeMatch = raw.match(/([0-9]{3,6})\s*H\b/iu);
  const temperatureMatch = raw.match(/([0-9]{2,3})\s*(?:℃|°C|C)\b/iu);

  const voltageV = voltageMatch ? parseOptionalNumber(voltageMatch[1]) : undefined;
  const capacitanceValue = capacitanceMatch ? parseCapacitanceToUf(`${capacitanceMatch[1]}${capacitanceMatch[2]}`) : undefined;
  const dimension = parseDimensionValue(raw);
  const lifetimeH = lifetimeMatch ? parseOptionalNumber(lifetimeMatch[1]) : undefined;
  const temperatureC = temperatureMatch ? parseOptionalNumber(temperatureMatch[1]) : undefined;
  const series = parseSeriesValue(raw);

  return {
    voltageV,
    capacitanceValue,
    capacitanceUnit: capacitanceValue !== undefined ? "uF" : undefined,
    diameterMm: dimension.diameterMm,
    heightMm: dimension.heightMm,
    lifetimeH,
    temperatureC,
    series,
    searchAliases: mergeSearchAliases(
      dimension.searchAliases,
      voltageV !== undefined ? [trimNumericToken(voltageV), `${trimNumericToken(voltageV)}v`] : [],
      buildCapacitanceAliases(capacitanceValue),
      series ? [series] : [],
    ),
  };
}

export function mergeSearchAliases(...groups: Array<Array<string | null | undefined> | string | null | undefined>) {
  const aliases = new Set<string>();

  for (const group of groups) {
    if (Array.isArray(group)) {
      for (const item of group) {
        const normalized = normalizeMaterialSearchText(item ?? "");
        if (normalized) {
          aliases.add(normalized.replace(/\s+/gu, ""));
        }
      }
      continue;
    }

    const normalized = normalizeMaterialSearchText(group ?? "");
    if (normalized) {
      aliases.add(normalized.replace(/\s+/gu, ""));
    }
  }

  return [...aliases];
}

export function formatVoltageLabel(voltageV: number | null | undefined) {
  return voltageV === null || voltageV === undefined ? null : `${trimNumericToken(voltageV)}V`;
}

export function formatCapacitanceLabel(capacitanceValueUf: number | null | undefined) {
  if (capacitanceValueUf === null || capacitanceValueUf === undefined) {
    return null;
  }

  if (capacitanceValueUf >= 1_000_000) {
    return `${trimNumericToken(capacitanceValueUf / 1_000_000)}F`;
  }

  if (capacitanceValueUf < 0.001) {
    return `${trimNumericToken(capacitanceValueUf * 1_000_000)}pF`;
  }

  if (capacitanceValueUf < 1) {
    return `${trimNumericToken(capacitanceValueUf * 1_000)}nF`;
  }

  return `${trimNumericToken(capacitanceValueUf)}uF`;
}

export function formatDimensionLabel(diameterMm: number | null | undefined, heightMm: number | null | undefined) {
  if (diameterMm === null || diameterMm === undefined || heightMm === null || heightMm === undefined) {
    return null;
  }

  return `${trimNumericToken(diameterMm)} x ${trimNumericToken(heightMm)} mm`;
}

export function formatTemperatureLabel(temperatureC: number | null | undefined) {
  return temperatureC === null || temperatureC === undefined ? null : `${trimNumericToken(temperatureC)}C`;
}

export function buildMaterialSpecChips(input: {
  voltageV?: number | null;
  capacitanceValue?: number | null;
  diameterMm?: number | null;
  heightMm?: number | null;
  series?: string | null;
  lifetimeH?: number | null;
  temperatureC?: number | null;
}) {
  return [
    formatVoltageLabel(input.voltageV),
    formatCapacitanceLabel(input.capacitanceValue),
    formatDimensionLabel(input.diameterMm, input.heightMm),
    input.series?.trim() ? input.series.trim().toUpperCase() : null,
    input.lifetimeH ? `${trimNumericToken(input.lifetimeH)}H` : null,
    formatTemperatureLabel(input.temperatureC),
  ].filter((value): value is string => Boolean(value && value.trim()));
}
