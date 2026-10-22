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

console.log('--- 1. Testing DOM Element Cache & Recipe Config Roundtrip ---');
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

console.log('\n--- 2. Testing 40-Tile Full LCG Matrix Generation (Seed 123456789) ---');
sandbox.window.updateMainMatrix(123456789);
const mat = sandbox.window.getCurrentMatrix();
console.log('Matrix Tile Count:', mat.length);
if (mat.length !== 40) {
  console.error('FAIL: Expected 40 tiles in matrix');
  process.exit(1);
}

// Baseline expected 40 center characters for seed 123456789
const expectedCenters = "0123456789abcdefghijklmnopqrstuvwxyz^%/-";
const actualCenters = mat.map(t => t.center).join('');
console.log('Actual Centers:', actualCenters);
if (actualCenters !== expectedCenters) {
  console.error(`FAIL: Expected centers '${expectedCenters}', got '${actualCenters}'`);
  process.exit(1);
} else {
  console.log('PASS: Full 40-tile matrix center characters match baseline!');
}

console.log('\n--- 3. Testing Multiple Recipe Configurations & Passwords ---');
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

console.log('\n--- 4. Testing CME3 Encryption & Decryption Roundtrip ---');
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

testCmeRoundtrip().catch(err => {
  console.error('FAIL in testCmeRoundtrip:', err);
  process.exit(1);
});
