// 盤面生成ガード: 数字シードの盤面（全40マス×5要素）が、オリジナル単体版
// 「Crypto Matrix .html」の生成ロジックと完全一致し続けることを固定する。
// 期待ダイジェストはオリジナル側ロジックから生成した値で、本体の生成処理
// （LCG・シード解釈・文字プール・シャッフル順序）のいずれが変わっても落ちる。
// 2026-11-09 の固定記号混入（末尾4マスの中央記号が全シードで固定値になった）の再発防止。
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
w.eval(segment + '\n;window.__getMatrixData = function(){ return currentMatrixData; }; window.__updateMainMatrix = updateMainMatrix;');
if (w.eval('typeof updateVerbalGuide') !== 'function') w.eval('function updateVerbalGuide(){}');
if (w.eval('typeof getRecipeConfig') !== 'function') w.eval('function getRecipeConfig(){ return {}; }');

function boardString(seed) {
  w.__updateMainMatrix(seed);
  const md = w.__getMatrixData();
  if (!Array.isArray(md) || md.length !== 40) throw new Error('matrix data must have 40 tiles');
  return md.map(t => [t.center, t.tl, t.tr, t.bl, t.br].join('/')).join(' ');
}
function boardDigest(seed) {
  return crypto.createHash('sha256').update(boardString(seed)).digest('hex');
}
function centers(seed) {
  w.__updateMainMatrix(seed);
  return w.__getMatrixData().map(t => t.center);
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : ' => got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected)));
  if (ok) pass++; else fail++;
}

// 抽出の健全性: 取り出した範囲が盤面生成の本体（LCG・updateMainMatrix・
// CENTER_CHARS 同期）を含んでいることを確認する。将来のコード移動で抽出が
// ずれた場合は、盤面の不一致ではなくこの項目で理由つきで落ちる。
check('extraction includes LCG constants', segment.includes('1664525') && segment.includes('1013904223') && segment.includes('4294967296'), true);
check('extraction includes updateMainMatrix and CENTER_CHARS sync', segment.includes('function updateMainMatrix') && segment.includes('CENTER_CHARS.splice'), true);

// オリジナル単体版ロジックから生成した期待値（seed -> 盤面全体の SHA-256）
const EXPECTED = {
  '0': 'a2124f752e28c4952cdd398cd926968c67f8760f196829ed588ee225c6e609f8',
  '1': '76fb1bdf7f8eb2b48333250a7b74c79310f4f088e18e33133b5100cfb1e4ff5e',
  '7': '77d228e8afe84e06cb7f675de2d9e1678a0d9bd47448925b3576e0c7048ed1c5',
  '42': '751d31d70bad31296286001275949b5d28763924895a4ef53b7250a2311d9484',
  '100': '5505671a9d273538138c4d8be31908f60d1b6a967efe6c3042b08dc5f3247d71',
  '1234567890': '34c322c717d88ff4e55e6849dff10189caff5401900096cc2091381724498e2d',
  '9999999999': '8400c77a2b12bbfcf897dd0325dac388d4e4c20a903417fee7dc3999c1ffb898',
  '4294967295': '9ffce501c83f9a1a417ecfce1b1d9ff13e6b80d8f17afa250835fe5f61d3e3b3',
  '4294967296': 'a2124f752e28c4952cdd398cd926968c67f8760f196829ed588ee225c6e609f8',
  '4294967297': '76fb1bdf7f8eb2b48333250a7b74c79310f4f088e18e33133b5100cfb1e4ff5e',
  '20261109': 'f39b6821f7bef3a2fd0805d8e215ffc99f24c8821630cb21f18814879fbdddab',
  '777777777777': '639971629bd39fde891513bc92b67fcf2303f3f82464cfe582788ed49df3a739'
};

for (const [seed, digest] of Object.entries(EXPECTED)) {
  check('board digest seed=' + seed, boardDigest(seed), digest);
}

// 数値で渡しても同じ盤面（呼び出し側は文字列・数値の両方がある）
check('board digest seed=42 (number input)', boardDigest(42), EXPECTED['42']);
check('board digest seed=0 (number input)', boardDigest(0), EXPECTED['0']);

// 末尾4マスの中央記号はシードごとに変わる（固定値混入の直接ガード）
check('seed 0 centers[36..39]', centers('0').slice(36, 40).join(' '), '- _ % ^');
check('seed 1 centers[36..39]', centers('1').slice(36, 40).join(' '), '_ & * )');
check('centers[36..39] differ across seeds', new Set([centers('0').slice(36, 40).join(''), centers('1').slice(36, 40).join(''), centers('7').slice(36, 40).join('')]).size, 3);

// 中央マスの並びは 0-9, a-z + 記号4つ（rootCharacters の構造）
check('seed 0 centers[0..35] are 0-9a-z in order', centers('0').slice(0, 36).join(''), '0123456789abcdefghijklmnopqrstuvwxyz');

// 記号選抜の構造（固定化の再発防止）: 末尾4記号は13種の記号プールから
// 重複なく4つ選ばれ、組み合わせはシードごとに変わる。
// ダイジェスト照合が「盤面全体の一致」を見るのに対し、こちらは
// 「記号の選び方そのもの」が壊れていないかを理由つきで示す。
const SYMBOL_POOL = ['-', '_', '!', '#', '$', '%', '&', '^', '(', ')', '+', '*', '/'];
const tails = [];
for (let s = 0; s < 20; s++) {
  const tail = centers(String(s)).slice(36, 40);
  tails.push(tail.join(''));
  check('seed ' + s + ' tail symbols are 4 distinct picks from the 13-symbol pool',
    tail.length === 4 && new Set(tail).size === 4 && tail.every(c => SYMBOL_POOL.includes(c)), true);
}
check('tail symbol combinations vary by seed (>=15 distinct in 20 seeds)', new Set(tails).size >= 15, true);
check('tail symbols cover the pool broadly (>=10 of 13 in 20 seeds)', new Set(tails.join('').split('')).size >= 10, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
