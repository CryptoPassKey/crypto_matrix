/* global importScripts, ZXingWASM, jsQR */
'use strict';

var VERSION = '3.1.6';
var SCRIPT_LOCAL_URL = 'data-transfer-zxing-reader.js';
var SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + VERSION + '/dist/iife/reader/index.js';
var WASM_LOCAL_URL = 'data-transfer-zxing-reader.wasm';
var WASM_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + VERSION + '/dist/reader/zxing_reader.wasm';
var zxingApi = null;
var isInitialized = false;

// Reusable ROI buffer to eliminate per-frame allocations and GC pressure
var cachedRoiData = null;
var cachedRoiWidth = 0;
var cachedRoiHeight = 0;

function loadJsQr() {
  if (typeof jsQR === 'function') return true;
  var candidates = ['vendor/jsQR.js', '../vendor/jsQR.js'];
  for (var i = 0; i < candidates.length; i++) {
    try {
      importScripts(candidates[i]);
      if (typeof jsQR === 'function') return true;
    } catch (_) {}
  }
  return false;
}

function isValidWasmHeader(bytes) {
  return bytes && bytes.length >= 500000 &&
    bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
}

async function fetchWorkerWasmBytes() {
  var localResp = await fetch(WASM_LOCAL_URL, { credentials: 'same-origin' });
  if (!localResp || !localResp.ok) {
    throw new Error('WASM fetch failed: ' + (localResp ? localResp.status : 'network'));
  }
  var localBuf = await localResp.arrayBuffer();
  if (!isValidWasmHeader(new Uint8Array(localBuf))) {
    throw new Error('Invalid WASM binary');
  }
  return localBuf;
}

async function initZxing() {
  if (zxingApi) return zxingApi;
  try {
    if (typeof ZXingWASM === 'undefined' || typeof ZXingWASM.readBarcodes !== 'function') {
      importScripts(SCRIPT_LOCAL_URL);
    }
    if (typeof ZXingWASM === 'undefined' || typeof ZXingWASM.readBarcodes !== 'function') {
      throw new Error('ZXingWASM not available in worker');
    }

    var wasmBytes = await fetchWorkerWasmBytes();

    await ZXingWASM.prepareZXingModule({
      overrides: {
        wasmBinary: wasmBytes,
        locateFile: function (path, prefix) {
          return path.slice(-5).toLowerCase() === '.wasm' ? WASM_LOCAL_URL : prefix + path;
        }
      },
      fireImmediately: true
    });
    zxingApi = ZXingWASM;
    return zxingApi;
  } catch (err) {
    // A failed ZXing initialization must never silently activate jsQR.
    throw err;
  }
}

function extractRoiImageData(srcBuffer, srcWidth, srcHeight, roiX, roiY, roiW, roiH) {
  var neededLength = roiW * roiH * 4;
  if (!cachedRoiData || cachedRoiWidth !== roiW || cachedRoiHeight !== roiH || cachedRoiData.length !== neededLength) {
    cachedRoiData = new Uint8ClampedArray(neededLength);
    cachedRoiWidth = roiW;
    cachedRoiHeight = roiH;
  }
  var dstData = cachedRoiData;
  var src32 = new Uint32Array(srcBuffer);
  var dst32 = new Uint32Array(dstData.buffer);

  for (var y = 0; y < roiH; y++) {
    var srcRowStart = (roiY + y) * srcWidth + roiX;
    var dstRowStart = y * roiW;
    for (var x = 0; x < roiW; x++) {
      dst32[dstRowStart + x] = src32[srcRowStart + x];
    }
  }
  return new ImageData(dstData, roiW, roiH);
}

function estimateQrRatio(pos, frameWidth) {
  if (!pos) return null;
  var p1 = pos.topLeft || pos.topLeftCorner;
  var p2 = pos.topRight || pos.topRightCorner;
  if (!p1 || !p2) return null;
  var w = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return Math.min(1.0, Math.max(0.0, Math.round((w / frameWidth) * 100) / 100));
}

