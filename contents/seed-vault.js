/*
 * Crypto Matrix — Seed Vault
 *
 * カード配列シード番号（cm_active_seed）を localStorage へ平文保存する代わりに、
 * 端末内蔵の「取り出し不可（extractable: false）」な AES-GCM デバイス鍵で包んで
 * （暗号化して）保存するための小さなモジュール。
 *
 * 設計:
 * - デバイス鍵は IndexedDB（DB: cm-seed-vault / store: keys / id: device-key）に
 *   CryptoKey のまま保存する。鍵そのものを JavaScript から読み出すことはできない。
 * - 包んだシードは localStorage の cm_active_seed_wrapped に
 *   JSON { v:1, iv:<base64>, ct:<base64> } 形式で保存する（AES-GCM, IV 12byte 乱数,
 *   AAD = "CryptoMatrix:SeedVault:v1"）。
 * - 利用感は従来どおり: 起動時に自動で復元され、保存も自動。ユーザー操作は不要。
 * - 旧来の平文 cm_active_seed が残っている場合は初回ロード時に自動移行し、
 *   移行後に平文は削除する。
 * - IndexedDB / WebCrypto が使えない環境では、従来どおり平文保存へフォールバックし、
 *   動作が退化しないようにする（その環境では保護水準も従来どおり）。
 *
 * 保護の限界（正直な明記）:
 * - この方式は「localStorage をテキストとして読まれた」「プロファイル内のファイルを
 *   覗かれた」場合にシードがそのまま漏れることを防ぐ。
 * - 一方、同一オリジンで実行されるスクリプトや、ブラウザプロファイルごと起動できる
 *   攻撃者は復号処理自体を呼び出せるため、それらへの完全な防御にはならない。
 *   そのレベルの防御が必要な場合はパスキー（WebAuthn PRF）やパスフレーズで
 *   鍵を包む方式を併用すること。
 */
