const CACHE_NAME = 'yakuzaishi-static-v5';

const CACHEABLE_PATHS = [
  '/css/style.css',
  '/js/site.js',
  '/js/patient-chat.js',
  '/js/articles.js',
  '/js/article.js',
  '/js/contact.js',
  '/js/legal.js',
  '/js/pharmacist-login.js',
  '/js/pharmacists.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHEABLE_PATHS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// 静的ファイルのみ「まずネットワーク、失敗時はキャッシュ」で扱う。
// チャットや記事などの動的な内容は常に最新をネットワークから取得する（キャッシュしない）。
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!CACHEABLE_PATHS.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
