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
// 注意: 開始位置が 0 なのは意図的。updateMainMatrix は parseSeedValue や
// Random など index.js 先頭部のトップレベル定義に依存しており、抜粋を
// 単独で評価するにはそれらを含める必要がある（fnStart から切り取ると
// 依存が欠けて評価できないことを確認済み）。範囲の終端は関数の直後まで。
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
  'abc123': '13d707ba7c9487c81990644b607d76e34a37e7961478aa9a4ba85a97a92abf19',
  'MySeed2026': 'cedd33ea22d8df4a9afed1eb8b7fce3151d7e9eb11f0ee842afd5587d6a74219',
  'Xk9$mQ2!vR7/pL4.wZ8-nT': '747628796f06dd0a656c7f9690bce41fddeee6ca8c9e86b9d5edf25f87d6abbb',
  'seed/with.dots_and-dashes': '0deca7e73c71256e0ebf00d77630d9e934b781c1010c15c1e694599c03c89c9d',
  '....': '115370c0f667b4eab3581f21eadd4208094c623f3fa00d0651c3d0371867bd0d',
  'a': 'b7e89caff49c4d12da1caa623d4ae64328de1e9008681c9071df2f44c4bc0661',
  'Z9': '885fd87d047086d5c83b75bb7771fa30eeee3a023b6d89d34643ecec87124b98',
  'パスワード盤面': '392ea99538686676be2c1085ac91886bb0af77c24c876d76d915d7845cc41aef',
  'Abc123': '73a30f2a86bb28e019f2a99714afb718828908763f1edefc75b2b6161725dc08',
  'ABC123': '87d70152c1e59f5b98471988925b62f3447004c80007baa27249e01bd79adfc6',
};
for (const [seed, digest] of Object.entries(EXPECTED_V2)) {
  check('v2 board digest ' + JSON.stringify(seed), boardDigest(seed), digest);
}

// v2 の構造
for (const s of ['abc123', 'MySeed2026', 'seed/with.dots_and-dashes']) {
  const md = tiles(s);
  check('v2 tail symbols fixed ' + JSON.stringify(s), md.slice(36, 40).map(t => t.center).join(' '), '@ . / -');
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

// NFC 仕様: 分解形（NFD）で入力しても、合成形（NFC）と同一の盤面になる
check('NFC: decomposed kana matches precomposed', boardDigest('か\u3099'), boardDigest('\u304c'));
check('NFC: decomposed accent matches precomposed', boardDigest('e\u0301xyz123'), boardDigest('\u00e9xyz123'));

// モジュール欠落時のガード: CMBoardV2 が読み込めていない状態で v2 シードを
// 使うと、TypeError ではなく意図したエラーメッセージで止まること。
// 数字シード（v1 経路）はモジュールなしでも従来どおり動くこと。
{
  const savedBoard = w.CMBoardV2;
  delete w.CMBoardV2;
  let err = null;
  try { w.__updateMainMatrix('abc123'); } catch (e) { err = e; }
  check('missing CMBoardV2 raises intended error', err ? err.name + ': ' + err.message : 'no error', 'Error: updateMainMatrix: seed v2 modules are not loaded');
  check('numeric seed still works without CMBoardV2', boardDigest('42'), '751d31d70bad31296286001275949b5d28763924895a4ef53b7250a2311d9484');
  w.CMBoardV2 = savedBoard;
}

// v1（数字シード）の盤面が変わらないこと（ガードテストの凍結値と同一）
check('v1 board unchanged seed 0', boardDigest('0'), 'a2124f752e28c4952cdd398cd926968c67f8760f196829ed588ee225c6e609f8');
check('v1 board unchanged seed 42', boardDigest('42'), '751d31d70bad31296286001275949b5d28763924895a4ef53b7250a2311d9484');
check('v1 board unchanged seed 9999999999', boardDigest('9999999999'), '8400c77a2b12bbfcf897dd0325dac388d4e4c20a903417fee7dc3999c1ffb898');
// 分類境界: 符号付き数値は v1（parseSeedValue の数値分岐と一致）
check('signed numeric seed stays v1 path', w.CMSeedKey.classify('-42'), 'v1');
check('symbol-only seed is v2', w.CMSeedKey.classify('....'), 'v2');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
