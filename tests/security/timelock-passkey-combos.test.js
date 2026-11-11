/**
 * TimeLock passkey combo consistency — regression tests.
 *
 * Combo definitions (timelock.js comboLabelTL):
 *   0 = password only        4 = keyfile only
 *   1 = password + keyfile   5 = passkey only
 *   2 = password + passkey   6 = keyfile + passkey
 *   3 = password + keyfile + passkey
 * So the passkey combos are exactly {2, 3, 5, 6}. Every code path that
 * derives "needs a passkey" from a combo value — creation-side recovery
 * guide, in-app decrypt, in-app restore check, the standalone recovery
 * tool, and the CME body parsers — must agree on that set. A divergence
 * makes the recovery guide omit the same-domain note (WebAuthn PRF is
 * domain-bound) for passkey-only / keyfile+passkey capsules and wrongly
 * present the standalone tool as an equivalent path.
 *
 * Run: node tests/security/timelock-passkey-combos.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTENTS = path.join(ROOT, 'contents');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name); }
}

const EXPECTED = [2, 3, 5, 6];

// Parse the combo set out of one assignment's right-hand side. Supports
// both "(combo === 2 || combo === 3)" chains and "[2, 3].includes(combo)".
function parseComboSet(rhs) {
  const inc = rhs.match(/\[(\d+(?:\s*,\s*\d+)*)\]\s*\.includes\(/);
  if (inc) return inc[1].split(',').map((s) => Number(s.trim())).sort((a, b) => a - b);
  const nums = [...rhs.matchAll(/combo\s*===\s*(\d+)/g)].map((mm) => Number(mm[1]));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function findPasskeyAssignments(relPath) {
  const src = fs.readFileSync(path.join(CONTENTS, relPath), 'utf8');
  const re = /(?:usesPasskey|needPasskey|needPk)\s*=\s*([^;]+);/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push({ rhs: m[1], set: parseComboSet(m[1]) });
  return { src, out };
}

const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log('TimeLock passkey combo consistency');

const tl = findPasskeyAssignments('timelock.js');
check('timelock.js: 3 passkey assignments found (decrypt / guide / restore check)', tl.out.length === 3);
tl.out.forEach((a, i) => check(`timelock.js assignment #${i + 1} set == {2,3,5,6} (got {${a.set.join(',')}})`, sameSet(a.set, EXPECTED)));

const rec = findPasskeyAssignments('timelock-recover.js');
check('timelock-recover.js: 1 passkey assignment found', rec.out.length === 1);
rec.out.forEach((a, i) => check(`timelock-recover.js assignment #${i + 1} set == {2,3,5,6} (got {${a.set.join(',')}})`, sameSet(a.set, EXPECTED)));

const idx = findPasskeyAssignments('index.js');
check('index.js: 2 passkey assignments found (CME v3 / v2 body parsers)', idx.out.length === 2);
idx.out.forEach((a, i) => check(`index.js assignment #${i + 1} set == {2,3,5,6} (got {${a.set.join(',')}})`, sameSet(a.set, EXPECTED)));

// Ground truth: the combo labels themselves define 5 and 6 as passkey combos.
check('combo 5 label is passkey-only', tl.src.includes("combo === 5) return 'パスキー単独"));
check('combo 6 label is keyfile + passkey', tl.src.includes("combo === 6) return 'キーファイル ＋ パスキー"));

// Behavioural check of the recovery-guide condition: evaluate the actual
// expression from the source for every combo in both modes.
const guideAssign = tl.out.find((a) => a.rhs.includes("m.mode === 'B'") || a.rhs.includes('m.mode==="B"'));
check('recovery guide usesPasskey assignment located', !!guideAssign);
if (guideAssign) {
  const fn = new Function('m', `'use strict'; return (${guideAssign.rhs});`);
  const expectedB = { 0: false, 1: false, 2: true, 3: true, 4: false, 5: true, 6: true };
  for (let combo = 0; combo <= 6; combo++) {
    check(`guide usesPasskey mode=B combo=${combo} -> ${expectedB[combo]}`, fn({ mode: 'B', combo }) === expectedB[combo]);
    check(`guide usesPasskey mode=A combo=${combo} -> false`, fn({ mode: 'A', combo }) === false);
  }
  // Both guide branches must exist, otherwise the condition selects nothing.
  check('guide contains the same-domain note for passkey capsules', tl.src.includes('作成時と同一のドメイン上で開いてください'));
  check('guide contains the standalone-tool line for non-passkey capsules', tl.src.includes('timelock-recover'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
