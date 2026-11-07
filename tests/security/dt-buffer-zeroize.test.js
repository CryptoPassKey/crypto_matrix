// 回帰テスト: Data Transfer の実体バッファがゼロ埋めで消去されること（監査 M3）。
// 従来は resetRx / Receiver.reset / FountainReceiver.reset / clearTxData が
// 参照を外すだけで、受信シャード・完成バイト列・送信元データ断片が
// メモリに残っていた。本テストは次を確認する:
//   1) プロトコル層: Receiver / FountainReceiver の reset() が保持バッファを
//      ゼロ埋めし、FountainEncoder.dispose() が元データ断片をゼロ埋めする
//   2) アプリ層: 受信完了後にリセット（または緊急消去）を実行すると、
//      秘密を含む実体バッファへの fill(0) が実際に行われる
//   3) 消去後も通常の受信が再び機能する
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const SECRET = 'DT-ZEROIZE-BUFFER-9917';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v;
    try { v = await fn(); } catch (_) { v = undefined; }
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
  await waitFor(() => window.CryptoMatrixDataTransfer && window.DataTransferCore && window.DataTransferFountain, 'dt API');
  await sleep(300);
  return window;
}

// ページ内でプロトコル層のゼロ埋めを検証する
function protocolChecks(window) {
  return window.eval(`(async () => {
    const out = {};
    const Core = window.DataTransferCore;
    const Fountain = window.DataTransferFountain;
    const enc = new TextEncoder();
    const secret = enc.encode('${SECRET}');
    const isZero = (a) => a && a.length > 0 && a.every((b) => b === 0);

    // --- Legacy Receiver ---
    {
      const built = Core.buildFrames(secret, { chunkSize: 180, parity: true, id: 'A1B2C3D4' });
      const rx = new Core.Receiver();
      // 最初のフレームだけ入れてシャードを保持させる
      rx.feed(built.frames[0]);
      const shardRefs = Array.from(rx.shards.values());
      const parityRefs = [];
      rx.parities.forEach((g) => Object.keys(g).forEach((k) => parityRefs.push(g[k])));
      for (const f of built.frames) rx.feed(f);
      out.legacyCompleted = rx.isComplete ? rx.isComplete() : shardRefs.length > 0;
      rx.reset();
      out.legacyShardsZeroed = shardRefs.length > 0 && shardRefs.every(isZero);
      out.legacyMapsCleared = rx.shards.size === 0 && rx.parities.size === 0;
      out.legacyParityZeroed = parityRefs.every(isZero); // パリティが無ければ vacuous
    }

    // --- Fountain Receiver / Encoder ---
    {
      const encoder = new Fountain.Encoder(secret, { chunkSize: 94, id: 'B1B2C3D4' });
      const fragRefs = encoder.fragments.slice();
      const frx = new Fountain.Receiver();
      let done = null;
      for (let i = 0; i < 40 && !done; i++) {
        const part = await encoder.nextPart();
        const res = await frx.feed(part.frame);
        if (res && res.complete) done = res.bytes;
      }
      out.fountainCompleted = !!done;
      const partRefs = Array.from(frx.simpleParts.values());
      const resultRef = frx.result;
      frx.reset();
      out.fountainPartsZeroed = partRefs.length > 0 && partRefs.every(isZero);
      out.fountainResultZeroed = resultRef ? isZero(resultRef) : false;
      out.fountainMapsCleared = frx.simpleParts.size === 0 && frx.mixedParts.size === 0;
      encoder.dispose();
      out.encoderFragmentsZeroed = fragRefs.length > 0 && fragRefs.every(isZero);
      out.encoderFragmentsReleased = encoder.fragments.length === 0;
      // 不正なIDではコンストラクタが例外を伝え、通常生成は壊れていない
      let threw = false;
      try { new Fountain.Encoder(secret, { chunkSize: 94, id: 'BAD!' }); } catch (_) { threw = true; }
      out.encoderInvalidIdThrows = threw;
    }
    return out;
  })()`);
}

