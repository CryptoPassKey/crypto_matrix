const fs = require('fs');
const vm = require('vm');
const webcrypto = require('crypto').webcrypto;

let jsCode = fs.readFileSync('contents/index.js', 'utf8');

const dummyEl = () => ({
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  style: {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  dataset: {},
  value: '',
  innerHTML: '',
  textContent: '',
  appendChild: () => {}
});

const sandbox = {
  console: console,
  Uint8Array: Uint8Array,
  Uint16Array: Uint16Array,
  Uint32Array: Uint32Array,
  Int32Array: Int32Array,
  BigInt: BigInt,
  Math: Math,
  Array: Array,
  String: String,
  Number: Number,
  Object: Object,
  Error: Error,
  TextEncoder: TextEncoder,
  TextDecoder: TextDecoder,
  crypto: webcrypto,
  globalThis: { crypto: webcrypto },
  window: { crypto: webcrypto, location: { hostname: 'localhost', href: 'http://localhost/', origin: 'http://localhost' } },
  navigator: { userAgent: 'node' },
  document: {
    addEventListener: () => {},
    getElementById: (id) => dummyEl(),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => dummyEl(),
    body: dummyEl()
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

console.log('index.js loaded successfully!');

const seed = 123456789;
sandbox.window.updateMainMatrix(seed);
const mat = sandbox.window.getCurrentMatrix();
console.log('Matrix count:', mat.length);
console.log('Center 0:', mat[0].center, 'TL:', mat[0].tl, 'TR:', mat[0].tr, 'BL:', mat[0].bl);

sandbox.window.setRecipeConfig({
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
});

const cfg = sandbox.window.getRecipeConfig();
const steps = sandbox.window.evaluateRecipeSteps('google.com', 'MySecret123', cfg);
const pw = steps.map(s => s.ch).join('');
console.log('Generated Password:', pw);

if (pw !== 'LZZLea+PZy') {
  console.error('FAIL: Generated password does not match expected baseline LZZLea+PZy');
  process.exit(1);
} else {
  console.log('PASS: Password generation regression test passed!');
}

async function testCmeRoundtrip() {
  const preset = sandbox.window.MatrixCardPreset;
  if (!preset || !preset.encryptBodyCME3 || !preset.decryptBodyCME) {
    console.error('FAIL: CME functions not found on MatrixCardPreset');
    process.exit(1);
  }
  const plainText = new TextEncoder().encode("Hello CryptoMatrix CME3!");
  const password = "SuperSecretPassword2026!";
  const encrypted = await preset.encryptBodyCME3(plainText, password, 1, { usePassword: true });
  const decrypted = await preset.decryptBodyCME(encrypted, password, { keyfileBytes: null, passkeyFactor: null });
  const restoredText = new TextDecoder().decode(decrypted.innerBody);
  console.log('Restored CME3 Body:', restoredText);
  if (restoredText !== "Hello CryptoMatrix CME3!") {
    console.error('FAIL: CME3 Encryption/Decryption mismatch');
    process.exit(1);
  } else {
    console.log('PASS: CME3 Encryption/Decryption test passed!');
  }
}

testCmeRoundtrip().catch(err => {
  console.error('FAIL in testCmeRoundtrip:', err);
  process.exit(1);
});
