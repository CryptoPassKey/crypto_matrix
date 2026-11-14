// Crypto Matrix — オフライン用 Service Worker（ビルド不要の手書き版）
// 版を上げると古いキャッシュは自動で削除される。ファイルを差し替えたら VERSION を変えること。
const VERSION = 'cm-v3.30.2-sw-precache-clean';
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
  "print-icon.png",
  "unlock-icon.png",
  "file-icon.png",
  "heartbeat-icon.png",
  "refresh-icon.png",
  "destruct-icon.png",
  "camera-icon.png",
  "image-icon.png",
  "qr-frame-icon.png",
  "save-icon.png",
  "pin-icon.png",
  "lock-icon.png",
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
  "shamir-icon.png",
  "test-icon.png",
  "passkey-icon.png",
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
  "feature-backup.webp",
  "feature-bip39.webp",
  "feature-erase.webp",
  "feature-keepass.webp",
  "feature-keyfile.webp",
  "feature-passkey.webp",
  "feature-password-gen.webp",
  "feature-shamir.webp",
  "feature-timesecret.webp",
  "feature-vault.webp",
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
  "keeweb/",
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
  "vendor/js-sha256.js",
  "vendor/tlock.bundle.js",
  "vendor/zxing-reader.js",
  "vendor/zxing_reader.wasm",
  "seed-vault.js",
  "passkey-store.js",
  "seed-key.js",
  "recipe-v6.js",
  "board-v2.js"
];


// Files fetched with HTTP-cache revalidation during precache. addAll() may be
// served a stale copy from the browser HTTP cache right after a deploy, which
// would pin the old file into the new worker's cache.
const REVALIDATE_FILES = ['theme-cyber.css', 'lock-icon.png', 'unlock-icon.png'];

// プリキャッシュ時に、ホストのリダイレクトを経た応答は redirected フラグを落として保存する。
// Cloudflare Pages は Clean URLs で .html を正規形へ 308 する（index.html → ./、
// keeweb/index.html → keeweb/ 等）。素の cache.addAll() では redirected=true の応答が
// 保存され、Chrome はそれをナビゲーションに使うことを拒否する
// （"a redirected response was used for a request whose redirect mode is not 'follow'"）。
// 同じステータス／ヘッダー／本文で応答を作り直して保存すればフラグが落ちる。
// content-encoding と content-length は、fetch 時点でデコード済みの本文には合わないため除外する。
function storeClean(cache, request, response) {
  if (!response.redirected) return cache.put(request, response);
  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (name !== 'content-encoding' && name !== 'content-length') headers.append(name, value);
  });
  return response.arrayBuffer().then((body) => cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  })));
}

// 1ファイルをプリキャッシュする。取得が OK でない場合はインストールを失敗させる
// （置き換え前の cache.addAll() と同じ失敗動作）。
function precacheFile(cache, file, init) {
  return fetch(file, init).then((res) => {
    if (!res.ok) throw new Error('precache failed: ' + file);
    return storeClean(cache, file, res);
  });
}

self.addEventListener('install', (e) => {
  // Precache the complete new app. The first rollout upgrades older workers once,
  // because those old app pages do not yet contain the manual-update controls.
  // After this release is active, later updates wait for an explicit user request.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(FILES.filter((f) => !REVALIDATE_FILES.includes(f)).map((f) => precacheFile(c, f)))
        .then(() => Promise.all(REVALIDATE_FILES.map((f) => precacheFile(c, f, { cache: 'reload' })))))
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
    // ページ本体もキャッシュ優先（アセットと同一方針）。新版の適用は手動更新フローで行う。
    // ただし redirected なキャッシュヒットは使えない（旧版で保存された可能性がある）ため、
    // ミスとして扱ってネットワークへフォールバックする。fetch が opaqueredirect を
    // 返した場合（Cloudflare Pages の 308 や GitHub Pages のディレクトリ 301）は
    // 加工せずそのまま返し、ブラウザ自身にリダイレクトを追従させる。
    // キャッシュへ保存するのは素の OK 応答のみで、保存失敗はページ表示を妨げない。
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit && !hit.redirected) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
