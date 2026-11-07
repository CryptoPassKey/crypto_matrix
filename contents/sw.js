// Crypto Matrix — オフライン用 Service Worker（ビルド不要の手書き版）
// 版を上げると古いキャッシュは自動で削除される。ファイルを差し替えたら VERSION を変えること。
const VERSION = 'cm-v3.9.1-guide-visible';
const MANUAL_UPDATE_MARKER = 'cm-manual-update-enabled';
const FILES = [
  "./",
  "app.css",
  "app.js",
  "apple-touch-icon.png",
  "argon2.umd.min.js",
  "backup-qr.js",
  "data-transfer-protocol.js",
  "data-transfer-worker.js",
  "data-transfer-zxing-loader.js",
  "data-transfer.js",
  "emblem.png",
  "favicon.png",
  "dice-icon.png",
  "qr-icon.png",
  "rewind-icon.png",
  "trash-icon.png",
  "copy-icon.png",
  "csp-icon.png",
  "duress-icon.png",
  "keepass-icon.png",
  "keyfile-icon.png",
  "off-icon.png",
  "on-icon.png",
  "pattern-icon.png",
  "pause-icon.png",
  "play-icon.png",
  "seal-icon.png",
  "stop-icon.png",
  "fonts/FiraCode-Bold.woff2",
  "fonts/FiraCode-Regular.woff2",
  "index.html",
  "index.js",
  "tab-backup.png",
  "tab-capsule.png",
  "tab-quick.png",
  "tab-recipe.png",
  "tab-timesecret.png",
  "tab-transfer.png",
  "tab-vault.png",
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
  "restore-steps.js",
  "field-hint.js",
  "legacy.css",
  "manifest.json",
  "pwa-192.png",
  "pwa-512.png",
  "qr-encoder.js",
  "theme-cyber.css",
  "dt-camera.css",
  "theme-init.js",
  "timelock.js",
  "timelock-recover.html",
  "timelock-recover.css",
  "timelock-recover.js",
  "timelock-recover-theme-init.js",
  "timelock-recover-theme-toggle.js",
  "timesecret.js",
  "vendor/jsQR.js",
  "vendor/tlock.bundle.js",
  "vendor/zxing-reader.js",
  "vendor/zxing_reader.wasm",
  "seed-vault.js",
  "passkey-store.js"
];


self.addEventListener('install', (e) => {
  // Precache the complete new app. The first rollout upgrades older workers once,
  // because those old app pages do not yet contain the manual-update controls.
  // After this release is active, later updates wait for an explicit user request.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FILES))
      .then(() => caches.open(MANUAL_UPDATE_MARKER))
      .then((marker) => marker.match('./enabled'))
      .then((enabled) => enabled ? undefined : self.skipWaiting())
  );
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'CM_SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('cm-') && k !== VERSION && k !== MANUAL_UPDATE_MARKER) || k.startsWith('data-transfer-zxing-wasm-')).map((k) => caches.delete(k))))
      .then(() => caches.open(MANUAL_UPDATE_MARKER))
      .then((marker) => marker.put('./enabled', new Response('1')))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'CM_OPEN_TIMESECRET' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./#timesecret');
      }
      return undefined;
    })
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const requestUrl = new URL(req.url);
  if (req.method !== 'GET' || requestUrl.origin !== location.origin) return;

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
