/* Service Worker — 离线缓存，让 App（含 OCR）完全离线可用 */
const CACHE = 'shengqianmao-soft-v3';
// 轻量核心资源：install 时立即缓存
const CORE_ASSETS = [
  './',
  './index.html',
  './bookkeeping.html',
  './manifest.json',
  './css/style.css',
  './js/calc.js',
  './js/data.js',
  './js/ocr.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
// OCR 离线文件较大（约 9MB），install 时后台逐个缓存，失败不影响 App 主体安装
const OCR_ASSETS = [
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/lang/chi_sim.traineddata.gz'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(CORE_ASSETS.map(url => c.add(url).catch(() => {}))))
      // 大文件后台缓存，不阻塞安装完成
      .then(() => {
        caches.open(CACHE).then(c => {
          OCR_ASSETS.forEach(url => c.add(url).catch(() => {}));
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 跨域资源不拦截，交浏览器直接处理，避免缓存污染与错误 fallback
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => {
        // 仅导航请求兜底到首页，脚本/样式失败不伪装成 HTML
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
