'use strict';
/*
 * 版6（recipe-v6）コーデックの検証。設計: crypto_matrix_board_v2_design.md §13・§14
 * （2026-11-10 確定、検証条件4点を含む）。
 *
 * 検証条件への対応:
 *  1. 文字列符号化の一意性と境界（長さ1/16、先行桁を含む全長、文字種の端・重複なし）
 *  2. 記号マスク組合せ符号化の全パターン一意性（小さい部分集合は全数、
 *     4〜8種は乱択）と、9種以上を切り捨てないこと（canPack=false）
 *  3. 版6の識別（マジック・版・値域・予約ビットの全検証、不正データの誤認なし）
 *  4. 48単語フォールバックとの整合は recipe-v6-integration.test.js で検証する
 */
const fs = require('fs');
const path = require('path');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
global.window = {};
require(path.join(CONTENTS, 'recipe-v6.js'));
const V6 = global.window.CMRecipeV6;
const I = V6._internal;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }

// ===== 契約: 文字種・母集団の一致 =====
{
  const seedKeySrc = fs.readFileSync(path.join(CONTENTS, 'seed-key.js'), 'utf8');
  const pool = seedKeySrc.match(/GENERATE_POOL = '([^']+)'/)[1];
  eq('storage charset = generate pool + #&', V6.STORAGE_CHARS, pool + '#&');
  eq('storage charset length is 76', V6.STORAGE_CHARS.length, 76);
  eq('storage charset has no duplicates', new Set(V6.STORAGE_CHARS).size, 76);
  const indexSrc = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');
  const univLiteral = indexSrc.match(/ALL_ASCII_SYMBOLS = ('(?:[^'\\]|\\.)*')/)[1];
  const univVal = eval(univLiteral); // アプリ本体の文字列リテラルそのものを評価する
  eq('symbol universe matches ALL_ASCII_SYMBOLS', V6.SYMBOL_UNIVERSE, univVal);
  eq('symbol universe length is 32', V6.SYMBOL_UNIVERSE.length, 32);
  eq('symbol universe has no duplicates', new Set(V6.SYMBOL_UNIVERSE).size, 32);
}

// ===== 条件2: 記号マスクの一意性 =====
{
  const all = Array.from({ length: 32 }, (_, i) => i);
  function* subsets(arr, k, start = 0, cur = []) {
    if (cur.length === k) { yield [...cur]; return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); yield* subsets(arr, k, i + 1, cur); cur.pop(); }
  }
  const seen = new Set();
  let dup = 0, roundtripFail = 0, n = 0;
  for (let k = 0; k <= 3; k++) {
    for (const s of subsets(all, k)) {
      const r = I.maskRank(s);
      if (seen.has(r)) dup++;
      seen.add(r);
      const u = I.maskUnrank(r);
      if (JSON.stringify(u) !== JSON.stringify(s)) roundtripFail++;
      n++;
    }
  }
  check('mask rank unique for all subsets of size <=3 (' + n + ' patterns)', dup === 0);
  check('mask roundtrip for all subsets of size <=3', roundtripFail === 0);
  let rngState = 987654321;
  const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let fail48 = 0;
  const seen48 = new Set();
  for (let t = 0; t < 4000; t++) {
    const k = 4 + Math.floor(rnd() * 5);
    const s = new Set();
    while (s.size < k) s.add(Math.floor(rnd() * 32));
    const arr = [...s].sort((a, b) => a - b);
    const r = I.maskRank(arr);
    if (seen48.has(r)) { /* 同じ集合の再抽選はあり得るため一意性は小さい集合で担保 */ }
    seen48.add(r);
    if (JSON.stringify(I.maskUnrank(r)) !== JSON.stringify(arr)) fail48++;
  }
  check('mask roundtrip for random subsets of size 4..8 (4000 samples)', fail48 === 0);
  eq('mask total count', I.MASK_TOTAL, 15033173);
}

