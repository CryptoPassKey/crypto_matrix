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
 *  1. 振る舞い固定: 代表シード26件（境界値・符号・空白・衝突ペア・記号・
 *     日本語・NFC/NFD 同値ペア・長尺を含む）の盤面ダイジェストが凍結値と一致すること。
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
  ['abc123', '20220db91a5b149544cd684c9ee45a5d952c8bb76fbfba187e25157a373e63bf'],
  ['Abc123', 'f1d9d89351b3eb57adbf23458d94fb1eddddfd5d1bffa78c17cd0b5c0d886bcd'],
  ['ABC123', '0fd60fc5b620af8356bd77746126cba960fc5421061b01f4beba4b407f84d4cb'],
  ['aB3-xY9zQwEr', '58d0392e4087fc623ad6872d174369f5dd78d2e7b622b071bdb53cf26e0ce5b8'],
  ['urnUkFZe', '9ee5ab8a8c6e725fa9e5e3d58763017d3bd61d4530bce23e4b7e519303cf40ce'],
  ['Zac6VKdc', 'b25add85d6c316cf782b4b916486ca9ce687e67b0be4af5fd8a0be6d87afe2af'],
  ['....', '22e9deaf8e1f1fea0ece156712e9573ce52fe71881189938a95167569cad637c'],
  ['!#$%&()*+-', '7187605ed23b7e26c6586dcc78dd09c78eefa23c7bb43efc92bd2768f9e755d2'],
  ['ab cd', '0d3a32f166921df7b01255a7a9570380a042959f8202d957383dfd0462c94c45'],
  ['あいうえお', '498df66653931efc233cb6b86e8f13b7c202bcb5ddfd054d6abd0ae2c48420b1'],
  ['\u304c', '7e7969021913a84a5d531a0ae1c0b8560677d37ad3c58d07581f8100f1d3982a'],
  ['\u304b\u3099', '7e7969021913a84a5d531a0ae1c0b8560677d37ad3c58d07581f8100f1d3982a'],
  ['p@ssw0rd!', 'fb6abbc36f61c17aa6e80a66d3a27b3fd10abc503caafc083107708ca19d75f6'],
  ['Ab3dF6hJ9kM2nP5qR8sT4vW7xY0zA1bC4eG7hK9mN2pQ5rS8uV1wX4yB6dE9gH0j', '7e72fa7869358ffd35ff3ecdfb2f93ee11c9e8e4e0c6e85cf083e86322ec1eb4'],
];

// ===== 2. ソース固定 =====
const SOURCE_HASHES = [
  ['index.js parseSeedValue', () => sha(spanTrim(fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8'), 'function parseSeedValue(')), '905cc2360546a09eb07dd3a2a93c74f6242eba7a4b6b6aab266ae73ff72d9359'],
  ['index.js updateMainMatrix', () => sha(spanTrim(fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8'), 'function updateMainMatrix(')), '9206c764989f988b97dd818d6c3a4e868b239ff7065e34b04b9affa958d8d2c2'],
  ['seed-key.js route classification (trimSeed..classify)', () => {
    const sk = fs.readFileSync(path.join(CONTENTS, 'seed-key.js'), 'utf8');
    const lines = sk.split('\n');
    const startLine = lines.find(l => l.trimStart().startsWith('function trimSeed('));
    const classSpan = spanTrim(sk, 'function classify(');
    return sha(sk.slice(sk.indexOf(startLine), sk.indexOf(classSpan) + classSpan.length));
  }, '2a10e98178903965133e6c66a0488f4628ddc0b48365191cf8070ebfd793d472'],
  ['board-v2.js (whole file)', () => sha(fs.readFileSync(path.join(CONTENTS, 'board-v2.js'), 'utf8')), '05b078410d608d687c56a4263feac7a651365fa230c23ed1ebc31e697c2b52ef'],
];

(async () => {
  const w = await loadApp(CONTENTS);
  check('freeze table is non-empty', BOARD_DIGESTS.length === 26, 'count=' + BOARD_DIGESTS.length);
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
