(function () {
  'use strict';

  // Vendored ZXing assets (vendor/zxing-reader.js + vendor/zxing_reader.wasm).
  // Keep this version in sync with the vendored zxing-wasm package version.
  var VERSION = '3.1.6';
  var SCRIPT_LOCAL_URL = 'vendor/zxing-reader.js';
  var WASM_LOCAL_URL = 'vendor/zxing_reader.wasm';
  var loadPromise = null;

  function swState() {
    if (!navigator.serviceWorker) return 'unsupported';
    if (navigator.serviceWorker.controller) return 'controlled';
    return 'not-controlled';
  }

  function diagnostic(stage, url, detail) {
    return new Error(
      'ZXing ' + stage +
      ' / URL: ' + url +
      ' / Service Worker: ' + swState() +
      (detail ? ' / ' + detail : '')
    );
  }

  async function fetchAsset(url, kind) {
    var response;
    try {
      response = await fetch(url, { credentials: 'same-origin' });
    } catch (error) {
      throw diagnostic(kind + '通信エラー', url,
        error && error.message ? error.message : String(error));
    }
    if (!response || !response.ok) {
      var body = '';
      var upstreamUrl = '';
      try {
        body = (await response.clone().text()).slice(0, 240);
        upstreamUrl = response.headers.get('X-CM-ZXing-Source') || '';
      } catch (_) {}
      throw diagnostic(kind + ' HTTPエラー', url,
        'HTTP ' + (response ? response.status : 'no response') +
        (upstreamUrl ? ' / upstream URL: ' + upstreamUrl : '') +
        (body ? ' / ' + body : ''));
    }
    return response;
  }

  function isValidWasm(bytes) {
    return !!(bytes && bytes.length >= 500000 &&
      bytes[0] === 0x00 && bytes[1] === 0x61 &&
      bytes[2] === 0x73 && bytes[3] === 0x6d &&
      typeof WebAssembly !== 'undefined' && WebAssembly.validate(bytes));
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.async = true;
      script.src = url;
      script.onload = function () {
        if (window.ZXingWASM && typeof window.ZXingWASM.readBarcodes === 'function' &&
            typeof window.ZXingWASM.prepareZXingModule === 'function') {
          resolve(window.ZXingWASM);
        } else {
          reject(diagnostic('JavaScript API不正', url,
            'readBarcodes / prepareZXingModule が見つかりません'));
        }
      };
      script.onerror = function () {
        reject(diagnostic('JavaScript実行用スクリプト読込失敗', url,
          'HTTP statusは事前取得で確認してください'));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function initialize() {
    // Preflight both vendored assets. Both files are same-origin static files
    // (precached by sw.js), so no Service Worker interception is required.
    var results = await Promise.all([
      fetchAsset(SCRIPT_LOCAL_URL, 'JavaScript').then(async function (response) {
        var source = await response.clone().text();
        if (source.length < 1000 || source.indexOf('readBarcodes') === -1 ||
            source.indexOf('prepareZXingModule') === -1) {
          throw diagnostic('JavaScript整合性エラー', response.url || SCRIPT_LOCAL_URL,
            'reader bundleの内容が不正です');
        }
        return response;
      }),
      fetchAsset(WASM_LOCAL_URL, 'WASM').then(async function (response) {
        var bytes = new Uint8Array(await response.arrayBuffer());
        if (!isValidWasm(bytes)) {
          throw diagnostic('WASM整合性エラー', response.url || WASM_LOCAL_URL,
            'WASMヘッダー・サイズ・WebAssembly検証に失敗しました');
        }
        return bytes.buffer;
      })
    ]);

    var api = window.ZXingWASM && typeof window.ZXingWASM.readBarcodes === 'function' &&
      typeof window.ZXingWASM.prepareZXingModule === 'function'
      ? window.ZXingWASM
      : await loadScript(SCRIPT_LOCAL_URL);
    await api.prepareZXingModule({
      overrides: {
        wasmBinary: results[1],
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
