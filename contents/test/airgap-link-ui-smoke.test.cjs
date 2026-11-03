'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = __dirname;

const context2d = new Proxy({}, {
  get(target, key) {
    if (key === 'measureText') return () => ({ width: 10 });
    if (key === 'createImageData') return (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) });
    if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});

class Element {
  constructor(id) {
    this.id = id || '';
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.files = [];
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.children = [];
    this.listeners = Object.create(null);
    this.width = 720;
    this.height = 720;
    this.readyState = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.parentElement = { style: {} };
    this.classList = { add() {}, remove() {}, contains() { return false; }, toggle() {} };
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async dispatch(type) {
    const event = { target: this, preventDefault() {} };
    for (const listener of this.listeners[type] || []) await listener(event);
  }
  getContext() { return context2d; }
  setAttribute() {}
  removeAttribute() {}
  appendChild(child) { this.children.push(child); return child; }
  remove() { this.removed = true; }
  focus() {}
  select() {}
  play() { return Promise.resolve(); }
  pause() {}
  getBoundingClientRect() { return { width: 720, height: 720, left: 0, top: 0 }; }
}

const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, new Element(id));
  return elements.get(id);
};
const document = {
  getElementById: getElement,
  createElement: tag => new Element(tag),
  body: new Element('body'),
  activeElement: null,
  execCommand: () => false
};
const window = {
  document,
  crypto: require('node:crypto').webcrypto,
  isSecureContext: false,
  addEventListener() {},
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: clearTimeout
};
const sandbox = {
  window, document, navigator: {},
  performance: { now: () => Date.now() },
  TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray,
  Set, Map, Promise, Date, Math, Number, String, Array, Object, JSON,
  Error, RegExp, Blob, URL, console, setTimeout, clearTimeout, atob, btoa
};
vm.createContext(sandbox);
for (const filename of [
  'airgap-link-wire-v8.js',
  'airgap-link-core-v8.js',
  'airgap-link-fountain-v8.js',
  'airgap-link-qr-encoder-v8.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });
}
sandbox.MatrixQRCode = window.MatrixQRCode;
const uiSource = fs.readFileSync(path.join(root, 'airgap-link-ui-v13.js'), 'utf8');
vm.runInContext(uiSource, sandbox, { filename: 'airgap-link-ui-v13.js' });

(async () => {
  assert.equal(getElement('autoTxTest').listeners.click.length, 1,
    'Automatic TX test button must have exactly one click handler');
  assert.equal(getElement('copyBenchmarkText').listeners.click.length, 1,
    'Benchmark copy button must have exactly one click handler');

  const autoStart = uiSource.indexOf('async function runTxAutoTest()');
  const autoEnd = uiSource.indexOf("  $('autoTxTest').addEventListener", autoStart);
  const autoBody = uiSource.slice(autoStart, autoEnd);
  assert(autoStart >= 0 && autoEnd > autoStart, 'Automatic TX benchmark handler must exist');
  assert(!autoBody.includes('autoBenchmarkReset') && !autoBody.includes('cameraVideo') &&
    !autoBody.includes('stream.active'),
    'TX benchmark must not gate its start on remote RX camera state');
  assert.equal(getElement('chunkSizeNumber').listeners.input.length, 1,
    'Expanded chunk-size numeric input must be wired');
  getElement('chunkSizeNumber').value = '3000';
  await getElement('chunkSizeNumber').dispatch('input');
  assert.equal(getElement('chunkSizeNumber').value, '2800',
    'Base45 chunk-size input must clamp to the 2,800-byte experiment ceiling');
  getElement('wireFormat').value = 'base64url';
  await getElement('wireFormat').dispatch('change');
  assert.equal(getElement('chunkSize').max, '2100',
    'Base64URL must expose its lower QR-capacity-aware maximum');
  assert.equal(getElement('chunkSizeNumber').value, '2100',
    'Changing to Base64URL must clamp the current chunk size');
  assert.equal(getElement('benchmarkSizeRange').listeners.input.length, 1,
    'Benchmark data-size slider must be wired');
  assert.equal(getElement('benchmarkSizeInput').listeners.input.length, 1,
    'Benchmark data-size numeric input must be wired');
  await getElement('benchmarkPreset4MiB').dispatch('click');
  assert.equal(getElement('benchmarkSizeInput').value, String(4 * 1024 * 1024),
    'A benchmark size preset must update the numeric input');
  assert.equal(getElement('benchmarkSizeRange').value, String(4 * 1024 * 1024),
    'A benchmark size preset must update the range slider');

  // Exercise the real V13 UI event path: change the chunk-size control, click
  // Prepare, and inspect the rendered block count for every TX mode.
  const oneMiB = new Uint8Array(1024 * 1024);
  for (let i = 0; i < oneMiB.length; i++) oneMiB[i] = (i * 73 + 19) & 0xff;
  getElement('txFile').files = [{
    name: 'chunk-size-regression.bin',
    size: oneMiB.length,
    arrayBuffer: async () => oneMiB.buffer
  }];
  getElement('compressionEnabled').checked = false;
  getElement('wireFormat').value = 'base45';
  await getElement('wireFormat').dispatch('change');

  const expectedBlocks = new Map([
    [600, 1748],
    [800, 1311],
    [1200, 874],
    [1600, 656],
    [2800, 375]
  ]);
  const txModes = ['legacy', 'legacy-data', 'fountain', 'hybrid', 'hybrid-data'];
  for (const mode of txModes) {
    getElement('transferMode').value = mode;
    await getElement('transferMode').dispatch('change');
    for (const [chunkSize, blocks] of expectedBlocks) {
      getElement('chunkSizeNumber').value = String(chunkSize);
      await getElement('chunkSizeNumber').dispatch('input');
      assert.equal(getElement('chunkSize').value, String(chunkSize),
        mode + ': range control must retain requested chunk size ' + chunkSize);
      await getElement('prepareTx').dispatch('click');
      assert.match(getElement('txStatus').textContent, /^準備完了:/,
        mode + ' / ' + chunkSize + ': TX preparation must succeed; actual status: ' + getElement('txStatus').textContent);
      assert.match(getElement('txBlockSummary').textContent,
        new RegExp('元データ ' + blocks + 'ブロック'),
        mode + ' / ' + chunkSize + ': UI block map must reflect the selected chunk size');
      assert.match(getElement('txFrameCount').textContent,
        new RegExp('^' + blocks + ' /'),
        mode + ' / ' + chunkSize + ': TX frame counter must reflect the selected chunk size');
    }
  }

  await getElement('copyBenchmarkText').dispatch('click');
  assert.match(getElement('rxStatus').textContent, /コピーできる計測結果はまだありません/,
    'Benchmark copy must explain the zero-results state');

  getElement('autoTxLog').value = 'case,mode,chunk_bytes,fps,transfer_id\n1,hybrid-data,180,6,DEADBEEF';
  await getElement('copyTxTestLog').dispatch('click');
  const fallback = document.body.children.find(element => element.id === 'clipboardFallback');
  assert.ok(fallback,
    'Clipboard API/execCommand failure must show a selectable text fallback');
  assert.match(fallback.value, /DEADBEEF/,
    'Clipboard fallback must contain the exact text being copied');

  process.stdout.write('PASS UI initialization; PASS TX benchmark independent of RX state; PASS data-size controls; ' +
    'PASS empty benchmark-copy feedback; PASS visible clipboard fallback\n');
})().catch(error => {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
