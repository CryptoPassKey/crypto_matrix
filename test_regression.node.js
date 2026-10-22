const fs = require('fs');
const vm = require('vm');
const webcrypto = require('crypto').webcrypto;

let jsCode = fs.readFileSync('contents/index.js', 'utf8');

// DOM elements cache per ID for headless Node.js testing
const elementCache = new Map();
const getOrCreateElement = (id) => {
  if (!elementCache.has(id)) {
    elementCache.set(id, {
      id: id,
      value: '',
      innerHTML: '',
      textContent: '',
      dataset: {},
      style: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild: () => {}
    });
  }
  return elementCache.get(id);
};

const sandbox = {
  console: console,
  Uint8Array, Uint16Array, Uint32Array, Int32Array, BigInt, Math, Array, String, Number, Object, Error, TextEncoder, TextDecoder,
  crypto: webcrypto,
  globalThis: { crypto: webcrypto },
  window: { crypto: webcrypto, location: { hostname: 'localhost', href: 'http://localhost/', origin: 'http://localhost' } },
  navigator: { userAgent: 'node' },
  document: {
    addEventListener: () => {},
    getElementById: (id) => getOrCreateElement(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, dataset: {} }),
    body: { addEventListener: () => {}, style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } }
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};

sandbox.window.globalThis = sandbox.globalThis;
sandbox.globalThis.window = sandbox.window;

const indexScript = jsCode + `\n` + `
window.getCurrentMatrix = () => currentMatrixData;
window.getCurrentPw = () => currentGeneratedPassword;
window.getCurrentSteps = () => currentEvalSteps;
window.evaluateRecipeSteps = evaluateRecipeSteps;
window.updateMainMatrix = updateMainMatrix;
window.setRecipeConfig = setRecipeConfig;
window.getRecipeConfig = getRecipeConfig;
`;

vm.createContext(sandbox);
vm.runInContext(indexScript, sandbox);

console.log('====================================================');
console.log('Crypto Matrix Core Regression & Compatibility Suite');
console.log('====================================================');

// Test 1: Recipe Config DOM Cache & Roundtrip
console.log('\n[Test 1] Recipe Config DOM Cache & Roundtrip Verification');
sandbox.window.setRecipeConfig({
  kwOrder: 3,
  kwFilter: 1,
  kwNum: 6,
  shiftDir: 2,
  shiftN: 3,
  shiftM: 2,
  baseCorner: 1,
  pickPattern: 2,
  symMode: 0,
  symList: '',
  symFbDir: 0,
  symFbDist: 1,
  symFbCorner: 0,
  preTarget: 1,
  prePattern: 2,
  preOffset: 1,
  sufTarget: 2,
  sufPattern: 3,
  sufOffset: 2,
  ancTile: 5,
  ancMode: 1,
  ancPos: 4,
  postMode: 1,
  lenMode: 0,
  lenVal: 20
});

const retrievedCfg = sandbox.window.getRecipeConfig();
console.log('Retrieved Recipe Config kwOrder:', retrievedCfg.kwOrder, 'kwNum:', retrievedCfg.kwNum, 'shiftN:', retrievedCfg.shiftN);
if (retrievedCfg.kwOrder !== 3 || retrievedCfg.kwNum !== 6 || retrievedCfg.shiftN !== 3) {
  console.error('FAIL: Recipe config roundtrip failed');
  process.exit(1);
} else {
  console.log('PASS: Recipe config roundtrip test passed!');
}

// Test 2: Complete 40-Tile All-Corner LCG Matrix Baseline Verification (Seed 123456789)
// Baseline acquired from origin release commit b439e9d6d1eee91bccad1e91a40df25f11cc5095 (contents/index.js updateMainMatrix)
console.log('\n[Test 2] Complete 40-Tile All-Corner LCG Matrix Baseline Verification (Seed 123456789)');
sandbox.window.updateMainMatrix(123456789);
const mat = sandbox.window.getCurrentMatrix();
console.log('Matrix Tile Count:', mat.length);
if (mat.length !== 40) {
  console.error('FAIL: Expected 40 tiles in matrix');
  process.exit(1);
}

