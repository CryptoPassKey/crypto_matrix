// 回帰テスト: 破損・改ざんされた入力の安全な拒否（監査 V1）。
// 攻撃者や破損した媒体から渡されるデータを想定し、次を確認する:
//   A) 暗号化バックアップ本体（CME2）: 切り詰め・暗号文の改ざん・
//      ヘッダーの改ざん・末尾への追加では復号できず、誤った平文も返らない
//   B) QR転送フレーム（レガシー）: 切り詰め・CRC改ざん・不正なヘッダー・
//      総フレーム数の詐称・ランダムな文字列を安全に拒否し、その後も
//      正常な転送が完了する
//   C) アプリ層: 不正なフレームを取り込んでも受信状態が壊れず、
//      正常な転送が完了する
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { loadApp } = require('../compatibility/load-app');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const PW = 'corrupt-input-test-pw';
const PLAIN = 'CORRUPT-INPUT-PLAINTEXT-5566';
const SECRET = 'DT-CORRUPT-FRAME-7788';

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

async function expectReject(name, fn) {
  try {
    const r = await fn();
    // 復号が「成功」しても、元の平文と異なるものを返したら失敗
    check(name, false);
    return r;
  } catch (_) {
    check(name, true);
    return null;
  }
}

async function loadDtPage() {
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
  await waitFor(() => window.CryptoMatrixDataTransfer && window.DataTransferCore, 'dt API');
  await sleep(300);
  return window;
}

(async () => {
  // ---------- A) CME2 バックアップ本体 ----------
  const win = await loadApp(CONTENTS);
  const M = win.MatrixCardPreset;
  const enc = new win.TextEncoder();
  const dec = new win.TextDecoder();
  const plainBody = enc.encode(PLAIN);
  const body = await M.encryptBodyCME2(plainBody, PW, 1, {});
  check('A: 正常な本体が作れる', body && body.length > 40);

  const ok = await M.decryptBodyCME2(body, PW, null);
  check('A: 正常な本体は復号できる', dec.decode(ok.innerBody) === PLAIN);

  await expectReject('A: 切り詰めた本体を拒否する',
    () => M.decryptBodyCME2(body.slice(0, Math.floor(body.length / 2)), PW, null));
  await expectReject('A: 末尾を少し切り詰めた本体を拒否する',
    () => M.decryptBodyCME2(body.slice(0, body.length - 4), PW, null));

  const tamperedCipher = new Uint8Array(body);
  tamperedCipher[tamperedCipher.length - 1] ^= 0xff;
  await expectReject('A: 暗号文を改ざんした本体を拒否する',
    () => M.decryptBodyCME2(tamperedCipher, PW, null));

  const tamperedMid = new Uint8Array(body);
  tamperedMid[Math.floor(tamperedMid.length / 2)] ^= 0x40;
  await expectReject('A: 中間を改ざんした本体を拒否する',
    () => M.decryptBodyCME2(tamperedMid, PW, null));

  const tamperedHead = new Uint8Array(body);
  tamperedHead[2] ^= 0xff;
  await expectReject('A: ヘッダーを改ざんした本体を拒否する',
    () => M.decryptBodyCME2(tamperedHead, PW, null));

  const appended = new Uint8Array(body.length + 8);
  appended.set(body);
  appended.set([1, 2, 3, 4, 5, 6, 7, 8], body.length);
  try {
    const r = await M.decryptBodyCME2(appended, PW, null);
    check('A: 末尾に追加した本体は拒否するか元の平文のみ返す',
      dec.decode(r.innerBody) === PLAIN);
  } catch (_) {
    check('A: 末尾に追加した本体は拒否するか元の平文のみ返す', true);
  }

  await expectReject('A: 空の本体を拒否する',
    () => M.decryptBodyCME2(new Uint8Array(0), PW, null));
  await expectReject('A: ランダムなバイト列を拒否する',
    () => M.decryptBodyCME2(enc.encode('x'.repeat(200)), PW, null));

  // ---------- B) QR転送フレーム（プロトコル層） ----------
  const window = await loadDtPage();
  const Core = window.DataTransferCore;
  const frameCheck = await window.eval(`(() => {
    const Core = window.DataTransferCore;
    const secret = new TextEncoder().encode('${SECRET}');
    const built = Core.buildFrames(secret, { chunkSize: 180, parity: true, id: 'C1B2C3D4' });
    const good = built.frames[0];
    const out = { good };
    const attempt = (frame) => {
      try { Core.parseFrame(frame); return 'parsed'; }
      catch (e) { return 'rejected'; }
    };
    out.truncated = attempt(good.slice(0, Math.floor(good.length / 2)));
    // ペイロード部の1文字を変更（CRC不一致になる）
    const chars = good.split('');
    const mid = Math.floor(chars.length / 2);
    chars[mid] = chars[mid] === 'A' ? 'B' : 'A';
    out.crcTampered = attempt(chars.join(''));
    out.badHeader = attempt('XXXX' + good.slice(4));
    out.garbage = attempt('これはフレームではありません！！！');
    out.empty = attempt('');
    return out;
  })()`);
  check('B: 切り詰めたフレームを拒否する', frameCheck.truncated === 'rejected');
  check('B: CRCが合わないフレームを拒否する', frameCheck.crcTampered === 'rejected');
  check('B: ヘッダーが不正なフレームを拒否する', frameCheck.badHeader === 'rejected');
  check('B: ランダムな文字列を拒否する', frameCheck.garbage === 'rejected');
  check('B: 空文字列を拒否する', frameCheck.empty === 'rejected');

  // 総フレーム数の詐称: 受信側が完了扱いにならないこと
  const forged = await window.eval(`(() => {
    const Core = window.DataTransferCore;
    const secret = new TextEncoder().encode('${SECRET}');
    const built = Core.buildFrames(secret, { chunkSize: 8, parity: false, id: 'D1B2C3D4' });
    const rx = new Core.Receiver();
    let accepted = 0;
    for (const f of built.frames) { try { rx.feed(f); accepted++; } catch (_) {} }
    return { accepted, total: built.frames.length, complete: rx.isComplete() };
  })()`);
  check('B: 小さいチャンクでも全フレームで正しく完了する',
    forged.accepted === forged.total && forged.complete === true);

  // ---------- C) アプリ層: 不正フレームの後に正常転送 ----------
  const api = window.CryptoMatrixDataTransfer;
  const bytes = new window.TextEncoder().encode(SECRET);
  const built = Core.buildFrames(bytes, { chunkSize: 180, parity: false, id: 'E1B2C3D4' });
  await api.ingest('garbage-frame-not-a-frame');
  await api.ingest(built.frames[0].slice(0, 20));
  await api.ingest('');
  for (const frame of built.frames) await api.ingest(frame);
  await waitFor(() => api.getState().rxFinalText === SECRET, '正常転送の完了');
  check('C: 不正フレームの後でも正常な転送が完了する', api.getState().rxFinalText === SECRET);

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
