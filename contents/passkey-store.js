'use strict';
/*
 * パスキー資格情報の保存（シード別マップ v2）。
 *
 * 旧形式は localStorage のキー名 `cm_passkey_cred_<シード>` に資格情報IDを
 * 保持していた。新形式では固定キー `cm_passkey_cred_v2` に
 * { v: 2, map: { 識別子: 資格情報ID(Base64) } } を保持し、キー名にも値にも
 * シードを直接含めない。識別子は CMSeedVault.derivePasskeyIdentifier
 * （端末内 HMAC 鍵による導出）を使う。
 *
 * 移行の安全条件:
 *  - 読み取りは 新形式 → 旧形式 の順。旧形式が見つかれば新形式へ移す。
 *  - 書き込み（移行・保存）は Web Locks の排他区間でのみ行い、保存後に
 *    読み戻して検証する。Web Locks が使えない環境では書き込みを行わない
 *    （移行保留）。新形式のデータが壊れている場合も上書きしない。
 *  - 旧キーの削除は、新形式への保存・検証が成功し、かつ旧キーに依存
 *    しない経路（プライマリ記録）で同じ資格情報に到達できることを
 *    確認できた場合に限る。それまでは旧キーを保持する。
 */
(function () {
  var V2_KEY = 'cm_passkey_cred_v2';
  var LEGACY_PREFIX = 'cm_passkey_cred_';
  var LOCK_NAME = 'cm-passkey-credential-map-v2';
  var cache = new Map(); // seedStr -> credB64 | null

  function seedStr(seed) { return String(seed == null ? '' : seed).trim(); }
  function legacyKey(seed) { return LEGACY_PREFIX + seedStr(seed); }

  function readMap() {
    try {
      var raw = localStorage.getItem(V2_KEY);
      if (!raw) return { ok: true, map: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 2 || !parsed.map || typeof parsed.map !== 'object') {
        return { ok: false, map: null };
      }
      return { ok: true, map: parsed.map };
    } catch (_) {
      return { ok: false, map: null };
    }
  }

  function writeMap(map) {
    localStorage.setItem(V2_KEY, JSON.stringify({ v: 2, map: map }));
  }

  function verifyEntry(id, credB64) {
    var m = readMap();
    return m.ok && m.map[id] === credB64;
  }

  function locksAvailable() {
    return typeof navigator !== 'undefined' && !!navigator.locks &&
      typeof navigator.locks.request === 'function';
  }

  // ロックが使えない場合は fn を実行せず undefined を返す（＝保留）。
  function withMapLock(fn) {
    if (!locksAvailable()) return Promise.resolve(undefined);
    return navigator.locks.request(LOCK_NAME, fn);
  }

  function defaultDerive(seed) {
    if (!window.CMSeedVault ||
        typeof window.CMSeedVault.derivePasskeyIdentifier !== 'function') {
      return Promise.reject(new Error('CMSeedVault is not available'));
    }
    var rpId = (typeof location !== 'undefined' && location.hostname)
      ? location.hostname : '';
    return window.CMSeedVault.derivePasskeyIdentifier(seedStr(seed), rpId);
  }

  function derive(seed, opts) {
    if (opts && typeof opts.deriveIdentifier === 'function') {
      return opts.deriveIdentifier(seedStr(seed));
    }
    return defaultDerive(seed);
  }

  function primaryCredB64(opts) {
    try {
      if (opts && typeof opts.getPrimaryCredB64 === 'function') {
        return opts.getPrimaryCredB64();
      }
    } catch (_) {}
    return null;
  }

  // 旧キーの削除は、プライマリ記録に同じ資格情報IDがある場合に限る。
  // （discoverable lookup の成功時もプライマリ記録はその資格情報で
  //   更新されるため、この条件で到達可能性の確認を兼ねる。）
  function maybeDeleteLegacy(seed, credB64, opts) {
    try {
      var primary = primaryCredB64(opts);
      if (primary && primary === credB64) {
        localStorage.removeItem(legacyKey(seed));
        return true;
      }
    } catch (_) {}
    return false;
  }

  // マップへの書き込み（移行・保存の共通処理）。
  // 成功したら true、保留・失敗なら false を返す。失敗時に旧キーは消さない。
  async function writeEntry(seed, credB64, opts) {
    var id = await derive(seed, opts);
    var done = await withMapLock(async function () {
      var m = readMap();
      if (!m.ok) return false; // 壊れた新形式は上書きしない
      m.map[id] = credB64;
      try { writeMap(m.map); } catch (_) { return false; }
      return verifyEntry(id, credB64);
    });
    if (done) {
      cache.set(seedStr(seed), credB64);
      maybeDeleteLegacy(seed, credB64, opts);
    }
    return !!done;
  }

  // 資格情報IDの解決: 新形式 → 旧形式（見つかれば移行を試みる）。
  async function resolve(seed, opts) {
    var s = seedStr(seed);
    var id = null;
    try { id = await derive(seed, opts); } catch (_) { id = null; }
    if (id) {
      var m = readMap();
      if (m.ok && typeof m.map[id] === 'string' && m.map[id]) {
        cache.set(s, m.map[id]);
        return m.map[id];
      }
    }
    var legacy = null;
    try { legacy = localStorage.getItem(legacyKey(seed)); } catch (_) {}
    if (legacy) {
      cache.set(s, legacy);
      if (id) {
        try { await writeEntry(seed, legacy, opts); } catch (_) {}
      }
      return legacy;
    }
    cache.set(s, null);
    return null;
  }

  // PRF 成功後の保存。書けなくても旧キーは消さず、false を返す。
  async function store(seed, credB64, opts) {
    if (!credB64) return false;
    try { return await writeEntry(seed, credB64, opts); } catch (_) { return false; }
  }

  // 同期参照用: キャッシュ → 旧キーの順で即時に返す。
  function peek(seed) {
    var s = seedStr(seed);
    if (cache.has(s)) return cache.get(s);
    try { return localStorage.getItem(legacyKey(seed)); } catch (_) { return null; }
  }

  // キャッシュを温める（結果は使わない）。同期参照の前に呼んでおく。
  function prime(seed, opts) {
    resolve(seed, opts).catch(function () {});
  }

  window.CMPasskeyStore = {
    resolve: resolve,
    store: store,
    peek: peek,
    prime: prime
  };
})();
