// 新規ユーザー向け盤面仕様: 英字を含む英数字シードのときだけ、末尾4マスの
// 中央記号を「. / - _」に固定し、左下の記号プールにも '.' を加える。
// 数字のみのシード（既存ユーザー・物理カード）の盤面は一切変わらないことも
// あわせて固定する（matrix-board-guard.test.js と対で運用する）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const src = fs.readFileSync(path.join(ROOT, 'contents', 'index.js'), 'utf8');
const bqSrc = fs.readFileSync(path.join(ROOT, 'contents', 'backup-qr.js'), 'utf8');

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

function board(seed) {
  w.__updateMainMatrix(seed);
  return w.__getMatrixData();
}
function boardDigest(seed) {
  const md = board(seed);
  return crypto.createHash('sha256').update(md.map(t => [t.center, t.tl, t.tr, t.bl, t.br].join('/')).join(' ')).digest('hex');
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : ' => got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected)));
  if (ok) pass++; else fail++;
}

// 抽出の健全性（ガードテストと共通）: 取り出した範囲が盤面生成の本体を
// 含んでいることを確認し、抽出ずれは理由つきで落とす。
check('extraction includes LCG constants', segment.includes('1664525') && segment.includes('1013904223') && segment.includes('4294967296'), true);
check('extraction includes updateMainMatrix and CENTER_CHARS sync', segment.includes('function updateMainMatrix') && segment.includes('CENTER_CHARS.splice'), true);

// 1. 英字を含む英数字シード: 末尾4マスの中央記号が「. / - _」固定
for (const s of ['abc123', 'MySeed2026', 'seedA', 'a']) {
  check('letter seed ' + JSON.stringify(s) + ' centers[36..39]', board(s).slice(36, 40).map(t => t.center).join(' '), '. / - _');
}
// 中央マスの先頭36は従来どおり 0-9, a-z
check('letter seed centers[0..35] unchanged', board('abc123').slice(0, 36).map(t => t.center).join(''), '0123456789abcdefghijklmnopqrstuvwxyz');
// 右下プール（中央と同じ40文字）には '.' が必ず現れる
for (const s of ['abc123', 'MySeed2026', 'seedA', 'a']) {
  check('letter seed ' + JSON.stringify(s) + ' dot in bottom-right', board(s).some(t => t.br === '.'), true);
}
// 左下プールにも '.' が加わる（盤面に現れるシードで確認）
for (const s of ['abc123', 'MySeed2026', 'a']) {
  check('letter seed ' + JSON.stringify(s) + ' dot in bottom-left', board(s).some(t => t.bl === '.'), true);
}
// 新仕様の盤面をダイジェストで固定する
check('letter seed abc123 board digest (new spec)', boardDigest('abc123'), '33fdd1296ab23d30814f7b8f586af5a9009fa35ed36a4d82135e451337ed3d27');
check('letter seed MySeed2026 board digest (new spec)', boardDigest('MySeed2026'), '74c7e426cc159293f7bdd28416dcd2451ea9561b88144b144481567adca481b3');
// 従来の英字シード盤面（ランダム記号）とは変わっている
check('letter seed abc123 differs from legacy board', boardDigest('abc123') !== '9c26592e5ef59d17af0631f600cf73df87c8d644376c5d2cc3a41410341f29d3', true);

// 大文字小文字の扱い（明示的に固定）: 区別する。大小が違えば別のシードとして
// 別の盤面になり、それぞれ再現性がある（ダイジェストで固定）。
check('case sensitivity: ABC123 board digest', boardDigest('ABC123'), 'b8295ee8548a00c05bf69f5efe99daeffec2704c13cb060e34da0899cb35529d');
check('case sensitivity: Abc123 board digest', boardDigest('Abc123'), 'bd5ea60e94962b3ecc57eedcdc0d610c91c7cdeb835f7b0c3b4a4015f8440035');
check('case sensitivity: ABC123 differs from abc123', boardDigest('ABC123') !== boardDigest('abc123'), true);
check('case sensitivity: Abc123 differs from abc123', boardDigest('Abc123') !== boardDigest('abc123'), true);
check('case variants also get fixed tail symbols', board('ABC123').slice(36, 40).map(t => t.center).join(' '), '. / - _');

// 2. 対象外の入力は従来どおり（ダイジェストは従来仕様の値）
// 数字のみのシード（文字列・2^32超を含む）
check('numeric seed 42 board unchanged', boardDigest('42'), '751d31d70bad31296286001275949b5d28763924895a4ef53b7250a2311d9484');
check('numeric seed 9999999999 board unchanged', boardDigest('9999999999'), '8400c77a2b12bbfcf897dd0325dac388d4e4c20a903417fee7dc3999c1ffb898');
check('numeric seed 123 board unchanged', boardDigest('123'), '30ea032697dbb53179475b0620700195c852cd5340ba6d5f13e9c5d9f8732398');
// 英数字でない文字列（空白を含む）は対象外
check('non-alphanumeric seed "hello world" board unchanged', boardDigest('hello world'), '0b8579d67e1358db4a2cddf8a8054251f4ebea1fc3311c1c01567f91d0020a61');

// 3. 復元経路の契約: 保存済み状態の復元では、数値化された seed ではなく
//    入力文字列（seedInput）を優先して盤面を再生成する（表示と復元の一致）
check('index.js restoreUI prefers seedInput', src.includes("updateMainMatrix((s.seedInput !== undefined && s.seedInput !== '') ? s.seedInput : s.seed)"), true);
check('backup-qr.js restore prefers seedInput', bqSrc.includes("updateMainMatrix((old.seedInput !== undefined && old.seedInput !== '') ? old.seedInput : old.seed)"), true);
// 分岐は updateMainMatrix 内の英字シード判定に閉じている
check('letter-seed branch exists in updateMainMatrix', segment.includes('isLetterSeed') && segment.includes("['.', '/', '-', '_']"), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
