// 回帰テスト: KeeWeb 転送データの削除契約（監査 M2）。
// 転送キー（cm_pending_*）は localStorage に平文で置かれるが、設計は
// 「消費が完了したら即時削除し、60秒 TTL は放棄時のバックストップ」。
// 本テストは次を確認する:
//   1) 本体側: setPendingKeeWebTransfer の封筒（転送ID・約60秒の期限）
//   2) 本体側: KEEWEB_IMPORT_COMPLETE（origin・転送ID・送信元が正しい）
//      を受けるとキーが削除される。不正な通知では削除されない
//   3) KeeWeb 側（静的契約）: 消費する3キーすべてで completePendingTransfer
//      が呼ばれ、削除が localStorage.removeItem で行われること、
//      readPendingTransfer が期限切れ・不正な封筒を削除すること
// KeeWeb 本体は jsdom で起動できないため、KeeWeb 側は csp-static-check と
// 同じ「ソース契約の静的検査」で再発を検出する。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const PW = 'keeweb-transfer-test-pw';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v;
    try { v = fn(); } catch (_) { v = undefined; }
    if (v) return v;
    await sleep(50);
  }
  throw new Error('waitFor timeout: ' + label);
}

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

// --- 3) KeeWeb 側の静的契約 ---
function staticChecks() {
  const html = fs.readFileSync(path.join(CONTENTS, 'keeweb', 'index.html'), 'utf8');
  for (const key of ['cm_pending_master_pass', 'cm_pending_keyfile', 'cm_pending_entry']) {
    check(`keeweb: ${key} の消費完了で削除処理が呼ばれる`,
      html.includes(`completePendingTransfer('${key}'`));
  }
  const removeFn = html.slice(html.indexOf('function removePendingTransfer'),
    html.indexOf('function removePendingTransfer') + 500);
  check('keeweb: removePendingTransfer が localStorage.removeItem で削除する',
    removeFn.includes('localStorage.removeItem'));
  const readFn = html.slice(html.indexOf('function readPendingTransfer'),
    html.indexOf('function readPendingTransfer') + 900);
  check('keeweb: readPendingTransfer が期限切れの封筒を削除する',
    readFn.includes('_expiresAt') && readFn.includes('localStorage.removeItem'));
  check('keeweb: completePendingTransfer が本体へ完了を通知する',
    html.includes("type:'KEEWEB_IMPORT_COMPLETE'") || html.includes('KEEWEB_IMPORT_COMPLETE'));
}

async function loadPage(store) {
  const html = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://localhost/contents/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
          clear: () => store.clear(),
          key: (i) => Array.from(store.keys())[i] ?? null,
          get length() { return store.size; }
        }
      });
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {}, readText: async () => '' }
      });
      window.URL.createObjectURL = () => 'blob:fake';
      window.URL.revokeObjectURL = () => {};
      window.HTMLCanvasElement.prototype.getContext = function () {
        const target = { canvas: this };
        return new Proxy(target, {
          get: (t, k) => (k in t ? t[k] : () => ({ width: 0, height: 0, data: new Uint8ClampedArray(4) })),
          set: () => true
        });
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => '';
      if (window.Element && !window.Element.prototype.scrollIntoView) {
        window.Element.prototype.scrollIntoView = () => {};
      }
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    }
  });
  const { window } = dom;
  for (const f of SCRIPTS) {
    try { window.eval(fs.readFileSync(path.join(CONTENTS, f), 'utf8')); }
    catch (e) { console.log('script load note:', f, '-', e.message.slice(0, 80)); }
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await waitFor(() => typeof window.setPendingKeeWebTransfer === 'function', 'setPendingKeeWebTransfer');
  await sleep(300);
  return window;
}

(async () => {
  staticChecks();

  const store = new Map();
  const window = await loadPage(store);
  const KEY = 'cm_pending_master_pass';

  // --- 1) 封筒の契約 ---
  const before = Date.now();
  const transferId = window.setPendingKeeWebTransfer(KEY, PW);
  check('本体: 転送IDが返る', typeof transferId === 'string' && transferId.length > 0);
  const envelope = JSON.parse(store.get(KEY));
  check('本体: 封筒に転送IDが入る', envelope._transferId === transferId);
  const ttl = envelope._expiresAt - before;
  check('本体: 期限は約60秒（バックストップ）', ttl > 50000 && ttl <= 61000);

  // --- 2) 削除の検証 ---
  const notify = (tid, origin) => {
    const ev = new window.MessageEvent('message', {
      data: { type: 'KEEWEB_IMPORT_COMPLETE', key: KEY, transferId: tid },
      origin, source: window
    });
    window.dispatchEvent(ev);
  };
  notify('xfer_wrong_id', window.location.origin);
  await sleep(150);
  check('本体: 転送IDが違う通知では削除されない', store.has(KEY));
  notify(transferId, 'https://evil.example');
  await sleep(150);
  check('本体: origin が違う通知では削除されない', store.has(KEY));
  notify(transferId, window.location.origin);
  await sleep(150);
  check('本体: 正しい完了通知でキーが即時削除される', !store.has(KEY));

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
