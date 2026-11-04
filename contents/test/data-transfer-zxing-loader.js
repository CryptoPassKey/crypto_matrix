(function () {
  'use strict';

  // Version-pinned reader-only IIFE. The service worker serves its JS through
  // a same-origin virtual URL and stores it in this independent cache.
  var VERSION = '3.1.6';
  var CACHE_NAME = 'data-transfer-zxing-wasm-' + VERSION;
  var SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + VERSION + '/dist/iife/reader/index.js';
  var SCRIPT_LOCAL_URL = 'data-transfer-zxing-reader.js';
  var WASM_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@' + VERSION + '/dist/reader/zxing_reader.wasm';
  var loadPromise = null;
  var wasmObjectUrl = null;

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

  async function cachedWasm(cache) {
    if (cache) {
      try {
        var cached = await cache.match(WASM_URL);
        if (cached) return cached;
      } catch (_) {}
    }
    var response = await fetch(WASM_URL, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error('WASM取得失敗 (' + response.status + ')');
    if (response.type === 'opaque') throw new Error('WASM CDN応答がCORSで読み取れません');
    if (cache) {
      try { await cache.put(WASM_URL, response.clone()); } catch (_) {}
    }
    return response;
  }

  async function initialize() {
    var cache = null;
    if (window.caches && typeof window.caches.open === 'function') {
      try { cache = await window.caches.open(CACHE_NAME); } catch (_) {}
    }

    var scriptPromise = window.ZXingWASM && typeof window.ZXingWASM.readBarcodes === 'function'
      ? Promise.resolve(window.ZXingWASM)
      : loadScript(SCRIPT_LOCAL_URL).catch(function () {
          return loadScript(SCRIPT_URL);
        });
    var wasmPromise = cachedWasm(cache);
    var results = await Promise.all([scriptPromise, wasmPromise]);
    var api = results[0];
    var wasmBytes = await results[1].arrayBuffer();
    var wasm = new Uint8Array(wasmBytes);
    if (wasm.length < 500000 || wasm[0] !== 0 || wasm[1] !== 0x61 ||
        wasm[2] !== 0x73 || wasm[3] !== 0x6d) {
      throw new Error('ZXing WASMファイルの形式またはサイズが不正です');
    }

    if (wasmObjectUrl) URL.revokeObjectURL(wasmObjectUrl);
    wasmObjectUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));
    await api.prepareZXingModule({
      overrides: {
        locateFile: function (path, prefix) {
          return path.slice(-5).toLowerCase() === '.wasm' ? wasmObjectUrl : prefix + path;
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

  window.DataTransferZXingLoader = {
    version: VERSION,
    cacheName: CACHE_NAME,
    load: load
  };
})();