// Fixed baseline array acquired from legacy LCG matrix generator for seed 123456789 (commit b439e9d6d1eee91bccad1e91a40df25f11cc5095)
const expected40Tiles = [
  { index: 0, center: "0", tl: "7", tr: "6", bl: "o", br: "b" },
  { index: 1, center: "1", tl: "0", tr: "4", bl: "Q", br: "w" },
  { index: 2, center: "2", tl: "3", tr: "d", bl: "I", br: "r" },
  { index: 3, center: "3", tl: "2", tr: "O", bl: "4", br: "i" },
  { index: 4, center: "4", tl: "4", tr: "u", bl: "T", br: "7" },
  { index: 5, center: "5", tl: "5", tr: "a", bl: "&", br: "8" },
  { index: 6, center: "6", tl: "1", tr: "R", bl: "+", br: "h" },
  { index: 7, center: "7", tl: "4", tr: "v", bl: "n", br: "o" },
  { index: 8, center: "8", tl: "2", tr: "j", bl: "9", br: "k" },
  { index: 9, center: "9", tl: "1", tr: "F", bl: "C", br: "q" },
  { index: 10, center: "a", tl: "4", tr: "W", bl: "s", br: "t" },
  { index: 11, center: "b", tl: "2", tr: "n", bl: "x", br: "4" },
  { index: 12, center: "c", tl: "6", tr: "m", bl: "P", br: "g" },
  { index: 13, center: "d", tl: "5", tr: "Y", bl: "J", br: "m" },
  { index: 14, center: "e", tl: "9", tr: "1", bl: "a", br: "v" },
  { index: 15, center: "f", tl: "2", tr: "C", bl: "(", br: "s" },
  { index: 16, center: "g", tl: "0", tr: "3", bl: "L", br: "z" },
  { index: 17, center: "h", tl: "4", tr: "y", bl: "G", br: "d" },
  { index: 18, center: "i", tl: "8", tr: "w", bl: "#", br: "n" },
  { index: 19, center: "j", tl: "8", tr: "M", bl: "h", br: "a" },
  { index: 20, center: "k", tl: "7", tr: "c", bl: "v", br: "p" },
  { index: 21, center: "l", tl: "5", tr: "h", bl: "e", br: "x" },
  { index: 22, center: "m", tl: "0", tr: "L", bl: "y", br: "c" },
  { index: 23, center: "n", tl: "6", tr: "o", bl: "u", br: "-" },
  { index: 24, center: "o", tl: "3", tr: "B", bl: "Z", br: "l" },
  { index: 25, center: "p", tl: "7", tr: "D", bl: "-", br: "(" },
  { index: 26, center: "q", tl: "0", tr: "X", bl: "A", br: "2" },
  { index: 27, center: "r", tl: "9", tr: "U", bl: "K", br: "f" },
  { index: 28, center: "s", tl: "1", tr: "e", bl: "U", br: "e" },
  { index: 29, center: "t", tl: "9", tr: "K", bl: "z", br: "*" },
  { index: 30, center: "u", tl: "6", tr: "f", bl: "$", br: "1" },
  { index: 31, center: "v", tl: "7", tr: "Q", bl: "W", br: "6" },
  { index: 32, center: "w", tl: "8", tr: "k", bl: "X", br: "0" },
  { index: 33, center: "x", tl: "8", tr: "G", bl: "l", br: "j" },
  { index: 34, center: "y", tl: "3", tr: "g", bl: "g", br: "u" },
  { index: 35, center: "z", tl: "5", tr: "I", bl: "8", br: "y" },
  { index: 36, center: "^", tl: "9", tr: "s", bl: "w", br: "5" },
  { index: 37, center: "%", tl: "6", tr: "T", bl: "M", br: "&" },
  { index: 38, center: "/", tl: "1", tr: "r", bl: "O", br: "9" },
  { index: 39, center: "-", tl: "3", tr: "q", bl: "2", br: "3" }
];

