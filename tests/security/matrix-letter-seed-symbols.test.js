// 新規ユーザー向け盤面仕様（v2 世代）: 文字列シード（数字のみでないシード）は
// v2 盤面（SHA-256 キーストリーム駆動）になり、末尾4マスの中央記号は
// 「@ . / -」固定、左下の記号プールには '.' が加わる。
// v2 盤面の正確なダイジェストは matrix-board-v2.test.js が参照実装の凍結値で
// 固定する。本ファイルは盤面の構成規則（固定記号・プール・大小区別）と、
// 数字のみのシード（既存ユーザー・物理カード）の盤面が一切変わらないこと、
// 復元経路の契約、シード入力欄の属性を固定する。
// （旧版は PR #155 の暫定仕様＝LCG 駆動の英字盤面を固定していた。v2 導入に
//   ともない盤面駆動が変わるため、凍結ダイジェストは board-v2 側へ移管した。）
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
if (!w.TextEncoder) w.TextEncoder = TextEncoder;
// 本番の読み込み順どおり: vendor/js-sha256 → seed-key → board-v2 → index.js 抜粋
w.eval(fs.readFileSync(path.join(ROOT, 'contents', 'vendor', 'js-sha256.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'contents', 'seed-key.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'contents', 'board-v2.js'), 'utf8'));
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

// 1. 英字を含む英数字シード: 末尾4マスの中央記号が「@ . / -」固定
for (const s of ['abc123', 'MySeed2026', 'seedA', 'a']) {
  check('letter seed ' + JSON.stringify(s) + ' centers[36..39]', board(s).slice(36, 40).map(t => t.center).join(' '), '@ . / -');
}
// 中央マスの先頭36は従来どおり 0-9, a-z
check('letter seed centers[0..35] unchanged', board('abc123').slice(0, 36).map(t => t.center).join(''), '0123456789abcdefghijklmnopqrstuvwxyz');
// 右下プール（中央と同じ40文字）には '.' が必ず現れる
for (const s of ['abc123', 'MySeed2026', 'seedA', 'a']) {
  check('letter seed ' + JSON.stringify(s) + ' dot in bottom-right', board(s).some(t => t.br === '.'), true);
}
// 左下プールにも '.' が加わる。左下は76種プールから40マスを引くため、
// '.' が盤面に現れるかはシードごとの抽選で決まる（プール含有の確認として、
// 複数シードのうち一定数以上に現れることを固定する。数字シードでは現れない）
{
  let hits = 0;
  const seeds = [];
  for (let i = 0; i < 40; i++) seeds.push('v2seed' + i);
  for (const s of seeds) if (board(s).some(t => t.bl === '.')) hits++;
  check('dot appears in bottom-left pool across 40 v2 seeds (>=5)', hits >= 5, true);
  check('dot never in bottom-left for numeric seed', board('424242').some(t => t.bl === '.'), false);
}
// v2 盤面は #155 暫定仕様（LCG 駆動）の英字盤面とは異なる（駆動方式の移行）。
// 正確な v2 ダイジェストの凍結は matrix-board-v2.test.js が担う。
check('letter seed abc123 differs from #155 interim board', boardDigest('abc123') !== '33fdd1296ab23d30814f7b8f586af5a9009fa35ed36a4d82135e451337ed3d27', true);

// 大文字小文字の扱い（明示的に固定）: 区別する。大小が違えば別のシードとして
// 別の盤面になる（v2 でも維持）。
check('case sensitivity: ABC123 differs from abc123', boardDigest('ABC123') !== boardDigest('abc123'), true);
check('case sensitivity: Abc123 differs from abc123', boardDigest('Abc123') !== boardDigest('abc123'), true);
check('case variants also get fixed tail symbols', board('ABC123').slice(36, 40).map(t => t.center).join(' '), '@ . / -');

// 2. 対象外の入力は従来どおり（ダイジェストは従来仕様の値）
// 数字のみのシード（文字列・2^32超を含む）
check('numeric seed 42 board unchanged', boardDigest('42'), '751d31d70bad31296286001275949b5d28763924895a4ef53b7250a2311d9484');
check('numeric seed 9999999999 board unchanged', boardDigest('9999999999'), '8400c77a2b12bbfcf897dd0325dac388d4e4c20a903417fee7dc3999c1ffb898');
check('numeric seed 123 board unchanged', boardDigest('123'), '30ea032697dbb53179475b0620700195c852cd5340ba6d5f13e9c5d9f8732398');
// 空白を含む文字列も v2 分類では文字列シードとして v2 盤面になる
// （#155 暫定仕様では対象外だった。v2 では分類が正規シードキーに一元化された）
check('string seed "hello world" gets v2 fixed tail symbols', board('hello world').slice(36, 40).map(t => t.center).join(' '), '@ . / -');
check('string seed "hello world" differs from legacy LCG board', boardDigest('hello world') !== '0b8579d67e1358db4a2cddf8a8054251f4ebea1fc3311c1c01567f91d0020a61', true);

// 3. 復元経路の契約: 保存済み状態の復元では、数値化された seed ではなく
//    入力文字列（seedInput）を優先して盤面を再生成する（表示と復元の一致）
check('index.js restoreUI prefers seedInput', src.includes("updateMainMatrix((s.seedInput !== undefined && s.seedInput !== '') ? s.seedInput : s.seed)"), true);
check('backup-qr.js restore prefers seedInput', bqSrc.includes("updateMainMatrix((old.seedInput !== undefined && old.seedInput !== '') ? old.seedInput : old.seed)"), true);
// 分岐は updateMainMatrix 内の v2 判定に閉じている
check('v2 branch exists in updateMainMatrix', segment.includes('CMBoardV2') && segment.includes("['@', '.', '/', '-']"), true);

// --- シード入力欄が英字を受け付けること（モバイルで数字キーボードに固定されない） ---
const seedInputEl = w.document.getElementById('input-seed-number');
check('seed input exists', !!seedInputEl, true);
check('seed input type stays text', seedInputEl && seedInputEl.getAttribute('type'), 'text');
check('seed input is not locked to numeric inputmode', seedInputEl?.getAttribute('inputmode'), null);
check('seed input autocapitalize is none', seedInputEl?.getAttribute('autocapitalize'), 'none');
check('seed input autocorrect is off', seedInputEl?.getAttribute('autocorrect'), 'off');
// 復元・アンロック系のシード欄も、自動変換で文字列が化けないことを保証する
for (const rid of ['bq-restore-seed-number', 'bv-restore-seed-number', 'tl-restore-seed-number', 'ts-unlock-seed-number']) {
  const el = w.document.getElementById(rid);
  check(rid + ' autocapitalize is none', el?.getAttribute('autocapitalize'), 'none');
  check(rid + ' autocorrect is off', el?.getAttribute('autocorrect'), 'off');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
