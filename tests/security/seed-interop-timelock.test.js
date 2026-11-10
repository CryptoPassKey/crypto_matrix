'use strict';
/*
 * 段階④テスト: 相互運用（異なる実装間の検証）。
 * 設計: crypto_matrix_board_v2_design.md §8（相互運用テスト）
 * - 作成側: 本体アプリの timelock.js の packCMV1AppBound
 * - 復元側: 独立した復元ツール timelock-recover.js の unpackCMV1AppBound
 * 両者は別ファイルの独立実装で、同じ誤りを共有しない組み合わせで検証する。
 * シード解釈は両実装とも「trim 済み文字列」で一致していること（数値・v2とも）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }

function extractSpan(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('start not found: ' + startMarker);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error('end not found: ' + endMarker);
  return src.slice(i, j);
}

(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });

  // --- 本体側（timelock.js）: zeroizeBuf 〜 unpackCMV1AppBound までを抽出 ---
  const tlSrc = fs.readFileSync(path.join(CONTENTS, 'timelock.js'), 'utf8');
  const tlSpan = extractSpan(tlSrc, 'function zeroizeBuf', 'async function packCommittedInner');
  const TL = w.eval(`(function(){
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    ${tlSpan}
    return { packCMV1AppBound, unpackCMV1AppBound };
  })()`);

  // --- 復元ツール側（timelock-recover.js）: pepper 〜 unpackCMV1 までを抽出 ---
  const rcSrc = fs.readFileSync(path.join(CONTENTS, 'timelock-recover.js'), 'utf8');
  const rcSpanFull = (() => {
    const start = rcSrc.indexOf('const CM_APP_DOMAIN_PEPPER');
    if (start < 0) throw new Error('recover pepper not found');
    const unpackStart = rcSrc.indexOf('function unpackCMV1(bytes)', start);
    if (unpackStart < 0) throw new Error('recover unpackCMV1 not found');
    let depth = 0, i = rcSrc.indexOf('{', unpackStart);
    const bodyStart = i;
    for (; i < rcSrc.length; i++) {
      if (rcSrc[i] === '{') depth++;
      else if (rcSrc[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return rcSrc.slice(start, i);
  })();
  if (!rcSpanFull.includes('unpackCMV1AppBound') || !rcSpanFull.includes('deriveAppDomainKey')) {
    throw new Error('recover span incomplete');
  }
  const RC = w.eval(`(function(){
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    function bytesToHex(bytes){return Array.from(bytes,(b)=>b.toString(16).padStart(2,'0')).join('');}
    async function sha256(data){const u8=data instanceof Uint8Array?data:enc.encode(String(data));return new Uint8Array(await crypto.subtle.digest('SHA-256',u8));}
    ${rcSpanFull}
    return { unpackCMV1AppBound };
  })()`);

  // ページ側 realm の Uint8Array で作る（本番コードの instanceof 判定を通すため）
  const pageEnc = new w.TextEncoder();
  const header = pageEnc.encode(JSON.stringify({ v: 1, type: 'note', name: 'interop' }));
  const payload = pageEnc.encode('CM-INTEROP::capsule-payload');

  for (const [cls, seed] of [['numeric', '42'], ['alnum', 'abc123'], ['symbols', 'Xk9$mQ2!vR7/pL4.wZ8-nT']]) {
    const packed = await TL.packCMV1AppBound(header, 'text', 'interop', payload, 'text/plain', seed);
    const opened = await RC.unpackCMV1AppBound(packed, header, seed);
    eq(`interop timelock->recover ${cls}`, opened.name, 'interop');
    eq(`interop payload ${cls}`, opened.text, 'CM-INTEROP::capsule-payload');
  }
  // 逆方向の自己整合（本体側で開ける）も確認
  {
    const packed = await TL.packCMV1AppBound(header, 'text', 'interop', payload, 'text/plain', 'abc123');
    const openedSelf = await TL.unpackCMV1AppBound(packed, header, 'abc123');
    check('timelock self roundtrip', !!openedSelf);
    let failed = false;
    try { await RC.unpackCMV1AppBound(packed, header, 'abc124'); } catch (_) { failed = true; }
    check('interop wrong seed rejected by recover tool', failed);
    // trim の解釈も一致する（前後空白は同一視）
    const openedPadded = await RC.unpackCMV1AppBound(packed, header, ' abc123 ');
    check('interop padded seed accepted consistently', !!openedPadded);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
