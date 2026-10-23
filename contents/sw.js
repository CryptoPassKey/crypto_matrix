// Crypto Matrix — オフライン用 Service Worker（ビルド不要の手書き版）
// 版を上げると古いキャッシュは自動で削除される。ファイルを差し替えたら VERSION を変えること。
const VERSION = 'cm-85f32dcee0';
const FILES = [
  "./",
  "app.css",
  "app.js",
  "apple-touch-icon.png",
  "argon2.umd.min.js",
  "backup-qr.js",
  "favicon.png",
  "fonts/jetbrains-mono-latin-400-normal.woff2",
  "fonts/jetbrains-mono-latin-700-normal.woff2",
  "index.html",
  "index.js",
  "keeweb/404.html",
  "keeweb/browserconfig.xml",
  "keeweb/build.txt",
  "keeweb/config.json",
  "keeweb/icons/android-chrome-192x192.png",
  "keeweb/icons/android-chrome-512x512.png",
  "keeweb/icons/apple-touch-icon.png",
  "keeweb/icons/favicon-16x16.png",
  "keeweb/icons/favicon-32x32.png",
  "keeweb/icons/mstile-150x150.png",
  "keeweb/icons/mstile-310x150.png",
  "keeweb/icons/mstile-310x310.png",
  "keeweb/icons/mstile-70x70.png",
  "keeweb/icons/safari-pinned-tab.svg",
  "keeweb/index.html",
  "keeweb/manifest.json",
  "keeweb/oauth-result/dropbox.html",
  "keeweb/oauth-result/gdrive.html",
  "keeweb/oauth-result/onedrive.html",
  "keeweb/oauth-result/teams.html",
  "keeweb/plugins/translations/ja/ja.json",
  "keeweb/plugins/translations/ja/manifest.json",
  "keeweb/update.json",
  "layout.js",
  "legacy.css",
  "manifest.json",
  "pwa-192.png",
  "pwa-512.png",
  "qr-encoder.js",
  "theme-cyber.css",
  "theme-init.js",
  "vendor/jsQR.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cm-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // ページ本体：オンラインなら最新、オフラインならキャッシュ
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
