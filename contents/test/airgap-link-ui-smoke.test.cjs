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
vm.runInContext(fs.readFileSync(path.join(root, 'airgap-link-ui-v11.js'), 'utf8'), sandbox,
  { filename: 'airgap-link-ui-v11.js' });

(async () => {
  assert.equal(getElement('autoTxTest').listeners.click.length, 1,
    'Automatic TX test button must have exactly one click handler');
  assert.equal(getElement('copyBenchmarkText').listeners.click.length, 1,
    'Benchmark copy button must have exactly one click handler');

  await getElement('autoTxTest').dispatch('click');
  assert.match(getElement('txStatus').textContent, /自動テストを開始できません/,
    'Automatic TX test must explain missing RX benchmark/camera prerequisites');

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

  process.stdout.write('PASS UI initialization; PASS TX button click/precondition feedback; ' +
    'PASS empty benchmark-copy feedback; PASS visible clipboard fallback\n');
})().catch(error => {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