(async () => {
  const window = await loadPage();
  const $ = (id) => window.document.getElementById(id);
  const api = window.CryptoMatrixDataTransfer;

  // --- 1) プロトコル層 ---
  const proto = await protocolChecks(window);
  check('protocol: Legacy受信が完了する', !!proto.legacyCompleted);
  check('protocol: Legacy シャードがゼロ埋めされる', proto.legacyShardsZeroed === true);
  check('protocol: Legacy パリティがゼロ埋めされる', proto.legacyParityZeroed === true);
  check('protocol: Legacy の Map が空になる', proto.legacyMapsCleared === true);
  check('protocol: Fountain受信が完了する', proto.fountainCompleted === true);
  check('protocol: Fountain パートがゼロ埋めされる', proto.fountainPartsZeroed === true);
  check('protocol: Fountain 完成バイト列がゼロ埋めされる', proto.fountainResultZeroed === true);
  check('protocol: Fountain の Map が空になる', proto.fountainMapsCleared === true);
  check('protocol: Encoder の元データ断片がゼロ埋めされる', proto.encoderFragmentsZeroed === true);
  check('protocol: Encoder の断片が解放される', proto.encoderFragmentsReleased === true);
  check('protocol: Encoder は不正なIDで例外を伝える', proto.encoderInvalidIdThrows === true);

  // --- 2) アプリ層: fill(0) の実行を観測する ---
  await window.eval(`(() => {
    const secret = new TextEncoder().encode('${SECRET}');
    const contains = (a) => {
      if (!a || a.length < secret.length) return false;
      outer: for (let i = 0; i + secret.length <= a.length; i++) {
        for (let j = 0; j < secret.length; j++) if (a[i + j] !== secret[j]) continue outer;
        return true;
      }
      return false;
    };
    window.__zeroedSecretBuffers = 0;
    const orig = Uint8Array.prototype.fill;
    window.__restoreFill = () => { Uint8Array.prototype.fill = orig; };
    Uint8Array.prototype.fill = function (v, s, e) {
      if (v === 0 && contains(this)) window.__zeroedSecretBuffers++;
      return orig.call(this, v, s, e);
    };
  })()`);
  const bytes = new window.TextEncoder().encode(SECRET);
  const built = window.DataTransferCore.buildFrames(bytes, { chunkSize: 180, parity: false, id: 'A1B2C3D4' });
  for (const frame of built.frames) await api.ingest(frame);
  await waitFor(() => api.getState().rxFinalText === SECRET, '受信完了');
  $('dt-reset-rx').click();
  await sleep(300);
  const zeroedCount = window.eval('window.__zeroedSecretBuffers');
  check('app: リセットで秘密を含む実体バッファがゼロ埋めされる', zeroedCount >= 1);
  check('app: リセット後に受信状態が消える', api.getState().rxFinalText === null && api.getState().rxFinalSize === 0);
  window.eval('window.__restoreFill && window.__restoreFill()');

  // --- 3) 送信側: 準備完了時・再準備時・クリア時のゼロ埋め ---
  const TXA = 'TXA-9f3Kd72mQ8xP4vN6bR1sT5wY0zH7jF2aG5cE8uI3oL6nM9qS4vX7yB0dW3eK6h';
  const TXB = 'TXB-2wE5rT8yU1iO4pA7sD0fG3hJ6kL9zX2cV5bN8mQ1wE4rT7yU0iO3pA6sD9f';
  await window.eval(`(() => {
    const secrets = { A: new TextEncoder().encode('${TXA}'), B: new TextEncoder().encode('${TXB}') };
    const contains = (a, secret) => {
      if (!a || a.length < secret.length) return false;
      outer: for (let i = 0; i + secret.length <= a.length; i++) {
        for (let j = 0; j < secret.length; j++) if (a[i + j] !== secret[j]) continue outer;
        return true;
      }
      return false;
    };
    window.__txZeroed = { A: 0, B: 0 };
    const orig = Uint8Array.prototype.fill;
    window.__restoreTxFill = () => { Uint8Array.prototype.fill = orig; };
    Uint8Array.prototype.fill = function (v, s2, e) {
      if (v === 0) {
        if (contains(this, secrets.A)) window.__txZeroed.A++;
        if (contains(this, secrets.B)) window.__txZeroed.B++;
      }
      return orig.call(this, v, s2, e);
    };
  })()`);
  const txZeroed = () => window.eval('window.__txZeroed');
  $('dt-tx-text').value = TXA;
  $('dt-prepare-tx').click();
  await waitFor(() => api.getState().txPrepared, '送信準備A');
  await sleep(300);
  check('app(TX): 準備完了時に作業バッファがゼロ埋めされる', (await txZeroed()).A >= 1);
  const aBefore = (await txZeroed()).A;
  $('dt-tx-text').value = TXB;
  $('dt-prepare-tx').click();
  await waitFor(async () => (await txZeroed()).A > aBefore, '再準備で旧Encoderが破棄される');
  check('app(TX): 再準備時に旧Encoderの断片がゼロ埋めされる', true);
  await waitFor(() => ($('dt-tx-status').textContent || '').includes('準備完了'), '送信準備B完了');
  const bBefore = (await txZeroed()).B;
  $('dt-clear-tx').click();
  await sleep(300);
  check('app(TX): クリア時に送信バッファがゼロ埋めされる', (await txZeroed()).B > bBefore);
  check('app(TX): クリア後に送信状態が消える', api.getState().txPrepared === false);
  window.eval('window.__restoreTxFill && window.__restoreTxFill()');

  // --- 3b) 送信準備が失敗しても作業バッファがゼロ埋めされる（finally） ---
  await window.eval(`(() => {
    const secret = new TextEncoder().encode('${TXA}');
    const contains = (a) => {
      if (!a || a.length < secret.length) return false;
      outer: for (let i = 0; i + secret.length <= a.length; i++) {
        for (let j = 0; j < secret.length; j++) if (a[i + j] !== secret[j]) continue outer;
        return true;
      }
      return false;
    };
    window.__failZeroed = 0;
    const orig = Uint8Array.prototype.fill;
    window.__restoreFailFill = () => { Uint8Array.prototype.fill = orig; };
    Uint8Array.prototype.fill = function (v, s2, e) {
      if (v === 0 && contains(this)) window.__failZeroed++;
      return orig.call(this, v, s2, e);
    };
    // フレーム生成を強制的に失敗させる（圧縮後・フレーム生成時点で例外）
    window.__origBuildFrames = window.DataTransferCore.buildFrames;
    window.DataTransferCore.buildFrames = function () { throw new Error('forced failure for test'); };
  })()`);
  $('dt-tx-text').value = TXA;
  $('dt-prepare-tx').click();
  await waitFor(() => ($('dt-tx-status').textContent || '').includes('失敗'), '準備失敗の表示');
  await sleep(300);
  check('app(TX): 準備失敗時も作業バッファがゼロ埋めされる',
    window.eval('window.__failZeroed') >= 1);
  check('app(TX): 準備失敗で送信状態が残らない', api.getState().txPrepared === false);
  window.eval('window.DataTransferCore.buildFrames = window.__origBuildFrames;');
  window.eval('window.__restoreFailFill && window.__restoreFailFill()');
  $('dt-prepare-tx').click();
  await waitFor(() => api.getState().txPrepared, '失敗後に再準備できる');
  check('app(TX): 失敗後も再準備が機能する', api.getState().txPrepared === true);
  $('dt-clear-tx').click();
  await sleep(200);

  // --- 4) 消去後も通常受信が機能する ---
  for (const frame of built.frames) await api.ingest(frame);
  await waitFor(() => api.getState().rxFinalText === SECRET, '再受信完了');
  check('app: 消去後も通常受信が機能する', api.getState().rxFinalText === SECRET);

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