for (let i = 0; i < 40; i++) {
  const actual = { index: mat[i].index, center: mat[i].center, tl: mat[i].tl, tr: mat[i].tr, bl: mat[i].bl, br: mat[i].br };
  const expected = expected40Tiles[i];
  if (
    actual.index !== expected.index ||
    actual.center !== expected.center ||
    actual.tl !== expected.tl ||
    actual.tr !== expected.tr ||
    actual.bl !== expected.bl ||
    actual.br !== expected.br
  ) {
    console.error(`FAIL: All-corner tile mismatch at index ${i}. Expected:`, expected, 'Actual:', actual);
    process.exit(1);
  }
}

console.log('PASS: All 40 tiles and corners verified against legacy baseline!');

// Test 3: Multiple Recipes & Password Baselines
console.log('\n[Test 3] Multiple Recipes & Password Evaluation Baselines');

// Recipe 1: Default Recipe Config
const defaultCfg = {
  kwOrder: 1, kwFilter: 0, kwNum: 4, shiftDir: 0, shiftN: 1, shiftM: 1,
  baseCorner: 0, pickPattern: 0, symMode: 0, symList: '', symFbDir: 0, symFbDist: 1, symFbCorner: 0,
  preTarget: 0, prePattern: 0, preOffset: 0, sufTarget: 0, sufPattern: 0, sufOffset: 0,
  ancTile: 0, ancMode: 0, ancPos: 2, postMode: 0, lenMode: 0, lenVal: 16
};

sandbox.window.updateMainMatrix(123456789);
const steps1 = sandbox.window.evaluateRecipeSteps('google.com', 'MySecret123', defaultCfg);
const pw1 = steps1.map(s => s.ch).join('');
console.log(`Default Recipe - Seed 123456789 - google.com -> Password: ${pw1}`);
if (pw1 !== 'LZZLea+PZyygUaPKazQI4') {
  console.error('FAIL: Default recipe password mismatch');
  process.exit(1);
}

// Recipe 2: Non-Default Custom Recipe (Varying shift, corner, length, and anchor rules)
const customCfg = {
  kwOrder: 2, kwFilter: 1, kwNum: 6, shiftDir: 1, shiftN: 2, shiftM: 2,
  baseCorner: 1, pickPattern: 1, symMode: 0, symList: '', symFbDir: 0, symFbDist: 1, symFbCorner: 0,
  preTarget: 0, prePattern: 0, preOffset: 0, sufTarget: 0, sufPattern: 0, sufOffset: 0,
  ancTile: 0, ancMode: 0, ancPos: 2, postMode: 0, lenMode: 0, lenVal: 16
};

sandbox.window.updateMainMatrix(987654321);
const steps2 = sandbox.window.evaluateRecipeSteps('amazon.co.jp', 'Shop2026!', customCfg);
const pw2 = steps2.map(s => s.ch).join('');
console.log(`Custom Recipe - Seed 987654321 - amazon.co.jp -> Password: ${pw2}`);
if (pw2 !== 'ca6C4R8Uew5m') {
  console.error('FAIL: Custom recipe password mismatch for amazon');
  process.exit(1);
} else {
  console.log('PASS: Password evaluation baseline test passed across diverse recipes!');
}

