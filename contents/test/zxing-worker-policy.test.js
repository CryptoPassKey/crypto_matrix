'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workerSource = fs.readFileSync(
  path.join(__dirname, 'data-transfer-worker.js'),
  'utf8'
);

function createWorker(options = {}) {
  const messages = [];
  const imports = [];
  const sandbox = {
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
    ArrayBuffer,
    Math,
    Promise,
    performance: { now: () => 1 },
    WebAssembly,
    ImageData: class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
    fetch: async () => {
      if (options.failWasm) throw new Error('simulated offline');
      const bytes = new Uint8Array(500000);
      bytes.set([0x00, 0x61, 0x73, 0x6d]);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer
      };
    },
    importScripts: (url) => {
      imports.push(url);
      if (url.indexOf('data-transfer-zxing-reader.js') !== -1) {
        if (options.failZxingScript) throw new Error('simulated script failure');
        sandbox.ZXingWASM = {
          readBarcodes: async () => [],
          prepareZXingModule: async () => {}
        };
      } else if (url.indexOf('jsQR.js') !== -1) {
        sandbox.jsQR = () => {
          options.jsQrCalls = (options.jsQrCalls || 0) + 1;
          return null;
        };
      }
    },
    self: {
      postMessage: (message) => messages.push(message),
      onmessage: null
    }
  };
  vm.runInNewContext(workerSource, sandbox, { filename: 'data-transfer-worker.js' });
  return { sandbox, messages, imports };
}

test('strict ZXing mode initializes without importing jsQR', async () => {
  const worker = createWorker();
  await worker.sandbox.self.onmessage({ data: { type: 'init', scannerType: 'zxing-wasm' } });
  assert.equal(worker.messages[0].success, true);
  assert.equal(worker.messages[0].hasZxing, true);
  assert.equal(worker.messages[0].hasJsQr, false);
  assert.equal(worker.imports.some((url) => url.indexOf('jsQR.js') !== -1), false);
});

test('strict ZXing mode reports initialization failure without jsQR fallback', async () => {
  const worker = createWorker({ failWasm: true });
  await worker.sandbox.self.onmessage({ data: { type: 'init', scannerType: 'zxing-wasm' } });
  assert.equal(worker.messages[0].success, false);
  assert.match(worker.messages[0].error, /simulated offline/);
  assert.equal(worker.imports.some((url) => url.indexOf('jsQR.js') !== -1), false);
});

test('jsQR is loaded only for an explicit compatibility scanner mode', async () => {
  const worker = createWorker();
  await worker.sandbox.self.onmessage({ data: { type: 'init', scannerType: 'jsqr' } });
  assert.equal(worker.messages[0].success, true);
  assert.equal(worker.messages[0].hasJsQr, true);
  assert.equal(worker.imports.some((url) => url.indexOf('jsQR.js') !== -1), true);
});

test('native compatibility mode may prepare jsQR for native-decoder failure', async () => {
  const worker = createWorker();
  await worker.sandbox.self.onmessage({ data: { type: 'init', scannerType: 'native' } });
  assert.equal(worker.messages[0].success, true);
  assert.equal(worker.messages[0].hasJsQr, true);
});
