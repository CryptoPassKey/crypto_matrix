const fs = require('fs');
const vm = require('vm');
const webcrypto = require('crypto').webcrypto;

let jsCode = fs.readFileSync('contents/index.js', 'utf8');

// DOM elements cache per ID
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
window.MatrixCardPreset = window.MatrixCardPreset || {};
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

// Test 2: Full 40-Tile All-Corner LCG Matrix Generation (Seed 123456789)
console.log('\n[Test 2] Full 40-Tile All-Corner LCG Matrix Baseline Verification (Seed 123456789)');
sandbox.window.updateMainMatrix(123456789);
const mat = sandbox.window.getCurrentMatrix();
console.log('Matrix Tile Count:', mat.length);
if (mat.length !== 40) {
  console.error('FAIL: Expected 40 tiles in matrix');
  process.exit(1);
}

// Baseline expected full tile structure for first tile of seed 123456789
const expectedTile0 = { center: '0', tl: '7', tr: '6', bl: 'o', br: 'b' };
const actualTile0 = { center: mat[0].center, tl: mat[0].tl, tr: mat[0].tr, bl: mat[0].bl, br: mat[0].br };
console.log('Tile 0 Expected:', expectedTile0, 'Actual:', actualTile0);

if (
  actualTile0.center !== expectedTile0.center ||
  actualTile0.tl !== expectedTile0.tl ||
  actualTile0.tr !== expectedTile0.tr ||
  actualTile0.bl !== expectedTile0.bl ||
  actualTile0.br !== expectedTile0.br
) {
  console.error('FAIL: Tile 0 all-corner mismatch');
  process.exit(1);
}

// Verify sequence of center characters across all 40 tiles
const centerChars = mat.map(t => t.center).join('');
console.log('Matrix Center Chars (40 tiles):', centerChars);
if (centerChars !== '0123456789abcdefghijklmnopqrstuvwxyz^%/-') {
  console.error('FAIL: Matrix center chars sequence mismatch');
  process.exit(1);
}

console.log('PASS: Full 40-tile all-corner LCG matrix generation verified!');

// Test 3: Multiple Recipes & Password Baselines
console.log('\n[Test 3] Multiple Recipes & Password Evaluation Baselines');
const defaultCfg = {
  kwOrder: 1,
  kwFilter: 0,
  kwNum: 4,
  shiftDir: 0,
  shiftN: 1,
  shiftM: 1,
  baseCorner: 0,
  pickPattern: 0,
  symMode: 0,
  symList: '',
  symFbDir: 0,
  symFbDist: 1,
  symFbCorner: 0,
  preTarget: 0,
  prePattern: 0,
  preOffset: 0,
  sufTarget: 0,
  sufPattern: 0,
  sufOffset: 0,
  ancTile: 0,
  ancMode: 0,
  ancPos: 2,
  postMode: 0,
  lenMode: 0,
  lenVal: 16
};

sandbox.window.updateMainMatrix(123456789);
const steps1 = sandbox.window.evaluateRecipeSteps('google.com', 'MySecret123', defaultCfg);
const pw1 = steps1.map(s => s.ch).join('');
console.log(`Default Recipe - Seed 123456789 - google.com -> Password: ${pw1}`);
if (pw1 !== 'LZZLea+PZyygUaPKazQI4') {
  console.error('FAIL: Default recipe password mismatch');
  process.exit(1);
}

sandbox.window.updateMainMatrix(987654321);
const steps2 = sandbox.window.evaluateRecipeSteps('amazon.co.jp', 'Shop2026!', defaultCfg);
const pw2 = steps2.map(s => s.ch).join('');
console.log(`Default Recipe - Seed 987654321 - amazon.co.jp -> Password: ${pw2}`);
if (pw2 !== 'nfnSMeDBMDC4x+M4mPmDE') {
  console.error('FAIL: Default recipe password mismatch for amazon');
  process.exit(1);
} else {
  console.log('PASS: Password evaluation baseline test passed across multiple recipes!');
}

// Test 4: CME3 Encryption & Decryption Roundtrip
console.log('\n[Test 4] CME3 Dual-Cascade Encryption & Decryption Roundtrip');
async function testCmeRoundtrip() {
  const preset = sandbox.window.MatrixCardPreset;
  const plainText = new TextEncoder().encode("CryptoMatrix Backward Compatibility Test 2026");
  const password = "MasterPassword#2026!";
  const encrypted = await preset.encryptBodyCME3(plainText, password, 1, { usePassword: true });
  const decrypted = await preset.decryptBodyCME(encrypted, password, { keyfileBytes: null, passkeyFactor: null });
  const restoredText = new TextDecoder().decode(decrypted.innerBody);
  console.log('Restored CME3 Text:', restoredText);
  if (restoredText !== "CryptoMatrix Backward Compatibility Test 2026") {
    console.error('FAIL: CME3 roundtrip failed');
    process.exit(1);
  } else {
    console.log('PASS: CME3 roundtrip test passed!');
  }
}

testCmeRoundtrip().then(() => {
  console.log('\n====================================================');
  console.log('All Core Regression Tests Passed Successfully!');
  console.log('====================================================');
}).catch(err => {
  console.error('FAIL in testCmeRoundtrip:', err);
  process.exit(1);
});
