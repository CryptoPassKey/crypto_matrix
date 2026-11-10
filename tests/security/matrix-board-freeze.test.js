'use strict';
/*
 * 盤面生成の永久固定ガード（2026-11-10 ユーザー決定）。
 *
 * PR-2（盤面 v2）の完了時点で、盤面生成は数字シード（v1: LCG 経路）と
 * 英数字シード（v2: SHA-256 経路）の両系統とも永久に固定される。
 * このテストが失敗したら、期待値を更新して通してはいけない。盤面生成に
 * 触れる変更は、ユーザーの明示的な再決定がある場合にだけ行うこと。
 *
 * 二重の固定:
 *  1. 振る舞い固定: 代表シード24件（境界値・符号・空白・衝突ペア・記号・
 *     日本語・長尺を含む）の盤面ダイジェストが凍結値と一致すること。
 *  2. ソース固定: 盤面生成に係るソース断片（parseSeedValue /
 *     updateMainMatrix / seed-key の経路判定部 / board-v2.js 全文）の
 *     ハッシュが凍結値と一致すること。標本化した振る舞いでは捉えきれない
 *     変更も、ソースが1文字でも変われば検出する。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + a + ' expected ' + b); }

function spanTrim(src, marker) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.trimStart().startsWith(marker));
  if (i < 0) throw new Error('marker missing: ' + marker);
  let depth = 0, started = false;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth === 0) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('no close: ' + marker);
}

// ===== 1. 振る舞い固定（盤面ダイジェスト） =====
const BOARD_DIGESTS = [
  // v1: 数字シード（物理カード互換の系統）
  ['0', 'd65795a43ed98a1247a0d4571c6afac2e9e187b240366eb3552f24ec5dde9fb7'],
  ['1', 'f8fd2d0e6699cffd6f930333ca801619312368ae822d57c7142a0d9aa3c22a46'],
  ['42', 'aca5abfa75da88323bf62747ffad4090d460fcfb2781f1323c3e79288215a287'],
  ['424242', '154434bb5f8a6b81e7f448a7f8eba3b59b4fc88146c93cbbfdfe113f70ebbfe2'],
  ['1234567890', '384c8e9493a4f208991ba827110389cd34976b4f4cab7282ec84b2aad41da0fa'],
  ['9999999999', 'c696fc8b7aa9b743dfca9494be6dcf5debd3de80670b52e9696fb2ca4f34f10b'],
  ['4294967295', 'ec408a4891daf27ce761b733b7cbb04137052f5f861a5e06fc26de898120903c'],
  ['4294967296', 'd65795a43ed98a1247a0d4571c6afac2e9e187b240366eb3552f24ec5dde9fb7'],
  ['007', '7742543651f42f4071dccfd052eee1c1a9a66166a34e883e25949dd04c123c6a'],
  ['-42', 'd0979ed9aa763df917c96c7753df6d25724bbf31e28634a20bd4174965741587'],
  ['+42', 'aca5abfa75da88323bf62747ffad4090d460fcfb2781f1323c3e79288215a287'],
  [' 42 ', 'aca5abfa75da88323bf62747ffad4090d460fcfb2781f1323c3e79288215a287'],
  // v2: 英数字・記号シード（SHA-256 経路）
  ['abc123', 'c1881d88b6e103f64c47d314b2afde6c9142a8a8fc1664abfbcacb600e9f8905'],
  ['Abc123', 'f0d5168b638061de383f6fa06b5f7ebb66a366a641eea88a19560fd4d661c827'],
  ['ABC123', '043d9c7528944f32aca3af2d2c4365cc9d0e895ddfdd98910659be195a274d70'],
  ['aB3-xY9zQwEr', '5b19c798323b90189c423d32df271194609bb8b096329dc6460bfc91b2ee8987'],
  ['urnUkFZe', '7fb4c8f849646984bdb6be2580cb9b3824cbf1d7080f601101c25d46e0d7f764'],
  ['Zac6VKdc', '0257ee834257846281d60ef5a05443669c75ca26b2186c39c773ea7a88bc5a7d'],
  ['....', 'ee8f90797b50f1cd55a83aabe1de245357d7f052e36bcdb64c96bb84f69cc8dc'],
  ['!#$%&()*+-', '74bd8cdffd8e4cd2f0d826afda7e566dcc559df5675ec62d2cf8da64c10a13bb'],
  ['ab cd', 'f1f0bd196ba5663a0c13a8bfa73c1a36fb63741540824ad99f24786e5f38e433'],
  ['あいうえお', '9da0b06a2fefd4f36bb4e0f3564163f654990bf9b766442e51b7d93c394462f1'],
  ['p@ssw0rd!', 'dafdc7ed4e574c2381ee36c2d226c9bc99e8314699c90e4be1827145a361b5c2'],
  ['Ab3dF6hJ9kM2nP5qR8sT4vW7xY0zA1bC4eG7hK9mN2pQ5rS8uV1wX4yB6dE9gH0j', '80ad73cd25dca0217c4cc4621be6363ac61a44655bcba6220a1a1f9a488a9a69'],
];

// ===== 2. ソース固定 =====
const SOURCE_HASHES = [
  ['index.js parseSeedValue', () => sha(spanTrim(fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8'), 'function parseSeedValue(')), '905cc2360546a09eb07dd3a2a93c74f6242eba7a4b6b6aab266ae73ff72d9359'],
  ['index.js updateMainMatrix', () => sha(spanTrim(fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8'), 'function updateMainMatrix(')), 'cea596a5e0372e6108805d208d59b73852abffe7f85982552c11bf50af959bd0'],
  ['seed-key.js route classification (trimSeed..classify)', () => {
    const sk = fs.readFileSync(path.join(CONTENTS, 'seed-key.js'), 'utf8');
    const lines = sk.split('\n');
    const startLine = lines.find(l => l.trimStart().startsWith('function trimSeed('));
    const classSpan = spanTrim(sk, 'function classify(');
    return sha(sk.slice(sk.indexOf(startLine), sk.indexOf(classSpan) + classSpan.length));
  }, '2a10e98178903965133e6c66a0488f4628ddc0b48365191cf8070ebfd793d472'],
  ['board-v2.js (whole file)', () => sha(fs.readFileSync(path.join(CONTENTS, 'board-v2.js'), 'utf8')), '8b4efd1ae91eebe7bae3b836413dcbd1befa07965445983d7856b9f20bfb5c57'],
];

(async () => {
  const w = await loadApp(CONTENTS);
  check('freeze table is non-empty', BOARD_DIGESTS.length === 24, 'count=' + BOARD_DIGESTS.length);
  for (const [seed, expected] of BOARD_DIGESTS) {
    w.updateMainMatrix(seed);
    const digest = sha(w.eval('JSON.stringify(currentMatrixData)'));
    eq('frozen board ' + JSON.stringify(seed), digest, expected);
  }
  for (const [name, compute, expected] of SOURCE_HASHES) {
    let actual;
    try { actual = compute(); } catch (e) { actual = 'ERROR: ' + e.message; }
    eq('frozen source ' + name, actual, expected);
  }
  console.log('---');
  console.log('matrix-board-freeze: pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('ERROR:', e && e.stack || e);
  process.exitCode = 1;
});
