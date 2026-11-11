/**
 * CryptoPassKey / crypto_matrix — Time Secret Module v2.12.0 (timesecret.js)
 *
 * Multi-Vault Check-in Timed Vault ("タイムシークレット"):
 * - Separated 3-Layer Authentication per vault (DeviceKey-sealed, tamper-evident):
 *     1. Encryption Auth (encryptionAuth): Protects DEK via CME3 + Card Array Seed (CMA1) + non-extractable DeviceKey
 *     2. Check-In Auth (checkInAuth): Independent policy (認証なし / パスワード / キーファイル / パスキー / 任意の組み合わせ)
 *     3. Management Auth (managementAuth): Protects vault deletion, deadline policy edits, check-in auth edits, and check-in passkey registration/removal (with Encryption Auth + DeviceKey recovery path)
 * - Dedicated Check-In / Management WebAuthn PRF Passkey registration & verification (domain-separated from CME3)
 * - Unified KeePass 2.0 XML (.key) generation & strict validation shared across Sections 2–6
 * - Unified Card Array Seed binding (CMA1 'TimeSecret' domain) with 100% backward compatibility for pre-v2.12.0 vaults
 * - Flexible Deadline Settings: Relative duration (extends on check-in), Absolute timestamp (fixed deadline), and 6 Quick Presets (including explicit 30s test preset)
 * - Multi-tab concurrency safety (Web Locks API per vaultId + atomic per-key IndexedDB transactions + BroadcastChannel live sync)
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: false });
  const decFatal = new TextDecoder('utf-8', { fatal: true });

  const DB_NAME = 'CryptoMatrix_TimeSecret_v1';
  const DB_VERSION = 3;
  const STORE_VAULTS = 'vaults';
  const STORE_KEYSTORE = 'keystore';
  const STORE_TOMBSTONES = 'tombstones';
  const SYNC_CHANNEL_NAME = 'CryptoMatrix_TimeSecret_Sync_v2';

  const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
  const MIN_RELATIVE_MS = 5 * 1000; // 5s API floor (supports 30s quick test preset)
  const MAX_RELATIVE_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
  const CLOCK_ROLLBACK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const NOTIFY_24H_MS = 24 * 60 * 60 * 1000;
  const NOTIFY_1H_MS = 60 * 60 * 1000;

  // Auth combo codes: -1 = 認証なし, 0..6 = factor combinations
  const AUTH_NONE_COMBO = -1;

  const KDF_PBKDF2_ITERS = Object.freeze({
    0: 600000,
    1: 2100000,
    2: 5000000
  });
  const KDF_ARGON2_CFGS = Object.freeze({
    3: { memorySize: 65536, iterations: 3, parallelism: 1 },
    4: { memorySize: 131072, iterations: 3, parallelism: 1 },
    5: { memorySize: 262144, iterations: 4, parallelism: 1 }
  });

  const STATES = Object.freeze({
    ACTIVE: 'ACTIVE',
    WARNING: 'WARNING',
    CLOCK_SUSPECT: 'CLOCK_SUSPECT',
    EXPIRED: 'EXPIRED',
    DELETE_PENDING: 'DELETE_PENDING',
    DELETE_FAILED: 'DELETE_FAILED',
    DESTROYED: 'DESTROYED',
    CORRUPTED: 'CORRUPTED'
  });

  const STATE_LABELS = Object.freeze({
    ACTIVE: '正常',
    WARNING: '期限接近',
    CLOCK_SUSPECT: '時計異常・復旧待ち',
    EXPIRED: '期限切れ',
    DELETE_PENDING: '削除処理中',
    DELETE_FAILED: '削除失敗',
    DESTROYED: '鍵の破棄を確認済み',
    CORRUPTED: 'データ破損・要確認'
  });

  // Runtime state (Map of vaultId -> vaultRecord, Map of vaultId -> tombstoneRecord)
  let vaultsMap = new Map();
  let tombstonesMap = new Map();
  const highWaterMarks = new Map(); // vaultId -> monotonic lastSeen in this session
  const recoveryNotices = new Map(); // vaultId -> notice string

  /* =====================================================================
   * Secondary State Anchor (localStorage High-Water Mark for Rollback & Re-injection Defense)
   * ===================================================================== */
  const STORAGE_HW_PREFIX = 'cm_ts_hw_anchor_';
  const CONSENT_STORAGE_KEY = 'cm_timesecret_consent_version';
  const CURRENT_CONSENT_VERSION = 'timesecret_consent_v1';

  function hasValidConsent() {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(CONSENT_STORAGE_KEY) === CURRENT_CONSENT_VERSION;
    } catch (_) {
      return false;
    }
  }

  function recordConsent() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CONSENT_STORAGE_KEY, CURRENT_CONSENT_VERSION);
      }
    } catch (_) {}
  }

  let tsTransferredPayload = null; // { source: 'sec3'|'sec4', label, bytes, armoredText, factorLabel, shamirM, shamirN, createdPassword, filename }

  function updateConsentUI() {
    const agreed = hasValidConsent();
    const badge = $('ts-consent-status-badge');
    const body = $('ts-guarantees-body');
    const agreedBox = $('ts-guarantees-agreed-box');
    const chk = $('ts-ack-devicekey');

    if (agreed) {
      if (badge) badge.style.display = 'inline-block';
      if (body) body.style.display = 'none';
      if (agreedBox) agreedBox.style.display = 'block';
      if (chk) chk.checked = true;
    } else {
      if (badge) badge.style.display = 'none';
      if (body) body.style.display = 'block';
      if (agreedBox) agreedBox.style.display = 'none';
      if (chk) chk.checked = false;
    }
  }

  function openHelpModal() {
    const modal = $('ts-help-modal');
    if (!modal) return;
    modal.hidden = false;
    $('btn-ts-help-ok')?.focus();
  }

  function closeHelpModal() {
    const modal = $('ts-help-modal');
    if (!modal) return;
    modal.hidden = true;
  }

  function syncPayloadUI() {
    const isText = $('ts-type-text')?.checked;
    const isFile = $('ts-type-file')?.checked;
    const isTransferred = $('ts-type-transferred')?.checked;

    if ($('ts-input-text-area')) $('ts-input-text-area').hidden = !isText;
    if ($('ts-input-file-area')) $('ts-input-file-area').hidden = !isFile;
    if ($('ts-input-transferred-area')) $('ts-input-transferred-area').hidden = !isTransferred;

    if (isTransferred && tsTransferredPayload && $('ts-transferred-summary')) {
      const p = tsTransferredPayload;
      $('ts-transferred-summary').innerHTML = `
        <div style="font-weight:700; color:#fbbf24; margin-bottom:4px;">🔗 転記済みデータ：${escapeHtml(p.label)}</div>
        <div style="font-size:0.8rem; color:#d1d5db; line-height:1.5;">
          ・データサイズ：<strong>${p.bytes.length.toLocaleString()} bytes</strong>（元ファイル名：<code>${escapeHtml(p.filename)}</code>）<br>
          ・転記元の保護：<strong>${escapeHtml(p.factorLabel)}</strong>${p.shamirN > 1 ? ` ＋ 秘密分散 (${p.shamirM}-of-${p.shamirN})` : ''}<br>
          ・<strong>保護構造：</strong>転記元の暗号化データは復号・再暗号化されず、元のバイナリ形式のままタイムシークレット内に安全に封入されます。<br>
          　→ 復号時はそのまま <code>${escapeHtml(p.filename)}</code> としてダウンロード・保存できます。
        </div>
      `;
    }
  }

  function openCreateView() {
    closeAuthModal();
    clearOpenedSecret();
    clearCreateInputs();
    currentView = 'create';
    renderUI();
    updateConsentUI();
    syncPayloadUI();
  }

  function receiveTransferredPayload(info) {
    if (!info || (!info.bytes && !info.armoredText)) return;
    const rawBytes = info.bytes instanceof Uint8Array ? info.bytes.slice() : enc.encode(info.armoredText);

    const tsTabBtn = document.querySelector('[data-tab="timesecret"]');
    if (tsTabBtn && typeof tsTabBtn.click === 'function') {
      tsTabBtn.click();
    }

    openCreateView();

    tsTransferredPayload = {
      source: info.source || 'sec4',
      label: info.label || '既存の暗号化データ',
      bytes: rawBytes,
      armoredText: info.armoredText || '',
      factorLabel: info.factorLabel || '暗号化済み',
      shamirM: info.shamirM || 1,
      shamirN: info.shamirN || 1,
      createdPassword: info.createdPassword || '',
      filename: info.filename || (info.source === 'sec3' ? 'cryptomatrix-backup.cmenc' : 'vault-secret.cmenc')
    };

    const radioTrans = $('ts-type-transferred');
    if (radioTrans) {
      radioTrans.disabled = false;
      radioTrans.checked = true;
    }
    if ($('ts-vault-label')) {
      $('ts-vault-label').value = tsTransferredPayload.label;
    }
    syncPayloadUI();
    setStatusMsg('ts-create-progress', `🔗 ${tsTransferredPayload.label}（${rawBytes.length.toLocaleString()} bytes）を転記しました。元のデータは消去・変更されていません。`, 'ok');
  }

  function getHighWaterAnchor(vaultId) {
    if (!vaultId) return null;
    if (typeof localStorage === 'undefined') {
      throw new Error('ロールバック検知用ストレージを利用できません。安全のため操作を拒否します。');
    }
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_HW_PREFIX + vaultId);
    } catch (_) {
      throw new Error('ロールバック検知用記録を読み取れません。安全のため操作を拒否します。');
    }
    if (raw === null) return null; // Legacy vaults / first initialization are handled by callers.
    let anchor;
    try {
      anchor = JSON.parse(raw);
    } catch (_) {
      throw new Error('ロールバック検知用記録が破損しています。安全のため操作を拒否します。');
    }
    if (!anchor || typeof anchor !== 'object' ||
        String(anchor.vaultId || '') !== String(vaultId) ||
        !Number.isFinite(Number(anchor.policyRev)) ||
        !Number.isFinite(Number(anchor.lastSeen)) ||
        typeof anchor.state !== 'string') {
      throw new Error('ロールバック検知用記録の形式が不正です。安全のため操作を拒否します。');
    }
    return anchor;
  }

  function setHighWaterAnchor(vaultId, data = {}) {
    if (!vaultId) throw new Error('ロールバック検知用記録を作成できません（vaultIdなし）。');
    if (typeof localStorage === 'undefined') {
      throw new Error('ロールバック検知用ストレージを利用できません。安全のため操作を拒否します。');
    }
    try {
      const prev = getHighWaterAnchor(vaultId) || {};
      const next = {
        vaultId: String(vaultId),
        policyRev: Math.max(Number(prev.policyRev || 0), Number(data.policyRev || 0)),
        lastSeen: Math.max(Number(prev.lastSeen || 0), Number(data.lastSeen || 0)),
        state: String(data.state || prev.state || 'ACTIVE'),
        updatedAt: nowMs()
      };
      const key = STORAGE_HW_PREFIX + vaultId;
      localStorage.setItem(key, JSON.stringify(next));
      // Read-after-write verification: do not silently continue if storage is unavailable,
      // quota-limited, or the value cannot be persisted exactly.
      const persisted = localStorage.getItem(key);
      if (persisted !== JSON.stringify(next)) {
        throw new Error('保存したロールバック検知用記録を読み戻せませんでした。');
      }
      return true;
    } catch (err) {
      throw new Error(`ロールバック検知用記録を保存できません。安全のため操作を拒否します。${err?.message ? ' ' + err.message : ''}`);
    }
  }

  function clearHighWaterAnchor(vaultId) {
    if (!vaultId || typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(STORAGE_HW_PREFIX + vaultId);
    } catch (_) {}
  }

  function verifyNoRollbackAgainstAnchor(vaultId, vaultRecord) {
    if (!vaultId || !vaultRecord) return;
    const anchor = getHighWaterAnchor(vaultId);
    if (!anchor) return;

    if (anchor.policyRev && Number(vaultRecord.policyRev || 0) < Number(anchor.policyRev)) {
      throw new Error(`ストレージロールバック改ざんを検知しました（記録されたポリシーリビジョン: rev ${anchor.policyRev}、提供されたレコード: rev ${vaultRecord.policyRev}）。処理を拒絶します。`);
    }
    if (anchor.lastSeen && Number(vaultRecord.lastSeen || 0) < Number(anchor.lastSeen) - CLOCK_ROLLBACK_THRESHOLD_MS) {
      throw new Error('観測時刻の逆行（ロールバック改ざんまたは時計異常）を検知しました。処理を拒絶します。');
    }
  }

  async function assertNotDestroyedOrTombstoned(vaultId) {
    if (!vaultId) return;
    const tomb = await idbGet(STORE_TOMBSTONES, vaultId);
    if (tomb && (tomb.state === STATES.DESTROYED || tomb.state === STATES.DELETE_PENDING || tomb.state === 'DELETE_FAILED' || tomb.state === STATES.EXPIRED)) {
      throw new Error('このタイムシークレットは既に破棄または削除済みです。復元や操作はできません。');
    }
    const anchor = getHighWaterAnchor(vaultId);
    if (anchor && (anchor.state === STATES.DESTROYED || anchor.state === STATES.DELETE_PENDING)) {
      throw new Error('このタイムシークレットは既に破棄または削除済みです（セカンダリ記録確認済み）。復元や操作はできません。');
    }
  }

  let currentView = 'list'; // 'list' | 'create' | 'detail'
  let selectedVaultId = null;
  let globalNotifEnabled = false;
  let lifecycleBusy = false;
  let lifecycleQueue = Promise.resolve();
  let countdownTimerId = null;
  let heartbeatTimerId = null;
  let syncChannel = null;

  // Ephemeral buffers (scrubbed on close / view switch / emergency zeroize)
  let selectedSecretFile = null;
  let selectedSecretFileBytes = null;

  let createKeyfileBytes = null;
  let createKeyfileName = '';
  let createCiKeyfileBytes = null;
  let createCiKeyfileName = '';
  let createMgmtKeyfileBytes = null;
  let createMgmtKeyfileName = '';

  let detailUnlockKeyfileBytes = null;
  let detailUnlockKeyfileName = '';
  let editCiKeyfileBytes = null;
  let editCiKeyfileName = '';
  let editMgmtKeyfileBytes = null;
  let editMgmtKeyfileName = '';
  let modalKeyfileBytes = null;
  let modalKeyfileName = '';

  // Ephemeral pre-registered WebAuthn PRF passkey sessions ({ purpose, credentialId, pkPrfSalt, prfOutput, reusedExisting })
  let pendingCreateCiPkSession = null;
  let pendingCreateMgmtPkSession = null;
  let pendingEditCiPkSession = null;
  let pendingEditMgmtPkSession = null;

  let openedSecret = null; // { vaultId, kind, name, mime, dataBytes, sha256Hex, createdAt }
  let pendingModalContext = null; // { action, vaultId, extraParams }

  // Clock source (defaults to Date.now)
  let nowProvider = () => Date.now();

  /* =====================================================================
   * 1. Utilities, Unified Keyfile Helpers, Concurrency Locks, & Scrubbing
   * ===================================================================== */
  function getPreset() {
    if (!window.MatrixCardPreset) {
      throw new Error('暗号コアモジュール (index.js) が読み込まれていません。ページを再読み込みしてください。');
    }
    return window.MatrixCardPreset;
  }

  function nowMs() {
    const t = Number(nowProvider());
    return Number.isFinite(t) ? t : Date.now();
  }

  function getCurrentCardSeed() {
    const raw = ($('input-seed-number')?.value ?? '0');
    const trimmed = String(raw).trim();
    return trimmed.length > 0 ? trimmed : '0';
  }

  async function withVaultLock(vaultId, fn) {
    const lockName = `cm-timesecret-v2-${vaultId || 'global'}`;
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request(lockName, { mode: 'exclusive' }, fn);
    }
    return await fn();
  }

  function broadcastSync(type, vaultId = null) {
    try {
      syncChannel?.postMessage({ type, vaultId, ts: Date.now() });
    } catch (_) {}
  }

  function zeroizeBuf(buf) {
    if (!buf) return;
    try {
      if (window.MatrixCardPreset?.zeroize && buf instanceof Uint8Array) {
        window.MatrixCardPreset.zeroize(buf);
      } else if (buf instanceof Uint8Array) {
        buf.fill(0);
      } else if (buf instanceof ArrayBuffer) {
        new Uint8Array(buf).fill(0);
      }
    } catch (_) {}
  }

  function scrubPasskeySession(sess) {
    if (!sess) return null;
    if (sess.prfOutput) zeroizeBuf(sess.prfOutput);
    if (sess.pkPrfSalt) zeroizeBuf(sess.pkPrfSalt);
    return null;
  }

  function scrubInputEl(el) {
    if (!el) return;
    if (el.type === 'file') {
      try { el.value = ''; } catch (_) {}
      return;
    }
    const len = el.value ? el.value.length : 0;
    if (len > 0) {
      try {
        el.value = '0'.repeat(len);
        el.value = '\u0000'.repeat(len);
      } catch (_) {}
    }
    el.value = '';
  }

  function concatBytes(...arrays) {
    let total = 0;
    for (const a of arrays) total += a ? a.length : 0;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      if (a && a.length) {
        out.set(a, offset);
        offset += a.length;
      }
    }
    return out;
  }

  function equalBytes(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function toUint8(val) {
    if (val instanceof Uint8Array) return val;
    if (val instanceof ArrayBuffer) return new Uint8Array(val);
    if (ArrayBuffer.isView(val)) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    if (Array.isArray(val)) return new Uint8Array(val);
    return new Uint8Array(0);
  }

  async function sha256Bytes(data) {
    const u8 = data instanceof Uint8Array ? data : enc.encode(String(data));
    return new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
  }

  async function sha512Bytes(data) {
    const u8 = data instanceof Uint8Array ? data : enc.encode(String(data));
    return new Uint8Array(await crypto.subtle.digest('SHA-512', u8));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    const clean = String(hex || '').trim();
    if (!clean || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
      return new Uint8Array(0);
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDateTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatLocalDatetimeInput(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    const abs = Math.max(0, Math.floor(Math.abs(ms) / 1000));
    const days = Math.floor(abs / 86400);
    const hours = Math.floor((abs % 86400) / 3600);
    const mins = Math.floor((abs % 3600) / 60);
    const secs = abs % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}日`);
    if (hours > 0 || days > 0) parts.push(`${hours}時間`);
    if (mins > 0 || hours > 0 || days > 0) parts.push(`${mins}分`);
    parts.push(`${secs}秒`);
    return parts.join(' ');
  }

  function formatIntervalLabel(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const yearMs = 365 * 86400000;
    const dayMs = 86400000;
    const hourMs = 3600000;
    const minMs = 60000;
    if (ms % yearMs === 0) return `${ms / yearMs}年`;
    if (ms % dayMs === 0) return `${ms / dayMs}日`;
    if (ms % hourMs === 0) return `${ms / hourMs}時間`;
    if (ms % minMs === 0) return `${ms / minMs}分`;
    return `${Math.round(ms / 1000)}秒`;
  }

  function formatBytes(len) {
    if (!Number.isFinite(len) || len < 1024) return `${len || 0} B`;
    if (len < 1024 * 1024) return `${(len / 1024).toFixed(1)} KB`;
    return `${(len / (1024 * 1024)).toFixed(2)} MB`;
  }

  function downloadBlob(blob, filename) {
    if (window.MatrixCardPreset?.downloadBlob) {
      window.MatrixCardPreset.downloadBlob(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function setStatusMsg(id, text, type = 'info') {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.dataset.type = type;
    el.className = 'ts-status-bar' + (text ? ` ts-status-${type}` : '');
  }

  /**
   * Unified Keyfile Validation (delegates to MatrixCardPreset.validateKeyfileBytes).
   * Accepts KeePass 2.0 / 1.0 XML (.key) from Sections 2–5 and valid binary keyfiles;
   * strictly rejects empty (0B), oversized (>20MB), malformed XML, or Hash-corrupted .key files.
   */
  async function validateKeyfileOrThrow(rawBytes, filename = '') {
    const preset = getPreset();
    if (typeof preset.validateKeyfileBytes === 'function') {
      return await preset.validateKeyfileBytes(rawBytes, filename);
    }
    const u8 = toUint8(rawBytes);
    if (!u8.length) throw new Error('キーファイルが空（0バイト）か読み込めません。');
    if (u8.length > MAX_FILE_BYTES) throw new Error('キーファイルのサイズが上限（20MB）を超えています。');
    return { valid: true, format: 'binary', byteLength: u8.length };
  }

  /**
   * Unified KeePass 2.0 XML (.key) Keyfile Generator shared with Sections 2, 3, 4, and 5.
   * Never uses a Time-Secret-only keyfile format!
   */
  async function runUnifiedKeyfileGenerator({
    statusElId,
    defaultPassword = '',
    defaultPasskey = false,
    context = 'timesecret',
    onGenerated
  }) {
    const preset = getPreset();
    const seedNum = typeof preset.getValidSeedOrPrompt === 'function'
      ? preset.getValidSeedOrPrompt(statusElId)
      : Number(getCurrentCardSeed()) || 0;
    if (seedNum === null) return;

    const cleanPw = Array.from(String(defaultPassword || '')).length >= 12 ? String(defaultPassword) : '';

    if (window.__SKIP_KEYFILE_MODAL__ || typeof preset.showKeyfileModal !== 'function') {
      const filename = `cryptomatrix-card-${seedNum}.key`;
      const res = await preset.exportKeePassXmlKeyfile({
        seedNum,
        password: cleanPw,
        filename
      });
      const bytes = enc.encode(res.keyData.xml);
      await validateKeyfileOrThrow(bytes, res.filename);
      onGenerated?.(bytes, res.filename, seedNum);
      return;
    }

    preset.showKeyfileModal(
      { seedNum, defaultPassword: cleanPw, defaultPasskey: Boolean(defaultPasskey), context },
      async (opts) => {
        try {
          const filename = `cryptomatrix-card-${opts.seedNum}.key`;
          const res = await preset.exportKeePassXmlKeyfile({
            seedNum: opts.seedNum,
            password: opts.password,
            passkeyFactor: opts.passkeyFactor,
            passkeyCred: opts.passkeyCred,
            filename
          });
          const bytes = enc.encode(res.keyData.xml);
          await validateKeyfileOrThrow(bytes, res.filename);
          onGenerated?.(bytes, res.filename, opts.seedNum);
        } catch (err) {
          setStatusMsg(statusElId, `❌ キーファイル生成エラー: ${err?.message || err}`, 'err');
        }
      }
    );
  }

  /* =====================================================================
   * 2. Multi-Vault IndexedDB Engine & v1 -> v2 -> v3 Seamless Migration
   * ===================================================================== */
  function openTimeSecretDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('このブラウザ環境ではIndexedDBが利用できません。タイムシークレットにはIndexedDBが必要です。'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_VAULTS)) {
          db.createObjectStore(STORE_VAULTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_KEYSTORE)) {
          db.createObjectStore(STORE_KEYSTORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) {
          db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDBのオープンに失敗しました。'));
      req.onblocked = () => reject(new Error('IndexedDBが他タブによりブロックされています。'));
    });
  }

  async function migrateLegacyV1RecordsIfNeeded() {
    const db = await openTimeSecretDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_VAULTS, STORE_TOMBSTONES], 'readwrite');
        const vs = tx.objectStore(STORE_VAULTS);
        const ts = tx.objectStore(STORE_TOMBSTONES);

        const vReq = vs.get('active');
        vReq.onsuccess = () => {
          const legacyVault = vReq.result;
          if (legacyVault && legacyVault.vaultId) {
            vs.delete('active');
            vs.put({
              ...legacyVault,
              id: legacyVault.vaultId,
              label: legacyVault.label || 'マイ・タイムシークレット',
              rev: Number(legacyVault.rev || 1)
            });
          }
        };

        const tReq = ts.get('latest');
        tReq.onsuccess = () => {
          const legacyTomb = tReq.result;
          if (legacyTomb) {
            ts.delete('latest');
            const tid = legacyTomb.vaultId && legacyTomb.vaultId !== 'unknown'
              ? legacyTomb.vaultId
              : `legacy-${legacyTomb.startedAt || Date.now()}`;
            ts.put({
              ...legacyTomb,
              id: tid,
              vaultId: tid,
              label: legacyTomb.label || 'タイムシークレット（旧履歴）'
            });
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (_) {
      // Non-fatal if no legacy records exist
    } finally {
      db.close();
    }
  }

  async function idbGet(storeName, key) {
    const db = await openTimeSecretDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error || new Error(`${storeName}.get に失敗しました。`));
      });
    } finally {
      db.close();
    }
  }

  async function idbGetAll(storeName) {
    const db = await openTimeSecretDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error || new Error(`${storeName}.getAll に失敗しました。`));
      });
    } finally {
      db.close();
    }
  }

  async function idbPut(storeName, value) {
    const db = await openTimeSecretDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(value);
        req.onerror = () => reject(req.error || new Error(`${storeName}.put に失敗しました。`));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`${storeName} 書き込みトランザクションに失敗しました。`));
        tx.onabort = () => reject(tx.error || new Error(`${storeName} 書き込みトランザクションが中断されました。`));
      });
    } finally {
      db.close();
    }
  }

  async function idbDeleteKey(storeName, key) {
    const db = await openTimeSecretDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(key);
        req.onerror = () => reject(req.error || new Error(`${storeName}.delete に失敗しました。`));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`${storeName} 削除トランザクションに失敗しました。`));
        tx.onabort = () => reject(tx.error || new Error(`${storeName} 削除トランザクションが中断されました。`));
      });
    } finally {
      db.close();
    }
  }

  async function idbPutVaultAndKeyBundle(keyRecord, vaultRecord) {
    const db = await openTimeSecretDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_KEYSTORE, STORE_VAULTS], 'readwrite');
        tx.objectStore(STORE_KEYSTORE).put(keyRecord);
        tx.objectStore(STORE_VAULTS).put(vaultRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('金庫データのIndexedDB保存に失敗しました。'));
        tx.onabort = () => reject(tx.error || new Error('金庫データの保存トランザクションが中断されました。'));
      });
    } finally {
      db.close();
    }
  }

  async function idbDeleteSingleVaultCompletely(vaultId) {
    const db = await openTimeSecretDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_KEYSTORE, STORE_VAULTS, STORE_TOMBSTONES], 'readwrite');
        tx.objectStore(STORE_KEYSTORE).delete(vaultId);
        tx.objectStore(STORE_VAULTS).delete(vaultId);
        tx.objectStore(STORE_TOMBSTONES).delete(vaultId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('対象タイムシークレットの完全削除に失敗しました。'));
        tx.onabort = () => reject(tx.error || new Error('対象タイムシークレットの削除が中断されました。'));
      });
    } finally {
      db.close();
    }
  }

  async function idbClearAllTimeSecretStores() {
    const db = await openTimeSecretDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_KEYSTORE, STORE_VAULTS, STORE_TOMBSTONES], 'readwrite');
        tx.objectStore(STORE_KEYSTORE).clear();
        tx.objectStore(STORE_VAULTS).clear();
        tx.objectStore(STORE_TOMBSTONES).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('全タイムシークレット領域の消去に失敗しました。'));
      });
    } finally {
      db.close();
    }
  }

  /* =====================================================================
   * 3. Inner Structured Container (TSV1), Seed Binding (CMA1), & Envelope
   * ===================================================================== */
  async function packTSV1(kind, name, mime, dataBytes, createdAt) {
    const data = dataBytes instanceof Uint8Array ? dataBytes : new Uint8Array(0);
    const kindCode = kind === 'binary' ? 2 : (kind === 'json' ? 1 : 0);
    const metaJson = JSON.stringify({
      container: 'CryptoMatrix.TimeSecret.JSON.v2',
      kind: kindCode === 2 ? 'file' : 'text',
      name: String(name || (kindCode === 2 ? 'timesecret.bin' : 'timesecret.txt')),
      mime: String(mime || (kindCode === 2 ? 'application/octet-stream' : 'text/plain;charset=utf-8')),
      origSize: data.length,
      createdAt
    });
    const metaBytes = enc.encode(metaJson);
    if (metaBytes.length > 16384) {
      throw new Error('ファイル名等のメタデータが長すぎます。');
    }
    const blindSalt = crypto.getRandomValues(new Uint8Array(32));
    const plainSha = await sha256Bytes(data);
    const totalLen = 80 + metaBytes.length + 4 + data.length;
    const out = new Uint8Array(totalLen);
    const dv = new DataView(out.buffer);

    out[0] = 0x54; out[1] = 0x53; out[2] = 0x56; out[3] = 0x31; // "TSV1"
    out[4] = kindCode;
    out[5] = 0;
    out.set(blindSalt, 6);
    out.set(plainSha, 38);
    dv.setBigUint64(70, BigInt(createdAt), false);
    dv.setUint16(78, metaBytes.length, false);
    out.set(metaBytes, 80);
    const dataOffset = 80 + metaBytes.length;
    dv.setUint32(dataOffset, data.length, false);
    out.set(data, dataOffset + 4);
    return { tsv1Bytes: out, plainShaHex: bytesToHex(plainSha) };
  }

  async function unpackTSV1(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 84) {
      throw new Error('復号ペイロードの構造が不正です（サイズ不足）。');
    }
    if (bytes[0] !== 0x54 || bytes[1] !== 0x53 || bytes[2] !== 0x56 || bytes[3] !== 0x31) {
      throw new Error('復号ペイロードのTSV1ヘッダが一致しません。');
    }
    const kindCode = bytes[4];
    const kind = kindCode === 2 ? 'binary' : 'text';
    const expectedSha = bytes.slice(38, 70);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const createdAt = Number(dv.getBigUint64(70, false));
    const metaLen = dv.getUint16(78, false);
    if (bytes.length < 80 + metaLen + 4) {
      throw new Error('復号ペイロードのメタデータ長が破損しています。');
    }
    let meta;
    try {
      meta = JSON.parse(decFatal.decode(bytes.subarray(80, 80 + metaLen)));
    } catch (_) {
      throw new Error('復号ペイロードの内部JSONメタデータが破損しています。');
    }
    const dataOffset = 80 + metaLen;
    const dataLen = dv.getUint32(dataOffset, false);
    if (bytes.length !== dataOffset + 4 + dataLen) {
      throw new Error('復号ペイロードのデータ長が一致しません（破損または改ざん検出）。');
    }
    const dataBytes = bytes.slice(dataOffset + 4, dataOffset + 4 + dataLen);
    const actualSha = await sha256Bytes(dataBytes);
    if (!equalBytes(expectedSha, actualSha)) {
      zeroizeBuf(dataBytes);
      throw new Error('復号データのSHA-256整合性検証に失敗しました（破損または改ざん）。');
    }
    return {
      kind,
      name: String(meta.name || (kind === 'binary' ? 'timesecret.bin' : 'timesecret.txt')),
      mime: String(meta.mime || (kind === 'binary' ? 'application/octet-stream' : 'text/plain;charset=utf-8')),
      origSize: Number(meta.origSize ?? dataBytes.length),
      createdAt,
      dataBytes,
      sha256Hex: bytesToHex(actualSha)
    };
  }

  function buildPayloadAAD(vaultId, createdAt) {
    return enc.encode(`CM-TIMESECRET-PAYLOAD-V1|${vaultId}|${createdAt}`);
  }

  /**
   * Preserves exact v2.11.0 AAD when envelope.schemaVersion is absent so migrated pre-v2.12.0 vaults
   * remain 100% decryptable without altering a single byte of existing encrypted envelopes!
   */
  function buildDeviceWrapAAD(vaultId, createdAt, authMeta, payloadHashHex, envelopeSchemaVersion = 0, seedBound = false) {
    if (Number(envelopeSchemaVersion || 0) >= 3) {
      return enc.encode(JSON.stringify({
        domain: 'CM-TIMESECRET-DEVWRAP-V3',
        schemaVersion: 3,
        vaultId: String(vaultId),
        createdAt: Number(createdAt),
        usePassword: Boolean(authMeta.usePassword),
        useKeyfile: Boolean(authMeta.useKeyfile),
        usePasskey: Boolean(authMeta.usePasskey),
        kdfProfile: Number(authMeta.kdfProfile),
        combo: Number(authMeta.combo),
        seedBound: Boolean(seedBound),
        payloadHashHex: String(payloadHashHex)
      }));
    }
    return enc.encode(JSON.stringify({
      domain: 'CM-TIMESECRET-DEVWRAP-V1',
      vaultId: String(vaultId),
      createdAt: Number(createdAt),
      usePassword: Boolean(authMeta.usePassword),
      useKeyfile: Boolean(authMeta.useKeyfile),
      usePasskey: Boolean(authMeta.usePasskey),
      kdfProfile: Number(authMeta.kdfProfile),
      combo: Number(authMeta.combo),
      payloadHashHex: String(payloadHashHex)
    }));
  }

  async function computeEnvelopeCommitHex(vaultId, createdAt, authMeta, envelope, seedBound = false) {
    const payloadIv = toUint8(envelope.payloadIv);
    const payloadCiphertext = toUint8(envelope.payloadCiphertext);
    const deviceWrapIv = toUint8(envelope.deviceWrapIv);
    const deviceWrappedCmeDek = toUint8(envelope.deviceWrappedCmeDek);
    const payloadHash = await sha256Bytes(concatBytes(payloadIv, payloadCiphertext));
    const wrapHash = await sha256Bytes(concatBytes(deviceWrapIv, deviceWrappedCmeDek));
    const schemaVer = Number(envelope.schemaVersion || 0);
    const metaObj = schemaVer >= 3
      ? {
          domain: 'CM-TIMESECRET-COMMIT-V3',
          schemaVersion: 3,
          vaultId,
          createdAt,
          usePassword: Boolean(authMeta.usePassword),
          useKeyfile: Boolean(authMeta.useKeyfile),
          usePasskey: Boolean(authMeta.usePasskey),
          kdfProfile: Number(authMeta.kdfProfile),
          combo: Number(authMeta.combo),
          seedBound: Boolean(seedBound),
          pLen: payloadCiphertext.length,
          wLen: deviceWrappedCmeDek.length
        }
      : {
          domain: 'CM-TIMESECRET-COMMIT-V1',
          vaultId,
          createdAt,
          usePassword: Boolean(authMeta.usePassword),
          useKeyfile: Boolean(authMeta.useKeyfile),
          usePasskey: Boolean(authMeta.usePasskey),
          kdfProfile: Number(authMeta.kdfProfile),
          combo: Number(authMeta.combo),
          pLen: payloadCiphertext.length,
          wLen: deviceWrappedCmeDek.length
        };
    const metaBytes = enc.encode(JSON.stringify(metaObj));
    return bytesToHex(await sha256Bytes(concatBytes(metaBytes, payloadHash, wrapHash)));
  }

  function computeAuthCombo(usePass, useKeyfile, usePasskey) {
    if (!usePass && !useKeyfile && !usePasskey) return AUTH_NONE_COMBO;
    if (usePass && !useKeyfile && !usePasskey) return 0;
    if (usePass && useKeyfile && !usePasskey) return 1;
    if (usePass && !useKeyfile && usePasskey) return 2;
    if (usePass && useKeyfile && usePasskey) return 3;
    if (!usePass && useKeyfile && !usePasskey) return 4;
    if (!usePass && !useKeyfile && usePasskey) return 5;
    return 6;
  }

  function requiresUserAuth(policyObj) {
    if (!policyObj) return false;
    if (policyObj.mode === 'none') return false;
    return Boolean(policyObj.usePassword || policyObj.useKeyfile || policyObj.usePasskey);
  }

  async function generateNonExtractableDeviceKey() {
    if (!window.crypto?.subtle) {
      throw new Error('Web Crypto API が利用できない環境です。HTTPSまたはlocalhostで開いてください。');
    }
    return await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function sealSecretEnvelope({
    vaultId,
    createdAt,
    kind,
    name,
    mime,
    plainBytes,
    password,
    kdfProfile,
    usePassword,
    useKeyfile,
    usePasskey,
    keyfileBytes,
    keyfileName = '',
    seedBound = true,
    seedNum = '0',
    deviceKey
  }) {
    const combo = computeAuthCombo(usePassword, useKeyfile, usePasskey);
    const authMeta = {
      usePassword: Boolean(usePassword),
      useKeyfile: Boolean(useKeyfile),
      usePasskey: Boolean(usePasskey),
      kdfProfile: Number(kdfProfile || 3),
      combo
    };

    if (useKeyfile) {
      await validateKeyfileOrThrow(keyfileBytes, keyfileName);
    }

    const rawDek = crypto.getRandomValues(new Uint8Array(32));
    const dekBundle = new Uint8Array(36);
    if (combo === AUTH_NONE_COMBO) {
      dekBundle[0] = 0x54; dekBundle[1] = 0x53; dekBundle[2] = 0x44; dekBundle[3] = 0x4e; // "TSDN"
    } else {
      dekBundle[0] = 0x54; dekBundle[1] = 0x53; dekBundle[2] = 0x44; dekBundle[3] = 0x4b; // "TSDK"
    }
    dekBundle.set(rawDek, 4);

    let tsv1Bytes = null;
    let bodyToEncrypt = null;
    let innerProtectedDek = null;
    let createdPrfForImmediateVerify = null;
    let encryptionPasskeyCredId = null;

    try {
      const preset = getPreset();
      const packed = await packTSV1(kind, name, mime, plainBytes, createdAt);
      tsv1Bytes = packed.tsv1Bytes;

      if (seedBound) {
        bodyToEncrypt = await preset.packAppBound('TimeSecret', tsv1Bytes, String(seedNum ?? '0').trim() || '0');
      } else {
        bodyToEncrypt = tsv1Bytes.slice();
      }

      const dekCryptoKey = await crypto.subtle.importKey(
        'raw',
        rawDek,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
      const payloadIv = crypto.getRandomValues(new Uint8Array(12));
      const payloadAAD = buildPayloadAAD(vaultId, createdAt);
      const payloadCiphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: payloadIv, additionalData: payloadAAD, tagLength: 128 },
          dekCryptoKey,
          bodyToEncrypt
        )
      );

      if (combo === AUTH_NONE_COMBO) {
        innerProtectedDek = dekBundle.slice();
      } else {
        const factors = {
          usePassword: Boolean(usePassword),
          useKeyfile: Boolean(useKeyfile),
          usePasskey: Boolean(usePasskey),
          keyfileBytes: useKeyfile ? keyfileBytes : null
        };
        innerProtectedDek = await preset.encryptBodyCME3(
          dekBundle,
          usePassword ? password : '',
          Number(kdfProfile || 3),
          factors
        );
        if (usePasskey && factors.createdPrf) {
          encryptionPasskeyCredId = factors.createdPrf.credentialId
            ? new Uint8Array(factors.createdPrf.credentialId)
            : null;
          if (innerProtectedDek.length >= 37 && encryptionPasskeyCredId) {
            const cmeVersion = innerProtectedDek[3];
            const prfSalt = cmeVersion === 4 ? innerProtectedDek.slice(61, 93) : innerProtectedDek.slice(5, 37);
            const cacheKey = Array.from(prfSalt).join(',') + '|' + Array.from(encryptionPasskeyCredId).join(',');
            createdPrfForImmediateVerify = { cacheKey, prf: factors.createdPrf };
          }
        }
      }

      const schemaVersion = 3;
      const payloadHashHex = bytesToHex(await sha256Bytes(concatBytes(payloadIv, payloadCiphertext)));
      const deviceWrapIv = crypto.getRandomValues(new Uint8Array(12));
      const deviceAAD = buildDeviceWrapAAD(vaultId, createdAt, authMeta, payloadHashHex, schemaVersion, seedBound);
      const deviceWrappedCmeDek = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: deviceWrapIv, additionalData: deviceAAD, tagLength: 128 },
          deviceKey,
          innerProtectedDek
        )
      );

      const envelope = {
        schemaVersion,
        payloadIv,
        payloadCiphertext,
        deviceWrapIv,
        deviceWrappedCmeDek,
        payloadHashHex
      };
      envelope.envelopeCommitHex = await computeEnvelopeCommitHex(vaultId, createdAt, authMeta, envelope, seedBound);

      return { authMeta, envelope, createdPrfForImmediateVerify, encryptionPasskeyCredId };
    } finally {
      zeroizeBuf(rawDek);
      zeroizeBuf(dekBundle);
      if (tsv1Bytes) zeroizeBuf(tsv1Bytes);
      if (bodyToEncrypt) zeroizeBuf(bodyToEncrypt);
      if (innerProtectedDek) zeroizeBuf(innerProtectedDek);
    }
  }

  async function unwrapAndVerifyVaultKey({
    vaultRecord,
    deviceKey,
    password = '',
    keyfileBytes = null,
    keyfileName = '',
    seedNum = undefined,
    passkeyCacheMap = null,
    verifyAuthOnly = false
  }) {
    const encAuth = vaultRecord?.encryptionAuth || vaultRecord?.authMeta;
    if (!vaultRecord || !vaultRecord.envelope || !encAuth) {
      throw new Error('金庫レコードが破損しているか存在しません。');
    }
    if (!deviceKey) {
      throw new Error('このブラウザ内にこのタイムシークレット用の「デバイス鍵」が存在しません。サイトデータ消去等でデバイス鍵が失われた場合、復号できません。');
    }

    const { vaultId, createdAt, envelope } = vaultRecord;
    const schemaVer = Number(envelope.schemaVersion || 0);
    const seedBound = schemaVer >= 3 ? Boolean(vaultRecord.seedMeta?.seedBound) : false;

    const payloadIv = toUint8(envelope.payloadIv);
    const payloadCiphertext = toUint8(envelope.payloadCiphertext);
    const deviceWrapIv = toUint8(envelope.deviceWrapIv);
    const deviceWrappedCmeDek = toUint8(envelope.deviceWrappedCmeDek);

    const expectedCommit = await computeEnvelopeCommitHex(vaultId, createdAt, encAuth, {
      schemaVersion: envelope.schemaVersion,
      payloadIv,
      payloadCiphertext,
      deviceWrapIv,
      deviceWrappedCmeDek
    }, seedBound);
    if (expectedCommit !== envelope.envelopeCommitHex) {
      throw new Error('暗号化データと鍵メタデータの整合性検証に失敗しました（破損または改ざん検出）。');
    }

    const actualPayloadHashHex = bytesToHex(await sha256Bytes(concatBytes(payloadIv, payloadCiphertext)));
    if (envelope.payloadHashHex && actualPayloadHashHex !== envelope.payloadHashHex) {
      throw new Error('暗号化ペイロードのハッシュ整合性が一致しません。');
    }

    if (encAuth.usePassword && (!password || !String(password).length)) {
      throw new Error('暗号化パスワードが設定されています。パスワードを入力してください。');
    }
    if (encAuth.useKeyfile) {
      if (!keyfileBytes || !keyfileBytes.length) {
        throw new Error('暗号化キーファイルが設定されています。作成時と同じキーファイルを選択してください。');
      }
      await validateKeyfileOrThrow(keyfileBytes, keyfileName);
    }

    let innerProtectedDek = null;
    let cmeResult = null;
    let rawDek = null;
    let decryptedInner = null;
    let tsv1Plain = null;

    try {
      const deviceAAD = buildDeviceWrapAAD(vaultId, createdAt, encAuth, actualPayloadHashHex, schemaVer, seedBound);
      try {
        innerProtectedDek = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: deviceWrapIv, additionalData: deviceAAD, tagLength: 128 },
            deviceKey,
            deviceWrappedCmeDek
          )
        );
      } catch (_) {
        throw new Error('デバイス鍵によるエンベロープ検証に失敗しました（別金庫の鍵との混同または改ざん検出）。');
      }

      if (encAuth.combo === AUTH_NONE_COMBO && !requiresUserAuth(encAuth)) {
        if (innerProtectedDek.length !== 36 ||
            innerProtectedDek[0] !== 0x54 || innerProtectedDek[1] !== 0x53 ||
            innerProtectedDek[2] !== 0x44 || innerProtectedDek[3] !== 0x4e) {
          throw new Error('デバイス鍵保護DEKヘッダが不正です。');
        }
        rawDek = innerProtectedDek.slice(4, 36);
      } else {
        const preset = getPreset();
        const twoFaOpts = {
          keyfileBytes: encAuth.useKeyfile ? keyfileBytes : null
        };
        if (passkeyCacheMap instanceof Map) {
          twoFaOpts.__cmPasskeyCache = passkeyCacheMap;
        }
        cmeResult = await preset.decryptBodyCME(
          innerProtectedDek,
          encAuth.usePassword ? password : '',
          twoFaOpts
        );
        if (
          Boolean(cmeResult.needPass) !== Boolean(encAuth.usePassword) ||
          Boolean(cmeResult.needKeyfile) !== Boolean(encAuth.useKeyfile) ||
          Boolean(cmeResult.needPasskey) !== Boolean(encAuth.usePasskey)
        ) {
          throw new Error('認証要素の構成メタデータが暗号ヘッダと一致しません。');
        }
        const dekBundle = cmeResult.innerBody;
        if (!(dekBundle instanceof Uint8Array) || dekBundle.length !== 36 ||
            dekBundle[0] !== 0x54 || dekBundle[1] !== 0x53 || dekBundle[2] !== 0x44 || dekBundle[3] !== 0x4b) {
          throw new Error('復号されたDEKバンドルのマジックヘッダが不正です。');
        }
        rawDek = dekBundle.slice(4, 36);
        zeroizeBuf(dekBundle);
      }

      if (verifyAuthOnly) {
        return { authenticated: true };
      }

      const dekCryptoKey = await crypto.subtle.importKey(
        'raw',
        rawDek,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
      const payloadAAD = buildPayloadAAD(vaultId, createdAt);
      try {
        decryptedInner = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: payloadIv, additionalData: payloadAAD, tagLength: 128 },
            dekCryptoKey,
            payloadCiphertext
          )
        );
      } catch (_) {
        throw new Error('DEKによるデータ本体の認証付き復号に失敗しました。');
      }

      if (seedBound || (decryptedInner.length >= 32 &&
          decryptedInner[0] === 0x43 && decryptedInner[1] === 0x4d &&
          decryptedInner[2] === 0x41 && decryptedInner[3] === 0x31)) {
        const preset = getPreset();
        const effectiveSeed = seedNum !== undefined && seedNum !== null
          ? String(seedNum).trim()
          : getCurrentCardSeed();
        tsv1Plain = await preset.unpackAppBound('TimeSecret', decryptedInner, effectiveSeed || '0');
      } else {
        tsv1Plain = decryptedInner;
      }

      return await unpackTSV1(tsv1Plain);
    } finally {
      if (innerProtectedDek) zeroizeBuf(innerProtectedDek);
      if (cmeResult?.innerBody) zeroizeBuf(cmeResult.innerBody);
      if (rawDek) zeroizeBuf(rawDek);
      if (tsv1Plain && tsv1Plain !== decryptedInner) zeroizeBuf(tsv1Plain);
      if (decryptedInner) zeroizeBuf(decryptedInner);
    }
  }

  /* =====================================================================
   * 3-B. Dedicated Separated Auth Policies & WebAuthn PRF Verifiers
   * ===================================================================== */
  async function computePurposePrfInput(purpose, pkPrfSalt) {
    return await sha256Bytes(concatBytes(enc.encode(`CM-TIMESECRET-${purpose}-PRF-V1:`), pkPrfSalt));
  }

  /**
   * Registers or verifies a WebAuthn PRF Passkey for CHECKIN or MANAGEMENT.
   * - Domain-separated from CME3 (`CM-TIMESECRET-${purpose}-PRF-V1:`).
   * - Never overwrites `cm_registered_passkey_v1`.
   * - Verifies authenticator PRF support; fails closed if PRF is unsupported or unavailable.
   * - Can safely share an existing RP passkey OR create a dedicated passkey (`forceNew: true`).
   */
  async function registerPurposePasskey(purpose = 'CHECKIN', {
    preferExisting = true,
    forceNew = false,
    allowCredentialId = null
  } = {}) {
    const cleanPurpose = purpose === 'MANAGEMENT' ? 'MANAGEMENT' : 'CHECKIN';
    if (!window.PublicKeyCredential || !navigator.credentials) {
      throw new Error('お使いのブラウザ環境ではパスキー（WebAuthn）が利用できません。');
    }
    const rpId = location.hostname || 'localhost';
    const pkPrfSalt = crypto.getRandomValues(new Uint8Array(32));
    const prfInput = await computePurposePrfInput(cleanPurpose, pkPrfSalt);

    // 1. Specific credential requested (e.g. sharing verified credentialId with domain-separated PRF salt)
    if (allowCredentialId instanceof Uint8Array && allowCredentialId.length > 0 && !forceNew) {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId,
          allowCredentials: [{ type: 'public-key', id: allowCredentialId }],
          userVerification: 'preferred',
          timeout: 60000,
          extensions: { prf: { eval: { first: prfInput } } }
        }
      });
      if (!assertion) throw new Error('パスキーの認証がキャンセルされました。');
      const extRes = assertion.getClientExtensionResults?.()?.prf;
      if (!extRes?.results?.first || extRes.results.first.byteLength < 16) {
        throw new Error('選択されたパスキー（認証器）は WebAuthn PRF 拡張に対応していません。');
      }
      return {
        purpose: cleanPurpose,
        credentialId: new Uint8Array(assertion.rawId),
        pkPrfSalt,
        prfOutput: new Uint8Array(extRes.results.first),
        reusedExisting: true
      };
    }

    // 2. Discoverable existing passkey check (if preferExisting && !forceNew)
    if (preferExisting && !forceNew) {
      let existingTriedAndLackedPrf = false;
      try {
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId,
            userVerification: 'preferred',
            timeout: 60000,
            extensions: { prf: { eval: { first: prfInput } } }
          }
        });
        if (assertion) {
          const extRes = assertion.getClientExtensionResults?.()?.prf;
          if (extRes?.results?.first && extRes.results.first.byteLength >= 16) {
            const credId = new Uint8Array(assertion.rawId);
            if (!credId.length || credId.length > 512) {
              throw new Error('パスキー識別子の長さが不正です。');
            }
            return {
              purpose: cleanPurpose,
              credentialId: credId,
              pkPrfSalt,
              prfOutput: new Uint8Array(extRes.results.first),
              reusedExisting: true
            };
          }
          existingTriedAndLackedPrf = true;
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        const msg = String(err?.message || '');
        if (msg.includes('キャンセル') || msg.includes('cancel')) throw err;
        // No existing discoverable credential on this RP -> fall through to create a new passkey
      }
      if (existingTriedAndLackedPrf) {
        throw new Error('この端末の既存パスキー（認証器）は WebAuthn PRF 拡張に対応していません。PRF対応の認証器をご利用いただくか、パスワード／キーファイル認証を選択してください。');
      }
    }

    // 3. Create new dedicated passkey & verify PRF support
    const userHandle = crypto.getRandomValues(new Uint8Array(32));
    const userLabel = cleanPurpose === 'MANAGEMENT'
      ? { name: 'cryptomatrix-timesecret-mgmt', displayName: 'CryptoMatrix Time Secret (Management)' }
      : { name: 'cryptomatrix-timesecret-checkin', displayName: 'CryptoMatrix Time Secret (Check-In)' };

    let created;
    try {
      created = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Crypto Matrix Time Secret', id: rpId },
          user: { id: userHandle, name: userLabel.name, displayName: userLabel.displayName },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
            { type: 'public-key', alg: -8 }
          ],
          authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
          timeout: 60000,
          extensions: { prf: { eval: { first: prfInput } } }
        }
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new Error(`パスキーの作成・登録に失敗しました: ${err?.message || err}`);
    }
    if (!created) throw new Error('パスキーの作成がキャンセルされました。');

    const rawCredId = new Uint8Array(created.rawId);
    if (!rawCredId.length || rawCredId.length > 512) {
      throw new Error('パスキー識別子の長さが不正です。');
    }

    const createPrf = created.getClientExtensionResults?.()?.prf;
    if (createPrf?.results?.first && createPrf.results.first.byteLength >= 16) {
      return {
        purpose: cleanPurpose,
        credentialId: rawCredId,
        pkPrfSalt,
        prfOutput: new Uint8Array(createPrf.results.first),
        reusedExisting: false
      };
    }

    // Verify PRF output via immediate get() assertion when create() only reports enabled:true
    let getPrf = null;
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId,
          allowCredentials: [{ type: 'public-key', id: rawCredId }],
          userVerification: 'preferred',
          timeout: 60000,
          extensions: { prf: { eval: { first: prfInput } } }
        }
      });
      getPrf = assertion?.getClientExtensionResults?.()?.prf;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }

    if (getPrf?.results?.first && getPrf.results.first.byteLength >= 16) {
      return {
        purpose: cleanPurpose,
        credentialId: rawCredId,
        pkPrfSalt,
        prfOutput: new Uint8Array(getPrf.results.first),
        reusedExisting: false
      };
    }

    throw new Error('お使いの認証器・ブラウザは WebAuthn PRF（暗号検証拡張）に対応していません。パスキー認証にはPRF対応環境、またはパスワード／キーファイル認証をご利用ください。');
  }

  async function deriveVerifierPasswordCommit(purpose, vaultId, password, pwSalt, kdfProfile = 3) {
    const profile = Number(kdfProfile in KDF_ARGON2_CFGS || kdfProfile in KDF_PBKDF2_ITERS ? kdfProfile : 3);
    const inputBytes = enc.encode(`CM-TS-VERIFIER-PW-V1|${purpose}|${vaultId}|${String(password ?? '')}`);
    let derived = null;
    try {
      if (profile in KDF_ARGON2_CFGS) {
        if (typeof hashwasm === 'undefined' || !hashwasm.argon2id) {
          throw new Error('Argon2id（WebAssembly）が読み込まれていません。');
        }
        const cfg = KDF_ARGON2_CFGS[profile];
        derived = await hashwasm.argon2id({
          password: inputBytes,
          salt: pwSalt.subarray(0, 32),
          parallelism: cfg.parallelism,
          iterations: cfg.iterations,
          memorySize: cfg.memorySize,
          hashLength: 32,
          outputType: 'binary'
        });
      } else {
        const iters = KDF_PBKDF2_ITERS[profile] || 2100000;
        const baseKey = await crypto.subtle.importKey('raw', inputBytes, 'PBKDF2', false, ['deriveBits']);
        derived = new Uint8Array(
          await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: pwSalt, iterations: iters, hash: 'SHA-512' }, baseKey, 256)
        );
      }
      return await sha256Bytes(concatBytes(enc.encode('CM-TS-PW-COMMIT-V1:'), derived));
    } finally {
      zeroizeBuf(inputBytes);
      if (derived) zeroizeBuf(derived);
    }
  }

  async function deriveVerifierKeyfileCommit(purpose, vaultId, keyfileBytes, kfSalt) {
    const kfDigest = await sha512Bytes(toUint8(keyfileBytes));
    try {
      const hmacKey = await crypto.subtle.importKey('raw', kfSalt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const msg = concatBytes(enc.encode(`CM-TS-VERIFIER-KF-V1|${purpose}|${vaultId}|`), kfDigest);
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
      const commit = await sha256Bytes(mac);
      zeroizeBuf(msg);
      zeroizeBuf(mac);
      return commit;
    } finally {
      zeroizeBuf(kfDigest);
    }
  }

  async function deriveVerifierPasskeyCommit(purpose, vaultId, credentialId, prfOutput, pkCommitSalt) {
    const hmacKey = await crypto.subtle.importKey('raw', pkCommitSalt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const msg = concatBytes(
      enc.encode(`CM-TS-VERIFIER-PK-V1|${purpose}|${vaultId}|`),
      toUint8(credentialId),
      toUint8(prfOutput)
    );
    try {
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
      const commit = await sha256Bytes(mac);
      zeroizeBuf(mac);
      return commit;
    } finally {
      zeroizeBuf(msg);
    }
  }

  function buildPolicySealAAD(purpose, vaultId, createdAt, policyRev, publicPolicy) {
    return enc.encode(JSON.stringify({
      domain: 'CM-TIMESECRET-POLICY-SEAL-V1',
      purpose: String(purpose),
      vaultId: String(vaultId),
      createdAt: Number(createdAt),
      policyRev: Number(policyRev),
      mode: String(publicPolicy.mode),
      usePassword: Boolean(publicPolicy.usePassword),
      useKeyfile: Boolean(publicPolicy.useKeyfile),
      usePasskey: Boolean(publicPolicy.usePasskey),
      kdfProfile: Number(publicPolicy.kdfProfile),
      combo: Number(publicPolicy.combo),
      verifierSource: String(publicPolicy.verifierSource),
      passkeyCredIdHex: publicPolicy.passkeyCredIdHex || null
    }));
  }

  async function sealPolicyObjectWithDeviceKey(purpose, vaultId, createdAt, policyRev, publicPolicy, secretPayloadObj, deviceKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = buildPolicySealAAD(purpose, vaultId, createdAt, policyRev, publicPolicy);
    const plain = enc.encode(JSON.stringify(secretPayloadObj));
    try {
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, deviceKey, plain)
      );
      return { v: 1, iv, ciphertext: ct };
    } finally {
      zeroizeBuf(plain);
    }
  }

  async function unsealAndVerifyPolicyIntegrity(purpose, vaultRecord, publicPolicy, sealedBundle, deviceKey) {
    if (!publicPolicy || !sealedBundle || !sealedBundle.iv || !sealedBundle.ciphertext) {
      throw new Error(`${purpose === 'CHECKIN' ? 'チェックイン' : '管理操作'}認証ポリシーが欠落または破損しています（安全のため認証なしへの自動フォールバックは行いません）。`);
    }
    if (!deviceKey) {
      throw new Error('専用デバイス鍵が見つからないため、認証ポリシーを検証できません。');
    }
    const policyRev = Number(vaultRecord.policyRev || 1);
    const aad = buildPolicySealAAD(purpose, vaultRecord.vaultId, vaultRecord.createdAt, policyRev, publicPolicy);
    let plainBytes = null;
    try {
      try {
        plainBytes = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: toUint8(sealedBundle.iv), additionalData: aad, tagLength: 128 },
            deviceKey,
            toUint8(sealedBundle.ciphertext)
          )
        );
      } catch (_) {
        throw new Error(`${purpose === 'CHECKIN' ? 'チェックイン' : '管理操作'}認証ポリシーの改ざん検知またはデバイス鍵不整合により拒否されました。`);
      }
      const parsed = JSON.parse(decFatal.decode(plainBytes));
      if (
        parsed.v !== 1 ||
        parsed.purpose !== purpose ||
        parsed.vaultId !== vaultRecord.vaultId ||
        Number(parsed.policyRev) !== policyRev ||
        parsed.mode !== publicPolicy.mode ||
        Boolean(parsed.usePassword) !== Boolean(publicPolicy.usePassword) ||
        Boolean(parsed.useKeyfile) !== Boolean(publicPolicy.useKeyfile) ||
        Boolean(parsed.usePasskey) !== Boolean(publicPolicy.usePasskey) ||
        parsed.verifierSource !== publicPolicy.verifierSource
      ) {
        throw new Error('認証ポリシー内部メタデータの整合性検証に失敗しました。');
      }
      return parsed;
    } finally {
      if (plainBytes) zeroizeBuf(plainBytes);
    }
  }

  /**
   * Builds a fresh dedicated CHECKIN or MANAGEMENT policy and seals its verifiers under DeviceKey.
   */
  async function buildAndSealDedicatedPolicy({
    purpose,
    vaultId,
    createdAt,
    policyRev,
    deviceKey,
    spec,
    origin = 'custom',
    allowNone = false
  }) {
    const cleanPurpose = purpose === 'MANAGEMENT' ? 'MANAGEMENT' : 'CHECKIN';
    const explicitNone = spec?.mode === 'none';
    const usePw = explicitNone ? false : Boolean(spec?.usePassword);
    const useKf = explicitNone ? false : Boolean(spec?.useKeyfile);
    const usePk = explicitNone ? false : Boolean(spec?.usePasskey);
    const anyFactor = usePw || useKf || usePk;

    if (!anyFactor && !explicitNone) {
      throw new Error(
        cleanPurpose === 'CHECKIN'
          ? 'チェックインの認証方式を選択してください（認証不要にする場合は「認証なし」にチェックを入れてください）。'
          : '管理操作の認証方式を少なくとも1つ選択してください（管理操作を「認証なし」にすることはできません）。'
      );
    }
    if (explicitNone && !allowNone) {
      throw new Error('管理操作の認証方式を「認証なし」に設定することはできません。1つ以上の認証方式を設定してください。');
    }

    const kdfProfile = Number(spec?.kdfProfile || 3);
    const now = nowMs();

    if (!anyFactor) {
      const publicPolicy = {
        mode: 'none',
        ...(cleanPurpose === 'MANAGEMENT' ? { origin } : {}),
        usePassword: false,
        useKeyfile: false,
        usePasskey: false,
        kdfProfile,
        combo: AUTH_NONE_COMBO,
        verifierSource: 'none',
        passkeyCredIdHex: null,
        updatedAt: now
      };
      const secretObj = {
        v: 1,
        purpose: cleanPurpose,
        vaultId,
        policyRev,
        mode: 'none',
        usePassword: false,
        useKeyfile: false,
        usePasskey: false,
        kdfProfile,
        verifierSource: 'none',
        pw: null,
        kf: null,
        pk: null
      };
      const sealed = await sealPolicyObjectWithDeviceKey(cleanPurpose, vaultId, createdAt, policyRev, publicPolicy, secretObj, deviceKey);
      return { publicPolicy, sealed };
    }

    // Validate all required factor inputs BEFORE creating commitments
    let pwObj = null;
    let kfObj = null;
    let pkObj = null;
    let passkeyCredIdHex = null;

    if (usePw) {
      const pw = String(spec?.password ?? '');
      if (Array.from(pw).length < 12) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}パスワードは12文字以上で設定してください。`);
      }
      const pwSalt = crypto.getRandomValues(new Uint8Array(32));
      const pwCommit = await deriveVerifierPasswordCommit(cleanPurpose, vaultId, pw, pwSalt, kdfProfile);
      pwObj = { saltHex: bytesToHex(pwSalt), commitHex: bytesToHex(pwCommit) };
      zeroizeBuf(pwCommit);
    }

    if (useKf) {
      const kfBytes = toUint8(spec?.keyfileBytes);
      if (!kfBytes.length) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}キーファイルが選択されていません。`);
      }
      await validateKeyfileOrThrow(kfBytes, spec?.keyfileName || '');
      const kfSalt = crypto.getRandomValues(new Uint8Array(32));
      const kfCommit = await deriveVerifierKeyfileCommit(cleanPurpose, vaultId, kfBytes, kfSalt);
      kfObj = { saltHex: bytesToHex(kfSalt), commitHex: bytesToHex(kfCommit) };
      zeroizeBuf(kfCommit);
    }

    if (usePk) {
      let pkSess = spec?.passkeySession || null;
      let ownedSession = false;
      if (!pkSess || !(pkSess.credentialId instanceof Uint8Array) || !(pkSess.pkPrfSalt instanceof Uint8Array) || !(pkSess.prfOutput instanceof Uint8Array) || !pkSess.prfOutput.length) {
        pkSess = await registerPurposePasskey(cleanPurpose, {
          preferExisting: spec?.preferExistingPasskey !== false,
          forceNew: Boolean(spec?.forceNewPasskey),
          allowCredentialId: spec?.allowCredentialId || null
        });
        ownedSession = true;
      }
      try {
        const pkCommitSalt = crypto.getRandomValues(new Uint8Array(32));
        const pkCommit = await deriveVerifierPasskeyCommit(cleanPurpose, vaultId, pkSess.credentialId, pkSess.prfOutput, pkCommitSalt);
        passkeyCredIdHex = bytesToHex(pkSess.credentialId);
        pkObj = {
          credIdHex: passkeyCredIdHex,
          prfSaltHex: bytesToHex(pkSess.pkPrfSalt),
          commitSaltHex: bytesToHex(pkCommitSalt),
          commitHex: bytesToHex(pkCommit)
        };
        zeroizeBuf(pkCommit);
      } finally {
        if (ownedSession) scrubPasskeySession(pkSess);
      }
    }

    const combo = computeAuthCombo(usePw, useKf, usePk);
    const publicPolicy = {
      mode: 'factors',
      ...(cleanPurpose === 'MANAGEMENT' ? { origin } : {}),
      usePassword: usePw,
      useKeyfile: useKf,
      usePasskey: usePk,
      kdfProfile,
      combo,
      verifierSource: 'dedicated',
      passkeyCredIdHex,
      updatedAt: now
    };
    const secretObj = {
      v: 1,
      purpose: cleanPurpose,
      vaultId,
      policyRev,
      mode: 'factors',
      usePassword: usePw,
      useKeyfile: useKf,
      usePasskey: usePk,
      kdfProfile,
      verifierSource: 'dedicated',
      pw: pwObj,
      kf: kfObj,
      pk: pkObj
    };
    const sealed = await sealPolicyObjectWithDeviceKey(cleanPurpose, vaultId, createdAt, policyRev, publicPolicy, secretObj, deviceKey);
    return { publicPolicy, sealed };
  }

  /**
   * Migrates any pre-v2.12.0 vault record in-place to formatVersion 3 without modifying envelope or weakening auth.
   */
  async function migrateVaultToV3IfNeeded(vaultRecord) {
    if (!isRecordStructurallySound(vaultRecord)) return vaultRecord;
    if (
      Number(vaultRecord.formatVersion || 0) >= 3 &&
      vaultRecord.encryptionAuth &&
      vaultRecord.checkInAuth &&
      vaultRecord.managementAuth &&
      vaultRecord.sealedCheckInPolicy &&
      vaultRecord.sealedManagementPolicy &&
      vaultRecord.deadlinePolicy
    ) {
      return vaultRecord;
    }

    const vid = vaultRecord.vaultId || vaultRecord.id;
    const keyRec = await idbGet(STORE_KEYSTORE, vid);
    let deviceKey = keyRec?.deviceKey;
    if (!deviceKey) {
      // Cannot seal policies if DeviceKey was lost; preserve read-only metadata without weakening auth
      return vaultRecord;
    }
    if (!(deviceKey instanceof CryptoKey)) {
      if (deviceKey instanceof Uint8Array || deviceKey instanceof ArrayBuffer || ArrayBuffer.isView(deviceKey)) {
        deviceKey = await crypto.subtle.importKey(
          'raw',
          toUint8(deviceKey),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
      } else {
        return vaultRecord;
      }
    }

    const legacyAuth = {
      usePassword: Boolean(vaultRecord.authMeta?.usePassword),
      useKeyfile: Boolean(vaultRecord.authMeta?.useKeyfile),
      usePasskey: Boolean(vaultRecord.authMeta?.usePasskey),
      kdfProfile: Number(vaultRecord.authMeta?.kdfProfile || 3),
      combo: Number(vaultRecord.authMeta?.combo ?? computeAuthCombo(
        vaultRecord.authMeta?.usePassword,
        vaultRecord.authMeta?.useKeyfile,
        vaultRecord.authMeta?.usePasskey
      ))
    };
    const hasFactors = requiresUserAuth(legacyAuth);
    const policyRev = 1;
    const mode = hasFactors ? 'factors' : 'none';
    const verifierSource = hasFactors ? 'legacy_envelope' : 'none';

    const checkInAuth = {
      mode,
      usePassword: legacyAuth.usePassword,
      useKeyfile: legacyAuth.useKeyfile,
      usePasskey: legacyAuth.usePasskey,
      kdfProfile: legacyAuth.kdfProfile,
      combo: legacyAuth.combo,
      verifierSource,
      passkeyCredIdHex: null,
      updatedAt: vaultRecord.createdAt
    };
    const managementAuth = {
      mode,
      origin: 'migrated_v2',
      usePassword: legacyAuth.usePassword,
      useKeyfile: legacyAuth.useKeyfile,
      usePasskey: legacyAuth.usePasskey,
      kdfProfile: legacyAuth.kdfProfile,
      combo: legacyAuth.combo,
      verifierSource,
      passkeyCredIdHex: null,
      updatedAt: vaultRecord.createdAt
    };

    const sealedCheckInPolicy = await sealPolicyObjectWithDeviceKey(
      'CHECKIN',
      vid,
      vaultRecord.createdAt,
      policyRev,
      checkInAuth,
      {
        v: 1,
        purpose: 'CHECKIN',
        vaultId: vid,
        policyRev,
        mode,
        usePassword: legacyAuth.usePassword,
        useKeyfile: legacyAuth.useKeyfile,
        usePasskey: legacyAuth.usePasskey,
        kdfProfile: legacyAuth.kdfProfile,
        verifierSource,
        pw: null,
        kf: null,
        pk: null
      },
      deviceKey
    );

    const sealedManagementPolicy = await sealPolicyObjectWithDeviceKey(
      'MANAGEMENT',
      vid,
      vaultRecord.createdAt,
      policyRev,
      managementAuth,
      {
        v: 1,
        purpose: 'MANAGEMENT',
        vaultId: vid,
        policyRev,
        mode,
        usePassword: legacyAuth.usePassword,
        useKeyfile: legacyAuth.useKeyfile,
        usePasskey: legacyAuth.usePasskey,
        kdfProfile: legacyAuth.kdfProfile,
        verifierSource,
        pw: null,
        kf: null,
        pk: null
      },
      deviceKey
    );

    const migrated = {
      ...vaultRecord,
      id: vid,
      vaultId: vid,
      formatVersion: 3,
      policyRev,
      encryptionAuth: legacyAuth,
      checkInAuth,
      managementAuth,
      sealedCheckInPolicy,
      sealedManagementPolicy,
      deadlinePolicy: vaultRecord.deadlinePolicy || {
        mode: 'relative',
        relativeMs: Number(vaultRecord.intervalMs || 7 * 86400000)
      },
      seedMeta: vaultRecord.seedMeta || {
        seedBound: false,
        domain: 'TimeSecret',
        version: 0
      }
    };

    const updatedKeyRec = { ...keyRec, id: vid, policyRev };
    await idbPutVaultAndKeyBundle(updatedKeyRec, migrated);
    return (await idbGet(STORE_VAULTS, vid)) || migrated;
  }

  /**
   * Verifies ONLY the specified purpose ('CHECKIN' or 'MANAGEMENT') against the vault's DeviceKey-sealed policy.
   * - Never mixes encryptionAuth with checkInAuth on v2.12.0 vaults.
   * - Never falls back to '認証なし' if verifiers or WebAuthn PRF are missing/unavailable.
   * - Supports explicit `useEncryptionRecovery: true` ONLY for 'MANAGEMENT' when user lost custom management credentials.
   */
  async function verifyVaultPolicyAuth(vaultRecord, purpose, credentials = {}) {
    const cleanPurpose = purpose === 'MANAGEMENT' ? 'MANAGEMENT' : 'CHECKIN';
    let targetVault = vaultRecord;
    if (Number(targetVault.formatVersion || 0) < 3 || !targetVault.checkInAuth || !targetVault.managementAuth) {
      targetVault = await migrateVaultToV3IfNeeded(targetVault);
    }
    const vid = targetVault.vaultId || targetVault.id;

    const keyRec = await idbGet(STORE_KEYSTORE, vid);
    if (!keyRec || !keyRec.deviceKey) {
      throw new Error('専用デバイス鍵が見つからないため、認証ポリシーを検証できません。');
    }

    const expectedRev = Number(keyRec.policyRev || 1);
    const actualRev = Number(targetVault.policyRev || 1);
    if (actualRev !== expectedRev) {
      throw new Error('認証ポリシーのバージョン整合性検証に失敗しました（ロールバックまたは改ざんの疑い）。');
    }

    // Explicit Recovery Path for Management operations using Encryption Auth + DeviceKey
    if (cleanPurpose === 'MANAGEMENT' && credentials?.useEncryptionRecovery === true) {
      const encAuth = targetVault.encryptionAuth || targetVault.authMeta;
      if (!requiresUserAuth(encAuth)) {
        throw new Error('暗号化認証が設定されていない金庫では暗号化認証による救出再認証は利用できません。');
      }
      await unwrapAndVerifyVaultKey({
        vaultRecord: targetVault,
        deviceKey: keyRec.deviceKey,
        password: credentials?.password || '',
        keyfileBytes: credentials?.keyfileBytes || null,
        keyfileName: credentials?.keyfileName || '',
        verifyAuthOnly: true
      });
      return true;
    }

    const publicPolicy = cleanPurpose === 'CHECKIN' ? targetVault.checkInAuth : targetVault.managementAuth;
    const sealedBundle = cleanPurpose === 'CHECKIN' ? targetVault.sealedCheckInPolicy : targetVault.sealedManagementPolicy;

    // Always verify AES-GCM policy seal with DeviceKey FIRST (even when mode === 'none'!)
    const unsealed = await unsealAndVerifyPolicyIntegrity(cleanPurpose, targetVault, publicPolicy, sealedBundle, keyRec.deviceKey);

    if (unsealed.mode === 'none' && unsealed.verifierSource === 'none') {
      if (unsealed.usePassword || unsealed.useKeyfile || unsealed.usePasskey) {
        throw new Error('認証なしポリシーの構成フラグに矛盾があります。');
      }
      return true;
    }

    if (unsealed.verifierSource === 'legacy_envelope') {
      await unwrapAndVerifyVaultKey({
        vaultRecord: targetVault,
        deviceKey: keyRec.deviceKey,
        password: credentials?.password || '',
        keyfileBytes: credentials?.keyfileBytes || null,
        keyfileName: credentials?.keyfileName || '',
        verifyAuthOnly: true
      });
      return true;
    }

    if (unsealed.verifierSource !== 'dedicated') {
      throw new Error('未対応の認証ポリシー検証形式です。');
    }

    if (!unsealed.usePassword && !unsealed.useKeyfile && !unsealed.usePasskey) {
      throw new Error('認証要素が1つも定義されていない不正なポリシーです（自動フォールバック拒否）。');
    }

    // Pre-check presence of Password & Keyfile inputs before invoking WebAuthn prompt
    const pwInput = String(credentials?.password ?? '');
    const kfBytes = credentials?.keyfileBytes ? toUint8(credentials.keyfileBytes) : null;

    if (unsealed.usePassword) {
      if (!unsealed.pw?.saltHex || !unsealed.pw?.commitHex) {
        throw new Error('パスワード検証情報が欠落しています（認証なしへは切り替わりません）。');
      }
      if (!pwInput.length) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}パスワードを入力してください。`);
      }
    }

    if (unsealed.useKeyfile) {
      if (!unsealed.kf?.saltHex || !unsealed.kf?.commitHex) {
        throw new Error('キーファイル検証情報が欠落しています（認証なしへは切り替わりません）。');
      }
      if (!kfBytes || !kfBytes.length) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}キーファイルを選択してください。`);
      }
      await validateKeyfileOrThrow(kfBytes, credentials?.keyfileName || '');
    }

    if (unsealed.usePasskey) {
      if (!unsealed.pk?.credIdHex || !unsealed.pk?.prfSaltHex || !unsealed.pk?.commitSaltHex || !unsealed.pk?.commitHex) {
        throw new Error('パスキー検証情報が欠落しています（認証なしへは切り替わりません）。');
      }
      if (!window.PublicKeyCredential || !navigator.credentials) {
        throw new Error('このブラウザ環境ではパスキーが利用できないため認証できません（認証なしへは切り替わりません）。');
      }
      if (credentials?.usePasskey === false) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}パスキーによる認証が必要です。`);
      }
    }

    // 1. Verify Password commitment
    if (unsealed.usePassword) {
      const pwSalt = hexToBytes(unsealed.pw.saltHex);
      const expectedPwCommit = hexToBytes(unsealed.pw.commitHex);
      const actualPwCommit = await deriveVerifierPasswordCommit(
        cleanPurpose,
        vid,
        pwInput,
        pwSalt,
        unsealed.kdfProfile
      );
      const ok = equalBytes(expectedPwCommit, actualPwCommit);
      zeroizeBuf(actualPwCommit);
      if (!ok) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}パスワードが一致しません。`);
      }
    }

    // 2. Verify Keyfile commitment
    if (unsealed.useKeyfile) {
      const kfSalt = hexToBytes(unsealed.kf.saltHex);
      const expectedKfCommit = hexToBytes(unsealed.kf.commitHex);
      const actualKfCommit = await deriveVerifierKeyfileCommit(
        cleanPurpose,
        vid,
        kfBytes,
        kfSalt
      );
      const ok = equalBytes(expectedKfCommit, actualKfCommit);
      zeroizeBuf(actualKfCommit);
      if (!ok) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}キーファイルが一致しません。`);
      }
    }

    // 3. Verify Passkey WebAuthn PRF commitment
    if (unsealed.usePasskey) {
      const rpId = location.hostname || 'localhost';
      const credIdBytes = hexToBytes(unsealed.pk.credIdHex);
      const pkPrfSalt = hexToBytes(unsealed.pk.prfSaltHex);
      const pkCommitSalt = hexToBytes(unsealed.pk.commitSaltHex);
      const expectedPkCommit = hexToBytes(unsealed.pk.commitHex);
      const prfInput = await computePurposePrfInput(cleanPurpose, pkPrfSalt);

      let assertion;
      try {
        assertion = await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId,
            allowCredentials: [{ type: 'public-key', id: credIdBytes }],
            userVerification: 'required',
            timeout: 60000,
            extensions: { prf: { eval: { first: prfInput } } }
          }
        });
      } catch (err) {
        throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}パスキーの認証に失敗しました（未登録・利用不可・キャンセル）: ${err?.message || err}`);
      }
      if (!assertion) {
        throw new Error('パスキー認証がキャンセルされました。');
      }
      const rawIdBytes = new Uint8Array(assertion.rawId);
      if (!equalBytes(credIdBytes, rawIdBytes)) {
        throw new Error('登録されたパスキー識別子と一致しません。');
      }
      const extRes = assertion.getClientExtensionResults?.()?.prf;
      if (!extRes?.results?.first || extRes.results.first.byteLength < 16) {
        throw new Error('パスキーから WebAuthn PRF 検証出力を取得できませんでした。');
      }
      const prfOut = new Uint8Array(extRes.results.first);
      try {
        const actualPkCommit = await deriveVerifierPasskeyCommit(
          cleanPurpose,
          vid,
          rawIdBytes,
          prfOut,
          pkCommitSalt
        );
        const ok = equalBytes(expectedPkCommit, actualPkCommit);
        zeroizeBuf(actualPkCommit);
        if (!ok) {
          throw new Error(`${cleanPurpose === 'CHECKIN' ? 'チェックイン用' : '管理操作用'}パスキーのPRF検証値が一致しません。`);
        }
      } finally {
        zeroizeBuf(prfOut);
      }
    }

    return true;
  }

  /* =====================================================================
   * 4. Multi-Vault Creation with Separated Policies & Round-Trip Check
   * ===================================================================== */
  function normalizeDeadlinePolicyInput(opts, createdAt) {
    if (opts?.deadlinePolicy && typeof opts.deadlinePolicy === 'object') {
      const mode = opts.deadlinePolicy.mode === 'absolute' ? 'absolute' : 'relative';
      if (mode === 'absolute') {
        const fixedDeadlineAt = Number(opts.deadlinePolicy.fixedDeadlineAt);
        if (!Number.isFinite(fixedDeadlineAt)) {
          throw new Error('指定日時（絶対時刻）の形式が不正です。');
        }
        if (fixedDeadlineAt <= createdAt) {
          throw new Error('指定された期限日時が現在時刻より過去（または現在時刻）です。未来の日時を指定してください。');
        }
        return {
          deadlinePolicy: { mode: 'absolute', fixedDeadlineAt },
          deadlineAt: fixedDeadlineAt,
          intervalMs: Math.max(1000, fixedDeadlineAt - createdAt)
        };
      }
      const relativeMs = Number(opts.deadlinePolicy.relativeMs);
      if (!Number.isFinite(relativeMs) || relativeMs < MIN_RELATIVE_MS || relativeMs > MAX_RELATIVE_MS) {
        throw new Error('相対時間の期限は5秒以上・10年以内で指定してください。');
      }
      return {
        deadlinePolicy: { mode: 'relative', relativeMs },
        deadlineAt: createdAt + relativeMs,
        intervalMs: relativeMs
      };
    }

    const legacyIntervalMs = Number(opts?.intervalMs);
    if (!Number.isFinite(legacyIntervalMs) || legacyIntervalMs < MIN_RELATIVE_MS || legacyIntervalMs > MAX_RELATIVE_MS) {
      throw new Error('チェックイン期限の間隔設定が不正です（5秒以上・10年以内で設定してください）。');
    }
    return {
      deadlinePolicy: { mode: 'relative', relativeMs: legacyIntervalMs },
      deadlineAt: createdAt + legacyIntervalMs,
      intervalMs: legacyIntervalMs
    };
  }

  async function createTimeSecretVault(opts = {}) {
    const {
      label,
      kind,
      name,
      mime,
      plainBytes,
      onProgress
    } = opts;

    const cleanLabel = String(label || '').trim() || `タイムシークレット #${vaultsMap.size + 1}`;
    if (cleanLabel.length > 80) {
      throw new Error('名前は80文字以内で入力してください。');
    }
    if (!(plainBytes instanceof Uint8Array) || plainBytes.length === 0) {
      throw new Error('保管するデータが空です。テキストを入力するかファイルを選択してください。');
    }
    if (plainBytes.length > MAX_FILE_BYTES) {
      throw new Error(`データサイズが大きすぎます（上限 20MB、現在 ${formatBytes(plainBytes.length)}）。`);
    }

    // 1. Normalize Encryption Auth (supports explicit opts.encryptionAuth or top-level shorthand)
    const encSpec = opts.encryptionAuth && typeof opts.encryptionAuth === 'object'
      ? opts.encryptionAuth
      : {
          usePassword: opts.usePassword !== undefined ? Boolean(opts.usePassword) : true,
          password: opts.password || '',
          kdfProfile: Number(opts.kdfProfile || 3),
          useKeyfile: Boolean(opts.useKeyfile),
          keyfileBytes: opts.keyfileBytes || null,
          keyfileName: opts.keyfileName || '',
          usePasskey: Boolean(opts.usePasskey)
        };

    const encUsePw = Boolean(encSpec.usePassword);
    const encUseKf = Boolean(encSpec.useKeyfile);
    const encUsePk = Boolean(encSpec.usePasskey);
    const encPw = String(encSpec.password ?? '');
    const encKfBytes = encSpec.keyfileBytes ? toUint8(encSpec.keyfileBytes) : null;
    const encKfName = String(encSpec.keyfileName || '');
    const encKdfProfile = Number(encSpec.kdfProfile || 3);

    if (!encUsePw && !encUseKf && !encUsePk) {
      throw new Error('暗号化の認証方式（パスワード、キーファイル、パスキー）を少なくとも1つ選択してください。');
    }
    if (encUsePw && Array.from(encPw).length < 12) {
      throw new Error('暗号化パスワードは12文字以上で設定してください。');
    }
    if (encUseKf) {
      if (!encKfBytes || !encKfBytes.length) {
        throw new Error('暗号化キーファイルが選択されていますが、キーファイルが読み込まれていません。');
      }
      await validateKeyfileOrThrow(encKfBytes, encKfName);
    }

    // 2. Normalize Check-In Auth (independent of Encryption Auth; allows explicit credential reuse with domain separation)
    let ciSpec;
    if (opts.checkInAuth && typeof opts.checkInAuth === 'object') {
      const anyCi = Boolean(opts.checkInAuth.usePassword || opts.checkInAuth.useKeyfile || opts.checkInAuth.usePasskey);
      const ciMode = opts.checkInAuth.mode || (anyCi ? 'factors' : 'none');
      const ciUsePw = ciMode === 'none' ? false : Boolean(opts.checkInAuth.usePassword);
      const ciUseKf = ciMode === 'none' ? false : Boolean(opts.checkInAuth.useKeyfile);
      const ciUsePk = ciMode === 'none' ? false : Boolean(opts.checkInAuth.usePasskey);

      let ciPw = String(opts.checkInAuth.password || '');
      const reuseEncPw = opts.checkInAuth.pwSource === 'encryption' ||
        opts.checkInAuth.reuseEncryptionPassword === true ||
        (ciUsePw && !ciPw && encUsePw);
      if (ciUsePw && reuseEncPw) {
        if (!encUsePw || !encPw) {
          throw new Error('暗号化用パスワードが設定されていないため、チェックインで再利用できません。');
        }
        ciPw = encPw;
      }

      let ciKfBytes = opts.checkInAuth.keyfileBytes ? toUint8(opts.checkInAuth.keyfileBytes) : null;
      let ciKfName = String(opts.checkInAuth.keyfileName || '');
      const reuseEncKf = opts.checkInAuth.kfSource === 'encryption' ||
        opts.checkInAuth.reuseEncryptionKeyfile === true ||
        (ciUseKf && !ciKfBytes && encUseKf);
      if (ciUseKf && reuseEncKf) {
        if (!encUseKf || !encKfBytes) {
          throw new Error('暗号化用キーファイルが選択されていないため、チェックインで再利用できません。');
        }
        ciKfBytes = encKfBytes.slice();
        ciKfName = encKfName || 'encrypted-master.key';
      }

      ciSpec = {
        mode: ciMode,
        usePassword: ciUsePw,
        password: ciPw,
        kdfProfile: Number(opts.checkInAuth.kdfProfile || 3),
        useKeyfile: ciUseKf,
        keyfileBytes: ciKfBytes,
        keyfileName: ciKfName,
        usePasskey: ciUsePk,
        passkeySession: opts.checkInAuth.passkeySession || null,
        preferExistingPasskey: opts.checkInAuth.preferExistingPasskey !== false,
        forceNewPasskey: Boolean(opts.checkInAuth.forceNewPasskey)
      };
    } else {
      throw new Error('チェックインの認証方式（認証なし／パスワード／キーファイル／パスキー）を明示的に指定してください。');
    }

    // 3. Normalize Management Auth (defaults safely to same_as_encryption unless custom is specified)
    const mgmtInput = opts.managementAuth && typeof opts.managementAuth === 'object'
      ? opts.managementAuth
      : { sameAsEncryption: true };
    const mgmtSameAsEnc = mgmtInput.sameAsEncryption !== false && mgmtInput.mode !== 'factors';

    const seedBound = opts.seedBound !== undefined ? Boolean(opts.seedBound) : true;
    const activeSeed = opts.seedNum !== undefined && opts.seedNum !== null
      ? String(opts.seedNum).trim() || '0'
      : getCurrentCardSeed();

    const createdAt = nowMs();
    const { deadlinePolicy, deadlineAt, intervalMs } = normalizeDeadlinePolicyInput(opts, createdAt);
    const vaultId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const policyRev = 1;

    return await withVaultLock(vaultId, async () => {
      onProgress?.('1/4 専用デバイス鍵（非抽出可能）を生成し、カード配列シード連動エンベロープ暗号化を実行中...');
      const deviceKey = await generateNonExtractableDeviceKey();
      if (deviceKey.extractable !== false) {
        throw new Error('デバイス鍵の非抽出属性 (extractable: false) を検証できませんでした。');
      }

      let sealRes = null;
      try {
        const normalizedKind = kind === 'binary' ? 'binary' : 'text';
        sealRes = await sealSecretEnvelope({
          vaultId,
          createdAt,
          kind: normalizedKind,
          name: normalizedKind === 'binary' ? (name || 'file.bin') : 'secret.txt',
          mime: normalizedKind === 'binary' ? (mime || 'application/octet-stream') : 'text/plain;charset=utf-8',
          plainBytes,
          password: encPw,
          kdfProfile: encKdfProfile,
          usePassword: encUsePw,
          useKeyfile: encUseKf,
          usePasskey: encUsePk,
          keyfileBytes: encKfBytes,
          keyfileName: encKfName,
          seedBound,
          seedNum: activeSeed,
          deviceKey
        });

        onProgress?.('2/4 チェックイン認証・管理操作認証の独立ポリシーを専用デバイス鍵で封印中...');
        const ciBundle = await buildAndSealDedicatedPolicy({
          purpose: 'CHECKIN',
          vaultId,
          createdAt,
          policyRev,
          deviceKey,
          spec: ciSpec,
          allowNone: true
        });

        const effectiveMgmtSpec = mgmtSameAsEnc
          ? {
              mode: 'factors',
              usePassword: encUsePw,
              password: encPw,
              kdfProfile: encKdfProfile,
              useKeyfile: encUseKf,
              keyfileBytes: encKfBytes,
              keyfileName: encKfName,
              usePasskey: encUsePk,
              allowCredentialId: sealRes.encryptionPasskeyCredId || null
            }
          : {
              mode: 'factors',
              usePassword: Boolean(mgmtInput.usePassword),
              password: mgmtInput.password || '',
              kdfProfile: Number(mgmtInput.kdfProfile || 3),
              useKeyfile: Boolean(mgmtInput.useKeyfile),
              keyfileBytes: mgmtInput.keyfileBytes || null,
              keyfileName: mgmtInput.keyfileName || '',
              usePasskey: Boolean(mgmtInput.usePasskey),
              passkeySession: mgmtInput.passkeySession || null,
              preferExistingPasskey: mgmtInput.preferExistingPasskey,
              forceNewPasskey: mgmtInput.forceNewPasskey
            };

        const mgmtBundle = await buildAndSealDedicatedPolicy({
          purpose: 'MANAGEMENT',
          vaultId,
          createdAt,
          policyRev,
          deviceKey,
          spec: effectiveMgmtSpec,
          origin: mgmtSameAsEnc ? 'same_as_encryption' : 'custom',
          allowNone: false
        });

        const draftVaultRecord = {
          id: vaultId,
          vaultId,
          label: cleanLabel,
          formatVersion: 3,
          policyRev,
          rev: 1,
          state: computeHealthyActiveState({ intervalMs, deadlineAt }, createdAt),
          createdAt,
          lastCheckInAt: createdAt,
          lastSeen: createdAt,
          intervalMs,
          pendingIntervalMs: null,
          deadlineAt,
          deadlinePolicy,
          seedMeta: {
            seedBound,
            domain: 'TimeSecret',
            version: seedBound ? 1 : 0
          },
          clockAnomaly: null,
          payloadMeta: {
            kind: normalizedKind,
            originalName: normalizedKind === 'binary' ? String(name || 'file.bin') : null,
            byteLength: plainBytes.length
          },
          authMeta: sealRes.authMeta,
          encryptionAuth: sealRes.authMeta,
          checkInAuth: ciBundle.publicPolicy,
          managementAuth: mgmtBundle.publicPolicy,
          sealedCheckInPolicy: ciBundle.sealed,
          sealedManagementPolicy: mgmtBundle.sealed,
          envelope: sealRes.envelope,
          notifications: {
            enabled: typeof Notification !== 'undefined' && Notification.permission === 'granted',
            deadlineEpoch: deadlineAt,
            sent24h: false,
            sent1h: false
          }
        };

        // Pre-seal round-trip decryption & byte-for-byte comparison (including CMA1 seed verification!)
        onProgress?.('3/4 封印前の復号テスト・シード連動検証・元データとのバイト完全一致検証を実行中...');
        const singleOpPasskeyCache = new Map();
        if (sealRes.createdPrfForImmediateVerify) {
          singleOpPasskeyCache.set(
            sealRes.createdPrfForImmediateVerify.cacheKey,
            sealRes.createdPrfForImmediateVerify.prf
          );
        }
        const roundTrip = await unwrapAndVerifyVaultKey({
          vaultRecord: draftVaultRecord,
          deviceKey,
          password: encPw,
          keyfileBytes: encKfBytes,
          keyfileName: encKfName,
          seedNum: activeSeed,
          passkeyCacheMap: singleOpPasskeyCache,
          verifyAuthOnly: false
        });
        try {
          if (!equalBytes(plainBytes, roundTrip.dataBytes)) {
            throw new Error('封印前検証エラー：復号結果が元データとバイト単位で一致しませんでした。保存を中止しました。');
          }
          if (roundTrip.kind !== normalizedKind || roundTrip.origSize !== plainBytes.length) {
            throw new Error('封印前検証エラー：内部メタデータが一致しませんでした。保存を中止しました。');
          }
        } finally {
          zeroizeBuf(roundTrip.dataBytes);
        }

        // Verify both sealed policies unseal cleanly with DeviceKey
        await unsealAndVerifyPolicyIntegrity('CHECKIN', draftVaultRecord, draftVaultRecord.checkInAuth, draftVaultRecord.sealedCheckInPolicy, deviceKey);
        await unsealAndVerifyPolicyIntegrity('MANAGEMENT', draftVaultRecord, draftVaultRecord.managementAuth, draftVaultRecord.sealedManagementPolicy, deviceKey);

        // Persist ONLY this new vaultId
        onProgress?.('4/4 IndexedDBへ保存し、暗号データ・デバイス鍵・3種認証ポリシーの読み戻し整合性を確認中...');
        const keyRecord = {
          id: vaultId,
          vaultId,
          deviceKey,
          createdAt,
          policyRev,
          purpose: 'DEK_AND_POLICY_WRAP_V3'
        };
        await idbPutVaultAndKeyBundle(keyRecord, draftVaultRecord);

        // Readback verification
        const readKeyRec = await idbGet(STORE_KEYSTORE, vaultId);
        const readVaultRec = await idbGet(STORE_VAULTS, vaultId);
        if (!readKeyRec || !readKeyRec.deviceKey || readKeyRec.deviceKey.extractable !== false) {
          throw new Error('保存後の読み戻し検証に失敗しました（デバイス鍵が確認できません）。');
        }
        if (!readVaultRec || readVaultRec.vaultId !== vaultId || readVaultRec.deadlineAt !== deadlineAt) {
          throw new Error('保存後の読み戻し検証に失敗しました（金庫レコードが確認できません）。');
        }
        const readbackCommit = await computeEnvelopeCommitHex(
          readVaultRec.vaultId,
          readVaultRec.createdAt,
          readVaultRec.encryptionAuth,
          readVaultRec.envelope,
          Boolean(readVaultRec.seedMeta?.seedBound)
        );
        if (readbackCommit !== draftVaultRecord.envelope.envelopeCommitHex) {
          throw new Error('保存後の読み戻し検証に失敗しました（暗号文コミットメント不一致）。');
        }
        await unsealAndVerifyPolicyIntegrity('CHECKIN', readVaultRec, readVaultRec.checkInAuth, readVaultRec.sealedCheckInPolicy, readKeyRec.deviceKey);
        await unsealAndVerifyPolicyIntegrity('MANAGEMENT', readVaultRec, readVaultRec.managementAuth, readVaultRec.sealedManagementPolicy, readKeyRec.deviceKey);

        setHighWaterAnchor(vaultId, { policyRev: 1, lastSeen: createdAt, state: 'ACTIVE' });
        highWaterMarks.set(vaultId, createdAt);
        vaultsMap.set(vaultId, readVaultRec);
        broadcastSync('CREATED', vaultId);
        renderUI();
        return readVaultRec;
      } finally {
        if (sealRes?.createdPrfForImmediateVerify?.prf?.extraFactor) {
          zeroizeBuf(sealRes.createdPrfForImmediateVerify.prf.extraFactor);
        }
      }
    });
  }

  /* =====================================================================
   * 5. Per-Vault Lifecycle, Clock Anomaly, & Isolated Expiration Deletion
   * ===================================================================== */
  function computeWarningThresholdMs(intervalMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return NOTIFY_24H_MS;
    if (intervalMs > NOTIFY_24H_MS) return NOTIFY_24H_MS;
    return Math.floor(intervalMs * 0.25);
  }

  function computeHealthyActiveState(record, now) {
    const remaining = record.deadlineAt - now;
    if (remaining <= 0) return STATES.EXPIRED;
    const spanMs = record.deadlinePolicy?.mode === 'relative'
      ? Number(record.deadlinePolicy.relativeMs || record.intervalMs)
      : Number(record.intervalMs || NOTIFY_24H_MS);
    const warnMs = computeWarningThresholdMs(spanMs);
    return remaining <= warnMs ? STATES.WARNING : STATES.ACTIVE;
  }

  function isRecordStructurallySound(rec) {
    const vid = rec?.vaultId || rec?.id;
    return Boolean(
      rec &&
      typeof vid === 'string' &&
      vid.length > 0 &&
      Number.isFinite(rec.deadlineAt) &&
      Number.isFinite(rec.createdAt) &&
      rec.envelope &&
      (rec.encryptionAuth || rec.authMeta || rec.authProfile)
    );
  }

  async function executeSingleVaultExpirationDestruction(vaultId, vaultRecordOrNull, existingTombstone = null, isInterruptedRecovery = false) {
    return await withVaultLock(vaultId, async () => {
      const now = nowMs();
      const label = vaultRecordOrNull?.label || existingTombstone?.label || `タイムシークレット (${vaultId.slice(0, 8)})`;
      const expiredDeadlineAt = vaultRecordOrNull?.deadlineAt || existingTombstone?.expiredDeadlineAt || null;

      const pendingTombstone = {
        id: vaultId,
        vaultId,
        label,
        state: STATES.DELETE_PENDING,
        reason: isInterruptedRecovery ? 'INTERRUPTED_RECOVERY' : 'EXPIRED',
        startedAt: existingTombstone?.startedAt || now,
        completedAt: null,
        expiredDeadlineAt,
        interruptedRecovered: Boolean(isInterruptedRecovery),
        verifiedKeyDeleted: false,
        verifiedVaultDeleted: false,
        errorDetail: null
      };

      tombstonesMap.set(vaultId, pendingTombstone);
      if (openedSecret?.vaultId === vaultId) {
        clearOpenedSecret();
      }

      let deleteError = null;

      try {
        await idbPut(STORE_TOMBSTONES, pendingTombstone);
        if (vaultRecordOrNull && isRecordStructurallySound(vaultRecordOrNull)) {
          await idbPut(STORE_VAULTS, { ...vaultRecordOrNull, id: vaultId, state: STATES.DELETE_PENDING });
        }
      } catch (err) {
        deleteError = `削除開始状態(DELETE_PENDING)の記録に失敗: ${err?.message || err}`;
      }

      try {
        await idbDeleteKey(STORE_KEYSTORE, vaultId);
      } catch (err) {
        deleteError = (deleteError ? `${deleteError} / ` : '') + `デバイス鍵削除エラー: ${err?.message || err}`;
      }
      try {
        await idbDeleteKey(STORE_VAULTS, vaultId);
      } catch (err) {
        deleteError = (deleteError ? `${deleteError} / ` : '') + `暗号データ削除エラー: ${err?.message || err}`;
      }

      let verifiedKeyDeleted = false;
      let verifiedVaultDeleted = false;
      try {
        const keyRemains = await idbGet(STORE_KEYSTORE, vaultId);
        const vaultRemains = await idbGet(STORE_VAULTS, vaultId);
        verifiedKeyDeleted = (keyRemains === null);
        verifiedVaultDeleted = (vaultRemains === null);
        if (!verifiedKeyDeleted) {
          deleteError = (deleteError ? `${deleteError} / ` : '') + '読み戻し検証で当該デバイス鍵の残存を検出';
        }
        if (!verifiedVaultDeleted) {
          deleteError = (deleteError ? `${deleteError} / ` : '') + '読み戻し検証で当該暗号データの残存を検出';
        }
      } catch (err) {
        deleteError = (deleteError ? `${deleteError} / ` : '') + `読み戻し検証に失敗: ${err?.message || err}`;
      }

      const succeeded = !deleteError && verifiedKeyDeleted && verifiedVaultDeleted;
      const finalState = succeeded ? STATES.DESTROYED : STATES.DELETE_FAILED;
      const finalTombstone = {
        ...pendingTombstone,
        state: finalState,
        completedAt: nowMs(),
        verifiedKeyDeleted,
        verifiedVaultDeleted,
        errorDetail: succeeded ? null : (deleteError || '削除状態の検証に失敗しました。')
      };

      try {
        await idbPut(STORE_TOMBSTONES, finalTombstone);
        const readbackTomb = await idbGet(STORE_TOMBSTONES, vaultId);
        if (!readbackTomb || readbackTomb.state !== finalState) {
          throw new Error('墓石(Tombstone)状態の読み戻し確認に失敗しました。');
        }
        tombstonesMap.set(vaultId, readbackTomb);
        setHighWaterAnchor(vaultId, { state: finalState });
      } catch (err) {
        tombstonesMap.set(vaultId, {
          ...finalTombstone,
          state: STATES.DELETE_FAILED,
          errorDetail: (finalTombstone.errorDetail ? `${finalTombstone.errorDetail} / ` : '') + (err?.message || String(err))
        });
      }

      if (succeeded) {
        vaultsMap.delete(vaultId);
        highWaterMarks.delete(vaultId);
      } else {
        const rem = await idbGet(STORE_VAULTS, vaultId).catch(() => null);
        if (rem) {
          const failedRec = { ...rem, id: vaultId, state: STATES.DELETE_FAILED };
          await idbPut(STORE_VAULTS, failedRec).catch(() => {});
          vaultsMap.set(vaultId, failedRec);
        } else {
          vaultsMap.delete(vaultId);
        }
      }

      if (isInterruptedRecovery) {
        recoveryNotices.set(
          vaultId,
          finalState === STATES.DESTROYED
            ? `「${label}」の中断された削除処理（DELETE_PENDING）を起動時に検出し、当該鍵とデータの破棄を確認しました。`
            : `「${label}」の中断された削除処理（DELETE_PENDING）を起動時に検出しましたが、削除検証に失敗しました。`
        );
      }

      broadcastSync('DESTROY_ATTEMPTED', vaultId);
      return tombstonesMap.get(vaultId);
    });
  }

  async function enterClockSuspectForVault(record, observedNow, baselineLastSeen) {
    const vaultId = record.vaultId;
    return await withVaultLock(vaultId, async () => {
      const fresh = (await idbGet(STORE_VAULTS, vaultId)) || record;
      const skewMs = baselineLastSeen - observedNow;
      const updated = {
        ...fresh,
        id: vaultId,
        rev: Number(fresh.rev || 1) + 1,
        state: STATES.CLOCK_SUSPECT,
        lastSeen: Math.max(fresh.lastSeen || 0, baselineLastSeen),
        clockAnomaly: {
          detectedAtRecordTime: baselineLastSeen,
          observedSystemTime: observedNow,
          previousLastSeen: baselineLastSeen,
          skewMs
        }
      };
      try {
        await idbPut(STORE_VAULTS, updated);
        const readback = await idbGet(STORE_VAULTS, vaultId);
        vaultsMap.set(vaultId, readback || updated);
      } catch (_) {
        vaultsMap.set(vaultId, updated);
      }
      broadcastSync('CLOCK_SUSPECT', vaultId);
      return vaultsMap.get(vaultId);
    });
  }

  async function runEvaluateLifecyclePass() {
    lifecycleBusy = true;
    try {
      await migrateLegacyV1RecordsIfNeeded();
      const [rawVaults, rawTombs] = await Promise.all([
        idbGetAll(STORE_VAULTS),
        idbGetAll(STORE_TOMBSTONES)
      ]);

      const nextVaults = new Map();
      const nextTombs = new Map();

      for (const t of rawTombs) {
        const tid = t?.vaultId || t?.id;
        if (tid) nextTombs.set(tid, t);
      }
      for (const v of rawVaults) {
        const vid = v?.vaultId || v?.id;
        if (vid) nextVaults.set(vid, v);
      }

      vaultsMap = nextVaults;
      tombstonesMap = nextTombs;

      // 1. Handle any interrupted DELETE_PENDING tombstones first
      for (const [tid, tomb] of Array.from(tombstonesMap.entries())) {
        if (tomb?.state === STATES.DELETE_PENDING) {
          const v = vaultsMap.get(tid) || null;
          await executeSingleVaultExpirationDestruction(tid, v, tomb, true);
        }
      }

      // 2. Evaluate & seamlessly migrate each active vault independently
      const now = nowMs();
      for (const [vid, rawVault] of Array.from(vaultsMap.entries())) {
        if (!isRecordStructurallySound(rawVault)) {
          vaultsMap.set(vid, {
            ...rawVault,
            id: vid,
            vaultId: vid,
            label: rawVault?.label || `破損レコード (${String(vid).slice(0, 8)})`,
            state: STATES.CORRUPTED
          });
          continue;
        }

        if (rawVault.state === STATES.DELETE_PENDING) {
          await executeSingleVaultExpirationDestruction(vid, rawVault, tombstonesMap.get(vid) || null, true);
          continue;
        }

        if (rawVault.state === STATES.DELETE_FAILED || tombstonesMap.get(vid)?.state === STATES.DELETE_FAILED) {
          vaultsMap.set(vid, { ...rawVault, id: vid, state: STATES.DELETE_FAILED });
          continue;
        }

        let vault = rawVault;
        try {
          vault = await migrateVaultToV3IfNeeded(rawVault);
          vaultsMap.set(vid, vault);
        } catch (_) {}

        const memHwm = highWaterMarks.get(vid) || 0;
        const baselineLastSeen = Math.max(Number(vault.lastSeen || 0), memHwm);

        if (vault.state === STATES.CLOCK_SUSPECT) {
          if (baselineLastSeen > 0 && now < baselineLastSeen - CLOCK_ROLLBACK_THRESHOLD_MS) {
            highWaterMarks.set(vid, baselineLastSeen);
            continue;
          }
          // Clock has restored forward! Recover back to healthy active state
          const recoveredState = computeHealthyActiveState(vault, now);
          vault = {
            ...vault,
            id: vid,
            rev: Number(vault.rev || 1) + 1,
            state: recoveredState,
            lastSeen: Math.max(now, baselineLastSeen)
          };
          try {
            await idbPut(STORE_VAULTS, vault);
          } catch (_) {}
          recoveryNotices.delete(vid);
        }

        if (baselineLastSeen > 0 && now < baselineLastSeen - CLOCK_ROLLBACK_THRESHOLD_MS) {
          await enterClockSuspectForVault(vault, now, baselineLastSeen);
          continue;
        }

        const nextLastSeen = Math.max(now, baselineLastSeen);
        highWaterMarks.set(vid, nextLastSeen);

        if (now >= vault.deadlineAt) {
          await executeSingleVaultExpirationDestruction(vid, vault, null, false);
          continue;
        }

        const healthyState = computeHealthyActiveState(vault, now);
        let latestRec = vault;
        if (nextLastSeen - (vault.lastSeen || 0) >= 30000 || vault.state !== healthyState) {
          const updated = {
            ...vault,
            id: vid,
            rev: Number(vault.rev || 1) + 1,
            lastSeen: nextLastSeen,
            state: healthyState
          };
          try {
            await idbPut(STORE_VAULTS, updated);
            const verified = await idbGet(STORE_VAULTS, vid);
            if (verified) latestRec = verified;
          } catch (_) {}
        } else {
          latestRec = { ...vault, state: healthyState };
        }
        vaultsMap.set(vid, latestRec);
        if (latestRec.notifications?.enabled) {
          globalNotifEnabled = true;
        }
        await evaluateNearExpiryNotificationsForVault(latestRec, now);
      }

      renderUI();
      return getSnapshot();
    } finally {
      lifecycleBusy = false;
    }
  }

  function evaluateLifecycle() {
    const next = lifecycleQueue.then(runEvaluateLifecyclePass, runEvaluateLifecyclePass);
    lifecycleQueue = next.catch(() => {});
    return next;
  }

  /* =====================================================================
   * 6. Separated Check-In, Management Operations, Decryption, & Deletion
   * ===================================================================== */
  async function performCheckIn(vaultId, credentials = {}) {
    if (!vaultId) throw new Error('対象のタイムシークレットが指定されていません。');

    // 1. 最優先で Tombstone およびセカンダリアンカーを確認（rawVaultの有無に関わらず！）
    await assertNotDestroyedOrTombstoned(vaultId);

    return await withVaultLock(vaultId, async () => {
      // ロック内でも再度 Tombstone とロールバックアンカーを確認
      await assertNotDestroyedOrTombstoned(vaultId);

      const tomb = await idbGet(STORE_TOMBSTONES, vaultId);
      const rawVault = await idbGet(STORE_VAULTS, vaultId);
      if (!rawVault) {
        await evaluateLifecycle();
        if (tomb?.state === STATES.DESTROYED || tomb?.state === STATES.DELETE_PENDING) {
          throw new Error('期限切れ処理が完了した金庫はチェックインによって復活できません。新規に作成してください。');
        }
        throw new Error('指定されたタイムシークレットが見つかりません（既に削除または期限切れの可能性があります）。');
      }
      verifyNoRollbackAgainstAnchor(vaultId, rawVault);
      if (!isRecordStructurallySound(rawVault)) {
        throw new Error('レコードが破損しているためチェックインできません。詳細画面から復号を取り出してください。');
      }
      if (rawVault.state === STATES.DELETE_PENDING || rawVault.state === STATES.DESTROYED || rawVault.state === STATES.EXPIRED) {
        throw new Error('期限切れまたは削除処理中の金庫はチェックインできません。');
      }
      if (rawVault.state === STATES.CLOCK_SUSPECT) {
        vaultsMap.set(vaultId, rawVault);
        renderUI();
        throw new Error('時計異常（復旧待ち）を検知しているため、通常のチェックインおよび期限延長は停止されています。詳細画面の「復号」からデータを取り出せます。');
      }

      const latestVault = await migrateVaultToV3IfNeeded(rawVault);
      const now = nowMs();
      const baselineLastSeen = Math.max(Number(latestVault.lastSeen || 0), highWaterMarks.get(vaultId) || 0);

      if (baselineLastSeen > 0 && now < baselineLastSeen - CLOCK_ROLLBACK_THRESHOLD_MS) {
        await enterClockSuspectForVault(latestVault, now, baselineLastSeen);
        renderUI();
        throw new Error('端末時刻が最終観測時刻より5分以上過去になっているため、時計異常モードへ移行しました。期限は延長されていません。');
      }

      if (now >= latestVault.deadlineAt) {
        await executeSingleVaultExpirationDestruction(vaultId, latestVault, null, false);
        renderUI();
        throw new Error('既にチェックイン期限を超過していたため、期限切れ削除処理を実行しました（復活はできません）。');
      }

      // Verify ONLY the vault's saved Check-In Authentication Policy!
      await verifyVaultPolicyAuth(latestVault, 'CHECKIN', credentials);

      const postAuthNow = nowMs();
      if (postAuthNow >= latestVault.deadlineAt) {
        await executeSingleVaultExpirationDestruction(vaultId, latestVault, null, false);
        renderUI();
        throw new Error('認証完了時点で期限を超過していたため、期限切れ削除処理を実行しました。');
      }

      const dp = latestVault.deadlinePolicy || { mode: 'relative', relativeMs: latestVault.intervalMs };
      const nextLastSeen = Math.max(postAuthNow, baselineLastSeen);
      let nextDeadlineAt;
      let nextIntervalMs = latestVault.intervalMs;
      let nextDeadlinePolicy;

      if (dp.mode === 'absolute') {
        const fixedTarget = Number(dp.fixedDeadlineAt ?? latestVault.deadlineAt);
        if (!Number.isFinite(fixedTarget) || fixedTarget <= postAuthNow) {
          throw new Error('指定された絶対時刻の期限を既に過ぎているため、チェックインできません（自動で未来へ延長されません）。');
        }
        nextDeadlineAt = fixedTarget; // Fixed absolute timestamp stays unchanged!
        nextDeadlinePolicy = { mode: 'absolute', fixedDeadlineAt: fixedTarget };
      } else {
        const effectiveRelMs = (Number.isFinite(latestVault.pendingIntervalMs) && latestVault.pendingIntervalMs >= MIN_RELATIVE_MS)
          ? latestVault.pendingIntervalMs
          : Number(dp.relativeMs || latestVault.intervalMs);
        nextIntervalMs = effectiveRelMs;
        nextDeadlineAt = postAuthNow + effectiveRelMs;
        nextDeadlinePolicy = { mode: 'relative', relativeMs: effectiveRelMs };
      }

      const nextState = computeHealthyActiveState(
        { intervalMs: nextIntervalMs, deadlineAt: nextDeadlineAt, deadlinePolicy: nextDeadlinePolicy },
        postAuthNow
      );
      const nextRev = Number(latestVault.rev || 1) + 1;

      const updatedRecord = {
        ...latestVault,
        id: vaultId,
        vaultId,
        rev: nextRev,
        state: nextState,
        lastCheckInAt: postAuthNow,
        lastSeen: nextLastSeen,
        intervalMs: nextIntervalMs,
        pendingIntervalMs: null,
        deadlineAt: nextDeadlineAt,
        deadlinePolicy: nextDeadlinePolicy,
        notifications: {
          enabled: Boolean(latestVault.notifications?.enabled),
          deadlineEpoch: nextDeadlineAt,
          sent24h: nextDeadlineAt === latestVault.deadlineAt ? Boolean(latestVault.notifications?.sent24h) : false,
          sent1h: nextDeadlineAt === latestVault.deadlineAt ? Boolean(latestVault.notifications?.sent1h) : false
        }
      };

      await idbPut(STORE_VAULTS, updatedRecord);
      const readback = await idbGet(STORE_VAULTS, vaultId);
      if (
        !readback ||
        (readback.vaultId || readback.id) !== vaultId ||
        readback.deadlineAt !== nextDeadlineAt ||
        readback.lastCheckInAt !== postAuthNow ||
        readback.rev !== nextRev
      ) {
        const diag = {
          hasReadback: !!readback,
          readbackId: readback?.id,
          readbackVaultId: readback?.vaultId,
          targetVaultId: vaultId,
          readbackDeadline: readback?.deadlineAt,
          expectedDeadline: nextDeadlineAt,
          readbackLastCheckIn: readback?.lastCheckInAt,
          expectedLastCheckIn: postAuthNow,
          readbackRev: readback?.rev,
          expectedRev: nextRev
        };
        throw new Error(`チェックイン結果のIndexedDB読み戻し検証に失敗しました。期限は更新されていません。 (diag: ${JSON.stringify(diag)})`);
      }

      setHighWaterAnchor(vaultId, { lastSeen: nextLastSeen, policyRev: readback.policyRev });
      highWaterMarks.set(vaultId, nextLastSeen);
      vaultsMap.set(vaultId, readback);
      broadcastSync('CHECKED_IN', vaultId);
      renderUI();
      return {
        ok: true,
        success: true,
        deadlineAt: readback.deadlineAt,
        lastCheckInAt: readback.lastCheckInAt,
        vault: readback
      };
    });
  }

  /**
   * Updates Deadline Policy (Relative or Absolute) — strictly protected by Management Auth!
   * Rejects past absolute timestamps without modifying deadlineAt.
   */
  async function updateDeadlinePolicy(vaultId, newDeadlineSpec, mgmtCredentials = {}, confirmImmediateExpiry = false) {
    if (!vaultId) throw new Error('対象のタイムシークレットが指定されていません。');
    if (!newDeadlineSpec || typeof newDeadlineSpec !== 'object') {
      throw new Error('新しい期限設定が指定されていません。');
    }

    await assertNotDestroyedOrTombstoned(vaultId);

    return await withVaultLock(vaultId, async () => {
      await assertNotDestroyedOrTombstoned(vaultId);
      const rawVault = await idbGet(STORE_VAULTS, vaultId);
      if (!rawVault || (rawVault.state !== STATES.ACTIVE && rawVault.state !== STATES.WARNING)) {
        throw new Error('現在の状態では期限設定を変更できません。');
      }
      verifyNoRollbackAgainstAnchor(vaultId, rawVault);
      const latestVault = await migrateVaultToV3IfNeeded(rawVault);
      const now = nowMs();
      const baselineLastSeen = Math.max(Number(latestVault.lastSeen || 0), highWaterMarks.get(vaultId) || 0);

      if (baselineLastSeen > 0 && now < baselineLastSeen - CLOCK_ROLLBACK_THRESHOLD_MS) {
        await enterClockSuspectForVault(latestVault, now, baselineLastSeen);
        renderUI();
        throw new Error('時計異常を検知したため期限変更を中止しました。');
      }
      if (now >= latestVault.deadlineAt) {
        await executeSingleVaultExpirationDestruction(vaultId, latestVault, null, false);
        renderUI();
        throw new Error('既に期限切れのため変更できません。');
      }

      const mode = newDeadlineSpec.mode === 'absolute' ? 'absolute' : 'relative';
      if (mode === 'absolute') {
        const fixedDeadlineAt = Number(newDeadlineSpec.fixedDeadlineAt);
        if (!Number.isFinite(fixedDeadlineAt)) {
          throw new Error('絶対時刻の指定形式が不正です。');
        }
        if (fixedDeadlineAt <= now) {
          throw new Error('指定された絶対時刻が現在時刻より過去（または現在時刻）のため変更できません（期限は変更されていません）。');
        }

        // Verify Management Auth before persisting deadline policy change
        await verifyVaultPolicyAuth(latestVault, 'MANAGEMENT', mgmtCredentials);

        const postNow = nowMs();
        if (fixedDeadlineAt <= postNow) {
          throw new Error('認証完了時点で指定日時が過去になったため変更を中止しました。');
        }
        const spanMs = Math.max(1000, fixedDeadlineAt - postNow);
        const nextPolicy = { mode: 'absolute', fixedDeadlineAt };
        const nextState = computeHealthyActiveState({ intervalMs: spanMs, deadlineAt: fixedDeadlineAt, deadlinePolicy: nextPolicy }, postNow);
        const updatedRecord = {
          ...latestVault,
          id: vaultId,
          rev: Number(latestVault.rev || 1) + 1,
          state: nextState,
          lastSeen: Math.max(postNow, baselineLastSeen),
          intervalMs: spanMs,
          pendingIntervalMs: null,
          deadlineAt: fixedDeadlineAt,
          deadlinePolicy: nextPolicy,
          notifications: {
            enabled: Boolean(latestVault.notifications?.enabled),
            deadlineEpoch: fixedDeadlineAt,
            sent24h: false,
            sent1h: false
          }
        };
        await idbPut(STORE_VAULTS, updatedRecord);
        const readback = await idbGet(STORE_VAULTS, vaultId);
        if (!readback || readback.deadlineAt !== fixedDeadlineAt || readback.deadlinePolicy?.mode !== 'absolute') {
          throw new Error('絶対時刻の保存確認に失敗しました。');
        }
        vaultsMap.set(vaultId, readback);
        broadcastSync('DEADLINE_UPDATED', vaultId);
        renderUI();
        return { mode: 'absolute_updated', vault: readback };
      }

      // Relative mode
      const newRelativeMs = Number(newDeadlineSpec.relativeMs);
      if (!Number.isFinite(newRelativeMs) || newRelativeMs < MIN_RELATIVE_MS || newRelativeMs > MAX_RELATIVE_MS) {
        throw new Error('相対時間は5秒以上・10年以内で指定してください。');
      }

      const candidateFromLastCheckIn = latestVault.lastCheckInAt + newRelativeMs;
      const isShorteningCurrentDeadline = candidateFromLastCheckIn < latestVault.deadlineAt;
      if (isShorteningCurrentDeadline && candidateFromLastCheckIn <= now && !confirmImmediateExpiry) {
        const err = new Error('前回のチェックインから既に新しい相対時間以上が経過しているため、適用すると直ちに期限切れ（鍵破棄・削除）となります。実行する場合は確認のうえ再度実行してください。');
        err.code = 'SHORTEN_WOULD_EXPIRE';
        throw err;
      }

      // Verify Management Auth
      await verifyVaultPolicyAuth(latestVault, 'MANAGEMENT', mgmtCredentials);

      const postNow = nowMs();
      const nextPolicy = { mode: 'relative', relativeMs: newRelativeMs };
      const nextDeadlineAt = isShorteningCurrentDeadline
        ? Math.min(latestVault.deadlineAt, candidateFromLastCheckIn)
        : (latestVault.deadlinePolicy?.mode === 'absolute' ? postNow + newRelativeMs : latestVault.deadlineAt);
      const pendingIntervalMs = (!isShorteningCurrentDeadline && latestVault.deadlinePolicy?.mode !== 'absolute' && newRelativeMs !== latestVault.intervalMs)
        ? newRelativeMs
        : null;

      const nextState = computeHealthyActiveState(
        { intervalMs: newRelativeMs, deadlineAt: nextDeadlineAt, deadlinePolicy: nextPolicy },
        postNow
      );
      const updatedRecord = {
        ...latestVault,
        id: vaultId,
        rev: Number(latestVault.rev || 1) + 1,
        state: nextState,
        lastSeen: Math.max(postNow, baselineLastSeen),
        intervalMs: pendingIntervalMs ? latestVault.intervalMs : newRelativeMs,
        pendingIntervalMs,
        deadlineAt: nextDeadlineAt,
        deadlinePolicy: pendingIntervalMs ? latestVault.deadlinePolicy : nextPolicy,
        notifications: {
          enabled: Boolean(latestVault.notifications?.enabled),
          deadlineEpoch: nextDeadlineAt,
          sent24h: nextDeadlineAt === latestVault.deadlineAt ? Boolean(latestVault.notifications?.sent24h) : false,
          sent1h: nextDeadlineAt === latestVault.deadlineAt ? Boolean(latestVault.notifications?.sent1h) : false
        }
      };

      await idbPut(STORE_VAULTS, updatedRecord);
      const readback = await idbGet(STORE_VAULTS, vaultId);
      if (!readback) throw new Error('期限設定の保存確認に失敗しました。');
      vaultsMap.set(vaultId, readback);

      if (nowMs() >= readback.deadlineAt) {
        await executeSingleVaultExpirationDestruction(vaultId, readback, null, false);
        renderUI();
        return { mode: 'expired_immediately', vault: null };
      }

      broadcastSync('DEADLINE_UPDATED', vaultId);
      renderUI();
      return {
        mode: pendingIntervalMs ? 'staged_extension' : (isShorteningCurrentDeadline ? 'shortened' : 'relative_updated'),
        vault: readback
      };
    });
  }

  async function updateCheckInInterval(vaultId, newIntervalMs, mgmtCredentials = {}, confirmImmediateExpiry = false) {
    return await updateDeadlinePolicy(vaultId, { mode: 'relative', relativeMs: Number(newIntervalMs) }, mgmtCredentials, confirmImmediateExpiry);
  }

  /**
   * Updates Check-In Authentication Policy (including switching 認証なし <-> authenticated,
   * and registering / changing / removing Check-In Passkey).
   * Strictly requires Management Auth! Never alters Encryption Auth!
   */
  async function updateCheckInAuthPolicy(vaultId, newCheckInSpec, mgmtCredentials = {}) {
    if (!vaultId) throw new Error('対象のタイムシークレットが指定されていません。');
    if (!newCheckInSpec || typeof newCheckInSpec !== 'object') {
      throw new Error('新しいチェックイン認証設定が指定されていません。');
    }

    await assertNotDestroyedOrTombstoned(vaultId);

    return await withVaultLock(vaultId, async () => {
      await assertNotDestroyedOrTombstoned(vaultId);
      const rawVault = await idbGet(STORE_VAULTS, vaultId);
      if (!rawVault || (rawVault.state !== STATES.ACTIVE && rawVault.state !== STATES.WARNING)) {
        throw new Error('現在の状態ではチェックイン認証設定を変更できません。');
      }
      verifyNoRollbackAgainstAnchor(vaultId, rawVault);
      const latestVault = await migrateVaultToV3IfNeeded(rawVault);
      const keyRec = await idbGet(STORE_KEYSTORE, vaultId);
      if (!keyRec?.deviceKey) {
        throw new Error('デバイス鍵が存在しないため設定を変更できません。');
      }

      // 1. Verify Management Auth FIRST!
      await verifyVaultPolicyAuth(latestVault, 'MANAGEMENT', mgmtCredentials);

      // 2. Bump policyRev & re-seal BOTH policies under new policyRev so replay/rollback is impossible
      const nextPolicyRev = Number(latestVault.policyRev || 1) + 1;
      const oldMgmtUnsealed = await unsealAndVerifyPolicyIntegrity(
        'MANAGEMENT',
        latestVault,
        latestVault.managementAuth,
        latestVault.sealedManagementPolicy,
        keyRec.deviceKey
      );

      const rawCiSpec = newCheckInSpec?.policy || newCheckInSpec || {};
      const newCiBundle = await buildAndSealDedicatedPolicy({
        purpose: 'CHECKIN',
        vaultId,
        createdAt: latestVault.createdAt,
        policyRev: nextPolicyRev,
        deviceKey: keyRec.deviceKey,
        spec: {
          ...rawCiSpec,
          password: rawCiSpec.password || newCheckInSpec?.newPassword || ''
        },
        allowNone: true
      });

      const resealedMgmtSecret = {
        ...oldMgmtUnsealed,
        policyRev: nextPolicyRev
      };
      const resealedMgmt = await sealPolicyObjectWithDeviceKey(
        'MANAGEMENT',
        vaultId,
        latestVault.createdAt,
        nextPolicyRev,
        latestVault.managementAuth,
        resealedMgmtSecret,
        keyRec.deviceKey
      );

      const updatedVault = {
        ...latestVault,
        id: vaultId,
        policyRev: nextPolicyRev,
        rev: Number(latestVault.rev || 1) + 1,
        checkInAuth: newCiBundle.publicPolicy,
        sealedCheckInPolicy: newCiBundle.sealed,
        sealedManagementPolicy: resealedMgmt
      };
      const updatedKeyRec = {
        ...keyRec,
        id: vaultId,
        policyRev: nextPolicyRev
      };

      await idbPutVaultAndKeyBundle(updatedKeyRec, updatedVault);
      const readVault = await idbGet(STORE_VAULTS, vaultId);
      const readKey = await idbGet(STORE_KEYSTORE, vaultId);
      if (!readVault || !readKey || readVault.policyRev !== nextPolicyRev || readKey.policyRev !== nextPolicyRev) {
        throw new Error('チェックイン認証ポリシー更新の読み戻し検証に失敗しました。');
      }
      await unsealAndVerifyPolicyIntegrity('CHECKIN', readVault, readVault.checkInAuth, readVault.sealedCheckInPolicy, readKey.deviceKey);
      await unsealAndVerifyPolicyIntegrity('MANAGEMENT', readVault, readVault.managementAuth, readVault.sealedManagementPolicy, readKey.deviceKey);

      setHighWaterAnchor(vaultId, { policyRev: nextPolicyRev });
      setHighWaterAnchor(vaultId, { policyRev: nextPolicyRev });
      vaultsMap.set(vaultId, readVault);
      broadcastSync('POLICY_UPDATED', vaultId);
      renderUI();
      return { ok: true, vault: readVault };
    });
  }

  /**
   * Updates Management Authentication Policy.
   * Requires current Management Auth (or Encryption Auth + DeviceKey recovery when `mgmtCredentials.useEncryptionRecovery === true`).
   * Rejects `認証なし` to prevent accidental security downgrade!
   */
  async function updateManagementAuthPolicy(vaultId, newMgmtSpec, mgmtCredentials = {}) {
    if (!vaultId) throw new Error('対象のタイムシークレットが指定されていません。');
    if (!newMgmtSpec || typeof newMgmtSpec !== 'object') {
      throw new Error('新しい管理操作認証設定が指定されていません。');
    }

    await assertNotDestroyedOrTombstoned(vaultId);

    return await withVaultLock(vaultId, async () => {
      await assertNotDestroyedOrTombstoned(vaultId);
      const rawVault = await idbGet(STORE_VAULTS, vaultId);
      if (!rawVault || (rawVault.state !== STATES.ACTIVE && rawVault.state !== STATES.WARNING)) {
        throw new Error('現在の状態では管理操作認証設定を変更できません。');
      }
      verifyNoRollbackAgainstAnchor(vaultId, rawVault);
      const latestVault = await migrateVaultToV3IfNeeded(rawVault);
      const keyRec = await idbGet(STORE_KEYSTORE, vaultId);
      if (!keyRec?.deviceKey) {
        throw new Error('デバイス鍵が存在しないため設定を変更できません。');
      }

      // 1. Re-authenticate with current Management Auth (or Encryption Recovery)
      await verifyVaultPolicyAuth(latestVault, 'MANAGEMENT', mgmtCredentials);

      const nextPolicyRev = Number(latestVault.policyRev || 1) + 1;
      const oldCiUnsealed = await unsealAndVerifyPolicyIntegrity(
        'CHECKIN',
        latestVault,
        latestVault.checkInAuth,
        latestVault.sealedCheckInPolicy,
        keyRec.deviceKey
      );

      const newMgmtBundle = await buildAndSealDedicatedPolicy({
        purpose: 'MANAGEMENT',
        vaultId,
        createdAt: latestVault.createdAt,
        policyRev: nextPolicyRev,
        deviceKey: keyRec.deviceKey,
        spec: { ...newMgmtSpec, mode: 'factors' },
        origin: 'custom',
        allowNone: false
      });

      const resealedCiSecret = {
        ...oldCiUnsealed,
        policyRev: nextPolicyRev
      };
      const resealedCi = await sealPolicyObjectWithDeviceKey(
        'CHECKIN',
        vaultId,
        latestVault.createdAt,
        nextPolicyRev,
        latestVault.checkInAuth,
        resealedCiSecret,
        keyRec.deviceKey
      );

      const updatedVault = {
        ...latestVault,
        id: vaultId,
        policyRev: nextPolicyRev,
        rev: Number(latestVault.rev || 1) + 1,
        managementAuth: newMgmtBundle.publicPolicy,
        sealedManagementPolicy: newMgmtBundle.sealed,
        sealedCheckInPolicy: resealedCi
      };
      const updatedKeyRec = {
        ...keyRec,
        id: vaultId,
        policyRev: nextPolicyRev
      };

      await idbPutVaultAndKeyBundle(updatedKeyRec, updatedVault);
      const readVault = await idbGet(STORE_VAULTS, vaultId);
      const readKey = await idbGet(STORE_KEYSTORE, vaultId);
      if (!readVault || !readKey || readVault.policyRev !== nextPolicyRev || readKey.policyRev !== nextPolicyRev) {
        throw new Error('管理操作認証ポリシー更新の読み戻し検証に失敗しました。');
      }
      await unsealAndVerifyPolicyIntegrity('CHECKIN', readVault, readVault.checkInAuth, readVault.sealedCheckInPolicy, readKey.deviceKey);
      await unsealAndVerifyPolicyIntegrity('MANAGEMENT', readVault, readVault.managementAuth, readVault.sealedManagementPolicy, readKey.deviceKey);

      setHighWaterAnchor(vaultId, { policyRev: nextPolicyRev });
      vaultsMap.set(vaultId, readVault);
      broadcastSync('POLICY_UPDATED', vaultId);
      renderUI();
      return { ok: true, vault: readVault };
    });
  }

  /**
   * Unified Decryption & Recovery (uses Encryption Auth + DeviceKey + Card Array Seed if seedBound).
   */
  async function decryptVault(vaultId, { password = '', keyfileBytes = null, keyfileName = '', seedNum = undefined } = {}) {
    if (!vaultId) throw new Error('復号対象のタイムシークレットが選択されていません。');

    // 1. 最優先で Tombstone およびセカンダリアンカーを確認
    await assertNotDestroyedOrTombstoned(vaultId);

    const vault = await idbGet(STORE_VAULTS, vaultId);
    if (!vault) {
      throw new Error('復号対象のタイムシークレットが存在しません（削除済みまたは期限切れ破棄済み）。');
    }
    verifyNoRollbackAgainstAnchor(vaultId, vault);

    if (vault.state === STATES.DELETE_PENDING) {
      throw new Error('削除処理中のタイムシークレットは復号できません。');
    }

    if (vault.state === STATES.ACTIVE || vault.state === STATES.WARNING) {
      const now = nowMs();
      const baseline = Math.max(Number(vault.lastSeen || 0), highWaterMarks.get(vaultId) || 0);
      if (baseline > 0 && now < baseline - CLOCK_ROLLBACK_THRESHOLD_MS) {
        await enterClockSuspectForVault(vault, now, baseline);
        renderUI();
      } else if (now >= vault.deadlineAt) {
        await executeSingleVaultExpirationDestruction(vaultId, vault, null, false);
        renderUI();
        throw new Error('チェックイン期限を超過していたため、期限切れ削除処理を実行しました。');
      }
    }

    const freshVault = (await idbGet(STORE_VAULTS, vaultId)) || vault;
    const keyRec = await idbGet(STORE_KEYSTORE, vaultId);
    if (!keyRec || !keyRec.deviceKey) {
      throw new Error('このタイムシークレットに対応する「デバイス鍵」がIndexedDB内に見つかりません。サイトデータ消去等でデバイス鍵が失われた場合、認証情報があっても復号できません。');
    }

    const res = await unwrapAndVerifyVaultKey({
      vaultRecord: freshVault,
      deviceKey: keyRec.deviceKey,
      password,
      keyfileBytes,
      keyfileName,
      seedNum,
      verifyAuthOnly: false
    });
    const text = res.kind === 'text' && res.dataBytes ? dec.decode(res.dataBytes) : null;
    return { ...res, text, vaultId };
  }

  /**
   * Destructive Deletion of ONE specific Time Secret — strictly protected by Management Auth!
   */
  async function deleteSingleTimeSecret(vaultId, mgmtCredentials = {}, confirmedTarget = false) {
    if (!vaultId) throw new Error('削除対象のタイムシークレットが指定されていません。');
    if (!confirmedTarget) {
      throw new Error('破壊的操作を実行するには、対象タイムシークレット削除の確認チェックが必要です。');
    }

    // A confirmed DESTROYED tombstone is display history, not an operable vault.
    // It must be removable even though assertNotDestroyedOrTombstoned() correctly
    // rejects every attempt to revive/check-in/delete an already-destroyed vault.
    // Only remove the history record when both secret-bearing stores are already empty.
    const initialVault = await idbGet(STORE_VAULTS, vaultId);
    const initialKey = await idbGet(STORE_KEYSTORE, vaultId);
    const initialTomb = await idbGet(STORE_TOMBSTONES, vaultId);
    if (!initialVault && !initialKey && initialTomb?.state === STATES.DESTROYED) {
      return await withVaultLock(vaultId, async () => {
        const [rawVault, keyRec, tomb] = await Promise.all([
          idbGet(STORE_VAULTS, vaultId),
          idbGet(STORE_KEYSTORE, vaultId),
          idbGet(STORE_TOMBSTONES, vaultId)
        ]);
        if (rawVault || keyRec) {
          throw new Error('破棄履歴を消去できません。金庫データまたはデバイス鍵が残っているため、安全のため操作を拒否しました。');
        }
        if (!tomb || tomb.state !== STATES.DESTROYED) {
          throw new Error('破棄確認済みの履歴ではないため、一覧から消去できません。');
        }

        // Keep the secondary anti-resurrection anchor. Removing the visible history
        // must not remove the local guard against restoring an old IndexedDB backup.
        setHighWaterAnchor(vaultId, { state: STATES.DESTROYED });
        await idbDeleteKey(STORE_TOMBSTONES, vaultId);
        const [remainingVault, remainingKey, remainingTomb] = await Promise.all([
          idbGet(STORE_VAULTS, vaultId),
          idbGet(STORE_KEYSTORE, vaultId),
          idbGet(STORE_TOMBSTONES, vaultId)
        ]);
        if (remainingVault || remainingKey || remainingTomb) {
          throw new Error('破棄履歴の消去後、IndexedDBの読み戻し検証に失敗しました。');
        }
        tombstonesMap.delete(vaultId);
        vaultsMap.delete(vaultId);
        recoveryNotices.delete(vaultId);
        if (selectedVaultId === vaultId) {
          selectedVaultId = null;
          currentView = 'list';
        }
        broadcastSync('DELETED', vaultId);
        renderUI();
        return { ok: true, deletedVaultId: vaultId, historyOnly: true };
      });
    }

    await assertNotDestroyedOrTombstoned(vaultId);

    return await withVaultLock(vaultId, async () => {
      await assertNotDestroyedOrTombstoned(vaultId);
      const rawVault = await idbGet(STORE_VAULTS, vaultId);
      const keyRec = await idbGet(STORE_KEYSTORE, vaultId);

      if (rawVault && isRecordStructurallySound(rawVault) && keyRec?.deviceKey) {
        verifyNoRollbackAgainstAnchor(vaultId, rawVault);
        const vault = await migrateVaultToV3IfNeeded(rawVault);
        if (requiresUserAuth(vault.managementAuth) || vault.sealedManagementPolicy) {
          await verifyVaultPolicyAuth(vault, 'MANAGEMENT', mgmtCredentials);
        }
      }

      if (openedSecret?.vaultId === vaultId) {
        clearOpenedSecret();
      }

      await idbDeleteSingleVaultCompletely(vaultId);
      setHighWaterAnchor(vaultId, { state: STATES.DESTROYED });

      const [remKey, remVault, remTomb] = await Promise.all([
        idbGet(STORE_KEYSTORE, vaultId),
        idbGet(STORE_VAULTS, vaultId),
        idbGet(STORE_TOMBSTONES, vaultId)
      ]);
      if (remKey !== null || remVault !== null || remTomb !== null) {
        throw new Error('削除後の読み戻し検証で一部データの残存が検出されました。');
      }

      vaultsMap.delete(vaultId);
      tombstonesMap.delete(vaultId);
      highWaterMarks.delete(vaultId);
      recoveryNotices.delete(vaultId);

      if (selectedVaultId === vaultId) {
        selectedVaultId = null;
        currentView = 'list';
      }

      broadcastSync('DELETED', vaultId);
      renderUI();
      return { ok: true, deletedVaultId: vaultId };
    });
  }

  async function clearAllTimeSecretsForReset() {
    scrubAllEphemeralMemory();
    await idbClearAllTimeSecretStores();
    vaultsMap.clear();
    tombstonesMap.clear();
    highWaterMarks.clear();
    recoveryNotices.clear();
    selectedVaultId = null;
    currentView = 'list';
    broadcastSync('CLEARED_ALL', null);
    renderUI();
    return { ok: true };
  }

  /* =====================================================================
   * 6-B. Ephemeral Buffer & Form Scrubbing
   * ===================================================================== */
  function clearOpenedSecret() {
    if (openedSecret?.dataBytes) zeroizeBuf(openedSecret.dataBytes);
    openedSecret = null;
    if ($('ts-decrypted-view')) $('ts-decrypted-view').textContent = '';
    if ($('ts-decrypted-meta')) $('ts-decrypted-meta').textContent = '';
    if ($('ts-decrypted-file-card')) $('ts-decrypted-file-card').hidden = true;
    if ($('ts-decrypted-text-wrap')) $('ts-decrypted-text-wrap').hidden = true;
    if ($('ts-decrypted-box')) $('ts-decrypted-box').hidden = true;
  }

  function updatePasskeyStatusBanner(statusId, clearBtnId, session, defaultMsg) {
    const el = $(statusId);
    const clr = $(clearBtnId);
    if (!el) return;
    if (session && session.credentialId?.length) {
      const idShort = bytesToHex(session.credentialId).slice(0, 12);
      el.dataset.registered = 'true';
      el.textContent = `✅ WebAuthn PRF対応パスキー検証・登録準備完了（ID: ${idShort}… ／ ${session.reusedExisting ? '既存パスキー共用' : '専用新規パスキー'}）`;
      if (clr) clr.hidden = false;
    } else {
      el.dataset.registered = 'false';
      el.textContent = defaultMsg;
      if (clr) clr.hidden = true;
    }
  }

  function clearCreateInputs() {
    zeroizeBuf(selectedSecretFileBytes);
    selectedSecretFileBytes = null;
    selectedSecretFile = null;

    zeroizeBuf(createKeyfileBytes);
    createKeyfileBytes = null;
    createKeyfileName = '';

    zeroizeBuf(createCiKeyfileBytes);
    createCiKeyfileBytes = null;
    createCiKeyfileName = '';

    zeroizeBuf(createMgmtKeyfileBytes);
    createMgmtKeyfileBytes = null;
    createMgmtKeyfileName = '';

    pendingCreateCiPkSession = scrubPasskeySession(pendingCreateCiPkSession);
    pendingCreateMgmtPkSession = scrubPasskeySession(pendingCreateMgmtPkSession);

    for (const id of [
      'ts-vault-label', 'ts-secret-text', 'ts-secret-file',
      'ts-password', 'ts-password-confirm', 'ts-keyfile',
      'ts-ci-password', 'ts-ci-password-confirm', 'ts-ci-keyfile',
      'ts-mgmt-password', 'ts-mgmt-password-confirm', 'ts-mgmt-keyfile'
    ]) {
      scrubInputEl($(id));
    }

    if ($('ts-ack-devicekey')) $('ts-ack-devicekey').checked = false;
    if ($('ts-opt-password')) $('ts-opt-password').checked = true;
    if ($('ts-opt-keyfile')) $('ts-opt-keyfile').checked = false;
    if ($('ts-opt-passkey')) $('ts-opt-passkey').checked = false;
    if ($('ts-ci-opt-none')) $('ts-ci-opt-none').checked = true;
    if ($('ts-ci-opt-password')) $('ts-ci-opt-password').checked = false;
    if ($('ts-ci-opt-keyfile')) $('ts-ci-opt-keyfile').checked = false;
    if ($('ts-ci-opt-passkey')) $('ts-ci-opt-passkey').checked = false;
    if ($('ts-mgmt-mode-same')) $('ts-mgmt-mode-same').checked = true;
    if ($('ts-mgmt-mode-custom')) $('ts-mgmt-mode-custom').checked = false;
    if ($('ts-mgmt-opt-password')) $('ts-mgmt-opt-password').checked = false;
    if ($('ts-mgmt-opt-keyfile')) $('ts-mgmt-opt-keyfile').checked = false;
    if ($('ts-mgmt-opt-passkey')) $('ts-mgmt-opt-passkey').checked = false;

    if ($('ts-keyfile-info')) $('ts-keyfile-info').textContent = 'キーファイル未選択';
    if ($('ts-ci-keyfile-info')) $('ts-ci-keyfile-info').textContent = 'キーファイル未選択（※同じ .key ファイルを共用しても暗号鍵は流用せず独立した検証子で照合します）';
    if ($('ts-mgmt-keyfile-info')) $('ts-mgmt-keyfile-info').textContent = 'キーファイル未選択';

    updatePasskeyStatusBanner(
      'ts-ci-pk-status',
      'btn-ts-ci-clear-passkey',
      null,
      '⚠️ 未登録：暗号化でパスキーを使わない場合でも独立して登録できます。下のボタンでPRF対応確認と登録を実行してください。'
    );
    updatePasskeyStatusBanner(
      'ts-mgmt-pk-status',
      'btn-ts-mgmt-clear-passkey',
      null,
      '⚠️ 未登録：下のボタンで管理用パスキーのPRF対応確認と登録を実行してください。'
    );

    syncUnifiedInputFileState();

    if (tsTransferredPayload?.bytes) zeroizeBuf(tsTransferredPayload.bytes);
    tsTransferredPayload = null;
    if ($('ts-type-transferred')) $('ts-type-transferred').disabled = true;
    if ($('ts-type-text')) $('ts-type-text').checked = true;

    updateConsentUI();
    syncPayloadUI();
  }

  function clearDetailEditInputs() {
    zeroizeBuf(editCiKeyfileBytes);
    editCiKeyfileBytes = null;
    editCiKeyfileName = '';

    zeroizeBuf(editMgmtKeyfileBytes);
    editMgmtKeyfileBytes = null;
    editMgmtKeyfileName = '';

    pendingEditCiPkSession = scrubPasskeySession(pendingEditCiPkSession);
    pendingEditMgmtPkSession = scrubPasskeySession(pendingEditMgmtPkSession);

    for (const id of [
      'ts-edit-ci-password', 'ts-edit-ci-password-confirm', 'ts-edit-ci-keyfile',
      'ts-edit-mgmt-password', 'ts-edit-mgmt-password-confirm', 'ts-edit-mgmt-keyfile'
    ]) {
      scrubInputEl($(id));
    }

    if ($('ts-edit-ci-kf-info')) $('ts-edit-ci-kf-info').textContent = 'キーファイル未選択';
    if ($('ts-edit-mgmt-kf-info')) $('ts-edit-mgmt-kf-info').textContent = 'キーファイル未選択';

    updatePasskeyStatusBanner(
      'ts-edit-ci-pk-status',
      'btn-ts-edit-ci-clear-passkey',
      null,
      '⚠️ 新しいチェックイン用パスキーを登録・検証してください（管理操作認証を通過するまで保存されません）。'
    );
    updatePasskeyStatusBanner(
      'ts-edit-mgmt-pk-status',
      'btn-ts-edit-mgmt-clear-passkey',
      null,
      '⚠️ 新しい管理用パスキーを登録・PRF検証してください。'
    );
  }

  function closeAuthModal() {
    pendingModalContext = null;
    zeroizeBuf(modalKeyfileBytes);
    modalKeyfileBytes = null;
    modalKeyfileName = '';
    scrubInputEl($('ts-modal-password'));
    scrubInputEl($('ts-modal-keyfile'));
    if ($('ts-modal-kf-info')) $('ts-modal-kf-info').textContent = 'キーファイル未選択';
    if ($('ts-modal-confirm-chk')) $('ts-modal-confirm-chk').checked = false;
    if ($('ts-modal-use-enc-recovery')) $('ts-modal-use-enc-recovery').checked = false;
    setStatusMsg('ts-modal-status', '', 'info');
    if ($('ts-auth-modal')) $('ts-auth-modal').hidden = true;
  }

  function scrubAllEphemeralMemory() {
    clearOpenedSecret();
    clearCreateInputs();
    clearDetailEditInputs();
    closeAuthModal();
    zeroizeBuf(detailUnlockKeyfileBytes);
    detailUnlockKeyfileBytes = null;
    detailUnlockKeyfileName = '';
    scrubInputEl($('ts-unlock-password'));
    scrubInputEl($('ts-unlock-keyfile'));
    if ($('ts-unlock-kf-info')) $('ts-unlock-kf-info').textContent = 'キーファイル未選択';
    if ($('ts-detail-decrypt-box')) $('ts-detail-decrypt-box').hidden = true;
  }

  /* =====================================================================
   * 7. PWA Near-Expiry Notifications per Vault
   * ===================================================================== */
  function isNotificationApiSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  async function dispatchBrowserNotification(title, body, tag) {
    if (!isNotificationApiSupported() || Notification.permission !== 'granted') return false;
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, {
            body,
            tag,
            icon: 'pwa-192.png',
            badge: 'favicon.png',
            renotify: false,
            data: { targetTab: 'tab-timesecret' }
          });
          return true;
        }
      }
      // eslint-disable-next-line no-new
      new Notification(title, { body, tag, icon: 'pwa-192.png' });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function evaluateNearExpiryNotificationsForVault(record, now) {
    if (!record || !Number.isFinite(record.deadlineAt)) return;
    const remaining = record.deadlineAt - now;
    if (remaining <= 0) return;

    const notif = record.notifications && record.notifications.deadlineEpoch === record.deadlineAt
      ? { ...record.notifications }
      : {
          enabled: Boolean(record.notifications?.enabled || globalNotifEnabled),
          deadlineEpoch: record.deadlineAt,
          sent24h: false,
          sent1h: false
        };

    let changed = notif.deadlineEpoch !== record.notifications?.deadlineEpoch;
    const canSendOsNotif = notif.enabled && isNotificationApiSupported() && Notification.permission === 'granted';

    if (remaining <= NOTIFY_1H_MS && !notif.sent1h) {
      if (canSendOsNotif) {
        await dispatchBrowserNotification(
          `タイムシークレット「${record.label}」：期限1時間前`,
          `チェックイン期限（${formatDateTime(record.deadlineAt)}）まで残り1時間以内です。`,
          `cm-ts-1h-${record.vaultId}-${record.deadlineAt}`
        );
      }
      notif.sent1h = true;
      notif.sent24h = true;
      changed = true;
    } else if (remaining <= NOTIFY_24H_MS && !notif.sent24h) {
      if (canSendOsNotif) {
        await dispatchBrowserNotification(
          `タイムシークレット「${record.label}」：期限24時間前`,
          `チェックイン期限（${formatDateTime(record.deadlineAt)}）まで残り24時間以内です。`,
          `cm-ts-24h-${record.vaultId}-${record.deadlineAt}`
        );
      }
      notif.sent24h = true;
      changed = true;
    }

    if (changed) {
      const updated = { ...record, id: record.vaultId, notifications: notif };
      try {
        await idbPut(STORE_VAULTS, updated);
        vaultsMap.set(record.vaultId, updated);
      } catch (_) {}
    }
  }

  /* =====================================================================
   * 8. UI Rendering (List View, Create View, Detail View, & Auth Modal)
   * ===================================================================== */
  function describePolicyShort(policyObj) {
    if (!policyObj || !requiresUserAuth(policyObj)) return '⚡認証なし';
    const parts = [];
    if (policyObj.usePassword) parts.push('🔑PW');
    if (policyObj.useKeyfile) parts.push('📄KF');
    if (policyObj.usePasskey) parts.push('👤パスキー');
    return parts.join('＋');
  }

  function describePolicyDetailed(policyObj, includeDeviceKey = false) {
    if (!policyObj || !requiresUserAuth(policyObj)) {
      return includeDeviceKey ? '認証なし（非抽出可能デバイス鍵のみ保護）' : '⚡ 認証なし（ワンクリック）';
    }
    const parts = [];
    if (policyObj.usePassword) {
      const kdfName = window.MatrixCardPreset?.kdfLabel
        ? window.MatrixCardPreset.kdfLabel(policyObj.kdfProfile)
        : `Profile ${policyObj.kdfProfile}`;
      parts.push(`パスワード (${kdfName})`);
    }
    if (policyObj.useKeyfile) parts.push('キーファイル');
    if (policyObj.usePasskey) parts.push('パスキー (WebAuthn PRF)');
    if (includeDeviceKey) parts.push('非抽出可能デバイス鍵');
    return parts.join(' ＋ ');
  }

  function describeDeadlinePolicyShort(vault) {
    if (!vault) return '—';
    const dp = vault.deadlinePolicy;
    if (dp?.mode === 'absolute') {
      return '📅 絶対時刻（日時固定）';
    }
    const relMs = Number(dp?.relativeMs || vault.intervalMs || 0);
    return `⏱️ 相対時間 (+${formatIntervalLabel(relMs)})`;
  }

  function buildCombinedDisplayEntries() {
    const items = [];
    for (const [vid, v] of vaultsMap.entries()) {
      const tomb = tombstonesMap.get(vid) || null;
      const effState = tomb?.state === STATES.DELETE_FAILED ? STATES.DELETE_FAILED : (v.state || STATES.ACTIVE);
      items.push({
        vaultId: vid,
        isTombstoneOnly: false,
        label: v.label || `タイムシークレット (${vid.slice(0, 6)})`,
        state: effState,
        lastCheckInAt: v.lastCheckInAt,
        deadlineAt: v.deadlineAt,
        createdAt: v.createdAt || 0,
        vault: v,
        tombstone: tomb
      });
    }
    for (const [tid, t] of tombstonesMap.entries()) {
      if (!vaultsMap.has(tid)) {
        items.push({
          vaultId: tid,
          isTombstoneOnly: true,
          label: t.label || `タイムシークレット (${tid.slice(0, 6)})`,
          state: t.state || STATES.DESTROYED,
          lastCheckInAt: null,
          deadlineAt: t.expiredDeadlineAt || null,
          createdAt: t.startedAt || 0,
          vault: null,
          tombstone: t
        });
      }
    }
    items.sort((a, b) => {
      if (a.isTombstoneOnly !== b.isTombstoneOnly) return a.isTombstoneOnly ? 1 : -1;
      return (a.deadlineAt || Infinity) - (b.deadlineAt || Infinity);
    });
    return items;
  }

  function parseDeadlineSpecFromControls(relRadioId, absRadioId, relAmountId, relUnitId, absInputId) {
    const isAbs = Boolean($(absRadioId)?.checked);
    if (isAbs) {
      const rawVal = ($(absInputId)?.value || '').trim();
      if (!rawVal) {
        throw new Error('期限の日時を入力してください。');
      }
      const parsedMs = new Date(rawVal).getTime();
      if (!Number.isFinite(parsedMs)) {
        throw new Error('指定日時の形式が正しくありません。');
      }
      if (parsedMs <= nowMs()) {
        throw new Error('指定された日時が現在時刻より過去（または現在時刻）です。未来の日時を指定してください。');
      }
      return { mode: 'absolute', fixedDeadlineAt: parsedMs };
    }

    const amt = Number($(relAmountId)?.value || 0);
    const unitMs = Number($(relUnitId)?.value || 86400000);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('有効期間には1以上の数値を入力してください。');
    }
    const relativeMs = Math.round(amt * unitMs);
    if (relativeMs < MIN_RELATIVE_MS || relativeMs > MAX_RELATIVE_MS) {
      throw new Error('相対時間の期限は5秒以上・10年以内で指定してください。');
    }
    return { mode: 'relative', relativeMs };
  }

  function applyQuickPresetToControls(sec, { relRadioId, absRadioId, relAmountId, relUnitId, absInputId, presetBtnSelector, clickedBtn }) {
    const secNum = Number(sec);
    if (!Number.isFinite(secNum) || secNum <= 0) return;

    document.querySelectorAll(presetBtnSelector).forEach((b) => b.classList.toggle('is-active', b === clickedBtn));

    const isAbs = Boolean($(absRadioId)?.checked);
    if (isAbs) {
      const targetMs = nowMs() + secNum * 1000;
      if ($(absInputId)) $(absInputId).value = formatLocalDatetimeInput(targetMs);
    } else {
      if ($(relRadioId)) $(relRadioId).checked = true;
      let amt = secNum;
      let unitVal = '1000';
      if (secNum % 86400 === 0) {
        amt = secNum / 86400;
        unitVal = '86400000';
      } else if (secNum % 3600 === 0) {
        amt = secNum / 3600;
        unitVal = '3600000';
      } else if (secNum % 60 === 0) {
        amt = secNum / 60;
        unitVal = '60000';
      }
      if ($(relAmountId)) $(relAmountId).value = String(amt);
      if ($(relUnitId)) $(relUnitId).value = unitVal;
    }
  }

  function syncCreateTimeModeBoxes() {
    const isAbs = Boolean($('ts-time-mode-abs')?.checked);
    if ($('ts-time-rel-box')) $('ts-time-rel-box').hidden = isAbs;
    if ($('ts-time-abs-box')) $('ts-time-abs-box').hidden = !isAbs;
    if (isAbs && $('ts-datetime-input') && !$('ts-datetime-input').value) {
      $('ts-datetime-input').value = formatLocalDatetimeInput(nowMs() + 7 * 86400000);
    }
    updateInitialDeadlinePreview();
  }

  function syncEditTimeModeBoxes() {
    const isAbs = Boolean($('ts-edit-time-mode-abs')?.checked);
    if ($('ts-edit-rel-box')) $('ts-edit-rel-box').hidden = isAbs;
    if ($('ts-edit-abs-box')) $('ts-edit-abs-box').hidden = !isAbs;
    if (isAbs && $('ts-edit-datetime-input') && !$('ts-edit-datetime-input').value) {
      $('ts-edit-datetime-input').value = formatLocalDatetimeInput(nowMs() + 7 * 86400000);
    }
  }

  function updateInitialDeadlinePreview() {
    const el = $('ts-initial-deadline-preview');
    const warnBox = $('ts-test-duration-warning');
    if (!el) return;
    try {
      const spec = parseDeadlineSpecFromControls(
        'ts-time-mode-rel',
        'ts-time-mode-abs',
        'ts-rel-amount',
        'ts-rel-unit',
        'ts-datetime-input'
      );
      const now = nowMs();
      if (spec.mode === 'absolute') {
        const span = spec.fixedDeadlineAt - now;
        if (warnBox) warnBox.hidden = span >= 60000;
        el.textContent = `📅 絶対時刻モード：期限日時は ${formatDateTime(spec.fixedDeadlineAt)} で固定されます（チェックインしても指定日時は延長されません）。`;
      } else {
        if (warnBox) warnBox.hidden = spec.relativeMs >= 60000;
        el.textContent = `⏱️ 相対時間モード：チェックインのたびに現在時刻から「+${formatIntervalLabel(spec.relativeMs)}」へ延長されます（今作成した場合の初回期限: ${formatDateTime(now + spec.relativeMs)}）。`;
      }
    } catch (err) {
      if (warnBox) warnBox.hidden = true;
      el.textContent = `⚠️ ${err?.message || err}`;
    }
  }

  function syncUnifiedInputFileState() {
    const hasFile = Boolean(selectedSecretFile && selectedSecretFileBytes?.length);
    const chip = $('ts-attached-file-chip');
    const chipText = $('ts-attached-file-text');
    const textWrap = $('ts-unified-text-wrap');
    if (chip) chip.hidden = !hasFile;
    if (hasFile && chipText) {
      chipText.textContent = `📎 ファイル保管: ${selectedSecretFile.name} (${formatBytes(selectedSecretFile.size)}) — 元のファイル形式のまま暗号化・出力されます`;
    }
    if (textWrap) textWrap.hidden = hasFile;
  }

  function syncCreateAuthPanels() {
    // 3-1 Encryption Auth
    const encPw = Boolean($('ts-opt-password')?.checked);
    const encKf = Boolean($('ts-opt-keyfile')?.checked);
    const encPk = Boolean($('ts-opt-passkey')?.checked);
    if ($('ts-pw-panel')) $('ts-pw-panel').hidden = !encPw;
    if ($('ts-kf-panel')) $('ts-kf-panel').hidden = !encKf;
    if ($('ts-pk-panel')) $('ts-pk-panel').hidden = !encPk;

    // 3-2 Check-In Auth
    const ciNone = Boolean($('ts-ci-opt-none')?.checked);
    const ciPw = !ciNone && Boolean($('ts-ci-opt-password')?.checked);
    const ciKf = !ciNone && Boolean($('ts-ci-opt-keyfile')?.checked);
    const ciPk = !ciNone && Boolean($('ts-ci-opt-passkey')?.checked);
    if ($('ts-ci-none-notice')) $('ts-ci-none-notice').hidden = !ciNone;
    if ($('ts-ci-pw-panel')) $('ts-ci-pw-panel').hidden = !ciPw;
    if ($('ts-ci-kf-panel')) $('ts-ci-kf-panel').hidden = !ciKf;
    if ($('ts-ci-pk-panel')) $('ts-ci-pk-panel').hidden = !ciPk;

    // Check-In Sub-options (Reuse vs Dedicated)
    // Password
    const ciPwSourceWrap = $('ts-ci-pw-source-wrap');
    if (ciPwSourceWrap) ciPwSourceWrap.hidden = !encPw;
    if (!encPw && $('ts-ci-pw-source-custom')) {
      $('ts-ci-pw-source-custom').checked = true;
    }
    const ciPwReuse = encPw && Boolean($('ts-ci-pw-source-enc')?.checked);
    if ($('ts-ci-pw-reuse-notice')) $('ts-ci-pw-reuse-notice').hidden = !ciPwReuse;
    if ($('ts-ci-pw-inputs-wrap')) $('ts-ci-pw-inputs-wrap').hidden = ciPwReuse;

    // Keyfile
    const ciKfSourceWrap = $('ts-ci-kf-source-wrap');
    if (ciKfSourceWrap) ciKfSourceWrap.hidden = !encKf;
    if (!encKf && $('ts-ci-kf-source-custom')) {
      $('ts-ci-kf-source-custom').checked = true;
    }
    const ciKfReuse = encKf && Boolean($('ts-ci-kf-source-enc')?.checked);
    if ($('ts-ci-kf-reuse-notice')) $('ts-ci-kf-reuse-notice').hidden = !ciKfReuse;
    if ($('ts-ci-kf-inputs-wrap')) $('ts-ci-kf-inputs-wrap').hidden = ciKfReuse;

    // Passkey
    const ciPkCustom = Boolean($('ts-ci-pk-source-custom')?.checked);
    if ($('ts-ci-pk-status')) {
      $('ts-ci-pk-status').textContent = ciPkCustom
        ? 'ℹ️ 専用パスキー新規作成モード：この金庫のチェックイン専用パスキーを作成・登録します。'
        : 'ℹ️ 既存パスキー利用モード：端末に登録済みの生体認証器（WebAuthn PRF）をチェックイン用として利用します。';
    }

    // 3-3 Management Auth
    const mgmtCustom = Boolean($('ts-mgmt-mode-custom')?.checked);
    if ($('ts-mgmt-custom-box')) $('ts-mgmt-custom-box').hidden = !mgmtCustom;
    if ($('ts-mgmt-pw-panel')) $('ts-mgmt-pw-panel').hidden = !(mgmtCustom && $('ts-mgmt-opt-password')?.checked);
    if ($('ts-mgmt-kf-panel')) $('ts-mgmt-kf-panel').hidden = !(mgmtCustom && $('ts-mgmt-opt-keyfile')?.checked);
    if ($('ts-mgmt-pk-panel')) $('ts-mgmt-pk-panel').hidden = !(mgmtCustom && $('ts-mgmt-opt-passkey')?.checked);

    // Sync bound seed badge
    const seedBadge = $('ts-bound-seed-badge');
    if (seedBadge) seedBadge.textContent = `#${getCurrentCardSeed()}`;
  }

  function syncEditAuthPanels() {
    const ciNone = Boolean($('ts-edit-ci-opt-none')?.checked);
    const ciPw = !ciNone && Boolean($('ts-edit-ci-opt-password')?.checked);
    const ciKf = !ciNone && Boolean($('ts-edit-ci-opt-keyfile')?.checked);
    const ciPk = !ciNone && Boolean($('ts-edit-ci-opt-passkey')?.checked);
    if ($('ts-edit-ci-pw-panel')) $('ts-edit-ci-pw-panel').hidden = !ciPw;
    if ($('ts-edit-ci-kf-panel')) $('ts-edit-ci-kf-panel').hidden = !ciKf;
    if ($('ts-edit-ci-pk-panel')) $('ts-edit-ci-pk-panel').hidden = !ciPk;

    const mgmtPw = Boolean($('ts-edit-mgmt-opt-password')?.checked);
    const mgmtKf = Boolean($('ts-edit-mgmt-opt-keyfile')?.checked);
    const mgmtPk = Boolean($('ts-edit-mgmt-opt-passkey')?.checked);
    if ($('ts-edit-mgmt-pw-panel')) $('ts-edit-mgmt-pw-panel').hidden = !mgmtPw;
    if ($('ts-edit-mgmt-kf-panel')) $('ts-edit-mgmt-kf-panel').hidden = !mgmtKf;
    if ($('ts-edit-mgmt-pk-panel')) $('ts-edit-mgmt-pk-panel').hidden = !mgmtPk;
  }

  function populateDetailSettingsFromVault(vault) {
    if (!vault) return;

    const dp = vault.deadlinePolicy || { mode: 'relative', relativeMs: vault.intervalMs };
    if ($('ts-current-deadline-policy-badge')) {
      $('ts-current-deadline-policy-badge').textContent = `現在: ${describeDeadlinePolicyShort(vault)}`;
    }
    if (dp.mode === 'absolute') {
      if ($('ts-edit-time-mode-abs')) $('ts-edit-time-mode-abs').checked = true;
      if ($('ts-edit-datetime-input') && Number.isFinite(dp.fixedDeadlineAt)) {
        $('ts-edit-datetime-input').value = formatLocalDatetimeInput(dp.fixedDeadlineAt);
      }
    } else {
      if ($('ts-edit-time-mode-rel')) $('ts-edit-time-mode-rel').checked = true;
    }
    syncEditTimeModeBoxes();

    const ci = vault.checkInAuth || vault.authMeta;
    if ($('ts-current-ci-policy-badge')) {
      $('ts-current-ci-policy-badge').textContent = `現在: ${describePolicyDetailed(ci, false)}`;
    }
    const mgmt = vault.managementAuth || vault.authMeta;
    if ($('ts-current-mgmt-policy-badge')) {
      $('ts-current-mgmt-policy-badge').textContent = `現在: ${describePolicyDetailed(mgmt, false)}`;
    }
    syncEditAuthPanels();
  }

  function renderInAppExpiryBanner() {
    const banner = $('ts-inapp-expiry-banner');
    if (!banner) return;
    const now = nowMs();
    const urgent1h = [];
    const warn24h = [];

    for (const v of vaultsMap.values()) {
      if (v.state !== STATES.ACTIVE && v.state !== STATES.WARNING) continue;
      const rem = v.deadlineAt - now;
      if (rem > 0 && rem <= NOTIFY_1H_MS) {
        urgent1h.push(`「${v.label}」(残り ${formatDuration(rem)})`);
      } else if (rem > 0 && rem <= NOTIFY_24H_MS && v.state === STATES.WARNING) {
        warn24h.push(`「${v.label}」(残り ${formatDuration(rem)})`);
      }
    }

    if (urgent1h.length > 0) {
      banner.hidden = false;
      banner.dataset.urgency = '1h';
      banner.textContent = `⏰ 【期限1時間前警告】${urgent1h.join('、')} のチェックイン期限が1時間以内に迫っています！`;
    } else if (warn24h.length > 0) {
      banner.hidden = false;
      banner.dataset.urgency = '24h';
      banner.textContent = `⚠️ 【期限接近】${warn24h.join('、')} のチェックイン期限が24時間以内です。`;
    } else {
      banner.hidden = true;
      banner.textContent = '';
    }
  }

  function renderListView(entries) {
    const emptyBox = $('ts-list-empty');
    const tableWrap = $('ts-list-table-wrap');
    const tbody = $('ts-vault-list-body');
    if (!tbody) return;

    if (entries.length === 0) {
      if (emptyBox) emptyBox.hidden = false;
      if (tableWrap) tableWrap.hidden = true;
      tbody.innerHTML = '';
      return;
    }
    if (emptyBox) emptyBox.hidden = true;
    if (tableWrap) tableWrap.hidden = false;

    const now = nowMs();
    const rowsHtml = entries.map((item) => {
      const v = item.vault;
      const st = item.state;
      const stLabel = STATE_LABELS[st] || st;
      const isFile = v?.payloadMeta?.kind === 'binary';
      const typeIcon = item.isTombstoneOnly ? '🪦' : (isFile ? '📁' : '📝');
      const authSummary = v
        ? `🔐復号:${describePolicyShort(v.encryptionAuth || v.authMeta)} ｜ ✅CI:${describePolicyShort(v.checkInAuth || v.authMeta)} ｜ ${describeDeadlinePolicyShort(v)}`
        : '破棄確認済み履歴';
      const canCheckIn = Boolean(v && (st === STATES.ACTIVE || st === STATES.WARNING));
      const remText = v && (st === STATES.ACTIVE || st === STATES.WARNING)
        ? `残り ${formatDuration(Math.max(0, v.deadlineAt - now))}`
        : (st === STATES.CLOCK_SUSPECT ? '時計異常・停止中' : stLabel);

      return `
        <tr class="ts-list-row" data-vault-id="${escapeHtml(item.vaultId)}">
          <td data-label="名前">
            <div class="ts-row-name">${typeIcon} ${escapeHtml(item.label)}</div>
            <div class="ts-row-sub">${escapeHtml(authSummary)}</div>
          </td>
          <td data-label="状態">
            <span class="ts-state-pill" data-state="${escapeHtml(st)}">${escapeHtml(stLabel)}</span>
          </td>
          <td data-label="最終チェックイン" class="ts-mono-cell">
            ${escapeHtml(v ? formatDateTime(v.lastCheckInAt) : '—')}
          </td>
          <td data-label="次の期限" class="ts-mono-cell">
            <div>${escapeHtml(item.deadlineAt ? formatDateTime(item.deadlineAt) : '—')}</div>
            <div class="ts-row-sub ts-live-rem" data-vault-id="${escapeHtml(item.vaultId)}">${escapeHtml(remText)}</div>
          </td>
          <td data-label="操作" class="ts-actions-cell">
            <div class="ts-row-btns">
              ${canCheckIn ? `<button type="button" class="ts-btn ts-btn-primary ts-btn-sm" data-ts-action="checkin" data-vault-id="${escapeHtml(item.vaultId)}">✅ チェックイン</button>` : ''}
              <button type="button" class="ts-btn ts-btn-secondary ts-btn-sm" data-ts-action="detail" data-vault-id="${escapeHtml(item.vaultId)}">詳細を開く</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
  }

  async function renderDetailView() {
    if (!selectedVaultId) {
      currentView = 'list';
      renderUI();
      return;
    }
    const vault = vaultsMap.get(selectedVaultId) || null;
    const tomb = tombstonesMap.get(selectedVaultId) || null;
    if (!vault && !tomb) {
      selectedVaultId = null;
      currentView = 'list';
      renderUI();
      return;
    }

    const st = tomb?.state === STATES.DELETE_FAILED ? STATES.DELETE_FAILED : (vault ? vault.state : tomb.state);
    const label = vault?.label || tomb?.label || 'タイムシークレット';

    if ($('ts-detail-title')) $('ts-detail-title').textContent = label;
    const stBadge = $('ts-detail-state-badge');
    if (stBadge) {
      stBadge.dataset.state = st;
      stBadge.textContent = `${st} · ${STATE_LABELS[st] || st}`;
    }

    if ($('ts-disp-state')) $('ts-disp-state').textContent = `${STATE_LABELS[st] || st} (${st})`;
    if ($('ts-disp-last-checkin')) $('ts-disp-last-checkin').textContent = vault ? formatDateTime(vault.lastCheckInAt) : '—（破棄済み）';
    if ($('ts-disp-deadline')) {
      $('ts-disp-deadline').textContent = vault
        ? formatDateTime(vault.deadlineAt)
        : (tomb?.expiredDeadlineAt ? `${formatDateTime(tomb.expiredDeadlineAt)}（期限到達）` : '—');
    }

    const metaEl = $('ts-disp-meta');
    if (metaEl) {
      if (vault) {
        const isFile = vault.payloadMeta?.kind === 'binary';
        const kindDesc = isFile
          ? `ファイル (${vault.payloadMeta?.originalName || '元形式保持'} / ${formatBytes(vault.payloadMeta?.byteLength || 0)})`
          : `テキスト (${formatBytes(vault.payloadMeta?.byteLength || 0)})`;
        const pendingTxt = vault.pendingIntervalMs
          ? `（次回チェックイン時に +${formatIntervalLabel(vault.pendingIntervalMs)} へ更新予約中）`
          : '';
        const seedTxt = vault.seedMeta?.seedBound ? '有効 (CMA1)' : '非連動（旧形式互換）';
        metaEl.textContent =
          `ID: ${vault.vaultId.slice(0, 12)}… ｜ 種別: ${kindDesc} ｜ 期限方式: ${describeDeadlinePolicyShort(vault)}${pendingTxt} ｜ シード連動: ${seedTxt} ｜ ` +
          `🔐暗号化認証: ${describePolicyDetailed(vault.encryptionAuth || vault.authMeta, true)} ｜ ` +
          `✅チェックイン認証: ${describePolicyDetailed(vault.checkInAuth || vault.authMeta, false)} ｜ ` +
          `🛡️管理操作認証: ${describePolicyDetailed(vault.managementAuth || vault.authMeta, false)}`;
      } else if (tomb) {
        metaEl.textContent = `ID: ${tomb.vaultId.slice(0, 12)}… ｜ 削除記録日時: ${formatDateTime(tomb.completedAt || tomb.startedAt)}`;
      }
    }

    const notice = recoveryNotices.get(selectedVaultId);
    if (notice) {
      setStatusMsg('ts-global-status', notice, st === STATES.DELETE_FAILED ? 'err' : 'warn');
    }

    const isHealthy = Boolean(vault && (st === STATES.ACTIVE || st === STATES.WARNING));
    const canDecrypt = Boolean(vault && (st === STATES.ACTIVE || st === STATES.WARNING || st === STATES.CLOCK_SUSPECT || st === STATES.CORRUPTED));

    if ($('ts-primary-actions')) $('ts-primary-actions').hidden = !(isHealthy || canDecrypt);
    if ($('btn-ts-detail-checkin')) {
      $('btn-ts-detail-checkin').hidden = !isHealthy;
      $('btn-ts-detail-checkin').disabled = !isHealthy;
    }
    if ($('btn-ts-detail-decrypt-toggle')) {
      $('btn-ts-detail-decrypt-toggle').hidden = !canDecrypt;
      $('btn-ts-detail-decrypt-toggle').disabled = !canDecrypt;
    }

    if ($('ts-settings-details')) {
      $('ts-settings-details').hidden = !isHealthy;
      if (isHealthy && vault.vaultId !== $('ts-settings-details').dataset.loadedVaultId) {
        $('ts-settings-details').dataset.loadedVaultId = vault.vaultId;
        populateDetailSettingsFromVault(vault);
      } else if (isHealthy) {
        if ($('ts-current-deadline-policy-badge')) {
          $('ts-current-deadline-policy-badge').textContent = `現在: ${describeDeadlinePolicyShort(vault)}`;
        }
        if ($('ts-current-ci-policy-badge')) {
          $('ts-current-ci-policy-badge').textContent = `現在: ${describePolicyDetailed(vault.checkInAuth || vault.authMeta, false)}`;
        }
        if ($('ts-current-mgmt-policy-badge')) {
          $('ts-current-mgmt-policy-badge').textContent = `現在: ${describePolicyDetailed(vault.managementAuth || vault.authMeta, false)}`;
        }
      }
    }

    const clockPanel = $('ts-clock-alert-panel');
    if (clockPanel) {
      clockPanel.hidden = st !== STATES.CLOCK_SUSPECT;
      if (st === STATES.CLOCK_SUSPECT && $('ts-clock-alert-detail')) {
        const anom = vault?.clockAnomaly;
        $('ts-clock-alert-detail').textContent = anom
          ? `最終観測時刻 (lastSeen): ${formatDateTime(anom.previousLastSeen)} ／ 検知時の端末時刻: ${formatDateTime(anom.observedSystemTime)}（約 ${formatDuration(anom.skewMs)} の逆行）`
          : '保存済みの最終観測時刻より5分以上過去のシステム時刻が観測されました。';
      }
    }

    const failPanel = $('ts-delete-failed-panel');
    if (failPanel) {
      failPanel.hidden = st !== STATES.DELETE_FAILED;
      if (st === STATES.DELETE_FAILED && $('ts-delete-failed-detail')) {
        const d = tomb?.errorDetail || 'デバイス鍵または暗号データの消去を読み戻しで確認できませんでした。';
        $('ts-delete-failed-detail').textContent = d;
      }
    }

    const destroyedPanel = $('ts-destroyed-panel');
    if (destroyedPanel) {
      destroyedPanel.hidden = st !== STATES.DESTROYED;
      if (st === STATES.DESTROYED && $('ts-destroyed-detail')) {
        $('ts-destroyed-detail').textContent =
          `破棄確認日時: ${formatDateTime(tomb?.completedAt)} ｜ IndexedDB読み戻し検証: 当該デバイス鍵=消去確認済、当該暗号データ=消去確認済（他のタイムシークレットには影響ありません）。`;
      }
    }

    const pendingBadge = $('ts-pending-interval-badge');
    if (pendingBadge) {
      if (vault?.pendingIntervalMs) {
        pendingBadge.hidden = false;
        pendingBadge.textContent = `📌 延長予約中：次回チェックイン確定時に間隔が「+${formatIntervalLabel(vault.pendingIntervalMs)}」へ更新されます。`;
      } else {
        pendingBadge.hidden = true;
      }
    }

    const delBtn = $('btn-ts-detail-open-delete');
    if (delBtn) {
      delBtn.textContent = vault
        ? `🗑️ 「${label}」を削除・鍵を破棄する`
        : `🗑️ 「${label}」の破棄履歴を一覧から消去する`;
    }

    syncNotificationControls(vault);
    renderCountdownTick();
  }

  function syncNotificationControls(vault) {
    const permBadge = $('ts-notif-perm-badge');
    const chk = $('ts-notif-enabled');
    const btnReq = $('btn-ts-request-notif');
    if (!permBadge) return;

    if (!isNotificationApiSupported()) {
      permBadge.textContent = '非対応環境（画面内警告バナーへ自動フォールバック）';
      if (chk) { chk.checked = false; chk.disabled = true; }
      if (btnReq) btnReq.hidden = true;
      return;
    }

    const perm = Notification.permission;
    const enabled = Boolean(vault?.notifications?.enabled ?? globalNotifEnabled) && perm === 'granted';
    if (chk) {
      chk.disabled = perm === 'denied';
      chk.checked = enabled;
    }
    if (perm === 'granted') {
      permBadge.textContent = enabled ? 'PWA/ブラウザ通知：有効（24時間前・1時間前）' : '通知権限：許可済み（画面内警告のみ）';
      if (btnReq) btnReq.hidden = true;
    } else if (perm === 'denied') {
      permBadge.textContent = '通知権限：ブロック中（画面内警告へフォールバック）';
      if (btnReq) btnReq.hidden = true;
    } else {
      permBadge.textContent = '通知権限：未許可（画面内警告で動作中）';
      if (btnReq) btnReq.hidden = false;
    }
  }

  function renderCountdownTick() {
    const now = nowMs();

    let anyExpiredDetected = false;
    document.querySelectorAll('#timesecret-section .ts-live-rem').forEach((el) => {
      const vid = el.dataset.vaultId;
      const v = vaultsMap.get(vid);
      if (!v) return;
      if (v.state === STATES.ACTIVE || v.state === STATES.WARNING) {
        const rem = v.deadlineAt - now;
        if (rem <= 0) {
          el.textContent = '期限到達（処理中...）';
          anyExpiredDetected = true;
        } else {
          el.textContent = `残り ${formatDuration(rem)}`;
        }
      }
    });

    const remEl = $('ts-disp-remaining');
    if (remEl && currentView === 'detail' && selectedVaultId) {
      const v = vaultsMap.get(selectedVaultId);
      const t = tombstonesMap.get(selectedVaultId);
      const st = v ? v.state : t?.state;
      if (v && (st === STATES.ACTIVE || st === STATES.WARNING)) {
        const rem = v.deadlineAt - now;
        if (rem <= 0) {
          remEl.textContent = '0秒（期限到達・判定実行中）';
          anyExpiredDetected = true;
        } else {
          const nextHealthy = computeHealthyActiveState(v, now);
          if (nextHealthy !== v.state) {
            v.state = nextHealthy;
            renderUI();
            return;
          }
          remEl.textContent = formatDuration(rem);
        }
      } else if (st === STATES.CLOCK_SUSPECT) {
        remEl.textContent = '停止中（時計異常・復号は可能）';
      } else if (st === STATES.DESTROYED) {
        remEl.textContent = '—（破棄確認済み）';
      } else if (st === STATES.DELETE_FAILED) {
        remEl.textContent = '削除失敗（要確認）';
      } else {
        remEl.textContent = '—';
      }
    }

    renderInAppExpiryBanner();
    if (anyExpiredDetected && !lifecycleBusy) {
      evaluateLifecycle().catch(() => {});
    }
  }

  function renderUI() {
    const entries = buildCombinedDisplayEntries();
    const activeCount = Array.from(vaultsMap.values()).filter((v) => v.state !== STATES.DESTROYED).length;
    const tombOnlyCount = entries.filter((e) => e.isTombstoneOnly).length;

    const summaryPill = $('ts-state-badge');
    if (summaryPill) {
      if (entries.length === 0) {
        summaryPill.dataset.state = 'UNINITIALIZED';
        summaryPill.textContent = '登録なし（0件）';
      } else {
        const hasAlert = entries.some((e) => e.state === STATES.CLOCK_SUSPECT || e.state === STATES.DELETE_FAILED);
        const hasWarn = entries.some((e) => e.state === STATES.WARNING);
        summaryPill.dataset.state = hasAlert ? 'CLOCK_SUSPECT' : (hasWarn ? 'WARNING' : 'ACTIVE');
        summaryPill.textContent = tombOnlyCount > 0
          ? `稼働中 ${activeCount}件 ／ 破棄履歴 ${tombOnlyCount}件`
          : `管理中 ${activeCount}件`;
      }
    }

    if ($('ts-list-view')) $('ts-list-view').hidden = currentView !== 'list';
    if ($('ts-create-view')) $('ts-create-view').hidden = currentView !== 'create';
    if ($('ts-detail-view')) $('ts-detail-view').hidden = currentView !== 'detail';

    if (currentView === 'list') {
      renderListView(entries);
    } else if (currentView === 'create') {
      syncUnifiedInputFileState();
      syncCreateAuthPanels();
      syncCreateTimeModeBoxes();
    } else if (currentView === 'detail') {
      renderDetailView();
    }
    renderInAppExpiryBanner();
  }

  /* =====================================================================
   * 9. Separated Action Triggers & Shared Auth / Management Modal Flow
   * ===================================================================== */
  async function triggerCheckInFlow(vaultId) {
    setStatusMsg('ts-global-status', '', 'info');
    const rawVault = vaultsMap.get(vaultId) || (await idbGet(STORE_VAULTS, vaultId));
    if (!rawVault) {
      await evaluateLifecycle();
      return;
    }
    const vault = await migrateVaultToV3IfNeeded(rawVault);
    const ciPolicy = vault.checkInAuth || vault.authMeta;

    // 1. Check-In policy === '認証なし' -> Immediate 1-click check-in WITHOUT opening any modal!
    if (!requiresUserAuth(ciPolicy)) {
      try {
        const res = await performCheckIn(vaultId, {});
        const modeNote = res.vault.deadlinePolicy?.mode === 'absolute' ? '固定期限日時維持' : '次回期限を更新';
        setStatusMsg(
          'ts-global-status',
          `✅ 「${res.vault.label}」をチェックインしました（${modeNote}: ${formatDateTime(res.vault.deadlineAt)}）。`,
          'ok'
        );
      } catch (err) {
        setStatusMsg('ts-global-status', `❌ チェックイン失敗：${err?.message || err}`, 'err');
      }
      return;
    }

    // 2. Check-In policy === Passkey-ONLY -> Invoke WebAuthn PRF directly on user gesture!
    if (!ciPolicy.usePassword && !ciPolicy.useKeyfile && ciPolicy.usePasskey) {
      try {
        const res = await performCheckIn(vaultId, {});
        setStatusMsg(
          'ts-global-status',
          `✅ チェックイン用パスキー認証に成功し、「${res.vault.label}」をチェックインしました。次回期限: ${formatDateTime(res.vault.deadlineAt)}`,
          'ok'
        );
      } catch (err) {
        setStatusMsg('ts-global-status', `❌ チェックイン失敗（期限は更新されていません）：${err?.message || err}`, 'err');
      }
      return;
    }

    // 3. Password / Keyfile / Multi-factor Check-In -> Open Auth Modal for Check-In policy
    openAuthModal({ action: 'checkin', vault });
  }

  async function triggerDeleteFlow(vaultId) {
    setStatusMsg('ts-global-status', '', 'info');
    const rawVault = vaultsMap.get(vaultId) || (await idbGet(STORE_VAULTS, vaultId));
    const tomb = tombstonesMap.get(vaultId) || (await idbGet(STORE_TOMBSTONES, vaultId));
    if (!rawVault && !tomb) return;

    const vault = rawVault ? await migrateVaultToV3IfNeeded(rawVault) : null;
    const keyRec = vault ? await idbGet(STORE_KEYSTORE, vaultId).catch(() => null) : null;
    const mgmtPolicy = vault?.managementAuth || vault?.authMeta;
    const needsAuth = Boolean(vault && isRecordStructurallySound(vault) && keyRec?.deviceKey && requiresUserAuth(mgmtPolicy));

    openAuthModal({
      action: 'delete',
      vault: vault || { vaultId, label: tomb?.label || '破棄済み履歴', managementAuth: { mode: 'none', combo: AUTH_NONE_COMBO } },
      isTombstoneOnly: !vault,
      needsAuth
    });
  }

  function syncAuthModalFactorFields() {
    if (!pendingModalContext) return;
    const { action, vault, requireFactors } = pendingModalContext;
    const useRecovery = action !== 'checkin' && Boolean($('ts-modal-use-enc-recovery')?.checked);
    const activePolicy = action === 'checkin'
      ? (vault.checkInAuth || vault.authMeta)
      : (useRecovery ? (vault.encryptionAuth || vault.authMeta) : (vault.managementAuth || vault.authMeta));

    const roleName = action === 'checkin'
      ? 'チェックイン用'
      : (useRecovery ? '暗号化（救出本人確認）用' : '管理操作用');

    if ($('ts-modal-pw-label')) $('ts-modal-pw-label').textContent = `${roleName}パスワード:`;
    if ($('ts-modal-kf-label')) $('ts-modal-kf-label').textContent = `${roleName}キーファイル:`;
    if ($('ts-modal-pk-label')) $('ts-modal-pk-label').textContent = `${roleName}パスキー認証必須：`;

    if ($('ts-modal-pw-wrap')) $('ts-modal-pw-wrap').hidden = !(requireFactors && activePolicy?.usePassword);
    if ($('ts-modal-kf-wrap')) $('ts-modal-kf-wrap').hidden = !(requireFactors && activePolicy?.useKeyfile);
    if ($('ts-modal-pk-wrap')) $('ts-modal-pk-wrap').hidden = !(requireFactors && activePolicy?.usePasskey);
  }

  function openAuthModal({ action, vault, isTombstoneOnly = false, needsAuth = undefined, extraParams = null }) {
    closeAuthModal();
    const basePolicy = action === 'checkin'
      ? (vault.checkInAuth || vault.authMeta)
      : (vault.managementAuth || vault.authMeta);
    const requireFactors = needsAuth !== undefined ? needsAuth : requiresUserAuth(basePolicy);
    pendingModalContext = { action, vaultId: vault.vaultId, vault, requireFactors, extraParams };

    const modal = $('ts-auth-modal');
    if (!modal) return;

    const label = vault.label || 'タイムシークレット';
    const titleMap = {
      checkin: `✅ チェックイン認証 — 「${label}」`,
      update_deadline: `🛡️ 期限設定変更の管理認証 — 「${label}」`,
      update_checkin_auth: `🛡️ チェックイン認証変更の管理認証 — 「${label}」`,
      update_mgmt_auth: `🛡️ 管理操作認証変更の再認証 — 「${label}」`,
      delete: isTombstoneOnly
        ? `🗑️ 破棄履歴の消去確認 — 「${label}」`
        : `🗑️ タイムシークレット削除・鍵破棄 — 「${label}」`
    };
    if ($('ts-modal-title')) $('ts-modal-title').textContent = titleMap[action] || '認証確認';

    if ($('ts-modal-desc')) {
      if (action === 'checkin') {
        $('ts-modal-desc').textContent = `設定されたチェックイン認証ポリシー（${describePolicyDetailed(basePolicy, false)}）をすべて検証して期限を更新します。`;
      } else if (action === 'update_deadline') {
        $('ts-modal-desc').textContent = extraParams?.confirmExpiry
          ? '⚠️ この期限変更を適用すると直ちに期限切れ（鍵破棄・削除）となります。実行するには管理操作認証を行ってください。'
          : `管理操作認証ポリシー（${describePolicyDetailed(basePolicy, false)}）を確認して期限設定を更新します。`;
      } else if (action === 'update_checkin_auth') {
        $('ts-modal-desc').textContent = `管理操作認証ポリシー（${describePolicyDetailed(basePolicy, false)}）を確認してチェックイン認証設定を更新します（暗号化設定は変更されません）。`;
      } else if (action === 'update_mgmt_auth') {
        $('ts-modal-desc').textContent = `現在の管理操作認証ポリシー（${describePolicyDetailed(basePolicy, false)}）で再認証し、新しい管理操作認証ポリシーへ更新します。`;
      } else if (isTombstoneOnly) {
        $('ts-modal-desc').textContent = `「${label}」の破棄確認ログを一覧から削除します。他のタイムシークレットには影響しません。`;
      } else {
        $('ts-modal-desc').textContent = requireFactors
          ? `破壊的操作のため、管理操作認証ポリシー（${describePolicyDetailed(basePolicy, false)}）と対象確認が必要です。「${label}」以外の金庫には影響しません。`
          : `旧形式の認証なし金庫です。誤削除防止のため対象確認にチェックを入れて削除を実行してください。`;
      }
    }

    // Show Encryption-Auth Recovery toggle ONLY on management operations when vault has encryptionAuth factors
    const encAuth = vault.encryptionAuth || vault.authMeta;
    const canOfferRecovery = action !== 'checkin' && !isTombstoneOnly && requireFactors && requiresUserAuth(encAuth) && vault.managementAuth?.origin === 'custom';
    if ($('ts-modal-recovery-wrap')) {
      $('ts-modal-recovery-wrap').hidden = !canOfferRecovery;
    }

    syncAuthModalFactorFields();

    if ($('ts-modal-delete-img')) $('ts-modal-delete-img').hidden = action !== 'delete';

    const confirmWrap = $('ts-modal-confirm-wrap');
    if (confirmWrap) {
      confirmWrap.hidden = action !== 'delete';
      if (action === 'delete' && $('ts-modal-confirm-label')) {
        $('ts-modal-confirm-label').textContent = isTombstoneOnly
          ? `「${label}」の破棄履歴を一覧から消去することを確認しました`
          : `「${label}」のデバイス鍵と暗号化データを永久に破棄し、元に戻せないことを確認しました`;
      }
    }

    const submitBtn = $('btn-ts-modal-submit');
    if (submitBtn) {
      submitBtn.className = action === 'delete' ? 'ts-btn ts-btn-danger' : 'ts-btn ts-btn-primary';
      const btnTextMap = {
        checkin: '✅ 認証してチェックイン',
        update_deadline: '🛡️ 管理認証して期限設定を更新',
        update_checkin_auth: '🛡️ 管理認証してチェックイン認証を更新',
        update_mgmt_auth: '🛡️ 再認証して管理認証を更新',
        delete: '🗑️ 削除を実行する'
      };
      submitBtn.textContent = btnTextMap[action] || '実行する';
    }

    modal.hidden = false;
    if (requireFactors && basePolicy?.usePassword) {
      setTimeout(() => $('ts-modal-password')?.focus(), 40);
    }
  }

  async function openUnifiedDecryptDrawer() {
    clearOpenedSecret();
    setStatusMsg('ts-unlock-status', '', 'info');
    const box = $('ts-detail-decrypt-box');
    if (!box || !selectedVaultId) return;

    const rawVault = await idbGet(STORE_VAULTS, selectedVaultId);
    if (!rawVault) {
      setStatusMsg('ts-global-status', '復号対象の金庫データが存在しません。', 'err');
      return;
    }
    const vault = await migrateVaultToV3IfNeeded(rawVault);
    const encAuth = vault.encryptionAuth || vault.authMeta;

    const keyRec = await idbGet(STORE_KEYSTORE, selectedVaultId).catch(() => null);
    const hasDevKey = Boolean(keyRec && keyRec.deviceKey);
    const devStatus = $('ts-unlock-devkey-status');
    if (devStatus) {
      devStatus.dataset.ok = String(hasDevKey);
      devStatus.textContent = hasDevKey
        ? `✅ 専用デバイス鍵を確認済み ｜ 暗号化認証設定: ${describePolicyDetailed(encAuth, false)}`
        : '❌ このタイムシークレット用のデバイス鍵が見つかりません。デバイス鍵が失われた場合、復号はできません。';
    }

    const isSeedBound = Boolean(vault.seedMeta?.seedBound);
    if ($('ts-unlock-seed-wrap')) $('ts-unlock-seed-wrap').hidden = !isSeedBound;
    if ($('ts-unlock-legacy-seed-note')) $('ts-unlock-legacy-seed-note').hidden = isSeedBound;
    if (isSeedBound && $('ts-unlock-seed-number')) {
      $('ts-unlock-seed-number').value = getCurrentCardSeed();
    }

    const needFactors = requiresUserAuth(encAuth);
    if ($('ts-unlock-pw-wrap')) $('ts-unlock-pw-wrap').hidden = !(needFactors && encAuth.usePassword);
    if ($('ts-unlock-kf-wrap')) $('ts-unlock-kf-wrap').hidden = !(needFactors && encAuth.useKeyfile);
    if ($('ts-unlock-pk-wrap')) $('ts-unlock-pk-wrap').hidden = !(needFactors && encAuth.usePasskey);
    if ($('btn-ts-unlock-exec')) {
      $('btn-ts-unlock-exec').disabled = !hasDevKey;
      $('btn-ts-unlock-exec').textContent = needFactors ? '🔓 認証して復号する' : '🔓 ワンクリックで復号する';
    }

    box.hidden = false;
  }

  function readFileAsBytes(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function handleValidatedKeyfileInput(inputEl, infoElId, statusBannerId, assignCb) {
    const f = inputEl?.files?.[0];
    if (!f) {
      assignCb(null, '');
      if ($(infoElId)) $(infoElId).textContent = 'キーファイル未選択';
      return;
    }
    try {
      const bytes = await readFileAsBytes(f);
      const vRes = await validateKeyfileOrThrow(bytes, f.name);
      assignCb(bytes, f.name);
      if ($(infoElId)) {
        const fmtTag = vRes.format === 'keepass-xml-v2' ? 'KeePass 2.0 XML .key 検証済' : (vRes.format === 'keepass-xml-v1' ? 'KeePass XML .key 検証済' : 'バイナリキーファイル検証済');
        $(infoElId).textContent = `✅ 読み込み済み: ${f.name} (${formatBytes(f.size)} · ${fmtTag})`;
      }
      if (statusBannerId) setStatusMsg(statusBannerId, '', 'info');
    } catch (err) {
      assignCb(null, '');
      scrubInputEl(inputEl);
      if ($(infoElId)) $(infoElId).textContent = `❌ 無効なキーファイル: ${err?.message || err}`;
      if (statusBannerId) setStatusMsg(statusBannerId, `❌ ${err?.message || err}`, 'err');
    }
  }

  /* =====================================================================
   * 10. Event Bindings
   * ===================================================================== */
  function bindEvents() {
    const section = $('timesecret-section');
    if (!section || section.dataset.tsBound === '1') return;
    section.dataset.tsBound = '1';

    // Password show/hide toggles
    section.querySelectorAll('.ts-toggle-pw').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targets = String(btn.dataset.target || '').split(',').map((s) => s.trim()).filter(Boolean);
        let showing = false;
        targets.forEach((id, idx) => {
          const input = $(id);
          if (!input) return;
          if (idx === 0) showing = input.type === 'password';
          input.type = showing ? 'text' : 'password';
        });
        btn.textContent = showing ? '🙈 非表示' : '👁️ 表示';
      });
    });

    // Global card seed change updates Time Secret seed badge
    $('input-seed-number')?.addEventListener('input', () => {
      const badge = $('ts-bound-seed-badge');
      if (badge) badge.textContent = `#${getCurrentCardSeed()}`;
    });

    // View Navigation: List <-> Create <-> Detail
    const goCreate = () => {
      openCreateView();
      setStatusMsg('ts-create-progress', '', 'info');
      setStatusMsg('ts-global-status', '', 'info');
    };
    $('btn-ts-new-vault')?.addEventListener('click', goCreate);
    $('btn-ts-empty-new')?.addEventListener('click', goCreate);

    $('btn-ts-create-back')?.addEventListener('click', () => {
      clearCreateInputs();
      setStatusMsg('ts-create-progress', '', 'info');
      currentView = 'list';
      renderUI();
    });

    $('btn-ts-detail-back')?.addEventListener('click', () => {
      clearOpenedSecret();
      clearDetailEditInputs();
      scrubInputEl($('ts-unlock-password'));
      if ($('ts-detail-decrypt-box')) $('ts-detail-decrypt-box').hidden = true;
      selectedVaultId = null;
      currentView = 'list';
      renderUI();
    });

    // List View Delegated Actions
    $('ts-vault-list-body')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ts-action]');
      if (!btn) return;
      const vid = btn.dataset.vaultId;
      const act = btn.dataset.tsAction;
      if (!vid) return;
      if (act === 'checkin') {
        triggerCheckInFlow(vid);
      } else if (act === 'detail') {
        clearOpenedSecret();
        clearDetailEditInputs();
        if ($('ts-detail-decrypt-box')) $('ts-detail-decrypt-box').hidden = true;
        if ($('ts-settings-details')) delete $('ts-settings-details').dataset.loadedVaultId;
        setStatusMsg('ts-global-status', '', 'info');
        selectedVaultId = vid;
        currentView = 'detail';
        renderUI();
      }
    });

    // Unified Secret File Attachment & Clear in Create View
    $('ts-secret-file')?.addEventListener('change', async (e) => {
      zeroizeBuf(selectedSecretFileBytes);
      selectedSecretFileBytes = null;
      selectedSecretFile = null;
      const f = e.target.files?.[0];
      if (!f) {
        syncUnifiedInputFileState();
        return;
      }
      if (f.size === 0) {
        e.target.value = '';
        setStatusMsg('ts-create-progress', '❌ 空のファイル（0バイト）は保管できません。', 'err');
        syncUnifiedInputFileState();
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        e.target.value = '';
        setStatusMsg('ts-create-progress', `❌ ファイルサイズ超過 (${formatBytes(f.size)} > 上限 20MB)`, 'err');
        syncUnifiedInputFileState();
        return;
      }
      try {
        selectedSecretFileBytes = await readFileAsBytes(f);
        selectedSecretFile = f;
        setStatusMsg('ts-create-progress', '', 'info');
        syncUnifiedInputFileState();
      } catch (err) {
        setStatusMsg('ts-create-progress', `❌ ${err.message}`, 'err');
      }
    });

    $('btn-ts-clear-file')?.addEventListener('click', () => {
      zeroizeBuf(selectedSecretFileBytes);
      selectedSecretFileBytes = null;
      selectedSecretFile = null;
      scrubInputEl($('ts-secret-file'));
      syncUnifiedInputFileState();
    });

    // Deadline Mode & Quick Presets (Create View)
    $('ts-time-mode-rel')?.addEventListener('change', syncCreateTimeModeBoxes);
    $('ts-time-mode-abs')?.addEventListener('change', syncCreateTimeModeBoxes);
    $('ts-rel-amount')?.addEventListener('input', updateInitialDeadlinePreview);
    $('ts-rel-unit')?.addEventListener('change', updateInitialDeadlinePreview);
    $('ts-datetime-input')?.addEventListener('input', updateInitialDeadlinePreview);
    $('ts-datetime-input')?.addEventListener('change', updateInitialDeadlinePreview);

    // Payload Type Radios
    for (const id of ['ts-type-text', 'ts-type-file', 'ts-type-transferred']) {
      $(id)?.addEventListener('change', syncPayloadUI);
    }

    // Clear Transferred Payload
    $('btn-ts-clear-transferred')?.addEventListener('click', () => {
      if (tsTransferredPayload?.bytes) zeroizeBuf(tsTransferredPayload.bytes);
      tsTransferredPayload = null;
      if ($('ts-type-transferred')) $('ts-type-transferred').disabled = true;
      if ($('ts-type-text')) $('ts-type-text').checked = true;
      syncPayloadUI();
    });

    // Help Modal Triggers
    $('btn-ts-help')?.addEventListener('click', (e) => {
      e.preventDefault();
      openHelpModal();
    });
    $('btn-ts-help-close')?.addEventListener('click', closeHelpModal);
    $('btn-ts-help-ok')?.addEventListener('click', closeHelpModal);
    $('ts-help-modal')?.addEventListener('click', (e) => {
      if (e.target === $('ts-help-modal')) closeHelpModal();
    });

    // Toggle Guarantees Details
    $('btn-ts-toggle-guarantees')?.addEventListener('click', () => {
      const body = $('ts-guarantees-body');
      if (body) {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      }
    });

    section.querySelectorAll('.ts-preset-time-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyQuickPresetToControls(btn.dataset.sec, {
          relRadioId: 'ts-time-mode-rel',
          absRadioId: 'ts-time-mode-abs',
          relAmountId: 'ts-rel-amount',
          relUnitId: 'ts-rel-unit',
          absInputId: 'ts-datetime-input',
          presetBtnSelector: '#timesecret-section .ts-preset-time-btn',
          clickedBtn: btn
        });
        updateInitialDeadlinePreview();
      });
    });

    // Deadline Mode & Quick Presets (Detail Settings)
    $('ts-edit-time-mode-rel')?.addEventListener('change', syncEditTimeModeBoxes);
    $('ts-edit-time-mode-abs')?.addEventListener('change', syncEditTimeModeBoxes);
    section.querySelectorAll('.ts-edit-preset-time-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyQuickPresetToControls(btn.dataset.sec, {
          relRadioId: 'ts-edit-time-mode-rel',
          absRadioId: 'ts-edit-time-mode-abs',
          relAmountId: 'ts-edit-rel-amount',
          relUnitId: 'ts-edit-rel-unit',
          absInputId: 'ts-edit-datetime-input',
          presetBtnSelector: '#timesecret-section .ts-edit-preset-time-btn',
          clickedBtn: btn
        });
      });
    });

    // Separated Auth Checkboxes (Create View)
    $('ts-opt-password')?.addEventListener('change', syncCreateAuthPanels);
    $('ts-opt-keyfile')?.addEventListener('change', syncCreateAuthPanels);
    $('ts-opt-passkey')?.addEventListener('change', syncCreateAuthPanels);

    // Check-In Auth mutual exclusion: selecting "認証なし" automatically clears all other check-in factors!
    $('ts-ci-opt-none')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        if ($('ts-ci-opt-password')) $('ts-ci-opt-password').checked = false;
        if ($('ts-ci-opt-keyfile')) $('ts-ci-opt-keyfile').checked = false;
        if ($('ts-ci-opt-passkey')) $('ts-ci-opt-passkey').checked = false;
      }
      syncCreateAuthPanels();
    });
    for (const id of ['ts-ci-opt-password', 'ts-ci-opt-keyfile', 'ts-ci-opt-passkey']) {
      $(id)?.addEventListener('change', (e) => {
        if (e.target.checked && $('ts-ci-opt-none')) {
          $('ts-ci-opt-none').checked = false;
        }
        syncCreateAuthPanels();
      });
    }
    for (const id of [
      'ts-ci-pw-source-enc', 'ts-ci-pw-source-custom',
      'ts-ci-kf-source-enc', 'ts-ci-kf-source-custom',
      'ts-ci-pk-source-existing', 'ts-ci-pk-source-custom'
    ]) {
      $(id)?.addEventListener('change', syncCreateAuthPanels);
    }

    $('ts-mgmt-mode-same')?.addEventListener('change', syncCreateAuthPanels);
    $('ts-mgmt-mode-custom')?.addEventListener('change', syncCreateAuthPanels);
    $('ts-mgmt-opt-password')?.addEventListener('change', syncCreateAuthPanels);
    $('ts-mgmt-opt-keyfile')?.addEventListener('change', syncCreateAuthPanels);
    $('ts-mgmt-opt-passkey')?.addEventListener('change', syncCreateAuthPanels);

    // Edit Check-In Auth mutual exclusion (Detail View)
    $('ts-edit-ci-opt-none')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        if ($('ts-edit-ci-opt-password')) $('ts-edit-ci-opt-password').checked = false;
        if ($('ts-edit-ci-opt-keyfile')) $('ts-edit-ci-opt-keyfile').checked = false;
        if ($('ts-edit-ci-opt-passkey')) $('ts-edit-ci-opt-passkey').checked = false;
      }
      syncEditAuthPanels();
    });
    for (const id of ['ts-edit-ci-opt-password', 'ts-edit-ci-opt-keyfile', 'ts-edit-ci-opt-passkey']) {
      $(id)?.addEventListener('change', (e) => {
        if (e.target.checked && $('ts-edit-ci-opt-none')) {
          $('ts-edit-ci-opt-none').checked = false;
        }
        syncEditAuthPanels();
      });
    }
    for (const id of ['ts-edit-mgmt-opt-password', 'ts-edit-mgmt-opt-keyfile', 'ts-edit-mgmt-opt-passkey']) {
      $(id)?.addEventListener('change', syncEditAuthPanels);
    }

    // Unified Keyfile Pickers & KeePass 2.0 (.key) Generators
    $('ts-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-keyfile-info', 'ts-create-progress', (b, n) => {
        zeroizeBuf(createKeyfileBytes);
        createKeyfileBytes = b;
        createKeyfileName = n;
      });
    });
    $('btn-ts-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-create-progress',
        defaultPassword: $('ts-password')?.value || '',
        defaultPasskey: Boolean($('ts-opt-passkey')?.checked),
        context: 'ts-enc',
        onGenerated: (bytes, fname) => {
          zeroizeBuf(createKeyfileBytes);
          createKeyfileBytes = bytes;
          createKeyfileName = fname;
          if ($('ts-keyfile-info')) {
            $('ts-keyfile-info').textContent = `✅ 共通KeePassキーファイル (${fname}) を生成・セットしました（ダウンロード済み）。`;
          }
        }
      });
    });

    $('ts-ci-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-ci-keyfile-info', 'ts-create-progress', (b, n) => {
        zeroizeBuf(createCiKeyfileBytes);
        createCiKeyfileBytes = b;
        createCiKeyfileName = n;
      });
    });
    $('btn-ts-ci-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-create-progress',
        defaultPassword: $('ts-ci-password')?.value || '',
        context: 'ts-ci',
        onGenerated: (bytes, fname) => {
          zeroizeBuf(createCiKeyfileBytes);
          createCiKeyfileBytes = bytes;
          createCiKeyfileName = fname;
          if ($('ts-ci-keyfile-info')) {
            $('ts-ci-keyfile-info').textContent = `✅ チェックイン用キーファイル (${fname}) を生成・セットしました。`;
          }
        }
      });
    });
    $('btn-ts-ci-use-enc-kf')?.addEventListener('click', () => {
      if (!createKeyfileBytes || !createKeyfileBytes.length) {
        setStatusMsg('ts-create-progress', '⚠️ 先に「3-1. 暗号化の認証方式」でキーファイルを選択または生成してください。', 'warn');
        return;
      }
      zeroizeBuf(createCiKeyfileBytes);
      createCiKeyfileBytes = createKeyfileBytes.slice();
      createCiKeyfileName = createKeyfileName;
      if ($('ts-ci-keyfile-info')) {
        $('ts-ci-keyfile-info').textContent = `✅ 暗号化と同じキーファイル (${createCiKeyfileName || '選択済みファイル'}) をチェックイン検証にも共用セットしました（検証情報は独立して保存されます）。`;
      }
    });

    $('ts-mgmt-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-mgmt-keyfile-info', 'ts-create-progress', (b, n) => {
        zeroizeBuf(createMgmtKeyfileBytes);
        createMgmtKeyfileBytes = b;
        createMgmtKeyfileName = n;
      });
    });
    $('btn-ts-mgmt-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-create-progress',
        defaultPassword: $('ts-mgmt-password')?.value || '',
        context: 'ts-mgmt',
        onGenerated: (bytes, fname) => {
          zeroizeBuf(createMgmtKeyfileBytes);
          createMgmtKeyfileBytes = bytes;
          createMgmtKeyfileName = fname;
          if ($('ts-mgmt-keyfile-info')) {
            $('ts-mgmt-keyfile-info').textContent = `✅ 管理用キーファイル (${fname}) を生成・セットしました。`;
          }
        }
      });
    });
    $('btn-ts-mgmt-use-enc-kf')?.addEventListener('click', () => {
      if (!createKeyfileBytes || !createKeyfileBytes.length) {
        setStatusMsg('ts-create-progress', '⚠️ 先に「3-1. 暗号化の認証方式」でキーファイルを選択または生成してください。', 'warn');
        return;
      }
      zeroizeBuf(createMgmtKeyfileBytes);
      createMgmtKeyfileBytes = createKeyfileBytes.slice();
      createMgmtKeyfileName = createKeyfileName;
      if ($('ts-mgmt-keyfile-info')) {
        $('ts-mgmt-keyfile-info').textContent = `✅ 暗号化と同じキーファイル (${createMgmtKeyfileName || '選択済みファイル'}) を管理検証にも共用セットしました。`;
      }
    });

    $('ts-unlock-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-unlock-kf-info', 'ts-unlock-status', (b, n) => {
        zeroizeBuf(detailUnlockKeyfileBytes);
        detailUnlockKeyfileBytes = b;
        detailUnlockKeyfileName = n;
      });
    });
    $('btn-ts-unlock-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-unlock-status',
        defaultPassword: $('ts-unlock-password')?.value || '',
        context: 'ts-unlock',
        onGenerated: (bytes, fname, seedNum) => {
          zeroizeBuf(detailUnlockKeyfileBytes);
          detailUnlockKeyfileBytes = bytes;
          detailUnlockKeyfileName = fname;
          if ($('ts-unlock-kf-info')) {
            $('ts-unlock-kf-info').textContent = `✅ カード（シード #${seedNum}）から ${fname} を再生成・セットしました。`;
          }
        }
      });
    });

    $('ts-edit-ci-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-edit-ci-kf-info', 'ts-global-status', (b, n) => {
        zeroizeBuf(editCiKeyfileBytes);
        editCiKeyfileBytes = b;
        editCiKeyfileName = n;
      });
    });
    $('btn-ts-edit-ci-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-global-status',
        defaultPassword: $('ts-edit-ci-password')?.value || '',
        context: 'ts-edit-ci',
        onGenerated: (bytes, fname) => {
          zeroizeBuf(editCiKeyfileBytes);
          editCiKeyfileBytes = bytes;
          editCiKeyfileName = fname;
          if ($('ts-edit-ci-kf-info')) {
            $('ts-edit-ci-kf-info').textContent = `✅ 新しいチェックイン用キーファイル (${fname}) を生成・セットしました。`;
          }
        }
      });
    });

    $('ts-edit-mgmt-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-edit-mgmt-kf-info', 'ts-global-status', (b, n) => {
        zeroizeBuf(editMgmtKeyfileBytes);
        editMgmtKeyfileBytes = b;
        editMgmtKeyfileName = n;
      });
    });
    $('btn-ts-edit-mgmt-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-global-status',
        defaultPassword: $('ts-edit-mgmt-password')?.value || '',
        context: 'ts-edit-mgmt',
        onGenerated: (bytes, fname) => {
          zeroizeBuf(editMgmtKeyfileBytes);
          editMgmtKeyfileBytes = bytes;
          editMgmtKeyfileName = fname;
          if ($('ts-edit-mgmt-kf-info')) {
            $('ts-edit-mgmt-kf-info').textContent = `✅ 新しい管理用キーファイル (${fname}) を生成・セットしました。`;
          }
        }
      });
    });

    $('ts-modal-keyfile')?.addEventListener('change', (e) => {
      handleValidatedKeyfileInput(e.target, 'ts-modal-kf-info', 'ts-modal-status', (b, n) => {
        zeroizeBuf(modalKeyfileBytes);
        modalKeyfileBytes = b;
        modalKeyfileName = n;
      });
    });
    $('btn-ts-modal-gen-keyfile')?.addEventListener('click', () => {
      runUnifiedKeyfileGenerator({
        statusElId: 'ts-modal-status',
        defaultPassword: $('ts-modal-password')?.value || '',
        context: 'ts-modal',
        onGenerated: (bytes, fname, seedNum) => {
          zeroizeBuf(modalKeyfileBytes);
          modalKeyfileBytes = bytes;
          modalKeyfileName = fname;
          if ($('ts-modal-kf-info')) {
            $('ts-modal-kf-info').textContent = `✅ カード（シード #${seedNum}）から ${fname} を再生成・セットしました。`;
          }
        }
      });
    });

    // Dedicated Passkey Registration & PRF Verification Buttons (Create & Edit Views)
    const wirePasskeyRegButtons = ({ purpose, regBtnId, newBtnId, clearBtnId, statusId, progressStatusId, defaultMsg, getSession, setSession }) => {
      const doReg = async (forceNew) => {
        const btn = $(forceNew ? newBtnId : regBtnId);
        if (btn) btn.disabled = true;
        setStatusMsg(progressStatusId, '', 'info');
        try {
          scrubPasskeySession(getSession());
          setSession(null);
          const sess = await registerPurposePasskey(purpose, { preferExisting: !forceNew, forceNew });
          setSession(sess);
          updatePasskeyStatusBanner(statusId, clearBtnId, sess, defaultMsg);
        } catch (err) {
          updatePasskeyStatusBanner(statusId, clearBtnId, null, defaultMsg);
          setStatusMsg(progressStatusId, `❌ ${err?.message || err}`, 'err');
        } finally {
          if (btn) btn.disabled = false;
        }
      };
      $(regBtnId)?.addEventListener('click', () => doReg(false));
      $(newBtnId)?.addEventListener('click', () => doReg(true));
      $(clearBtnId)?.addEventListener('click', () => {
        scrubPasskeySession(getSession());
        setSession(null);
        updatePasskeyStatusBanner(statusId, clearBtnId, null, defaultMsg);
      });
    };

    wirePasskeyRegButtons({
      purpose: 'CHECKIN',
      regBtnId: 'btn-ts-ci-reg-passkey',
      newBtnId: 'btn-ts-ci-reg-passkey-new',
      clearBtnId: 'btn-ts-ci-clear-passkey',
      statusId: 'ts-ci-pk-status',
      progressStatusId: 'ts-create-progress',
      defaultMsg: '⚠️ 未登録：暗号化でパスキーを使わない場合でも独立して登録できます。下のボタンでPRF対応確認と登録を実行してください。',
      getSession: () => pendingCreateCiPkSession,
      setSession: (s) => { pendingCreateCiPkSession = s; }
    });

    wirePasskeyRegButtons({
      purpose: 'MANAGEMENT',
      regBtnId: 'btn-ts-mgmt-reg-passkey',
      newBtnId: 'btn-ts-mgmt-reg-passkey-new',
      clearBtnId: 'btn-ts-mgmt-clear-passkey',
      statusId: 'ts-mgmt-pk-status',
      progressStatusId: 'ts-create-progress',
      defaultMsg: '⚠️ 未登録：下のボタンで管理用パスキーのPRF対応確認と登録を実行してください。',
      getSession: () => pendingCreateMgmtPkSession,
      setSession: (s) => { pendingCreateMgmtPkSession = s; }
    });

    wirePasskeyRegButtons({
      purpose: 'CHECKIN',
      regBtnId: 'btn-ts-edit-ci-reg-passkey',
      newBtnId: 'btn-ts-edit-ci-reg-passkey-new',
      clearBtnId: 'btn-ts-edit-ci-clear-passkey',
      statusId: 'ts-edit-ci-pk-status',
      progressStatusId: 'ts-global-status',
      defaultMsg: '⚠️ 新しいチェックイン用パスキーを登録・検証してください（管理操作認証を通過するまで保存されません）。',
      getSession: () => pendingEditCiPkSession,
      setSession: (s) => { pendingEditCiPkSession = s; }
    });

    wirePasskeyRegButtons({
      purpose: 'MANAGEMENT',
      regBtnId: 'btn-ts-edit-mgmt-reg-passkey',
      newBtnId: 'btn-ts-edit-mgmt-reg-passkey-new',
      clearBtnId: 'btn-ts-edit-mgmt-clear-passkey',
      statusId: 'ts-edit-mgmt-pk-status',
      progressStatusId: 'ts-global-status',
      defaultMsg: '⚠️ 新しい管理用パスキーを登録・PRF検証してください。',
      getSession: () => pendingEditMgmtPkSession,
      setSession: (s) => { pendingEditMgmtPkSession = s; }
    });

    // Create & Seal Submit
    $('btn-ts-create-seal')?.addEventListener('click', async () => {
      const btn = $('btn-ts-create-seal');
      setStatusMsg('ts-create-progress', '', 'info');
      try {
        if (!hasValidConsent() && !$('ts-ack-devicekey')?.checked) {
          throw new Error('作成前に「デバイス鍵の喪失リスクおよび保証範囲（6項目）」の確認チェックを入れてください。');
        }
        const label = ($('ts-vault-label')?.value || '').trim() || `タイムシークレット #${vaultsMap.size + 1}`;

        const isTransferred = Boolean($('ts-type-transferred')?.checked && tsTransferredPayload);
        const isFile = Boolean($('ts-type-file')?.checked && selectedSecretFile && selectedSecretFileBytes?.length);

        let kind = 'text';
        let name = 'timesecret.txt';
        let mime = 'text/plain;charset=utf-8';
        let plainBytes = null;

        if (isTransferred) {
          kind = 'binary';
          name = tsTransferredPayload.filename || 'vault-secret.cmenc';
          mime = 'application/octet-stream';
          plainBytes = tsTransferredPayload.bytes.slice();
        } else if (isFile) {
          kind = 'binary';
          name = selectedSecretFile.name || 'timesecret.bin';
          mime = selectedSecretFile.type || 'application/octet-stream';
          plainBytes = selectedSecretFileBytes.slice();
        } else {
          const rawText = $('ts-secret-text')?.value ?? '';
          if (!rawText.trim().length) {
            throw new Error('テキストを入力するか、保管するファイルを選択してください。');
          }
          plainBytes = enc.encode(rawText);
        }

        const deadlinePolicy = parseDeadlineSpecFromControls(
          'ts-time-mode-rel',
          'ts-time-mode-abs',
          'ts-rel-amount',
          'ts-rel-unit',
          'ts-datetime-input'
        );

        // 1. Validate Encryption Auth UI
        const encUsePw = Boolean($('ts-opt-password')?.checked);
        const encUseKf = Boolean($('ts-opt-keyfile')?.checked);
        const encUsePk = Boolean($('ts-opt-passkey')?.checked);
        if (!encUsePw && !encUseKf && !encUsePk) {
          throw new Error('「3-1. 暗号化の認証方式」を少なくとも1つ選択してください。');
        }
        const encPw = $('ts-password')?.value || '';
        const encPwConf = $('ts-password-confirm')?.value || '';
        if (encUsePw) {
          if (Array.from(encPw).length < 12) throw new Error('暗号化パスワードは12文字以上で入力してください。');
          if (encPw !== encPwConf) throw new Error('暗号化パスワードと確認用再入力が一致しません。');
        }
        if (encUseKf && (!createKeyfileBytes || !createKeyfileBytes.length)) {
          throw new Error('暗号化用キーファイルを選択するか、「KeePassキーファイル(.key)生成」を押してください。');
        }
        const kdfProfile = Number($('ts-kdf-profile')?.value || 3);

        // 2. Validate Check-In Auth UI
        const ciNone = Boolean($('ts-ci-opt-none')?.checked);
        const ciUsePw = !ciNone && Boolean($('ts-ci-opt-password')?.checked);
        const ciUseKf = !ciNone && Boolean($('ts-ci-opt-keyfile')?.checked);
        const ciUsePk = !ciNone && Boolean($('ts-ci-opt-passkey')?.checked);
        if (!ciNone && !ciUsePw && !ciUseKf && !ciUsePk) {
          throw new Error('「3-2. チェックインの認証方式」を選択してください（認証不要にする場合は「⚡ 認証なし」を選択してください）。');
        }

        const ciReusePw = ciUsePw && encUsePw && Boolean($('ts-ci-pw-source-enc')?.checked);
        let ciPw = '';
        if (ciUsePw) {
          if (ciReusePw) {
            ciPw = encPw;
          } else {
            ciPw = $('ts-ci-password')?.value || '';
            const ciPwConf = $('ts-ci-password-confirm')?.value || '';
            if (Array.from(ciPw).length < 12) throw new Error('チェックイン専用パスワードは12文字以上で入力してください。');
            if (ciPw !== ciPwConf) throw new Error('チェックイン専用パスワードと確認用再入力が一致しません。');
          }
        }

        const ciReuseKf = ciUseKf && encUseKf && Boolean($('ts-ci-kf-source-enc')?.checked);
        let ciKfBytes = null;
        let ciKfName = '';
        if (ciUseKf) {
          if (ciReuseKf) {
            ciKfBytes = createKeyfileBytes;
            ciKfName = createKeyfileName;
          } else {
            if (!createCiKeyfileBytes || !createCiKeyfileBytes.length) {
              throw new Error('チェックイン用キーファイルを選択・生成するか、「暗号化用キーファイルを再利用」を選択してください。');
            }
            ciKfBytes = createCiKeyfileBytes;
            ciKfName = createCiKeyfileName;
          }
        }

        const ciReusePk = Boolean($('ts-ci-pk-source-existing')?.checked);

        // 3. Validate Management Auth UI
        const mgmtSame = Boolean($('ts-mgmt-mode-same')?.checked);
        let managementAuthSpec;
        if (mgmtSame) {
          managementAuthSpec = { sameAsEncryption: true };
        } else {
          const mgmtUsePw = Boolean($('ts-mgmt-opt-password')?.checked);
          const mgmtUseKf = Boolean($('ts-mgmt-opt-keyfile')?.checked);
          const mgmtUsePk = Boolean($('ts-mgmt-opt-passkey')?.checked);
          if (!mgmtUsePw && !mgmtUseKf && !mgmtUsePk) {
            throw new Error('「3-3. 管理操作の認証方式」を少なくとも1つ選択してください。');
          }
          const mgmtPw = $('ts-mgmt-password')?.value || '';
          const mgmtPwConf = $('ts-mgmt-password-confirm')?.value || '';
          if (mgmtUsePw) {
            if (Array.from(mgmtPw).length < 12) throw new Error('管理操作用パスワードは12文字以上で入力してください。');
            if (mgmtPw !== mgmtPwConf) throw new Error('管理操作用パスワードと確認用再入力が一致しません。');
          }
          if (mgmtUseKf && (!createMgmtKeyfileBytes || !createMgmtKeyfileBytes.length)) {
            throw new Error('管理操作用キーファイルを選択・生成するか、「暗号化のキーファイルを共用」を押してください。');
          }
          managementAuthSpec = {
            sameAsEncryption: false,
            mode: 'factors',
            usePassword: mgmtUsePw,
            password: mgmtPw,
            kdfProfile,
            useKeyfile: mgmtUseKf,
            keyfileBytes: createMgmtKeyfileBytes,
            keyfileName: createMgmtKeyfileName,
            usePasskey: mgmtUsePk,
            passkeySession: pendingCreateMgmtPkSession
          };
        }

        btn.disabled = true;
        try {
          const created = await createTimeSecretVault({
            label,
            kind,
            name,
            mime,
            plainBytes,
            seedNum: getCurrentCardSeed(),
            seedBound: true,
            deadlinePolicy,
            encryptionAuth: {
              usePassword: encUsePw,
              password: encPw,
              kdfProfile,
              useKeyfile: encUseKf,
              keyfileBytes: createKeyfileBytes,
              keyfileName: createKeyfileName,
              usePasskey: encUsePk
            },
            checkInAuth: {
              mode: ciNone ? 'none' : 'factors',
              usePassword: ciUsePw,
              password: ciPw,
              pwSource: ciReusePw ? 'encryption' : 'custom',
              reuseEncryptionPassword: ciReusePw,
              kdfProfile,
              useKeyfile: ciUseKf,
              keyfileBytes: ciKfBytes,
              keyfileName: ciKfName,
              kfSource: ciReuseKf ? 'encryption' : 'custom',
              reuseEncryptionKeyfile: ciReuseKf,
              usePasskey: ciUsePk,
              passkeySession: pendingCreateCiPkSession,
              preferExistingPasskey: ciReusePk,
              forceNewPasskey: !ciReusePk
            },
            managementAuth: managementAuthSpec,
            onProgress: (msg) => setStatusMsg('ts-create-progress', `⏳ ${msg}`, 'info')
          });
          recordConsent();
          clearCreateInputs();
          setStatusMsg('ts-create-progress', '', 'info');
          currentView = 'list';
          renderUI();
          updateConsentUI();
          setStatusMsg('ts-global-status', `✅ タイムシークレット「${created.label}」を作成・封印しました（3種認証分離・シード連動・事前往復検証・IndexedDB読み戻し確認済み）。`, 'ok');
        } finally {
          zeroizeBuf(plainBytes);
        }
      } catch (err) {
        setStatusMsg('ts-create-progress', `❌ ${err?.message || err}`, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    // Detail View: Check-In & Unified Decryption Drawer
    $('btn-ts-detail-checkin')?.addEventListener('click', () => {
      if (selectedVaultId) triggerCheckInFlow(selectedVaultId);
    });

    $('btn-ts-detail-decrypt-toggle')?.addEventListener('click', () => {
      const box = $('ts-detail-decrypt-box');
      if (!box) return;
      if (!box.hidden) {
        clearOpenedSecret();
        scrubInputEl($('ts-unlock-password'));
        box.hidden = true;
      } else {
        openUnifiedDecryptDrawer();
      }
    });

    $('btn-ts-alert-decrypt')?.addEventListener('click', () => {
      openUnifiedDecryptDrawer();
      $('ts-detail-decrypt-box')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    $('ts-btn-sync-card-seed')?.addEventListener('click', () => {
      const curSeed = getCurrentCardSeed();
      if ($('ts-unlock-seed-number')) $('ts-unlock-seed-number').value = curSeed;
      setStatusMsg('ts-unlock-status', `🔑 現在のカード番号 (#${curSeed}) を反映しました。`, 'info');
    });

    $('btn-ts-unlock-cancel')?.addEventListener('click', () => {
      clearOpenedSecret();
      scrubInputEl($('ts-unlock-password'));
      zeroizeBuf(detailUnlockKeyfileBytes);
      detailUnlockKeyfileBytes = null;
      detailUnlockKeyfileName = '';
      if ($('ts-detail-decrypt-box')) $('ts-detail-decrypt-box').hidden = true;
    });

    $('btn-ts-unlock-exec')?.addEventListener('click', async () => {
      if (!selectedVaultId) return;
      const btn = $('btn-ts-unlock-exec');
      btn.disabled = true;
      clearOpenedSecret();
      setStatusMsg('ts-unlock-status', '⏳ デバイス鍵・シード連動・暗号化認証要素で復号・SHA-256整合性検証を実行中...', 'info');
      try {
        const pw = $('ts-unlock-password')?.value || '';
        const seedVal = ($('ts-unlock-seed-number')?.value ?? getCurrentCardSeed()).trim() || '0';
        const res = await decryptVault(selectedVaultId, {
          password: pw,
          keyfileBytes: detailUnlockKeyfileBytes,
          keyfileName: detailUnlockKeyfileName,
          seedNum: seedVal
        });
        scrubInputEl($('ts-unlock-password'));
        openedSecret = res;

        if ($('ts-decrypted-meta')) {
          $('ts-decrypted-meta').textContent =
            `✅ 復号・SHA-256整合性確認済み (${res.sha256Hex.slice(0, 16)}…) ｜ サイズ: ${formatBytes(res.dataBytes.length)}`;
        }

        if (res.kind === 'binary') {
          if ($('ts-decrypted-text-wrap')) $('ts-decrypted-text-wrap').hidden = true;
          const fileCard = $('ts-decrypted-file-card');
          if (fileCard) fileCard.hidden = false;
          if ($('ts-decrypted-file-desc')) {
            $('ts-decrypted-file-desc').textContent = `📎 元のファイル名: ${res.name} ｜ 形式: ${res.mime} ｜ サイズ: ${formatBytes(res.dataBytes.length)}`;
          }
          if ($('btn-ts-dl-original-file')) {
            $('btn-ts-dl-original-file').textContent = `💾 元の形式で出力 (${res.name})`;
          }
          setStatusMsg('ts-unlock-status', '✅ ファイルを復号しました。下のボタンから元のファイル形式で保存してください。', 'ok');
        } else {
          if ($('ts-decrypted-file-card')) $('ts-decrypted-file-card').hidden = true;
          if ($('ts-decrypted-text-wrap')) $('ts-decrypted-text-wrap').hidden = false;
          if ($('ts-decrypted-view')) $('ts-decrypted-view').textContent = dec.decode(res.dataBytes);
          setStatusMsg('ts-unlock-status', '✅ テキストを復号して画面に表示しました。閲覧後は「閉じてメモリ消去」を押してください。', 'ok');
        }

        if ($('ts-decrypted-box')) $('ts-decrypted-box').hidden = false;
      } catch (err) {
        setStatusMsg('ts-unlock-status', `❌ ${err?.message || err}`, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    $('btn-ts-copy-decrypted')?.addEventListener('click', async () => {
      if (!openedSecret || openedSecret.kind === 'binary') return;
      const text = dec.decode(openedSecret.dataBytes);
      if (window.MatrixCardPreset?.copyWithAutoClear) {
        await window.MatrixCardPreset.copyWithAutoClear(text, () => {
          setStatusMsg('ts-unlock-status', '🛡️ クリップボードを自動消去しました。', 'info');
        });
        setStatusMsg('ts-unlock-status', '📋 コピーしました（30秒後に自動消去されます）。', 'ok');
      } else {
        await navigator.clipboard.writeText(text);
        setStatusMsg('ts-unlock-status', '📋 コピーしました。', 'ok');
      }
    });

    const downloadOpenedSecret = () => {
      if (!openedSecret?.dataBytes) return;
      const isBin = openedSecret.kind === 'binary';
      const mime = isBin ? (openedSecret.mime || 'application/octet-stream') : 'text/plain;charset=utf-8';
      const fname = isBin ? (openedSecret.name || 'timesecret.bin') : 'timesecret.txt';
      downloadBlob(new Blob([openedSecret.dataBytes], { type: mime }), fname);
    };
    $('btn-ts-dl-original-file')?.addEventListener('click', downloadOpenedSecret);
    $('btn-ts-export-text-file')?.addEventListener('click', downloadOpenedSecret);

    $('btn-ts-close-decrypted')?.addEventListener('click', () => {
      clearOpenedSecret();
      if ($('ts-detail-decrypt-box')) $('ts-detail-decrypt-box').hidden = true;
      setStatusMsg('ts-global-status', '🔒 復号表示を閉じ、メモリ上の平文バッファをゼロ消去しました。', 'info');
    });

    // Detail Settings 1: Apply Deadline Update (gated by Management Auth!)
    $('btn-ts-apply-deadline')?.addEventListener('click', async () => {
      if (!selectedVaultId) return;
      const rawVault = vaultsMap.get(selectedVaultId) || (await idbGet(STORE_VAULTS, selectedVaultId));
      if (!rawVault) return;
      try {
        const vault = await migrateVaultToV3IfNeeded(rawVault);
        const deadlineSpec = parseDeadlineSpecFromControls(
          'ts-edit-time-mode-rel',
          'ts-edit-time-mode-abs',
          'ts-edit-rel-amount',
          'ts-edit-rel-unit',
          'ts-edit-datetime-input'
        );
        const wouldExpire = deadlineSpec.mode === 'relative' &&
          Math.min(vault.deadlineAt, vault.lastCheckInAt + deadlineSpec.relativeMs) <= nowMs();

        openAuthModal({
          action: 'update_deadline',
          vault,
          extraParams: { deadlineSpec, confirmExpiry: wouldExpire }
        });
      } catch (err) {
        setStatusMsg('ts-global-status', `❌ ${err?.message || err}`, 'err');
      }
    });

    // Detail Settings 2: Apply Check-In Auth Update (gated by Management Auth!)
    $('btn-ts-apply-ci-auth')?.addEventListener('click', async () => {
      if (!selectedVaultId) return;
      const rawVault = vaultsMap.get(selectedVaultId) || (await idbGet(STORE_VAULTS, selectedVaultId));
      if (!rawVault) return;
      try {
        const vault = await migrateVaultToV3IfNeeded(rawVault);
        const ciNone = Boolean($('ts-edit-ci-opt-none')?.checked);
        const ciUsePw = !ciNone && Boolean($('ts-edit-ci-opt-password')?.checked);
        const ciUseKf = !ciNone && Boolean($('ts-edit-ci-opt-keyfile')?.checked);
        const ciUsePk = !ciNone && Boolean($('ts-edit-ci-opt-passkey')?.checked);
        if (!ciNone && !ciUsePw && !ciUseKf && !ciUsePk) {
          throw new Error('新しいチェックイン認証方式を選択してください（認証なしにする場合は「⚡ 認証なし」にチェックを入れてください）。');
        }
        const pw = $('ts-edit-ci-password')?.value || '';
        const pwConf = $('ts-edit-ci-password-confirm')?.value || '';
        if (ciUsePw) {
          if (Array.from(pw).length < 12) throw new Error('新しいチェックイン用パスワードは12文字以上で入力してください。');
          if (pw !== pwConf) throw new Error('新しいチェックイン用パスワードと確認用再入力が一致しません。');
        }
        if (ciUseKf && (!editCiKeyfileBytes || !editCiKeyfileBytes.length)) {
          throw new Error('新しいチェックイン用キーファイルを選択または生成してください。');
        }
        if (ciUsePk && !pendingEditCiPkSession) {
          throw new Error('先に「パスキーを登録・PRF検証」ボタンを押して、チェックイン用パスキーのPRF対応確認を実行してください。');
        }

        const newCheckInSpec = {
          mode: ciNone ? 'none' : 'factors',
          usePassword: ciUsePw,
          password: pw,
          kdfProfile: Number(vault.encryptionAuth?.kdfProfile || 3),
          useKeyfile: ciUseKf,
          keyfileBytes: editCiKeyfileBytes ? editCiKeyfileBytes.slice() : null,
          keyfileName: editCiKeyfileName,
          usePasskey: ciUsePk,
          passkeySession: pendingEditCiPkSession
        };

        openAuthModal({
          action: 'update_checkin_auth',
          vault,
          extraParams: { newCheckInSpec }
        });
      } catch (err) {
        setStatusMsg('ts-global-status', `❌ ${err?.message || err}`, 'err');
      }
    });

    // Detail Settings 3: Apply Management Auth Update (gated by current Management Auth or Encryption Recovery!)
    $('btn-ts-apply-mgmt-auth')?.addEventListener('click', async () => {
      if (!selectedVaultId) return;
      const rawVault = vaultsMap.get(selectedVaultId) || (await idbGet(STORE_VAULTS, selectedVaultId));
      if (!rawVault) return;
      try {
        const vault = await migrateVaultToV3IfNeeded(rawVault);
        const mgmtUsePw = Boolean($('ts-edit-mgmt-opt-password')?.checked);
        const mgmtUseKf = Boolean($('ts-edit-mgmt-opt-keyfile')?.checked);
        const mgmtUsePk = Boolean($('ts-edit-mgmt-opt-passkey')?.checked);
        if (!mgmtUsePw && !mgmtUseKf && !mgmtUsePk) {
          throw new Error('管理操作認証は少なくとも1つの方式を選択する必要があります（「認証なし」には変更できません）。');
        }
        const pw = $('ts-edit-mgmt-password')?.value || '';
        const pwConf = $('ts-edit-mgmt-password-confirm')?.value || '';
        if (mgmtUsePw) {
          if (Array.from(pw).length < 12) throw new Error('新しい管理操作用パスワードは12文字以上で入力してください。');
          if (pw !== pwConf) throw new Error('新しい管理操作用パスワードと確認用再入力が一致しません。');
        }
        if (mgmtUseKf && (!editMgmtKeyfileBytes || !editMgmtKeyfileBytes.length)) {
          throw new Error('新しい管理用キーファイルを選択または生成してください。');
        }
        if (mgmtUsePk && !pendingEditMgmtPkSession) {
          throw new Error('先に「管理用パスキーを登録・PRF検証」ボタンを押してPRF対応確認を実行してください。');
        }

        const newMgmtSpec = {
          mode: 'factors',
          usePassword: mgmtUsePw,
          password: pw,
          kdfProfile: Number(vault.encryptionAuth?.kdfProfile || 3),
          useKeyfile: mgmtUseKf,
          keyfileBytes: editMgmtKeyfileBytes ? editMgmtKeyfileBytes.slice() : null,
          keyfileName: editMgmtKeyfileName,
          usePasskey: mgmtUsePk,
          passkeySession: pendingEditMgmtPkSession
        };

        openAuthModal({
          action: 'update_mgmt_auth',
          vault,
          extraParams: { newMgmtSpec }
        });
      } catch (err) {
        setStatusMsg('ts-global-status', `❌ ${err?.message || err}`, 'err');
      }
    });

    // Detail View: Notifications
    $('btn-ts-request-notif')?.addEventListener('click', async () => {
      if (!isNotificationApiSupported()) return;
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        globalNotifEnabled = true;
        if (selectedVaultId && vaultsMap.has(selectedVaultId)) {
          const v = vaultsMap.get(selectedVaultId);
          const updated = { ...v, id: v.vaultId, notifications: { ...(v.notifications || {}), deadlineEpoch: v.deadlineAt, enabled: true } };
          await idbPut(STORE_VAULTS, updated);
          vaultsMap.set(v.vaultId, updated);
        }
        setStatusMsg('ts-global-status', '🔔 PWA/ブラウザ通知を有効化しました。', 'ok');
      } else {
        setStatusMsg('ts-global-status', '通知が許可されなかったため、画面内警告でフォールバックします。', 'warn');
      }
      renderUI();
    });

    $('ts-notif-enabled')?.addEventListener('change', async (e) => {
      if (!selectedVaultId || !vaultsMap.has(selectedVaultId)) return;
      const v = vaultsMap.get(selectedVaultId);
      const want = Boolean(e.target.checked);
      if (want && isNotificationApiSupported() && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          e.target.checked = false;
          syncNotificationControls(v);
          return;
        }
      }
      const enabled = want && isNotificationApiSupported() && Notification.permission === 'granted';
      globalNotifEnabled = enabled;
      const updated = {
        ...v,
        id: v.vaultId,
        notifications: { ...(v.notifications || { deadlineEpoch: v.deadlineAt }), enabled }
      };
      try {
        await idbPut(STORE_VAULTS, updated);
        vaultsMap.set(v.vaultId, updated);
      } catch (_) {}
      syncNotificationControls(updated);
    });

    // Detail View: Retry Delete & Open Delete Confirmation
    $('btn-ts-retry-delete')?.addEventListener('click', async () => {
      if (!selectedVaultId) return;
      const btn = $('btn-ts-retry-delete');
      btn.disabled = true;
      try {
        const v = await idbGet(STORE_VAULTS, selectedVaultId).catch(() => null);
        const t = await idbGet(STORE_TOMBSTONES, selectedVaultId).catch(() => null);
        await executeSingleVaultExpirationDestruction(selectedVaultId, v, t, true);
        renderUI();
      } finally {
        btn.disabled = false;
      }
    });

    $('btn-ts-detail-open-delete')?.addEventListener('click', () => {
      if (selectedVaultId) triggerDeleteFlow(selectedVaultId);
    });
    $('btn-ts-destroyed-clear')?.addEventListener('click', () => {
      if (selectedVaultId) triggerDeleteFlow(selectedVaultId);
    });

    // Shared Auth & Management Modal Controls
    $('ts-modal-use-enc-recovery')?.addEventListener('change', syncAuthModalFactorFields);
    $('btn-ts-modal-cancel')?.addEventListener('click', closeAuthModal);
    $('btn-ts-modal-close')?.addEventListener('click', closeAuthModal);

    $('btn-ts-modal-submit')?.addEventListener('click', async () => {
      if (!pendingModalContext) return;
      const ctx = pendingModalContext;
      const btn = $('btn-ts-modal-submit');
      btn.disabled = true;
      setStatusMsg('ts-modal-status', '⏳ 認証と整合性検証を実行中...', 'info');

      try {
        const creds = {
          password: $('ts-modal-password')?.value || '',
          keyfileBytes: modalKeyfileBytes,
          keyfileName: modalKeyfileName,
          useEncryptionRecovery: Boolean($('ts-modal-use-enc-recovery')?.checked)
        };

        if (ctx.action === 'checkin') {
          const res = await performCheckIn(ctx.vaultId, creds);
          closeAuthModal();
          setStatusMsg(
            'ts-global-status',
            `✅ 「${res.vault.label}」をチェックインしました。次回期限: ${formatDateTime(res.vault.deadlineAt)}`,
            'ok'
          );
        } else if (ctx.action === 'update_deadline') {
          const res = await updateDeadlinePolicy(
            ctx.vaultId,
            ctx.extraParams.deadlineSpec,
            creds,
            Boolean(ctx.extraParams.confirmExpiry)
          );
          closeAuthModal();
          if (res.mode === 'expired_immediately') {
            setStatusMsg('ts-global-status', '⚠️ 短縮後の期限が既に経過していたため、期限切れ削除処理を実行しました。', 'warn');
          } else if (res.mode === 'staged_extension') {
            setStatusMsg('ts-global-status', `📌 相対時間の延長（+${formatIntervalLabel(ctx.extraParams.deadlineSpec.relativeMs)}）を保存しました。次回チェックイン時に適用されます。`, 'ok');
          } else {
            setStatusMsg('ts-global-status', `✅ 期限設定を更新しました（現在の期限: ${formatDateTime(res.vault.deadlineAt)}）。`, 'ok');
          }
        } else if (ctx.action === 'update_checkin_auth') {
          const res = await updateCheckInAuthPolicy(ctx.vaultId, ctx.extraParams.newCheckInSpec, creds);
          clearDetailEditInputs();
          closeAuthModal();
          setStatusMsg(
            'ts-global-status',
            `✅ チェックイン認証ポリシーを「${describePolicyDetailed(res.vault.checkInAuth, false)}」へ更新しました（暗号化設定は維持されています）。`,
            'ok'
          );
        } else if (ctx.action === 'update_mgmt_auth') {
          const res = await updateManagementAuthPolicy(ctx.vaultId, ctx.extraParams.newMgmtSpec, creds);
          clearDetailEditInputs();
          closeAuthModal();
          setStatusMsg(
            'ts-global-status',
            `✅ 管理操作認証ポリシーを「${describePolicyDetailed(res.vault.managementAuth, false)}」へ更新しました。`,
            'ok'
          );
        } else if (ctx.action === 'delete') {
          const confirmed = Boolean($('ts-modal-confirm-chk')?.checked);
          if (!confirmed) {
            throw new Error('誤削除防止のため、確認チェックボックスにチェックを入れてください。');
          }
          const targetLabel = vaultsMap.get(ctx.vaultId)?.label || tombstonesMap.get(ctx.vaultId)?.label || 'タイムシークレット';
          await deleteSingleTimeSecret(ctx.vaultId, creds, true);
          closeAuthModal();
          setStatusMsg('ts-global-status', `🗑️ 「${targetLabel}」を削除しました（他のタイムシークレットおよび他セクションのデータは保持されています）。`, 'ok');
        }
      } catch (err) {
        setStatusMsg('ts-modal-status', `❌ ${err?.message || err}`, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    // Global Emergency Zeroize (#btn-zeroize)
    $('btn-zeroize')?.addEventListener('click', () => {
      scrubAllEphemeralMemory();
    });

    // Tab / visibility / multi-tab BroadcastChannel sync
    document.querySelector('[aria-controls="tab-timesecret"]')?.addEventListener('click', () => {
      const badge = $('ts-bound-seed-badge');
      if (badge) badge.textContent = `#${getCurrentCardSeed()}`;
      evaluateLifecycle().catch(() => {});
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        evaluateLifecycle().catch(() => {});
      } else if (window.MatrixCardPreset?.isBlindMode?.()) {
        clearOpenedSecret();
      }
    });

    window.addEventListener('focus', () => {
      evaluateLifecycle().catch(() => {});
    });

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
        syncChannel.onmessage = () => {
          evaluateLifecycle().catch(() => {});
        };
      } catch (_) {}
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data?.type === 'CM_OPEN_TIMESECRET') {
          document.querySelector('[aria-controls="tab-timesecret"]')?.click();
        }
      });
    }
  }

  function getSnapshot() {
    const entries = buildCombinedDisplayEntries();
    return {
      view: currentView,
      selectedVaultId,
      totalCount: entries.length,
      activeVaultCount: vaultsMap.size,
      tombstoneCount: tombstonesMap.size,
      vaults: entries.map((e) => ({
        id: e.vaultId,
        vaultId: e.vaultId,
        label: e.label,
        state: e.state,
        formatVersion: e.vault?.formatVersion || null,
        policyRev: e.vault?.policyRev || null,
        isTombstoneOnly: e.isTombstoneOnly,
        lastCheckInAt: e.lastCheckInAt,
        lastSeen: e.vault?.lastSeen || null,
        deadlineAt: e.deadlineAt,
        intervalMs: e.vault?.intervalMs || null,
        pendingIntervalMs: e.vault?.pendingIntervalMs || null,
        deadlinePolicy: e.vault?.deadlinePolicy ? { ...e.vault.deadlinePolicy } : null,
        seedMeta: e.vault?.seedMeta ? { ...e.vault.seedMeta } : null,
        kind: e.vault?.payloadMeta?.kind || null,
        authMeta: e.vault?.authMeta ? { ...e.vault.authMeta } : null,
        encryptionAuth: e.vault?.encryptionAuth ? { ...e.vault.encryptionAuth } : null,
        checkInAuth: e.vault?.checkInAuth ? { ...e.vault.checkInAuth } : null,
        managementAuth: e.vault?.managementAuth ? { ...e.vault.managementAuth } : null,
        clockAnomaly: e.vault?.clockAnomaly ? { ...e.vault.clockAnomaly } : null,
        tombstone: e.tombstone ? { ...e.tombstone } : null
      }))
    };
  }

  async function initTimeSecret() {
    bindEvents();
    await evaluateLifecycle();
    if (!countdownTimerId) {
      countdownTimerId = setInterval(renderCountdownTick, 1000);
    }
    if (!heartbeatTimerId) {
      heartbeatTimerId = setInterval(() => {
        evaluateLifecycle().catch(() => {});
      }, 15000);
    }
    if (location.hash === '#timesecret') {
      document.querySelector('[aria-controls="tab-timesecret"]')?.click();
    }
  }

  window.TimeSecretApp = Object.freeze({
    STATES,
    AUTH_NONE_COMBO,
    DB_NAME,
    DB_VERSION,
    STORE_VAULTS,
    STORE_KEYSTORE,
    STORE_TOMBSTONES,
    CLOCK_ROLLBACK_THRESHOLD_MS,
    getSnapshot,
    getVault: async (vaultId) => {
      const raw = await idbGet(STORE_VAULTS, vaultId);
      if (raw) return await migrateVaultToV3IfNeeded(raw);
      const tomb = await idbGet(STORE_TOMBSTONES, vaultId);
      if (tomb) return { id: vaultId, vaultId, label: tomb.label, state: tomb.state, tombstone: tomb };
      return null;
    },
    listVaults: () => getSnapshot().vaults,
    setClockProvider: (fn) => {
      nowProvider = typeof fn === 'function' ? fn : () => Date.now();
    },
    evaluateLifecycle: () => evaluateLifecycle(),
    validateKeyfileBytes: (bytes, filename) => validateKeyfileOrThrow(bytes, filename),
    registerCheckInPasskey: (opts) => registerPurposePasskey('CHECKIN', opts),
    registerManagementPasskey: (opts) => registerPurposePasskey('MANAGEMENT', opts),
    createVault: (opts) => createTimeSecretVault(opts),
    performCheckIn: (vaultId, creds) => performCheckIn(vaultId, creds),
    triggerCheckInFlow: (vaultId) => triggerCheckInFlow(vaultId),
    updateDeadlinePolicy: (vaultId, spec, mgmtCreds, confirmExpiry) => updateDeadlinePolicy(vaultId, spec, mgmtCreds, confirmExpiry),
    updateCheckInInterval: (vaultId, ms, mgmtCreds, confirmExpiry) => updateCheckInInterval(vaultId, ms, mgmtCreds, confirmExpiry),
    updateCheckInAuth: (vaultId, newCiSpec, mgmtCreds) => updateCheckInAuthPolicy(vaultId, newCiSpec, mgmtCreds),
    updateManagementAuth: (vaultId, newMgmtSpec, mgmtCreds) => updateManagementAuthPolicy(vaultId, newMgmtSpec, mgmtCreds),
    decryptVault: (vaultId, opts) => decryptVault(vaultId, opts),
    deleteVault: (vaultId, mgmtCreds, confirmed) => deleteSingleTimeSecret(vaultId, mgmtCreds, confirmed),
    clearAllForReset: () => clearAllTimeSecretsForReset(),
    openCreateView: () => openCreateView(),
    openDetailView: (vaultId) => {
      closeAuthModal();
      selectedVaultId = vaultId;
      currentView = 'detail';
      renderUI();
    },
    openListView: () => {
      closeAuthModal();
      selectedVaultId = null;
      currentView = 'list';
      renderUI();
    },
    receiveTransferredPayload: (info) => receiveTransferredPayload(info),
    openHelpModal: () => openHelpModal(),
    closeHelpModal: () => closeHelpModal(),
    hasValidConsent: () => hasValidConsent(),
    recordConsent: () => recordConsent(),
    clearConsent: () => {
      try { localStorage.removeItem(CONSENT_STORAGE_KEY); } catch (_) {}
      updateConsentUI();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTimeSecret().catch((e) => console.error('TimeSecret init failed:', e));
    });
  } else {
    initTimeSecret().catch((e) => console.error('TimeSecret init failed:', e));
  }
})();
