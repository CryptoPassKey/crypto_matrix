// 回帰テスト: 緊急消去（btn-zeroize）が QR 転送の受信状態を消去すること。
// 実際の受信完了までを駆動する: DataTransferCore.buildFrames で作った
// フレームを CryptoMatrixDataTransfer.ingest へ投入し、受信完了状態
// （rxFinalText・プレビュー・完了カード）を作ってから zeroize を実行する。
// zeroize 後は受信状態が残らず、その後の通常受信にも影響しないことを確認する。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const SECRET = 'ZEROIZE-RX-SECRET-7391';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v;
    try { v = fn(); } catch (_) { v = undefined; }
    if (v) return v;
    await sleep(50);
  }
  throw new Error('waitFor timeout: ' + label);
}

async function loadPage() {
  const html = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  const store = new Map();
  const clip = { value: '', writes: [] };
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
        value: {
          writeText: async (t) => { clip.value = String(t); clip.writes.push(String(t)); },
          readText: async () => clip.value
        }
      });
      window.URL.createObjectURL = () => 'blob:fake';
      window.URL.revokeObjectURL = () => {};
      // jsdom には canvas 2D 実装がないため、dt 初期化が止まらないよう無害なスタブを差す
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
  await waitFor(() => window.CryptoMatrixDataTransfer && window.DataTransferCore, 'dt API');
  await sleep(300);
  return { window, clip };
}

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

async function receiveSecret(window) {
  const bytes = new window.TextEncoder().encode(SECRET);
  const built = window.DataTransferCore.buildFrames(bytes, { chunkSize: 180, parity: false, id: 'A1B2C3D4' });
  for (const frame of built.frames) await window.CryptoMatrixDataTransfer.ingest(frame);
  await waitFor(() => window.CryptoMatrixDataTransfer.getState().rxFinalText === SECRET, '受信完了');
}

(async () => {
  const { window, clip } = await loadPage();
  const api = window.CryptoMatrixDataTransfer;
  const $ = (id) => window.document.getElementById(id);

  // 1) 実際に受信を完了させ、受信状態が存在する状態を作る
  await receiveSecret(window);
  let st = api.getState();
  check('受信完了: rxFinalText に秘密が保持される', st.rxFinalText === SECRET);
  check('受信完了: プレビューに秘密が表示される', $('dt-rx-text-preview').value === SECRET);
  check('受信完了: 完了カードが表示される', $('dt-rx-completion-card').hidden === false);

  // 2) 緊急消去を実行する
  $('btn-zeroize').click();
  await waitFor(() => api.getState().rxFinalText === null, 'zeroize 後の rxFinalText 消去');
  st = api.getState();
  check('zeroize 後: rxFinalText が null', st.rxFinalText === null);
  check('zeroize 後: rxFinalSize が 0', st.rxFinalSize === 0);
  check('zeroize 後: rxReceivedDone が false', st.rxReceivedDone === false);
  check('zeroize 後: 受信ブロックが 0', st.rxHaveBlocks === 0);
  check('zeroize 後: プレビューが空', $('dt-rx-text-preview').value === '');
  check('zeroize 後: プレビューが隠れる', $('dt-rx-text-preview-wrap').hidden === true);
  check('zeroize 後: 完了カードが隠れる', $('dt-rx-completion-card').hidden === true);
  check('zeroize 後: ファイル名が初期値に戻る', st.rxFinalFilename === 'received-file.bin');

  // 3) 消去後にコピーボタンを押しても秘密はクリップボードへ出ない
  clip.writes.length = 0;
  $('dt-copy-result').click();
  await sleep(200);
  check('zeroize 後のコピー: 秘密が書き込まれない', !clip.writes.includes(SECRET));

  // 4) 通常の受信操作に影響がないこと（同じフレームを再受信できる）
  await receiveSecret(window);
  st = api.getState();
  check('再受信: 通常受信が引き続き機能する', st.rxFinalText === SECRET);

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
