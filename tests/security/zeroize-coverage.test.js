// 回帰テスト: 緊急消去（btn-zeroize）の対象範囲（監査フォローアップ）。
// 専用テストがある QR受信（zeroize-dt-rx）と TimeSecret（zeroize-timesecret）
// 以外の横断範囲を確認する:
//   1) 各機能の秘密入力欄（生成・復元・バックアップ・保管庫・タイム
//      カプセル・おとり・キーファイルモーダル等）が空になる
//   2) localStorage の cm_* が一掃され、cm_ 以外のキーは残る（範囲の限定）
//   3) KeeWeb 転送キー（cm_pending_*）も一掃対象に含まれる
//   4) クリップボードへ即時に空文字が書き込まれる
//   5) 保管庫の復号結果表示が消え、シード入力が初期値に戻る
// モジュール内部のバイト列ゼロ埋め（保管庫・タイムカプセルのキーファイル
// 等）は外部から観測できないため、コード確認済みの範囲として扱う。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const SECRET = 'ZEROIZE-COVERAGE-3345';

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

async function loadPage(store, clipWrites) {
  const html = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://localhost/contents/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      // Object.keys(localStorage) が保存キーを列挙できるよう Proxy で
      // Storage インターフェースを再現する（Map直結だと列挙が効かず、
      // 緊急消去の一掃がテスト内で再現できない）
      const lsMock = new Proxy({}, {
        ownKeys: () => Array.from(store.keys()),
        getOwnPropertyDescriptor: (_t, k) =>
          store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined,
        get: (_t, k) => {
          if (k === 'getItem') return (key) => (store.has(key) ? store.get(key) : null);
          if (k === 'setItem') return (key, v) => store.set(key, String(v));
          if (k === 'removeItem') return (key) => store.delete(key);
          if (k === 'clear') return () => store.clear();
          if (k === 'key') return (i) => Array.from(store.keys())[i] ?? null;
          if (k === 'length') return store.size;
          return store.get(k);
        },
        set: (_t, k, v) => { store.set(k, String(v)); return true; },
        deleteProperty: (_t, k) => store.delete(k)
      });
      Object.defineProperty(window, 'localStorage', { configurable: true, value: lsMock });
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (t) => { clipWrites.push(t); },
          readText: async () => ''
        }
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
  await waitFor(() => window.CryptoMatrixDataTransfer, 'dt API');
  await sleep(300);
  return window;
}

(async () => {
  const store = new Map();
  const clipWrites = [];
  const window = await loadPage(store, clipWrites);
  const $ = (id) => window.document.getElementById(id);

  // 各機能の秘密入力欄に値を入れる
  const SECRET_FIELDS = [
    'sim-secret', 'input-restore-seed', 'input-restore-password',
    'bq-password', 'bq-restore-password',
    'bv-text-content', 'bv-password', 'bv-restore-password', 'bv-restore-text',
    'tl-text-content', 'tl-password', 'tl-restore-password', 'tl-restore-text',
    'tl-duress-pw', 'duress-modal-pw', 'duress-vault-pw', 'km-password',
    'ts-password', 'ts-unlock-password'
  ];
  const present = SECRET_FIELDS.filter((id) => $(id));
  for (const id of present) $(id).value = SECRET;
  check('対象の秘密入力欄が揃っている', present.length >= 15);

  // 保管庫の復号結果表示を再現
  if ($('bv-decrypted-content')) $('bv-decrypted-content').textContent = SECRET;
  if ($('bv-decrypt-result')) $('bv-decrypt-result').style.display = 'block';
  // シード入力を変更しておく
  if ($('input-seed-number')) $('input-seed-number').value = '424242';

  // localStorage: cm_* と無関係キーを用意
  window.setPendingKeeWebTransfer('cm_pending_entry', { site: 'x', password: SECRET });
  store.set('cm_active_seed', '123456');
  store.set('unrelated_app_key', 'keep-me');

  $('btn-zeroize').click();
  await sleep(500);

  const remaining = present.filter((id) => $(id).value !== '');
  check('全機能の秘密入力欄が空になる', remaining.length === 0);
  if (remaining.length) console.log('  残存:', remaining.join(','));
  check('保管庫の復号結果が消える',
    $('bv-decrypted-content').textContent === '' && $('bv-decrypt-result').style.display === 'none');
  check('シード入力が初期値に戻る', $('input-seed-number').value === '0');
  check('KeeWeb転送キーが一掃される', !store.has('cm_pending_entry'));
  check('元のシード値が残らない', store.get('cm_active_seed') !== '123456');
  const leaked = Array.from(store.entries())
    .filter(([_k, v]) => typeof v === 'string' && v.includes(SECRET));
  check('秘密を含む保存値が残らない', leaked.length === 0);
  if (leaked.length) console.log('  残存:', leaked.map(([k]) => k).join(','));
  check('cm_ 以外のキーは消去範囲に含まれない', store.get('unrelated_app_key') === 'keep-me');
  check('クリップボードへ空文字が書き込まれる', clipWrites.includes(''));
  check('完了バナーが表示される',
    ($('sim-step-banner').textContent || '').includes('緊急消去完了'));

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
