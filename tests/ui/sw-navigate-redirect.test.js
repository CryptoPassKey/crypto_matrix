'use strict';
/*
 * Service Worker のリダイレクト処理（Cloudflare Pages Clean URLs）の回帰テスト。
 *
 * Cloudflare Pages は .html を正規形へ 308 する（index.html → ./、
 * keeweb/index.html → keeweb/、timelock-recover.html → timelock-recover）。
 * リダイレクトを経た応答は redirected=true を持ち、Chrome はそれを
 * ナビゲーションに使うことを拒否する（"a redirected response was used for
 * a request whose redirect mode is not 'follow'"）。
 *
 * 方式（Crypto-Qwerty 側の対応と同一）:
 * - プリキャッシュは addAll() を使わず、1件ずつ fetch して保存する。
 *   リダイレクトされた応答は、ステータス／ヘッダー／本文を保ったまま
 *   新しい Response として保存し直し、redirected フラグを落とす
 *   （content-encoding / content-length はデコード済み本文に合わないため除外）。
 *   取得が OK でない場合はインストールを失敗させる。
 * - ナビゲーションでは redirected なキャッシュヒットをミスとして扱い、
 *   ネットワーク応答は加工せず返す。fetch が返した opaqueredirect は
 *   ブラウザ自身に追従させる。キャッシュするのは素の OK 応答のみ。
 * - KeeWeb 専用 Service Worker（ベンダーコード）は変更しない。
 *
 * ここでは実物の sw.js を vm 上で実行し、Cloudflare の 308 を再現する
 * fetch モックと Cache Storage モックで上記を検証する。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CONTENTS = path.join(ROOT, 'contents');
const ORIGIN = 'https://example.test';
const SCOPE = ORIGIN + '/';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? ':: ' + extra : ''); }
}
function eq(name, actual, expected) { check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

function filesFromSource(source) {
  const start = source.indexOf('const FILES = [');
  const end = source.indexOf('\n];', start);
  const block = source.slice(start, end);
  return [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(m[0]));
}

// Node の実 Response は redirected=true を持ち得ないため、その状態はモックで再現する。
function mockResponse({ ok = true, status = 200, redirected = false, url = '', type = 'basic', headers = {}, body = '' } = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : '');
  return {
    ok, status, statusText: status === 200 ? 'OK' : 'Error', redirected, url, type,
    headers: new Headers(headers),
    clone() { return mockResponse({ ok, status, redirected, url, type, headers, body }); },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    async text() { return typeof body === 'string' ? body : ''; },
  };
}

class MockCache {
  constructor() { this.store = new Map(); }
  _key(request) {
    const href = typeof request === 'string' ? request : request.url;
    return new URL(href, SCOPE).href;
  }
  async match(request, options = {}) {
    const want = new URL(this._key(request));
    for (const [key, res] of this.store) {
      const have = new URL(key);
      if (options.ignoreSearch) {
        if (have.origin + have.pathname === want.origin + want.pathname) return res;
      } else if (key === want.href) return res;
    }
    return undefined;
  }
  async put(request, response) { this.store.set(this._key(request), response); }
  async keys() { return [...this.store.keys()].map((href) => ({ url: href })); }
}

function createHarness(fetchImpl) {
  const storage = new Map();
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new MockCache());
      return storage.get(name);
    },
    async keys() { return [...storage.keys()]; },
    async delete(name) { return storage.delete(name); },
    async match(request, options) {
      for (const cache of storage.values()) {
        const hit = await cache.match(request, options);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const listeners = {};
  let skipWaitingCalled = false;
  const self = {
    registration: { scope: SCOPE },
    skipWaiting() { skipWaitingCalled = true; },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  // Cloudflare Pages の挙動を再現する fetch: .html は正規形へ 308。
  // 通常 fetch は追従して redirected=true を報告し、ナビゲーション要求では
  // opaqueredirect が返る（ブラウザの実挙動）。
  const DIRS = new Set(['/keeweb/']);
  const cfFetch = async (input, _init) => {
    const isNav = input && typeof input === 'object' && input.mode === 'navigate';
    const url = new URL(typeof input === 'string' ? input : input.url, SCOPE);
    const p = url.pathname;
    let target = null;
    if (p.endsWith('/index.html')) target = p.slice(0, -'index.html'.length);
    else if (p.endsWith('.html')) target = p.slice(0, -'.html'.length);
    else if (!p.endsWith('/') && DIRS.has(p + '/')) target = p + '/';
    if (target !== null) {
      if (isNav) return mockResponse({ ok: false, status: 0, redirected: false, url: '', type: 'opaqueredirect', body: '' });
      return mockResponse({
        ok: true, status: 200, redirected: true, url: ORIGIN + target,
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'br', 'content-length': '999' },
        body: '<html>page ' + p + '</html>',
      });
    }
    if (p.endsWith('/')) {
      return mockResponse({ ok: true, status: 200, redirected: false, url: url.href, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html>page ' + p + '</html>' });
    }
    return mockResponse({ ok: true, status: 200, redirected: false, url: url.href, headers: { 'content-type': 'application/octet-stream' }, body: 'data ' + p });
  };
  const sandbox = {
    self, caches, fetch: fetchImpl || cfFetch, Response, Headers, URL,
    location: { origin: ORIGIN }, console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(CONTENTS, 'sw.js'), 'utf8'), sandbox, { filename: 'sw.js' });
  return {
    listeners, storage, sandbox,
    wasSkipWaitingCalled: () => skipWaitingCalled,
    dispatchInstall() {
      let captured;
      listeners.install({ waitUntil(p) { captured = p; } });
      return captured;
    },
    dispatchFetch(request) {
      let captured;
      listeners.fetch({ request, respondWith(p) { captured = p; } });
      return captured;
    },
    versionCache() {
      const names = [...storage.keys()].filter((n) => n.startsWith('cm-v') && n !== 'cm-manual-update-enabled');
      eq('exactly one version cache exists', names.length, 1);
      return storage.get(names[0]);
    },
  };
}

const navRequest = (pathname) => ({ method: 'GET', mode: 'navigate', url: ORIGIN + pathname });

(async () => {
  const swSource = fs.readFileSync(path.join(CONTENTS, 'sw.js'), 'utf8');
  const files = filesFromSource(swSource);

  // ===== 1. プリキャッシュ: リダイレクト応答が浄化されて保存される =====
  {
    const h = createHarness();
    await h.dispatchInstall();
    check('first rollout activates immediately (skipWaiting)', h.wasSkipWaitingCalled());
    const cache = h.versionCache();
    eq('precache contains every FILES entry', cache.store.size, files.length);
    let allClean = true, allOk = true;
    for (const [, res] of cache.store) { if (res.redirected) allClean = false; if (!res.ok) allOk = false; }
    check('every precached entry has redirected === false', allClean);
    check('every precached entry is ok', allOk);
    const index = cache.store.get(ORIGIN + '/index.html');
    check('index.html is precached', !!index);
    eq('index.html body preserved', await index.text(), '<html>page /index.html</html>');
    eq('index.html content-type preserved', index.headers.get('content-type'), 'text/html; charset=utf-8');
    eq('index.html content-encoding stripped', index.headers.get('content-encoding'), null);
    eq('index.html content-length stripped', index.headers.get('content-length'), null);
    const keeweb = cache.store.get(ORIGIN + '/keeweb/index.html');
    check('keeweb/index.html is precached', !!keeweb);
    eq('keeweb/index.html stored clean', keeweb.redirected, false);
    check('keeweb/ directory URL is precached', cache.store.has(ORIGIN + '/keeweb/'));
  }

  // ===== 2. プリキャッシュ: 取得失敗時はインストールが失敗する =====
  {
    const notFound = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, SCOPE);
      if (url.pathname === '/app.js') return mockResponse({ ok: false, status: 404, body: 'not found' });
      return mockResponse({ ok: true, status: 200, body: 'ok ' + url.pathname });
    };
    const h = createHarness(notFound);
    let rejected = false;
    try { await h.dispatchInstall(); } catch (_) { rejected = true; }
    check('install fails when a precache fetch is not ok', rejected);
  }
  {
    const h = createHarness(async () => { throw new Error('network down'); });
    let rejected = false;
    try { await h.dispatchInstall(); } catch (_) { rejected = true; }
    check('install fails when a precache fetch throws', rejected);
  }

  // ===== 3. ナビゲーション: 正常なキャッシュ応答が利用される =====
  {
    const h = createHarness();
    await h.dispatchInstall();
    const res = await h.dispatchFetch(navRequest('/index.html'));
    eq('clean cached page status', res.status, 200);
    eq('clean cached page is not redirected', res.redirected, false);
    eq('clean cached page body', await res.text(), '<html>page /index.html</html>');
    const kw = await h.dispatchFetch(navRequest('/keeweb/'));
    eq('keeweb/ navigation served from precache', await kw.text(), '<html>page /keeweb/</html>');
  }

  // ===== 4. ナビゲーション: redirected なキャッシュヒットは使われない =====
  {
    const h = createHarness();
    await h.dispatchInstall();
    const cache = h.versionCache();
    const poisoned = mockResponse({
      ok: true, status: 200, redirected: true, url: ORIGIN + '/',
      headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html>poisoned</html>',
    });
    await cache.put(ORIGIN + '/index.html', poisoned);
    const res = await h.dispatchFetch(navRequest('/index.html'));
    eq('redirected cache hit falls through to opaqueredirect', res.type, 'opaqueredirect');
    check('poisoned entry is left untouched (never served)', cache.store.get(ORIGIN + '/index.html') === poisoned);
  }

  // ===== 5. ナビゲーション: opaqueredirect は加工されず、キャッシュもされない =====
  {
    const h = createHarness();
    await h.dispatchInstall();
    const cache = h.versionCache();
    const before = cache.store.size;
    const res = await h.dispatchFetch(navRequest('/keeweb'));
    eq('bare directory navigation returns opaqueredirect', res.type, 'opaqueredirect');
    eq('opaqueredirect is not cached (store size unchanged)', cache.store.size, before);
    check('no cache entry for the bare directory URL', !cache.store.has(ORIGIN + '/keeweb'));
    // 素の 200 応答はキャッシュされる
    const res2 = await h.dispatchFetch(navRequest('/timelock-recover'));
    eq('plain 200 navigation is served', res2.status, 200);
    await new Promise((r) => setTimeout(r, 10));
    const entry = cache.store.get(ORIGIN + '/timelock-recover');
    check('plain 200 navigation gets cached', !!entry);
    eq('cached navigation entry is clean', entry && entry.redirected, false);
  }

  // ===== 6. ナビゲーション: オフライン時はアプリシェルへフォールバック =====
  {
    const h = createHarness();
    await h.dispatchInstall();
    h.sandbox.fetch = async () => { throw new Error('offline'); };
    const res = await h.dispatchFetch(navRequest('/nonexistent.html'));
    check('offline navigation falls back to the app shell', !!res);
    eq('app shell body served', await res.text(), '<html>page /</html>');
  }

  // ===== 7. サブリソースは従来どおりキャッシュ優先 =====
  {
    const h = createHarness();
    await h.dispatchInstall();
    const res = await h.dispatchFetch({ method: 'GET', mode: 'cors', url: ORIGIN + '/app.js' });
    eq('subresource served from precache', await res.text(), 'data /app.js');
  }

  // ===== 8. 静的ガード =====
  check('sw uses per-file precache (storeClean/precacheFile)', swSource.includes('function storeClean') && swSource.includes('function precacheFile'));
  check('sw no longer uses cache.addAll', !swSource.includes('.addAll(FILES'));
  check('navigate branch treats redirected hits as misses', swSource.includes('hit && !hit.redirected'));
  check('navigation caching is limited to plain OK responses', swSource.includes('res.ok && !res.redirected'));
  check('sw version bumped', swSource.includes("cm-v3.30.3-mobile-dock-overlap"));
  check('precache keeps keeweb/index.html', swSource.includes('"keeweb/index.html"'));
  check('precache includes keeweb/ directory URL', swSource.includes('"keeweb/",'));
  const kwSw = fs.readFileSync(path.join(CONTENTS, 'keeweb', 'service-worker.js'), 'utf8');
  check('keeweb service worker is the unmodified vendored file', !kwSw.includes('redirected') && kwSw.includes('caches.match(event.request.url)'));
  const indexJs = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');
  const timelockJs = fs.readFileSync(path.join(CONTENTS, 'timelock.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  check('openKeeWeb opens keeweb/', indexJs.includes("window.open('keeweb/', KEEWEB_WINDOW_NAME)"));
  check('timelock fallbacks open keeweb/', !timelockJs.includes("window.open('keeweb/index.html'") && timelockJs.includes("window.open('keeweb/', 'CryptoPassKeyKeeWeb')"));
  eq('generator links use keeweb/ form', (indexHtml.match(/href="keeweb\/#generator/g) || []).length, 8);
  check('no index.html keeweb links remain in index.html', !indexHtml.includes('keeweb/index.html'));

  console.log('---');
  console.log(`sw-navigate-redirect: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
