const recentSearchesKey = "palletflow:recent-material-searches";
const recentMaterialsKey = "palletflow:recent-material-views";

export interface RecentMaterialView {
  materialCode: string;
  label: string;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T) {
  if (!canUseStorage()) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readRecentMaterialSearches() {
  return readJson<string[]>(recentSearchesKey, []);
}

export function saveRecentMaterialSearch(query: string) {
  const normalized = query.trim();
  if (!normalized) {
    return readRecentMaterialSearches();
  }

  const next = [normalized, ...readRecentMaterialSearches().filter((item) => item !== normalized)].slice(0, 8);
  writeJson(recentSearchesKey, next);
  return next;
}

export function readRecentMaterialViews() {
  return readJson<RecentMaterialView[]>(recentMaterialsKey, []);
}

export function saveRecentMaterialView(view: RecentMaterialView) {
  const next = [view, ...readRecentMaterialViews().filter((item) => item.materialCode !== view.materialCode)].slice(0, 8);
  writeJson(recentMaterialsKey, next);
  return next;
}
