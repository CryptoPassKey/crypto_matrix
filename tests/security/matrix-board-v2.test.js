'use strict';
/*
 * 盤面生成 第2世代（v2）の固定テスト。
 * 設計: crypto_matrix_board_v2_design.md（2026-11-10 凍結）／必須条件2・3
 * - 期待ダイジェストは仕様からの独立参照実装（Node crypto 使用、本番の
 *   js-sha256 とは別実装）で生成して凍結した値。本番コードから作らない。
 * - v2 の構造（末尾固定記号・左下プール・分類境界）と、v1（数字シード）の
 *   盤面が本変更で一切変わらないことを併せて固定する。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const src = fs.readFileSync(path.join(ROOT, 'contents', 'index.js'), 'utf8');

const fnStart = src.indexOf('function updateMainMatrix');
if (fnStart < 0) { console.error('FAIL: updateMainMatrix not found in index.js (extraction target changed; update the test harness)'); process.exit(1); }
let fnEnd = src.indexOf('\nfunction ', fnStart);
if (fnEnd < 0) fnEnd = src.length;
const segment = src.slice(0, fnEnd);

const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
if (!w.TextEncoder) w.TextEncoder = TextEncoder;
// 本番の読み込み順どおり: vendor/js-sha256 → seed-key → board-v2 → index.js 抜粋
w.eval(fs.readFileSync(path.join(ROOT, 'contents', 'vendor', 'js-sha256.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'contents', 'seed-key.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'contents', 'board-v2.js'), 'utf8'));
w.eval(segment + '\n;window.__getMatrixData = function(){ return currentMatrixData; }; window.__updateMainMatrix = updateMainMatrix;');
if (w.eval('typeof updateVerbalGuide') !== 'function') w.eval('function updateVerbalGuide(){}');
if (w.eval('typeof getRecipeConfig') !== 'function') w.eval('function getRecipeConfig(){ return {}; }');

function boardString(seed) {
  w.__updateMainMatrix(seed);
  const md = w.__getMatrixData();
  if (!Array.isArray(md) || md.length !== 40) throw new Error('matrix data must have 40 tiles');
  return md.map(t => [t.center, t.tl, t.tr, t.bl, t.br].join('/')).join(' ');
}
function boardDigest(seed) { return crypto.createHash('sha256').update(boardString(seed)).digest('hex'); }
function tiles(seed) { w.__updateMainMatrix(seed); return w.__getMatrixData(); }

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : ' => got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected)));
  if (ok) pass++; else fail++;
}

check('v2 modules loaded', typeof w.CMSeedKey + '/' + typeof w.CMBoardV2, 'object/object');

// 参照実装から生成した固定ベクタ（仕様バージョン: CM-BOARD-V2）
const EXPECTED_V2 = {
  'abc123': 'ded0729b40aa29dcb2f4796d240cbc8d29ce8e81d55d085b7fba6485d7f8d086',
  'MySeed2026': 'b1a20a1e283fd94b08edcedc2ea84f75998e37b10b4e5c983b67c9e47d7cc309',
  'Xk9$mQ2!vR7/pL4.wZ8-nT': 'f212296ad3fb36cf0dcb4cfc62fd8d68e1aa21b961f532b3033fab26beb0d321',
  'seed/with.dots_and-dashes': '20b34b7ccbe499387676dcc790bf07b600c12a282b92aca25029175337d4a05c',
  '....': '6b2ff5cdff6a211ea9ef31675df3c0bc2b5f878bc90ddaa4f566027148d68ddb',
  'a': '5c1616a7bd889f892551fa21cddd41c955f49b8a53d52fd2c18e57cb31d43d24',
  'Z9': '67205779ec98f38c89bf5445d483f79d2040b3e45194dbf598bbf960cdb9d9ae',
  'パスワード盤面': '741005a30a661af1a5b5f266b3c26dca37d1ee8e962deeaaef82cdb70be110a8',
  'Abc123': 'da642718fb978b56771844d3dba5ab6fb2e5065944990534fbfadd6acba6b465',
  'ABC123': 'd68a700919c613591e60788c479f7c2d346793a2f5e751bf8887b7fc611c60cb',
};
for (const [seed, digest] of Object.entries(EXPECTED_V2)) {
  check('v2 board digest ' + JSON.stringify(seed), boardDigest(seed), digest);
}

// v2 の構造
for (const s of ['abc123', 'MySeed2026', 'seed/with.dots_and-dashes']) {
  const md = tiles(s);
  check('v2 tail symbols fixed ' + JSON.stringify(s), md.slice(36, 40).map(t => t.center).join(' '), '. / - _');
  check('v2 centers[0..35] are 0-9a-z in order ' + JSON.stringify(s), md.slice(0, 36).map(t => t.center).join(''), '0123456789abcdefghijklmnopqrstuvwxyz');
  const blPool = new Set(md.map(t => t.bl));
  check('v2 bl pool can contain dot ' + JSON.stringify(s), typeof blPool.has('.'), 'boolean'); // 存在可否は盤面依存のため型のみ（網羅は次項）
}
// 左下プールに '.' が含まれ得ること（複数シードの和集合で確認）
{
  const seen = new Set();
  for (const s of ['abc123', 'MySeed2026', 'Xk9$mQ2!vR7/pL4.wZ8-nT', 'seed/with.dots_and-dashes', 'a', 'Z9']) {
    for (const t of tiles(s)) seen.add(t.bl);
  }
  check('dot appears in bl across v2 seeds', seen.has('.'), true);
}
// 再現性と大小文字の区別
check('v2 board is reproducible', boardDigest('abc123'), boardDigest('abc123'));
check('v2 case matters (abc123 != Abc123)', boardDigest('abc123') !== boardDigest('Abc123'), true);
check('v2 case matters (Abc123 != ABC123)', boardDigest('Abc123') !== boardDigest('ABC123'), true);
// trim された入力は同じ盤面（正規化の一貫性）
check('v2 trimmed input reproduces same board', boardDigest(' abc123 '), boardDigest('abc123'));

// 32bit 衝突ペア: 数値化すると同じ値になる2つの文字列でも、v2 では盤面が異なる
// （v2 が解消する問題そのものの回帰ガード）。
check('collision pair shares parseSeedValue', w.parseSeedValue('urnUkFZe'), w.parseSeedValue('Zac6VKdc'));
check('collision pair differs on v2 board', boardDigest('urnUkFZe') !== boardDigest('Zac6VKdc'), true);

// v1（数字シード）の盤面が変わらないこと（ガードテストの凍結値と同一）
check('v1 board unchanged seed 0', boardDigest('0'), 'a2124f752e28c4952cdd398cd926968c67f8760f196829ed588ee225c6e609f8');
check('v1 board unchanged seed 42', boardDigest('42'), '751d31d70bad31296286001275949b5d28763924895a4ef53b7250a2311d9484');
check('v1 board unchanged seed 9999999999', boardDigest('9999999999'), '8400c77a2b12bbfcf897dd0325dac388d4e4c20a903417fee7dc3999c1ffb898');
// 分類境界: 符号付き数値は v1（parseSeedValue の数値分岐と一致）
check('signed numeric seed stays v1 path', w.CMSeedKey.classify('-42'), 'v1');
check('symbol-only seed is v2', w.CMSeedKey.classify('....'), 'v2');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
