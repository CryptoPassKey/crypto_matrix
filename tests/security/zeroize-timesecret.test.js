// 回帰テスト: 緊急消去（btn-zeroize）と TimeSecret の連携。
// TimeSecret は独自のライフサイクルを持ち、timesecret.js 自身が
// btn-zeroize にリスナーを登録して scrubAllEphemeralMemory() を実行する
// （index.js 側の入力欄スクラブとは別系統で、競合しない）。
// 本テストは fake-indexeddb 上に実際の保管庫を作り、UI フローで開いて
// 平文を表示させた状態から緊急消去を実行し、次を確認する:
//   1) 復号表示・復号バイト列に紐づく表示・一時データが破棄される
//   2) 転記ペイロードや作成フォームの一時データが消去される
//   3) 認証モーダルが閉じる
//   4) IndexedDB の暗号化保管庫は残り、正しい認証情報で再復号できる
//      （緊急消去はセッション状態の消去であり、データ破棄ではない）
//   5) 消去後も通常の表示フローが再び機能する
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const SECRET = 'TS-ZEROIZE-SECRET-4820';
const PW = 'ts-test-password-4820';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 20000) {
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

async function loadPage() {
  const html = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  const store = new Map();
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
      window.indexedDB = new IDBFactory();
      // jsdom には SubtleCrypto がないため Node の WebCrypto を差す
      try {
        Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
      } catch (_) {}
      window.URL.createObjectURL = () => 'blob:fake';
      window.URL.revokeObjectURL = () => {};
      // jsdom には canvas 2D 実装がないため無害なスタブを差す
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
  const app = await waitFor(() => window.TimeSecretApp, 'TimeSecretApp');
  await sleep(400);
  return { window, app };
}

(async () => {
  const { window, app } = await loadPage();
  const $ = (id) => window.document.getElementById(id);
  const enc = new window.TextEncoder();

  app.recordConsent();
  const createOpts = (label, extra) => Object.assign({
    label, kind: 'text', plainBytes: enc.encode(SECRET),
    usePassword: true, password: PW, kdfProfile: 1,
    intervalMs: 7 * 24 * 3600 * 1000,
    checkInAuth: { mode: 'none' }, managementAuth: { mode: 'none' }
  }, extra || {});
  const v1 = await app.createVault(createOpts('保管庫1'));
  const vid = v1.vaultId;
  check('保管庫を作成できる', typeof vid === 'string' && vid.length > 0);

  // --- 1) UI フローで開き、平文を表示させる ---
  async function openViaUI() {
    app.openDetailView(vid);
    await sleep(200);
    if ($('ts-detail-decrypt-box').hidden) $('btn-ts-detail-decrypt-toggle').click();
    await sleep(200);
    $('ts-unlock-password').value = PW;
    $('btn-ts-unlock-exec').click();
    await waitFor(
      () => $('ts-decrypted-view') && $('ts-decrypted-view').textContent.includes(SECRET),
      '平文表示');
  }
  await openViaUI();
  check('表示: 復号ビューに平文が出る', $('ts-decrypted-view').textContent.includes(SECRET));
  check('表示: テキストラップが表示される', $('ts-decrypted-text-wrap').hidden === false);
  check('表示: 復号メタ情報が出る', ($('ts-decrypted-meta').textContent || '').length > 0);

  // --- 2) 緊急消去で表示と一時データが破棄される ---
  $('btn-zeroize').click();
  await sleep(700);
  check('消去: 復号ビューが空になる', $('ts-decrypted-view').textContent === '');
  check('消去: 復号メタ情報が空になる', $('ts-decrypted-meta').textContent === '');
  check('消去: テキストラップが隠れる', $('ts-decrypted-text-wrap').hidden === true);
  check('消去: 復号ボックスが隠れる', $('ts-decrypted-box').hidden === true);
  check('消去: 復号ドロワーが隠れる', $('ts-detail-decrypt-box').hidden === true);
  check('消去: アンロック用パスワード欄が空になる', $('ts-unlock-password').value === '');

  // --- 3) 認証モーダルが閉じる ---
  const v2 = await app.createVault(createOpts('保管庫2', {
    checkInAuth: { usePassword: true, pwSource: 'encryption', kdfProfile: 1 }
  }));
  app.triggerCheckInFlow(v2.vaultId);
  await sleep(500);
  check('モーダル: チェックイン認証モーダルが開く', $('ts-auth-modal').hidden === false);
  $('btn-zeroize').click();
  await sleep(700);
  check('消去: 認証モーダルが閉じる', $('ts-auth-modal').hidden === true);

  // --- 4) 転記ペイロードと作成フォームの一時データが消去される ---
  app.receiveTransferredPayload({
    source: 'sec3', label: '転記テスト', armoredText: 'ARMORED-DUMMY', createdPassword: 'cp-1234'
  });
  await sleep(300);
  check('転記: ラベルが作成フォームへ入る', $('ts-vault-label').value === '転記テスト');
  $('ts-secret-text').value = SECRET;
  $('ts-password').value = PW;
  $('btn-zeroize').click();
  await sleep(700);
  check('消去: 転記ラベルが空になる', $('ts-vault-label').value === '');
  check('消去: 転記ラジオが無効に戻る', $('ts-type-transferred').disabled === true);
  check('消去: 作成用テキストが空になる', $('ts-secret-text').value === '');
  check('消去: 作成用パスワードが空になる', $('ts-password').value === '');

  // --- 5) 非破壊: 保管庫は残り、再復号と再表示ができる ---
  check('非破壊: 保管庫が2件とも残る', app.listVaults().length === 2);
  const dec = await app.decryptVault(vid, { password: PW });
  check('非破壊: 正しいパスワードで再復号できる', dec.text === SECRET);
  let wrongPasswordRejected = false;
  try { await app.decryptVault(vid, { password: 'definitely-wrong-password' }); } catch (_) { wrongPasswordRejected = true; }
  check('異常系: 誤った復元用パスワードを拒否する', wrongPasswordRejected);
  await openViaUI();
  check('非破壊: 消去後も通常の表示フローが機能する', $('ts-decrypted-view').textContent.includes(SECRET));

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
