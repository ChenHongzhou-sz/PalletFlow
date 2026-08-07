const CACHE_PREFIX = "palletflow-";
const CACHE_NAME = `${CACHE_PREFIX}static-v2`;
const BASE_PATH = self.location.pathname.replace(/sw\.js$/, "");
const OFFLINE_URL = `${BASE_PATH}offline.html`;
const APP_SHELL = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  OFFLINE_URL,
  `${BASE_PATH}icons/app-icon.svg`,
  `${BASE_PATH}icons/maskable-icon.svg`,
];

function isSameOriginRequest(request) {
  return new URL(request.url).origin === self.location.origin;
}

async function putInCache(request, response) {
  if (!response || !response.ok) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    return await putInCache(request, response);
  } catch (error) {
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      const offlineResponse = await caches.match(fallbackUrl);

      if (offlineResponse) {
        return offlineResponse;
      }
    }

    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (!isSameOriginRequest(event.request)) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, OFFLINE_URL));
    return;
  }

  event.respondWith(networkFirst(event.request));
});