// ===== 条件1: 文字列符号化の境界 =====
{
  const edges = ['a', '0', '&', '#', '/', V6.STORAGE_CHARS[0], V6.STORAGE_CHARS[75],
    'a'.repeat(15), 'a'.repeat(16), '&'.repeat(16), 'Zz9/'.repeat(4), 'Ab3-xY9zQwEr'];
  let bad = 0;
  for (const s of edges) {
    const v = I.encodeSeedValue(s);
    if (v >= (1n << 101n)) bad++;
    if (I.decodeSeedValue(v) !== s) bad++;
  }
  check('seed encode/decode at boundaries (len 1..16, charset edges)', bad === 0, 'bad=' + bad);
  eq('decode rejects zero', I.decodeSeedValue(0n), null);
  eq('decode rejects gap zone (2*76^5)', I.decodeSeedValue(2n * 76n ** 5n), null);
  eq('decode rejects beyond capacity (2*76^16)', I.decodeSeedValue(2n * 76n ** 16n), null);
  eq('max seed value is 2*76^16-1 and decodes', I.decodeSeedValue(2n * 76n ** 16n - 1n), '&'.repeat(16));
}

// ===== pack/unpack 往復と格納可否 =====
const baseCfg = { kwOrder: 3, kwFilter: 0, kwNum: 4, shiftDir: 0, baseCorner: 0, shiftN: 1, shiftM: 1, pickPattern: 0, symMode: 0, symList: '-_!#', symFbDir: 3, symFbDist: 1, symFbCorner: 0, preTarget: 0, prePattern: 0, preOffset: 0, sufTarget: 0, sufPattern: 0, sufOffset: 0, ancTile: 0, ancMode: 0, lenMode: 5, lenVal: 16, ancPos: 4, postMode: 0 };
function normCfg(cfg) {
  const c = { ...cfg };
  c.symList = [...V6.SYMBOL_UNIVERSE].filter(ch => (cfg.symList || '').includes(ch)).join('');
  return c;
}
function cfgEq(a, b) {
  const ka = Object.keys(b);
  return ka.length === Object.keys(a).length && ka.every(k => a[k] === b[k]);
}
{
  const un = V6.tryUnpack(V6.pack(baseCfg, true, 'aB3-xY9zQwEr'));
  check('roundtrip typical cfg+seed', !!un && un.seedText === 'aB3-xY9zQwEr' && cfgEq(un.cfg, normCfg(baseCfg)));
  const unNoSeed = V6.tryUnpack(V6.pack(baseCfg, false, null));
  check('roundtrip without seed', !!unNoSeed && unNoSeed.includeCardSeed === false && unNoSeed.seedText === null && cfgEq(unNoSeed.cfg, normCfg(baseCfg)));
  const maxCfg = { kwOrder: 9, kwFilter: 6, kwNum: 63, shiftDir: 13, baseCorner: 9, shiftN: 63, shiftM: 63, pickPattern: 17, symMode: 3, symList: '!#$%&()*', symFbDir: 10, symFbDist: 39, symFbCorner: 4, preTarget: 7, prePattern: 13, preOffset: 63, sufTarget: 7, sufPattern: 13, sufOffset: 63, ancTile: 39, ancMode: 6, lenMode: 5, lenVal: 128, ancPos: 63, postMode: 4 };
  const unMax = V6.tryUnpack(V6.pack(maxCfg, true, '&'.repeat(16)));
  check('roundtrip max-range cfg + 16-char seed', !!unMax && unMax.seedText === '&'.repeat(16) && cfgEq(unMax.cfg, normCfg(maxCfg)));
  const minCfg = { kwOrder: 0, kwFilter: 0, kwNum: 1, shiftDir: 0, baseCorner: 0, shiftN: 0, shiftM: 0, pickPattern: 0, symMode: 0, symList: '', symFbDir: 0, symFbDist: 1, symFbCorner: 0, preTarget: 0, prePattern: 0, preOffset: 0, sufTarget: 0, sufPattern: 0, sufOffset: 0, ancTile: 0, ancMode: 0, lenMode: 0, lenVal: 1, ancPos: 0, postMode: 0 };
  const unMin = V6.tryUnpack(V6.pack(minCfg, true, 'a'));
  check('roundtrip min-range cfg + 1-char seed', !!unMin && unMin.seedText === 'a' && cfgEq(unMin.cfg, normCfg(minCfg)));

  check('canPack rejects 17-char seed', !V6.canPack(baseCfg, 'a'.repeat(17)));
  check('canPack rejects char outside charset (@)', !V6.canPack(baseCfg, 'abc@def1'));
  check('canPack rejects multibyte char', !V6.canPack(baseCfg, 'abcあdef1'));
  check('canPack rejects all-digit seed (numeric path)', !V6.canPack(baseCfg, '123456'));
  check('canPack rejects empty seed', !V6.canPack(baseCfg, ''));
  check('canPack rejects 9-symbol recipe (no truncation)', !V6.canPack({ ...baseCfg, symList: '!#$%&()*+-' }, 'aB3-xY9zQwEr'));
  check('canPack accepts 8-symbol recipe', V6.canPack({ ...baseCfg, symList: '!#$%&()*' }, 'aB3-xY9zQwEr'));
  check('canPack rejects out-of-range kwNum=64', !V6.canPack({ ...baseCfg, kwNum: 64 }, 'aB3-xY9zQwEr'));
  check('canPack rejects out-of-range lenVal=129', !V6.canPack({ ...baseCfg, lenVal: 129 }, 'aB3-xY9zQwEr'));
  check('canPack rejects out-of-range ancTile=40', !V6.canPack({ ...baseCfg, ancTile: 40 }, 'aB3-xY9zQwEr'));
  // 記号の重複は現行マスクと同じく実効集合として扱う（'-' を2回書いても1種）
  check('canPack dedupes repeated symbols like legacy mask', V6.canPack({ ...baseCfg, symList: '--------' }, 'aB3-xY9zQwEr'));
}

