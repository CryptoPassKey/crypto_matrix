'use strict';
/*
 * Service Worker のナビゲーション応答がリダイレクト履歴を持たないことを保証する回帰テスト。
 *
 * Cloudflare Pages は /keeweb/index.html → /keeweb/ の 308 リダイレクトを返す。
 * プリキャッシュや fetch がそのリダイレクトを経た応答（redirected=true）を保持し、
 * それをナビゲーション要求（redirect: 'manual'）へそのまま返すと、ブラウザは
 * "a redirected response was used for a request whose redirect mode is not 'follow'"
 * というネットワークエラーにする（KeeWeb が Cloudflare Pages で開けなかった原因）。
 * GitHub Pages は index.html を直接 200 で返すため問題が顕在化しなかった。
 *
 * ここでは sw.js と keeweb/service-worker.js を vm 上で実行し、
 * フェッチイベントへの応答が常にリダイレクト履歴なしで返ることを検証する。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CONTENTS = path.join(ROOT, 'contents');
const BASE = 'https://example.test/';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? ':: ' + extra : ''); }
}
function eq(name, actual, expected) { check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

function redirectedResponse(bodyText, opts = {}) {
  return {
    redirected: true, status: 200, statusText: 'OK', type: 'basic',
    url: BASE + 'keeweb/',
    headers: new Headers({ 'content-type': 'text/html' }),
    blob: opts.blob || (async () => new Blob([bodyText], { type: 'text/html' })),
    clone() { return this; },
  };
}

function loadSw(swPath, { entries = {}, fetchImpl } = {}) {
  const listeners = {};
  const store = new Map();
  for (const [k, v] of Object.entries(entries)) store.set(new URL(k, BASE).href, v);
  const resolveKey = (req) => {
    const u = typeof req === 'string' ? req : req.url;
    return new URL(u, BASE).href;
  };
  const caches = {
    open: async () => ({
      put: async (req, res) => { store.set(resolveKey(req), res); },
      addAll: async () => {},
      match: async (req) => store.get(resolveKey(req)),
    }),
    match: async (req) => store.get(resolveKey(req)),
    keys: async () => [...store.keys()],
    delete: async () => true,
  };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
  };
  const sandbox = {
    self, caches, location: { origin: 'https://example.test' },
    fetch: fetchImpl || (async () => { throw new Error('network down'); }),
    console, URL, Response, Headers, Blob, Promise, setTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(swPath, 'utf8'), sandbox, { filename: path.basename(swPath) });
  return { listeners, store };
}

async function dispatchFetch(listeners, request) {
  const event = { request, _response: null, respondWith(p) { this._response = p; } };
  listeners.fetch(event);
  return event._response ? await event._response : null;
}

(async () => {
  const swPath = path.join(CONTENTS, 'sw.js');

  // ===== 1. メイン SW: キャッシュ済みのリダイレクト応答をナビゲーションへ返す場合 =====
  {
    const { listeners } = loadSw(swPath, {
      entries: { 'keeweb/index.html': redirectedResponse('KEEWEB-HTML') },
    });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/index.html', mode: 'navigate' });
    check('navigate + cached redirected response is served', !!res);
    eq('served response has no redirect history', res.redirected, false);
    eq('served response keeps the body', await res.text(), 'KEEWEB-HTML');
    eq('served response keeps status', res.status, 200);
  }

  // ===== 2. メイン SW: キャッシュミス→取得したリダイレクト応答を返す場合 =====
  {
    const { listeners } = loadSw(swPath, {
      fetchImpl: async () => redirectedResponse('KEEWEB-LIVE'),
    });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/index.html', mode: 'navigate' });
    eq('navigate + fetched redirected response is cleaned', res.redirected, false);
    eq('fetched body is preserved', await res.text(), 'KEEWEB-LIVE');
  }

  // ===== 3. メイン SW: リダイレクトのない応答はそのまま返す =====
  {
    const clean = new Response('PLAIN', { status: 200 });
    const { listeners } = loadSw(swPath, { entries: { 'index.html': clean } });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'index.html', mode: 'navigate' });
    check('navigate + clean cached response is returned as-is', res === clean);
  }

  // ===== 4. メイン SW: オフライン時のフォールバック（./）は維持される =====
  {
    const index = new Response('APP-INDEX', { status: 200 });
    const { listeners } = loadSw(swPath, {
      entries: { './': index },
      fetchImpl: async () => { throw new Error('offline'); },
    });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/', mode: 'navigate' });
    check('offline navigate falls back to the app index', res === index);
  }

  // ===== 5. メイン SW: ナビゲーション以外は従来どおり（リダイレクト応答に触れない） =====
  {
    const redir = redirectedResponse('ASSET');
    const { listeners } = loadSw(swPath, { fetchImpl: async () => redir });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'app.js', mode: 'cors' });
    check('subresource response is returned untouched', res === redir);
  }

  // ===== 6. KeeWeb 側 SW: 取得したリダイレクト応答をナビゲーションへ返す場合 =====
  {
    const { listeners } = loadSw(path.join(CONTENTS, 'keeweb', 'service-worker.js'), {
      fetchImpl: async () => redirectedResponse('KEEWEB-OWN'),
    });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/index.html', mode: 'navigate' });
    eq('keeweb sw cleans a redirected fetch response', res.redirected, false);
    eq('keeweb sw preserves the body', await res.text(), 'KEEWEB-OWN');
  }

  // ===== 6b. KeeWeb 側 SW: ナビゲーション以外では元の応答を維持する =====
  {
    const redir = redirectedResponse('KEEWEB-ASSET');
    const { listeners } = loadSw(path.join(CONTENTS, 'keeweb', 'service-worker.js'), {
      fetchImpl: async () => redir,
    });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/app.js', mode: 'cors' });
    check('keeweb sw returns subresource responses untouched', res === redir);
  }

  // ===== 6c. 再構築に失敗した場合は元の応答を返す（本体への置き換えで隠さない） =====
  {
    const broken = redirectedResponse('BROKEN', { blob: async () => { throw new Error('blob failed'); } });
    const { listeners } = loadSw(swPath, { entries: { 'keeweb/index.html': broken } });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/index.html', mode: 'navigate' });
    check('main sw returns the original response when the rebuild fails', res === broken);
  }
  {
    const broken = redirectedResponse('BROKEN-KW', { blob: async () => { throw new Error('blob failed'); } });
    const { listeners } = loadSw(path.join(CONTENTS, 'keeweb', 'service-worker.js'), {
      fetchImpl: async () => broken,
    });
    const res = await dispatchFetch(listeners, { method: 'GET', url: BASE + 'keeweb/index.html', mode: 'navigate' });
    check('keeweb sw returns the original response when the rebuild fails', res === broken);
  }

  // ===== 7. 静的ガード: 内部リンクは keeweb/ に統一し、プリキャッシュは維持する =====
  const indexJs = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');
  const timelockJs = fs.readFileSync(path.join(CONTENTS, 'timelock.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(swPath, 'utf8');
  check('openKeeWeb opens keeweb/', indexJs.includes("window.open('keeweb/', KEEWEB_WINDOW_NAME)"));
  check('timelock fallbacks open keeweb/', !timelockJs.includes("window.open('keeweb/index.html'") && timelockJs.includes("window.open('keeweb/', 'CryptoPassKeyKeeWeb')"));
  eq('generator links use keeweb/ form', (indexHtml.match(/href="keeweb\/#generator/g) || []).length, 8);
  check('no index.html keeweb links remain in index.html', !indexHtml.includes('keeweb/index.html'));
  check('precache still includes keeweb/index.html for offline use', swJs.includes('"keeweb/index.html"'));
  check('precache also includes the keeweb/ directory URL', swJs.includes('"keeweb/",'));
  check('sw navigate branch cleans redirected responses', swJs.includes('cleanRedirectedResponse'));
  check('sw version bumped', swJs.includes("cm-v3.30.1-keeweb-redirect"));

  console.log('---');
  console.log(`sw-navigate-redirect: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
