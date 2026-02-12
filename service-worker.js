const CACHE_NAME = 'plamoscanner-pwa-dev-network-first-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/html5-qrcode.min.js', // ローカル化したライブラリ
  '/manifest.json',      // マニフェストファイル
  '/icons/icon-192x192.png', // アイコン
  '/icons/icon-512x512.png'  // アイコン
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // ネットワークから取得成功した場合
        // レスポンスのコピーをキャッシュに保存し、レスポンスを返す
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });
        return response;
      })
      .catch(() => {
        // ネットワークからの取得に失敗した場合（オフラインなど）
        // キャッシュからリソースを返す
        return caches.match(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