// ===== 条件3: 版6の識別と改ざん検出 =====
{
  const packed = V6.pack(baseCfg, true, 'aB3-xY9zQwEr');
  check('isV6 detects own output', V6.isV6(packed));
  // 予約ビット・版・フラグの改変はすべて棄却されること
  let tamperAccepted = 0;
  for (let bit = 0; bit < 8; bit++) {
    const t = new Uint8Array(packed);
    t[2] ^= (1 << bit);
    if (V6.tryUnpack(t) !== null) tamperAccepted++;
  }
  eq('byte2 any single-bit flip is rejected', tamperAccepted, 0);
  // マジック改変
  const t0 = new Uint8Array(packed); t0[0] ^= 1;
  eq('magic tamper rejected', V6.tryUnpack(t0), null);
  // 乱数データは版6と誤認しない
  let rngState = 246813579;
  const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let falsePos = 0;
  for (let i = 0; i < 5000; i++) {
    const b = new Uint8Array(32);
    for (let j = 0; j < 32; j++) b[j] = Math.floor(rnd() * 256);
    if (V6.tryUnpack(b) !== null) falsePos++;
  }
  eq('random garbage never validates as v6 (5000 samples)', falsePos, 0);
  // 署名だけ合わせた乱数も、値域検証でほぼ必ず落ちる。落ちなかった場合は
  // pack で再符号化して完全一致すること（正準形）を確認する。
  let nonCanonical = 0, accepted = 0;
  for (let i = 0; i < 20000; i++) {
    const b = new Uint8Array(32);
    for (let j = 0; j < 32; j++) b[j] = Math.floor(rnd() * 256);
    b[0] = 0x43; b[1] = 0x4D; b[2] = (6 << 4) | (b[2] & 0x0F);
    const d = V6.tryUnpack(b);
    if (d) {
      accepted++;
      const re = V6.pack(d.cfg, d.includeCardSeed, d.seedText);
      if (JSON.stringify([...re]) !== JSON.stringify([...b])) nonCanonical++;
    }
  }
  eq('any v6-accepted data is canonical (re-pack identical)', nonCanonical, 0);
  console.log('  (info) signature-forced random data accepted as v6: ' + accepted + ' / 20000');
}

console.log('---');
console.log('recipe-v6: pass=' + pass + ' fail=' + fail);
process.exitCode = fail ? 1 : 0;
