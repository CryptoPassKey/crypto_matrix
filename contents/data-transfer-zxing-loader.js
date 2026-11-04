(function () {
  'use strict';

  // Version-pinned reader-only IIFE. The service worker serves its JS and WASM
  // through same-origin virtual URLs and stores them in this independent cache.
  var VERSION = '3.1.6';
  var CACHE_NAME = 'data-transfer-zxing-wasm-' + VERSION;
  var SCRIPT_CACHE_KEY = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + VERSION + '/dist/iife/reader/index.js';
  var SCRIPT_LOCAL_URL = 'data-transfer-zxing-reader.js';
  var WASM_CACHE_KEY = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + VERSION + '/dist/reader/zxing_reader.wasm';
  var WASM_LOCAL_URL = 'data-transfer-zxing-reader.wasm';
  var loadPromise = null;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.async = true;
      script.src = url;
      script.onload = function () {
        if (window.ZXingWASM && typeof window.ZXingWASM.readBarcodes === 'function') {
          resolve(window.ZXingWASM);
        } else {
          reject(new Error('ZXing reader APIが見つかりません: ' + url));
        }
      };
      script.onerror = function () {
        reject(new Error('ZXing JavaScriptの読込に失敗しました: ' + url));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function isValidWasmHeader(bytes) {
    return bytes && bytes.length >= 500000 &&
      bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
  }

  async function fetchWasmBytes(cache) {
    if (cache) {
      try {
        var cached = await cache.match(WASM_CACHE_KEY);
        if (cached) {
          var cachedBuf = await cached.arrayBuffer();
          if (isValidWasmHeader(new Uint8Array(cachedBuf))) return cachedBuf;
        }
      } catch (_) {}
    }

    var hasSwController = !!(typeof navigator !== 'undefined' &&
      navigator.serviceWorker &&
      navigator.serviceWorker.controller);
    if (!hasSwController) {
      throw new Error('Service Worker未制御のため同オリジンWASMルートは未有効です');
    }

    // Request via same-origin Service Worker virtual route (satisfies strict CSP 'self')
    var localResp = await fetch(WASM_LOCAL_URL, { credentials: 'same-origin' });
    if (!localResp || !localResp.ok) {
      throw new Error('WASM取得失敗 (' + (localResp ? localResp.status : 'network') + ')');
    }
    var localBuf = await localResp.arrayBuffer();
    if (!isValidWasmHeader(new Uint8Array(localBuf))) {
      throw new Error('ZXing WASMファイルの形式またはサイズが不正です');
    }
    return localBuf;
  }

  async function initialize() {
    var cache = null;
    if (window.caches && typeof window.caches.open === 'function') {
      try { cache = await window.caches.open(CACHE_NAME); } catch (_) {}
    }

    var hasSwController = !!(typeof navigator !== 'undefined' &&
      navigator.serviceWorker &&
      navigator.serviceWorker.controller);
    var hasCachedScript = false;
    if (cache) {
      try {
        hasCachedScript = !!(await cache.match(SCRIPT_CACHE_KEY));
      } catch (_) {}
    }

    if (!window.ZXingWASM && !hasSwController && !hasCachedScript) {
      throw new Error('ZXing WASMはService Worker有効化後に利用可能になります（現在はローカルjsQRを使用）');
    }

    var scriptPromise = window.ZXingWASM && typeof window.ZXingWASM.readBarcodes === 'function'
      ? Promise.resolve(window.ZXingWASM)
      : loadScript(SCRIPT_LOCAL_URL);
    var wasmPromise = fetchWasmBytes(cache);
    var results = await Promise.all([scriptPromise, wasmPromise]);
    var api = results[0];
    var wasmBytes = results[1];

    await api.prepareZXingModule({
      overrides: {
        wasmBinary: wasmBytes,
        locateFile: function (path, prefix) {
          return path.slice(-5).toLowerCase() === '.wasm' ? WASM_LOCAL_URL : prefix + path;
        }
      },
      fireImmediately: true
    });
    return api;
  }

  function load() {
    if (!loadPromise) {
      loadPromise = initialize().catch(function (error) {
        loadPromise = null;
        throw error;
      });
    }
    return loadPromise;
  }

  window.AirgapZXingLoader = { load: load };
  window.DataTransferZXingLoader = { load: load };
})();