// Test 4: CME2 and CME3 Fixed Legacy Payload Restorations
// Origin details:
// Generated from origin commit b439e9d6d1eee91bccad1e91a40df25f11cc5095.
// Header Specification:
// Both CME v2 and CME v3 format headers start with magic ASCII bytes [0x43, 0x4d, 0x45] ('CME').
// CME2 byte 3 = 0x02 (v2 version tag), header format [67, 77, 69, 2, profileByte(0=600k PBKDF2), ...salt(32), ...iv(12)].
// CME3 byte 3 = 0x03 (v3 version tag), header format [67, 77, 69, 3, profileByte(1=64MB Argon2id), ...salt(32), ...aesIv(12), ...chachaNonce(12)].
// Plaintext: "CryptoMatrix Legacy Backup Payload Verification"
// Password: "MasterPassword#2026!"
console.log('\n[Test 4] CME2 and CME3 Fixed Legacy Payload Restorations');
async function testCmePayloadRestorations() {
  const preset = sandbox.window.MatrixCardPreset;
  const password = "MasterPassword#2026!";

  // Fixed CME v2 payload byte array (Magic 'CME', byte[3]=2 for v2, profile 0 = 600,000 PBKDF2 iterations)
  const fixedCme2U8 = new Uint8Array([67,77,69,2,0,104,245,252,224,208,55,13,229,106,91,41,233,36,137,96,114,36,171,150,158,98,187,172,124,208,196,150,151,58,173,246,233,33,11,206,249,210,233,10,18,164,105,9,145,17,96,152,168,189,1,185,235,165,192,156,95,98,99,211,186,254,26,118,112,201,36,209,217,70,117,175,32,97,35,93,200,37,142,192,40,178,160,220,135,129,176,94,166,108,16,8,176,183,179,234,5,200,116,236,212,101,220,61,246,174,136,177,124,173,52,34,219,141,21,5,13,116,132,68,144,204,102,180]);
  const dec2 = await preset.decryptBodyCME(fixedCme2U8, password, { keyfileBytes: null, passkeyFactor: null });
  const text2 = new TextDecoder().decode(dec2.innerBody);
  console.log('Restored Fixed CME2 Text:', text2, '| Version:', dec2.version);
  if (text2 !== "CryptoMatrix Legacy Backup Payload Verification" || dec2.version !== 2) {
    console.error('FAIL: Fixed CME2 payload restoration failed');
    process.exit(1);
  }

  // Fixed CME v3 payload byte array (Magic 'CME', byte[3]=3 for v3, profile 1 = 64MB Argon2id + Dual Cascade)
  const fixedCme3U8 = new Uint8Array([67,77,69,3,1,247,150,48,128,109,215,89,68,4,174,237,27,221,58,37,214,100,76,129,196,29,255,219,22,184,175,241,29,164,123,130,41,214,105,18,89,144,187,40,16,19,1,107,227,30,247,201,99,16,141,5,209,31,175,208,79,6,45,69,157,104,68,250,26,0,43,95,31,122,44,193,73,95,17,26,34,17,22,117,54,21,193,186,29,161,228,107,42,239,149,94,62,210,45,49,242,35,226,180,11,211,187,174,160,2,91,56,85,139,158,246,88,39,5,244,133,2,76,251,85,107,153,163,241,66,231,195,179,249,232,199,111,27,52,130,17,48,137,112,79,194,19,173,208,80,136,254,109,210,40,170]);
  const dec3 = await preset.decryptBodyCME(fixedCme3U8, password, { keyfileBytes: null, passkeyFactor: null });
  const text3 = new TextDecoder().decode(dec3.innerBody);
  console.log('Restored Fixed CME3 Text:', text3, '| Version:', dec3.version);
  if (text3 !== "CryptoMatrix Legacy Backup Payload Verification" || dec3.version !== 3) {
    console.error('FAIL: Fixed CME3 payload restoration failed');
    process.exit(1);
  }

  console.log('PASS: Fixed CME2 and CME3 legacy backup restorations verified!');
}

testCmePayloadRestorations().then(() => {
  console.log('\n====================================================');
  console.log('All Core Regression Tests Passed Successfully!');
  console.log('====================================================');
}).catch(err => {
  console.error('FAIL in testCmePayloadRestorations:', err);
  process.exit(1);
});
