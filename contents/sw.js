// Crypto Matrix — オフライン用 Service Worker（ビルド不要の手書き版）
// 版を上げると古いキャッシュは自動で削除される。ファイルを差し替えたら VERSION を変えること。
const VERSION = 'cm-v2.28.6-remove-test-lab';
const MANUAL_UPDATE_MARKER = 'cm-manual-update-enabled';
const ZXING_WASM_VERSION = '3.1.6';
const ZXING_WASM_CACHE = 'data-transfer-zxing-wasm-' + ZXING_WASM_VERSION + '-pair-v2';
const ZXING_READER_SCRIPT = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + ZXING_WASM_VERSION + '/dist/iife/reader/index.js';
const ZXING_READER_WASM = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + ZXING_WASM_VERSION + '/dist/reader/zxing_reader.wasm';
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
  "fonts/FiraCode-Bold.woff2",
  "fonts/FiraCode-Regular.woff2",
  "index.html",
  "index.js",
  "tab-backup.png",
  "tab-capsule.png",
  "tab-quick.png",
  "tab-recipe.png",
  "tab-timesecret.png",
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
  "legacy.css",
  "manifest.json",
  "pwa-192.png",
  "pwa-512.png",
  "qr-encoder.js",
  "theme-cyber.css",
  "theme-init.js",
  "timelock.js",
  "timelock-recover.html",
  "timesecret.js",
  "vendor/jsQR.js",
  "vendor/tlock.bundle.js"
];


function isValidZxingScript(text) {
  return typeof text === 'string' && text.length >= 1000 &&
    text.indexOf('readBarcodes') !== -1 &&
    text.indexOf('prepareZXingModule') !== -1;
}

function isValidZxingWasm(bytes) {
  if (!bytes || bytes.byteLength < 500000 ||
      typeof WebAssembly === 'undefined') return false;
  const view = new Uint8Array(bytes);
  return view[0] === 0x00 && view[1] === 0x61 &&
    view[2] === 0x73 && view[3] === 0x6d &&
    WebAssembly.validate(bytes);
}

let zxingPairPromise = null;

async function getZxingPair(cache) {
  // Both virtual asset requests can arrive together. Share one pair fetch so
  // simultaneous JS/WASM requests do not race or download the same bundle twice.
  if (!zxingPairPromise) {
    zxingPairPromise = getZxingPairInternal(cache);
  }
  try {
    return await zxingPairPromise;
  } finally {
    zxingPairPromise = null;
  }
}

async function getZxingPairInternal(cache) {
  const cachedScript = await cache.match(ZXING_READER_SCRIPT);
  const cachedWasm = await cache.match(ZXING_READER_WASM);
  if (cachedScript && cachedWasm) {
    try {
      const scriptText = await cachedScript.clone().text();
      const wasmBytes = await cachedWasm.clone().arrayBuffer();
      if (isValidZxingScript(scriptText) && isValidZxingWasm(wasmBytes)) {
        return { script: cachedScript, wasm: cachedWasm, cacheHit: true };
      }
    } catch (_) {}
  }

  // A partial or corrupt pair is never served. Remove both members before refetch.
  await Promise.all([
    cache.delete(ZXING_READER_SCRIPT),
    cache.delete(ZXING_READER_WASM)
  ]);

  const [scriptResponse, wasmResponse] = await Promise.all([
    fetch(ZXING_READER_SCRIPT, { mode: 'cors', credentials: 'omit' }),
    fetch(ZXING_READER_WASM, { mode: 'cors', credentials: 'omit' })
  ]);

  if (!scriptResponse.ok) {
    const error = new Error('JavaScript upstream HTTP ' + scriptResponse.status);
    error.status = scriptResponse.status;
    error.url = ZXING_READER_SCRIPT;
    throw error;
  }
  if (!wasmResponse.ok) {
    const error = new Error('WASM upstream HTTP ' + wasmResponse.status);
    error.status = wasmResponse.status;
    error.url = ZXING_READER_WASM;
    throw error;
  }
  if (scriptResponse.type === 'opaque' || wasmResponse.type === 'opaque') {
    const error = new Error('Opaque CDN response; CORS response is required');
    error.status = 502;
    error.url = scriptResponse.type === 'opaque' ? ZXING_READER_SCRIPT : ZXING_READER_WASM;
    throw error;
  }

  const [scriptText, wasmBytes] = await Promise.all([
    scriptResponse.clone().text(),
    wasmResponse.clone().arrayBuffer()
  ]);
  if (!isValidZxingScript(scriptText)) {
    const error = new Error('Downloaded JavaScript bundle failed integrity checks');
    error.status = 502;
    error.url = ZXING_READER_SCRIPT;
    throw error;
  }
  if (!isValidZxingWasm(wasmBytes)) {
    const error = new Error('Downloaded WASM failed header/size/validation checks');
    error.status = 502;
    error.url = ZXING_READER_WASM;
    throw error;
  }

  // Both assets are validated before either is committed to the paired cache.
  await Promise.all([
    cache.put(ZXING_READER_SCRIPT, new Response(scriptText, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
    })),
    cache.put(ZXING_READER_WASM, new Response(wasmBytes, {
      headers: { 'Content-Type': 'application/wasm' }
    }))
  ]);
  return {
    script: await cache.match(ZXING_READER_SCRIPT),
    wasm: await cache.match(ZXING_READER_WASM),
    cacheHit: false
  };
}

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
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('cm-') && k !== VERSION && k !== MANUAL_UPDATE_MARKER) || (k.startsWith('data-transfer-zxing-wasm-') && k !== ZXING_WASM_CACHE)).map((k) => caches.delete(k))))
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

  // Virtual same-origin routes keep the strict CSP at 'self'. The paired
  // JS/WASM assets are validated together and corrupt/partial cache entries are refetched.
  if (requestUrl.pathname.endsWith('/data-transfer-zxing-reader.js') ||
      requestUrl.pathname.endsWith('/data-transfer-zxing-reader.wasm')) {
    const isWasm = requestUrl.pathname.endsWith('.wasm');
    e.respondWith((async () => {
      const cache = await caches.open(ZXING_WASM_CACHE);
      const pair = await getZxingPair(cache);
      const selected = isWasm ? pair.wasm : pair.script;
      const response = selected.clone();
      const headers = new Headers(response.headers);
      headers.set('X-CM-ZXing-Cache', pair.cacheHit ? 'hit-validated' : 'refetched-validated');
      headers.set('X-CM-ZXing-Version', ZXING_WASM_VERSION);
      return new Response(await response.arrayBuffer(), {
        status: 200,
        headers: headers
      });
    })().catch((error) => {
      const status = Number.isInteger(error && error.status) ? error.status : 503;
      const sourceUrl = error && error.url ? error.url : (isWasm ? ZXING_READER_WASM : ZXING_READER_SCRIPT);
      return new Response('ZXing asset error: ' + (error && error.message ? error.message : String(error)), {
        status: status,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-CM-ZXing-Source': sourceUrl,
          'X-CM-ZXing-Version': ZXING_WASM_VERSION
        }
      });
    }));
    return;
  }

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