async function decodeFrame(data) {
  var width = data.width;
  var height = data.height;
  var buffer = data.buffer;
  var scannerType = data.scannerType || 'auto';

  // 1. Try Center ROI (70%) first
  var roiRatio = 0.7;
  var roiW = Math.round(width * roiRatio);
  var roiH = Math.round(height * roiRatio);
  var roiX = Math.round((width - roiW) / 2);
  var roiY = Math.round((height - roiH) / 2);

  var roiImage = extractRoiImageData(buffer, width, height, roiX, roiY, roiW, roiH);
  var raw = null;
  var qrRatio = null;

  // Try ZXing if available
  if (zxingApi && (scannerType === 'auto' || scannerType === 'zxing-wasm')) {
    try {
      var roiResults = await zxingApi.readBarcodes(roiImage, {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
        tryHarder: false
      });
      if (roiResults && roiResults.length && roiResults[0].text) {
        raw = roiResults[0].text;
        qrRatio = estimateQrRatio(roiResults[0].position, width);
      }
    } catch (_) {}

    // Fallback to full frame
    if (!raw) {
      try {
        var fullImageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
        var fullResults = await zxingApi.readBarcodes(fullImageData, {
          formats: ['QRCode'],
          maxNumberOfSymbols: 1,
          tryHarder: false
        });
        if (fullResults && fullResults.length && fullResults[0].text) {
          raw = fullResults[0].text;
          qrRatio = estimateQrRatio(fullResults[0].position, width);
        }
      } catch (_) {}
    }
  }

  // If still not found and jsQR is available, try jsQR
  if (!raw && (scannerType === 'jsqr' || scannerType === 'native') && typeof jsQR === 'function') {
    try {
      var roiDecoded = jsQR(roiImage.data, roiImage.width, roiImage.height, { inversionAttempts: 'dontInvert' });
      if (roiDecoded && roiDecoded.data) {
        raw = roiDecoded.data;
        qrRatio = estimateQrRatio(roiDecoded.location, width);
      }
    } catch (_) {}

    if (!raw) {
      try {
        var fullImageDataJs = new ImageData(new Uint8ClampedArray(buffer), width, height);
        var fullDecoded = jsQR(fullImageDataJs.data, fullImageDataJs.width, fullImageDataJs.height, { inversionAttempts: 'dontInvert' });
        if (fullDecoded && fullDecoded.data) {
          raw = fullDecoded.data;
          qrRatio = estimateQrRatio(fullDecoded.location, width);
        }
      } catch (_) {}
    }
  }

  return { raw: raw, qrRatio: qrRatio };
}

self.onmessage = async function (e) {
  var msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    try {
      if (msg.scannerType === 'zxing-wasm') {
        // Strict mode: ZXing only. Do not import or initialize jsQR here.
        await initZxing();
      } else if (msg.scannerType === 'jsqr' || msg.scannerType === 'native') {
        // Native BarcodeDetector runs on the main thread. jsQR is permitted here
        // only because these scanner modes are selected in compatibility mode.
        if (!loadJsQr()) throw new Error('jsQR compatibility decoder could not be loaded');
      } else {
        throw new Error('Unsupported scanner type: ' + msg.scannerType);
      }
      isInitialized = true;
      self.postMessage({
        type: 'init-ready',
        success: msg.scannerType === 'zxing-wasm' ? !!zxingApi :
          (msg.scannerType === 'jsqr' || msg.scannerType === 'native') && typeof jsQR === 'function',
        hasZxing: !!zxingApi,
        hasJsQr: typeof jsQR === 'function'
      });
    } catch (err) {
      self.postMessage({ type: 'init-ready', success: false, error: err && err.message ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === 'decode') {
    var started = performance.now();
    var result = { raw: null, qrRatio: null };
    try {
      result = await decodeFrame(msg);
    } catch (_) {}
    var elapsed = performance.now() - started;
    self.postMessage({
      type: 'decode-result',
      id: msg.id,
      sessionId: msg.sessionId,
      raw: result.raw,
      qrRatio: result.qrRatio,
      elapsedMs: elapsed
    });
  }
};