(function () {
  'use strict';

  var WRAPPED_KEY = 'cm_active_seed_wrapped';
  var LEGACY_KEY = 'cm_active_seed';
  var DB_NAME = 'cm-seed-vault';
  var DB_VERSION = 1;
  var STORE_NAME = 'keys';
  var DEVICE_KEY_ID = 'device-key';
  var AAD = new TextEncoder().encode('CryptoMatrix:SeedVault:v1');

  function b64encode(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(text) {
    var bin = atob(text);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
  }

  function idbGet(db, key) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB get failed')); };
    });
  }

  function idbPut(db, key, value) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB put failed')); };
    });
  }

  var deviceKeyPromise = null;

  async function getOrCreateDeviceKey() {
        if (!window.crypto || !window.crypto.subtle) {
          throw new Error('WebCrypto is not available');
        }
        var db = await openDb();
        var existing = await idbGet(db, DEVICE_KEY_ID);
        if (existing && existing.extractable === false) {
          return existing;
        }
        var key = await window.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          false, // extractable: false — 鍵を取り出すことはできない
          ['encrypt', 'decrypt']
        );
        if (key.extractable !== false) {
          throw new Error('Generated device key is unexpectedly extractable');
        }
        await idbPut(db, DEVICE_KEY_ID, key);
        // 保存後に読み戻した鍵を正とする（読み戻しはロック内でも整合性の確認になる）
        var stored = await idbGet(db, DEVICE_KEY_ID);
        if (stored && stored.extractable === false) return stored;
        return key;
  }

  function getDeviceKey() {
    if (!deviceKeyPromise) {
      // 複数タブが同時に初回起動しても鍵が1つだけ生成されるよう、
      // Web Locks API で「取得または生成」を原子的（排他的）に実行する。
      // Web Locks が使えない環境では従来どおり直接実行する。
      if (typeof navigator !== 'undefined' && navigator.locks &&
          typeof navigator.locks.request === 'function') {
        deviceKeyPromise = navigator.locks.request(
          'cm-seed-vault-keygen',
          function () { return getOrCreateDeviceKey(); }
        );
      } else {
        deviceKeyPromise = getOrCreateDeviceKey();
      }
      deviceKeyPromise = deviceKeyPromise.catch(function (err) {
        deviceKeyPromise = null;
        throw err;
      });
    }
    return deviceKeyPromise;
  }

  async function wrapSeed(seed) {
    var key = await getDeviceKey();
    var iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);
    var plain = new TextEncoder().encode(String(seed));
    var ct = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: AAD, tagLength: 128 },
      key,
      plain
    );
    return JSON.stringify({
      v: 1,
      iv: b64encode(iv),
      ct: b64encode(new Uint8Array(ct))
    });
  }

  async function unwrapSeed(recordText) {
    var record = JSON.parse(recordText);
    if (!record || record.v !== 1 || !record.iv || !record.ct) {
      throw new Error('Unknown wrapped seed format');
    }
    var key = await getDeviceKey();
    var plain = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(record.iv), additionalData: AAD, tagLength: 128 },
      key,
      b64decode(record.ct)
    );
    return new TextDecoder().decode(plain);
  }

  var readyFlag = false;
  var loadedSeed = null;
  var sawWrappedRecord = false;
  var unwrapFailedFlag = false;
  // 復元結果が画面側へ行き渡ったことを index.js の復元処理が markRestored() で通知する。
  // それまでは、初期化直後の無条件保存などによるプレースホルダ値 '0' での
  // 保存済みシードの上書きを saveSeed 側で防ぐ（二重防御）。
  var restoredFlag = false;

  // 初回ロード: 包まれたシードの復元と、旧平文からの自動移行を行う。
  var initialLoad = (async function () {
    try {
      var wrapped = null;
      var legacy = null;
      try { wrapped = localStorage.getItem(WRAPPED_KEY); } catch (_) {}
      try { legacy = localStorage.getItem(LEGACY_KEY); } catch (_) {}

      if (wrapped) {
        sawWrappedRecord = true;
        try {
          loadedSeed = await unwrapSeed(wrapped);
        } catch (_) {
          loadedSeed = null;
        }
        if (loadedSeed !== null && loadedSeed !== '') {
          // 復号に成功した場合に限り、残っている旧平文を削除する
          if (legacy !== null) {
            try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
          }
          return loadedSeed;
        }
        // 復号に失敗した場合、旧平文は削除せず、それを正として使う。
        // 可能なら現行のデバイス鍵で包み直して状態を自己修復し、
        // 平文の削除は包み直しが成功した場合のみ行う。失敗したら平文を保持する。
        if (legacy !== null && legacy !== '') {
          loadedSeed = legacy;
          try {
            var repaired = await wrapSeed(legacy);
            localStorage.setItem(WRAPPED_KEY, repaired);
            try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
          } catch (_) {
            // 包み直しにも失敗した場合は平文を保持する（次回ロードで再試行される）
          }
          return loadedSeed;
        }
        return null;
      }

      if (legacy !== null && legacy !== '') {
        loadedSeed = legacy;
        // 平文を包んで保存し直し、平文を削除する（自動移行）
        try {
          var record = await wrapSeed(legacy);
          localStorage.setItem(WRAPPED_KEY, record);
          localStorage.removeItem(LEGACY_KEY);
        } catch (_) {
          // 移行に失敗した場合は平文のまま使う（動作を退化させない）
        }
        return loadedSeed;
      }

      return null;
    } finally {
      // 包まれた記録があったのにシードを復元できなかった場合（鍵データ消失など）
      unwrapFailedFlag = sawWrappedRecord && (loadedSeed === null || loadedSeed === '');
      readyFlag = true;
    }
  })();
  // 未処理の rejection 警告を避ける（呼び出し側でも処理される）
  initialLoad.catch(function () {});

  var saveQueue = Promise.resolve();

  function saveSeed(seed) {
    var value = (seed === undefined || seed === null) ? '' : String(seed);
    // ガードの判定は「呼び出された時点」の状態で行う。キュー実行時点まで
    // 遅らせると、その間に復元完了通知（markRestored）が届いてしまい、
    // 復元前にキューされた競合保存を止められなくなるため。
    var restoredAtCall = restoredFlag;
    var loadedAtCall = loadedSeed;
    saveQueue = saveQueue.then(async function () {
      try {
        if (!readyFlag) {
          try { await initialLoad; } catch (_) {}
        }
        // 復元結果が確定する（画面側へ行き渡る）までは、保存済みのシードと
        // 異なる値での上書きを一切行わない。初期化直後の無条件保存（既定値）や
        // 復元中の競合する保存から既存データを守るためのガード。
        // 復元確定の通知は index.js の復元処理（またはURLシード適用時）の
        // markRestored() で行われる。
        var effectiveLoaded = (loadedAtCall !== null) ? loadedAtCall : loadedSeed;
        if (!restoredAtCall && effectiveLoaded !== null && value !== effectiveLoaded) {
          return;
        }
        if (value === '') {
          try { localStorage.removeItem(WRAPPED_KEY); } catch (_) {}
          try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
          loadedSeed = null;
          return;
        }
        var record = await wrapSeed(value);
        localStorage.setItem(WRAPPED_KEY, record);
        try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
        loadedSeed = value;
      } catch (_) {
        // IndexedDB / WebCrypto が使えない・包む処理に失敗した環境では
        // 従来どおり平文で保存する。その際、壊れた/古いラップ記録が残っていると
        // 次回ロードで優先されてしまうため、平文を正としてラップ記録は削除する。
        try {
          if (value === '') {
            localStorage.removeItem(LEGACY_KEY);
            localStorage.removeItem(WRAPPED_KEY);
          } else {
            localStorage.setItem(LEGACY_KEY, value);
            localStorage.removeItem(WRAPPED_KEY);
          }
        } catch (_) {}
      }
    });
    return saveQueue;
  }

  window.CMSeedVault = {
    // 初回復元専用。そのPromiseの解決値は起動時の復元結果で固定され、
    // その後の保存では更新されない。現在の保存値が必要な場合は
    // getCurrentSeed() を使うこと（両者を混同しない）。
    loadSeed: function () { return initialLoad; },
    getCurrentSeed: function () { return loadedSeed; },
    saveSeed: saveSeed,
    isReady: function () { return readyFlag; },
    status: function () {
      return { hasWrappedRecord: sawWrappedRecord, unwrapFailed: unwrapFailedFlag };
    },
    markRestored: function () { restoredFlag = true; }
  };

  // 既存コードからの簡易呼び出し口（平文 setItem の置き換え用）
  window.CMPersistSeed = function (seed) {
    return saveSeed(seed);
  };
})();
