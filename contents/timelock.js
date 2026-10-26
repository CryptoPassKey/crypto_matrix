/**
 * CryptoPassKey / crypto_matrix — Time Lock / Time Capsule Module (timelock.js)
 *
 * Implements:
 * - Mode A (Time Capsule: drand quicknet tlock IBE + AGE + header commitment)
 * - Mode B (Private Time Capsule: inner CME3 PBKDF2/Argon2id + AES-256-GCM + ChaCha20-Poly1305 + Keyfile + Passkey PRF + Duress + outer drand tlock)
 * - Outer Shamir Secret Sharing (GF(2^8) M-of-N over CMTL1 container)
 * - Payload support for UTF-8 Text, Binary Files, and direct encrypted transfers from Section 3 & Section 4
 * - Online drand beacon retrieval (with BLS12-381 signature verification) and Offline manual beacon JSON/signature input
 * - Recovery Guide (.txt) generator & Built-in structural / pre-unlock verification test
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: false });
  const decFatal = new TextDecoder('utf-8', { fatal: true });

  const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
  const QR_MAX_CHARS = 2200;

  let tlOpToken = 0;
  let tlSelectedFile = null;
  let tlSelectedFileBytes = null;
  let tlTransferredPayload = null; // { source: 'sec3'|'sec4', label, bytes, armoredText, factorLabel, shamirM, shamirN, createdPassword, filename }
  let tlCreationKeyfileBytes = null;
  let tlCreationKeyfileName = '';
  let tlRestoreKeyfileBytes = null;
  let tlRestoreKeyfileName = '';
  let tlLastArtifact = null;
  let tlLastDecrypted = null;
  let tlCountdownTimer = null;
  let tlCameraEpoch = 0;
  let tlCameraStream = null;
  let tlCameraTimer = null;
  let tlRestoreSharesMap = new Map(); // index -> { shareObj, rawBytes }

  function getTLBundle() {
    if (!window.TLockBundle) {
      throw new Error('タイムロック暗号モジュール (tlock.bundle.js) が読み込まれていません。ページを再読み込みしてください。');
    }
    return window.TLockBundle;
  }

  function getPreset() {
    if (!window.MatrixCardPreset) {
      throw new Error('暗号コアモジュール (index.js) が読み込まれていません。');
    }
    return window.MatrixCardPreset;
  }

  function zeroizeBuf(buf) {
    if (!buf) return;
    if (window.MatrixCardPreset?.zeroize) {
      window.MatrixCardPreset.zeroize(buf);
    } else if (buf instanceof Uint8Array) {
      buf.fill(0);
    }
  }

  function equalBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function sha256Bytes(data) {
    const u8 = data instanceof Uint8Array ? data : enc.encode(String(data));
    return new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let s = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function base64ToBytes(b64Str) {
    const clean = String(b64Str).replace(/[\r\n\s]/g, '');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function downloadBlob(blob, filename) {
    if (window.downloadBlob) {
      window.downloadBlob(blob, filename);
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

  function tlMessage(id, text, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status-msg' + (text ? (isError ? ' err' : ' ok') : '');
    el.dataset.error = String(Boolean(isError));
  }

  /* ===================================================================
   * 1. Inner Payload Container (CMV1 + 32-byte Header Hash Commitment)
   * =================================================================== */
  function packCMV1(type, name, payloadBytes, mimeType = '') {
    const isFile = type === 'file';
    const metaName = mimeType ? `${name || 'file'}\0${mimeType}` : (name || '');
    const nameBytes = enc.encode(metaName);
    if (nameBytes.length > 4096) throw new Error('ファイル名が長すぎます。');
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const data = payloadBytes instanceof Uint8Array ? payloadBytes : new Uint8Array(0);
    const now = BigInt(Date.now());
    const headerLen = 4 + 1 + 1 + 32 + 8 + 2 + nameBytes.length + 4;
    const out = new Uint8Array(headerLen + data.length);
    const dv = new DataView(out.buffer);

    // Magic "CMV1"
    out[0] = 0x43; out[1] = 0x4d; out[2] = 0x56; out[3] = 0x31;
    out[4] = isFile ? 1 : 0;
    out[5] = 0;
    out.set(salt, 6);
    dv.setBigUint64(38, now, false);
    dv.setUint16(46, nameBytes.length, false);
    out.set(nameBytes, 48);
    const pOffset = 48 + nameBytes.length;
    dv.setUint32(pOffset, data.length, false);
    out.set(data, pOffset + 4);
    return out;
  }

  function unpackCMV1(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 52) {
      throw new Error('内部ペイロード形式が不正です（サイズ不足）。');
    }
    if (bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x56 || bytes[3] !== 0x31) {
      throw new Error('内部ペイロードのCMV1ヘッダが一致しません。');
    }
    const isFile = bytes[4] === 1;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nameLen = dv.getUint16(46, false);
    if (bytes.length < 48 + nameLen + 4) {
      throw new Error('内部ペイロードのヘッダが破損しています。');
    }
    const rawName = dec.decode(bytes.subarray(48, 48 + nameLen));
    const nulIdx = rawName.indexOf('\0');
    const name = nulIdx >= 0 ? rawName.slice(0, nulIdx) : rawName;
    const mimeType = nulIdx >= 0 ? rawName.slice(nulIdx + 1) : '';
    const pOffset = 48 + nameLen;
    const payloadLen = dv.getUint32(pOffset, false);
    if (bytes.length !== pOffset + 4 + payloadLen) {
      throw new Error('内部ペイロードのデータ長が一致しません（破損または改ざん検出）。');
    }
    const payload = bytes.slice(pOffset + 4, pOffset + 4 + payloadLen);
    return {
      type: isFile ? 'file' : 'text',
      name,
      mimeType,
      payload,
    };
  }

  // ドメイン分離子（Domain Separator）: CryptoMatrixのタイムロック名前空間を他アプリケーションから論理分離するための固定コンテキスト文字列（RFC 5869準拠）。
  // ※ 注意: これは公開ソースコードに含まれる固定文字列であり、「秘密鍵」ではありません。
  // 本機能の真の秘密保護エントロピーは、ユーザーが保持する物理「カード配列シード番号 (seed)」によって担保されます。
  const CM_APP_DOMAIN_PEPPER = 'CryptoMatrix:TimeLock:AppDomainSecret:v1:2026';

  async function deriveAppDomainKey(hdrHash, seedNum = '0') {
    const cleanSeed = (seedNum !== undefined && seedNum !== null) ? String(seedNum).trim() : '0';
    const seed = enc.encode(`${CM_APP_DOMAIN_PEPPER}:seed=${cleanSeed}:${bytesToHex(hdrHash)}`);
    const keyHash = await sha256Bytes(seed);
    return crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function packCMV1AppBound(headerJsonBytes, type, name, payloadBytes, mimeType = '', seedNum = '0') {
    const hdrHash = await sha256Bytes(headerJsonBytes);
    const plainCmv1 = packCMV1(type, name, payloadBytes, mimeType);
    const appKey = await deriveAppDomainKey(hdrHash, seedNum);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = enc.encode('CryptoMatrix:CMA1:AAD:v1');
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, appKey, plainCmv1));
    zeroizeBuf(plainCmv1);
    const out = new Uint8Array(4 + 12 + encrypted.length);
    out[0] = 0x43; out[1] = 0x4d; out[2] = 0x41; out[3] = 0x31; // "CMA1"
    out.set(iv, 4);
    out.set(encrypted, 16);
    return out;
  }

  async function unpackCMV1AppBound(bodyBytes, headerJsonBytes, seedNum = '0') {
    if (!(bodyBytes instanceof Uint8Array) || bodyBytes.length < 32) {
      throw new Error('内部ペイロード形式が不正です（サイズ不足）。');
    }
    // "CMA1" (App-Domain encrypted: only openable via CryptoMatrix or timelock-recover.html with matching seed)
    if (bodyBytes[0] === 0x43 && bodyBytes[1] === 0x4d && bodyBytes[2] === 0x41 && bodyBytes[3] === 0x31) {
      const hdrHash = await sha256Bytes(headerJsonBytes);
      const iv = bodyBytes.subarray(4, 16);
      const ciphertext = bodyBytes.subarray(16);
      const appKey = await deriveAppDomainKey(hdrHash, seedNum);
      const aad = enc.encode('CryptoMatrix:CMA1:AAD:v1');
      let decryptedCmv1;
      try {
        decryptedCmv1 = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, appKey, ciphertext));
      } catch (_) {
        throw new Error('本カプセルはCryptoMatrix固有のシード鍵で保護されています。連動カード配列シード番号 (seed) が一致しないか、外部ツールでは開封できません。作成時のシード番号（デフォルト: 0）をご確認ください。');
      }
      return unpackCMV1(decryptedCmv1);
    }
    // "CMV1" (Legacy unencrypted fallback)
    if (bodyBytes[0] === 0x43 && bodyBytes[1] === 0x4d && bodyBytes[2] === 0x56 && bodyBytes[3] === 0x31) {
      return unpackCMV1(bodyBytes);
    }
    throw new Error('内部ペイロードのヘッダマジック（CMA1 / CMV1）が一致しません。');
  }

  async function packCommittedInner(headerJsonBytes, type, name, payloadBytes, mimeType = '', seedNum = '0') {
    const hdrHash = await sha256Bytes(headerJsonBytes);
    const cma1 = await packCMV1AppBound(headerJsonBytes, type, name, payloadBytes, mimeType, seedNum);
    const out = new Uint8Array(32 + cma1.length);
    out.set(hdrHash, 0);
    out.set(cma1, 32);
    zeroizeBuf(cma1);
    return out;
  }

  async function unpackCommittedInner(committedBytes, headerJsonBytes, seedNum = '0') {
    if (!(committedBytes instanceof Uint8Array) || committedBytes.length < 32 + 32) {
      throw new Error('復号された内部データが不正または破損しています。');
    }
    const expectedHash = await sha256Bytes(headerJsonBytes);
    const actualHash = committedBytes.subarray(0, 32);
    if (!equalBytes(expectedHash, actualHash)) {
      throw new Error('外装メタデータと内部暗号ペイロードのコミットメントハッシュが一致しません（ヘッダー改ざん・差し替え検出）。');
    }
    return unpackCMV1AppBound(committedBytes.subarray(32), headerJsonBytes, seedNum);
  }

  /* ===================================================================
   * 2. CMTL1 Container & CMTS Shamir Share Container
   * =================================================================== */
  function packCMTL1(headerJsonBytes, ageBinary) {
    if (!(headerJsonBytes instanceof Uint8Array) || headerJsonBytes.length === 0) {
      throw new Error('CMTL1ヘッダーが空です。');
    }
    if (!(ageBinary instanceof Uint8Array) || ageBinary.length === 0) {
      throw new Error('AGEタイムロック暗号文が空です。');
    }
    const out = new Uint8Array(4 + 1 + 4 + headerJsonBytes.length + ageBinary.length);
    const dv = new DataView(out.buffer);
    // Magic "CMTL" + version 0x01
    out[0] = 0x43; out[1] = 0x4d; out[2] = 0x54; out[3] = 0x4c;
    out[4] = 0x01;
    dv.setUint32(5, headerJsonBytes.length, false);
    out.set(headerJsonBytes, 9);
    out.set(ageBinary, 9 + headerJsonBytes.length);
    return out;
  }

  function unpackCMTL1(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 16) {
      throw new Error('タイムロックデータ (CMTL1) の長さが不足しています。');
    }
    if (bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x54 || bytes[3] !== 0x4c) {
      throw new Error('タイムロックデータのマジックヘッダ (CMTL) が一致しません。');
    }
    const version = bytes[4];
    if (version !== 1) {
      throw new Error(`未対応のタイムロック形式バージョンです (v${version})。`);
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hdrLen = dv.getUint32(5, false);
    if (hdrLen < 2 || hdrLen > 65536 || 9 + hdrLen >= bytes.length) {
      throw new Error('タイムロックデータのヘッダー長が不正または破損しています。');
    }
    const headerJsonBytes = bytes.slice(9, 9 + hdrLen);
    let meta;
    try {
      meta = JSON.parse(decFatal.decode(headerJsonBytes));
    } catch (_) {
      throw new Error('タイムロックデータのメタデータJSONが破損しています。');
    }
    if (!meta || meta.v !== 1 || (meta.mode !== 'A' && meta.mode !== 'B') || !Number.isInteger(meta.round) || meta.round < 1) {
      throw new Error('タイムロックデータのメタデータ内容が不正です。');
    }
    const ageBinary = bytes.slice(9 + hdrLen);
    // Verify that the inner AGE header matches the outer metadata
    const ageHdr = getTLBundle().parseTimelockAgeHeader(ageBinary);
    if (ageHdr.roundNumber !== meta.round) {
      throw new Error('外装メタデータのラウンド番号と内部tlockスタンザのラウンド番号が一致しません（改ざん検出）。');
    }
    if (String(ageHdr.chainHash).toLowerCase() !== String(meta.chainHash).toLowerCase()) {
      throw new Error('外装メタデータのチェーンハッシュと内部tlockスタンザのチェーンハッシュが一致しません（改ざん検出）。');
    }
    return {
      kind: 'cmtl1',
      version,
      meta,
      headerJsonBytes,
      ageBinary,
    };
  }

  function packCMTSShare(shamirM, shamirN, shareIndex, setId8, headerJsonBytes, rawShareData) {
    const out = new Uint8Array(4 + 1 + 1 + 1 + 1 + 8 + 4 + headerJsonBytes.length + rawShareData.length);
    const dv = new DataView(out.buffer);
    // Magic "CMTS" + version 0x01
    out[0] = 0x43; out[1] = 0x4d; out[2] = 0x54; out[3] = 0x53;
    out[4] = 0x01;
    out[5] = shamirM & 0xff;
    out[6] = shamirN & 0xff;
    out[7] = shareIndex & 0xff;
    out.set(setId8.subarray(0, 8), 8);
    dv.setUint32(16, headerJsonBytes.length, false);
    out.set(headerJsonBytes, 20);
    out.set(rawShareData, 20 + headerJsonBytes.length);
    return out;
  }

  function unpackCMTSShare(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 24) {
      throw new Error('タイムロック秘密分散シェア (CMTS) のサイズが不足しています。');
    }
    if (bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x54 || bytes[3] !== 0x53) {
      throw new Error('タイムロック秘密分散シェアのヘッダ (CMTS) が一致しません。');
    }
    const version = bytes[4];
    if (version !== 1) {
      throw new Error(`未対応の秘密分散シェアバージョンです (v${version})。`);
    }
    const m = bytes[5];
    const n = bytes[6];
    const index = bytes[7];
    if (m < 2 || n < m || index < 1 || index > n) {
      throw new Error('秘密分散シェアのしきい値パラメータが不正です。');
    }
    const setIdHex = bytesToHex(bytes.subarray(8, 16));
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hdrLen = dv.getUint32(16, false);
    if (hdrLen < 2 || hdrLen > 65536 || 20 + hdrLen >= bytes.length) {
      throw new Error('秘密分散シェアのメタデータ長が不正です。');
    }
    const headerJsonBytes = bytes.slice(20, 20 + hdrLen);
    let meta;
    try {
      meta = JSON.parse(decFatal.decode(headerJsonBytes));
    } catch (_) {
      throw new Error('秘密分散シェアのメタデータJSONが破損しています。');
    }
    const data = bytes.slice(20 + hdrLen);
    return {
      kind: 'cmts',
      version,
      m,
      n,
      index,
      setIdHex,
      meta,
      headerJsonBytes,
      data,
    };
  }

  function isTimelockBinary(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 16) return false;
    const isCMTL = bytes[0] === 0x43 && bytes[1] === 0x4d && bytes[2] === 0x54 && bytes[3] === 0x4c;
    const isCMTS = bytes[0] === 0x43 && bytes[1] === 0x4d && bytes[2] === 0x54 && bytes[3] === 0x53;
    return isCMTL || isCMTS;
  }

  function armorTimelock(bytes, shareIndex = 0, shareTotal = 0) {
    const header =
      shareIndex > 0 && shareTotal > 1
        ? `CRYPTOMATRIX TIMELOCK SHAMIR SHARE ${shareIndex}/${shareTotal}`
        : 'CRYPTOMATRIX TIMELOCK';
    const b64 = bytesToBase64(bytes);
    const wrapped = b64.match(/.{1,64}/g)?.join('\n') || b64;
    return `-----BEGIN ${header}-----\n${wrapped}\n-----END ${header}-----`;
  }

  function dearmorTimelock(text) {
    if (typeof text !== 'string') return [];
    const results = [];
    const regex = /-----BEGIN CRYPTOMATRIX TIMELOCK[^-]*-----([\s\S]*?)-----END CRYPTOMATRIX TIMELOCK[^-]*-----/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const body = m[1].trim();
      if (!body) continue;
      try {
        results.push(base64ToBytes(body));
      } catch (_) {
        throw new Error('アーマード文字列のBase64デコードに失敗しました（文字欠落または破損）。');
      }
    }
    if (results.length > 0) return results;
    const trimmed = text.trim();
    if (trimmed && /^[A-Za-z0-9+/=\r\n\s]+$/.test(trimmed) && trimmed.length >= 24) {
      try {
        const b = base64ToBytes(trimmed);
        if (isTimelockBinary(b)) return [b];
      } catch (_) {}
    }
    return [];
  }

  function parseAnyTimelockPacket(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 16) {
      throw new Error('タイムロックデータのサイズが小さすぎます。');
    }
    if (bytes[0] === 0x43 && bytes[1] === 0x4d && bytes[2] === 0x54 && bytes[3] === 0x4c) {
      return unpackCMTL1(bytes);
    }
    if (bytes[0] === 0x43 && bytes[1] === 0x4d && bytes[2] === 0x54 && bytes[3] === 0x53) {
      return unpackCMTSShare(bytes);
    }
    throw new Error('認識可能なタイムロックカプセル（.cmtl）ではありません。');
  }

  function combineTimelockShares(shareObjs) {
    if (!Array.isArray(shareObjs) || shareObjs.length === 0) {
      throw new Error('秘密分散シェアが指定されていません。');
    }
    const first = shareObjs[0];
    const m = first.m;
    const n = first.n;
    const setIdHex = first.setIdHex;
    const uniqueMap = new Map();
    for (const s of shareObjs) {
      if (s.kind !== 'cmts') throw new Error('秘密分散シェアではないデータが混在しています。');
      if (s.setIdHex !== setIdHex || s.m !== m || s.n !== n) {
        throw new Error('異なるタイムロックカプセルから生成された秘密分散シェアが混在しています。同じカプセルのシェアを入力してください。');
      }
      if (!uniqueMap.has(s.index)) {
        uniqueMap.set(s.index, s);
      }
    }
    if (uniqueMap.size < m) {
      throw new Error(`秘密分散（${m}-of-${n}）の復元に必要なしきい値に達していません（現在 ${uniqueMap.size} / 必要 ${m} シェア）。`);
    }
    const selected = Array.from(uniqueMap.values()).slice(0, m);
    const combinedBytes = getPreset().shamirCombine(
      selected.map((s) => ({ index: s.index, data: s.data }))
    );
    const unpacked = unpackCMTL1(combinedBytes);
    if (!equalBytes(unpacked.headerJsonBytes, first.headerJsonBytes)) {
      throw new Error('秘密分散シェアのヘッダーと復元されたカプセル本体のヘッダーが一致しません（改ざん検出）。');
    }
    return {
      ...unpacked,
      shamirUsed: selected.map((s) => s.index),
      shamirM: m,
      shamirN: n,
    };
  }

  /* ===================================================================
   * 3. High-Level Capsule Creation & Decryption API (Also used by tests)
   * =================================================================== */
  async function createTimelockCapsule(options) {
    const TL = getTLBundle();
    const Preset = getPreset();
    let {
      mode = 'A', // 'A' | 'B'
      targetTimeMs,
      roundNumber: explicitRound,
      chainInfo = TL.QUICKNET_CHAIN_INFO,
      payloadType = 'text', // 'text' | 'file'
      payloadBytes,
      filename = '',
      mimeType = '',
      payloadKind = 'text', // 'text' | 'file' | 'sec3_backup' | 'sec4_vault'
      // Mode B options:
      kdfProfile = 1,
      usePassword = true,
      password = '',
      useKeyfile = false,
      keyfileBytes = null,
      usePasskey = false,
      duress = null, // { password: '...', decoyBytes: Uint8Array }
      seedNum = null, // Card array seed number for seed-bound key derivation
      // Outer Shamir options:
      shamirM = 1,
      shamirN = 1,
    } = options || {};

    if (mode !== 'A' && mode !== 'B') {
      throw new Error('保護タイプを選択してください。');
    }
    if (!(payloadBytes instanceof Uint8Array) || payloadBytes.length === 0) {
      throw new Error('暗号化する保護対象データが空です。テキストを入力するかファイルを選択してください。');
    }
    if (payloadBytes.length > MAX_FILE_BYTES) {
      throw new Error(`データサイズが上限（${MAX_FILE_BYTES / (1024 * 1024)}MB）を超えています。`);
    }

    let roundInfo;
    if (Number.isInteger(explicitRound) && explicitRound >= 1) {
      const unlockTimeMs = TL.roundTime(chainInfo, explicitRound);
      roundInfo = {
        round: explicitRound,
        targetTimeMs: targetTimeMs || unlockTimeMs,
        unlockTimeMs,
        diffMs: targetTimeMs ? unlockTimeMs - targetTimeMs : 0,
        periodSec: chainInfo.period,
      };
    } else {
      roundInfo = TL.roundForUnlockTime(targetTimeMs, chainInfo);
    }

    let combo = null;
    let hasDuress = false;
    if (mode === 'B') {
      if (!usePassword && !useKeyfile && !usePasskey) {
        if (shamirN > 1) {
          // 秘密分散のみ（パスワード・キーファイル・パスキーなし）：Mode A (cma1 App/Seed-Bound) として扱い、CME3暗号化をスキップ
          mode = 'A';
        } else {
          throw new Error('保護方法（パスワード、キーファイル、パスキー、または2分割以上の秘密分散）のいずれかを有効にしてください。');
        }
      } else {
        if (usePassword) {
          if (Array.from(password || '').length < 12) {
            throw new Error('復元用パスワードは12文字以上で設定してください。');
          }
        }
        if (useKeyfile && (!keyfileBytes || keyfileBytes.length === 0)) {
          throw new Error('キーファイルが選択されていません。');
        }
        if (usePassword && !useKeyfile && !usePasskey) combo = 0;
        else if (usePassword && useKeyfile && !usePasskey) combo = 1;
        else if (usePassword && !useKeyfile && usePasskey) combo = 2;
        else if (usePassword && useKeyfile && usePasskey) combo = 3;
        else if (!usePassword && useKeyfile && !usePasskey) combo = 4;
        else if (!usePassword && !useKeyfile && usePasskey) combo = 5;
        else if (!usePassword && useKeyfile && usePasskey) combo = 6;
        else throw new Error('未対応の保護要素組み合わせです。');
        hasDuress = Boolean(duress && duress.password && duress.decoyBytes);
      }
    }

    const headerObj = {
      v: 1,
      mode,
      net: chainInfo.metadata?.beaconID || 'quicknet',
      chainHash: chainInfo.hash,
      round: roundInfo.round,
      targetTimeMs: roundInfo.targetTimeMs,
      unlockTimeMs: roundInfo.unlockTimeMs,
      createdAtMs: Date.now(),
      innerType: mode === 'B' ? 'cme3' : 'cma1',
      kdfProfile: mode === 'B' ? kdfProfile : null,
      combo: mode === 'B' ? combo : null,
      hasDuress: mode === 'B' ? hasDuress : false,
      payloadKind,
      shamir: shamirN > 1 ? { m: shamirM, n: shamirN } : null,
    };
    const headerJsonBytes = enc.encode(JSON.stringify(headerObj));

    const activeSeed = (seedNum !== null && seedNum !== undefined)
      ? String(seedNum).trim()
      : String($('input-seed-number')?.value || '0').trim();

    const committedInner = await packCommittedInner(
      headerJsonBytes,
      payloadType === 'file' ? 'file' : 'text',
      filename,
      payloadBytes,
      mimeType,
      activeSeed
    );

    let toTimelockBytes = null;
    try {
      if (mode === 'A') {
        toTimelockBytes = committedInner;
      } else {
        const cmeFactors = {
          usePassword,
          useKeyfile,
          usePasskey,
          keyfileBytes,
        };
        if (hasDuress) {
          const committedDecoy = await packCommittedInner(
            headerJsonBytes,
            'text',
            '',
            duress.decoyBytes instanceof Uint8Array ? duress.decoyBytes : enc.encode(String(duress.decoyBytes)),
            'text/plain'
          );
          try {
            toTimelockBytes = await Preset.encryptDuressDualCME(
              committedInner,
              password,
              committedDecoy,
              duress.password,
              kdfProfile,
              cmeFactors
            );
          } finally {
            zeroizeBuf(committedDecoy);
          }
        } else {
          toTimelockBytes = await Preset.encryptBodyCME2(
            committedInner,
            password,
            kdfProfile,
            cmeFactors
          );
        }
      }

      const tlEnc = await TL.encryptTimelock(roundInfo.round, toTimelockBytes, chainInfo);
      const cmtl1Bytes = packCMTL1(headerJsonBytes, tlEnc.ageBinary);

      if (shamirN > 1) {
        const rawShares = Preset.shamirSplit(cmtl1Bytes, shamirM, shamirN);
        const setId8 = crypto.getRandomValues(new Uint8Array(8));
        const shares = rawShares.map((s, idx) => {
          const shareIndex = s?.index ?? (idx + 1);
          const shareData = s?.data instanceof Uint8Array ? s.data : s;
          const shareBytes = packCMTSShare(shamirM, shamirN, shareIndex, setId8, headerJsonBytes, shareData);
          const armored = armorTimelock(shareBytes, shareIndex, shamirN);
          return {
            index: shareIndex,
            m: shamirM,
            n: shamirN,
            bytes: shareBytes,
            armored,
          };
        });
        return {
          meta: headerObj,
          roundInfo,
          cmtl1Bytes,
          armoredText: shares.map((s) => s.armored).join('\n\n'),
          shares,
          shamirM,
          shamirN,
          seedNum: activeSeed,
        };
      }

      const armoredText = armorTimelock(cmtl1Bytes, 0, 0);
      return {
        meta: headerObj,
        roundInfo,
        cmtl1Bytes,
        armoredText,
        shares: null,
        shamirM: 1,
        shamirN: 1,
        seedNum: activeSeed,
      };
    } finally {
      zeroizeBuf(committedInner);
      if (mode === 'B' && toTimelockBytes) zeroizeBuf(toTimelockBytes);
    }
  }

  async function decryptTimelockCapsule(options) {
    const TL = getTLBundle();
    const Preset = getPreset();
    const {
      packets, // Array of Uint8Array (either 1 CMTL1 or >=M CMTS shares)
      beacon = null, // Optional manual/pre-fetched beacon { round, signature, randomness }
      chainInfo = TL.QUICKNET_CHAIN_INFO,
      endpoints = TL.DEFAULT_DRAND_ENDPOINTS,
      password = '',
      keyfileBytes = null,
      seedNum = null,
      allowNetworkFetch = true,
    } = options || {};

    if (!Array.isArray(packets) || packets.length === 0) {
      throw new Error('復号するタイムロックデータが入力されていません。');
    }

    const parsedList = packets.map((b) => parseAnyTimelockPacket(b));
    let cmtlUnpacked;
    if (parsedList[0].kind === 'cmts') {
      cmtlUnpacked = combineTimelockShares(parsedList);
    } else {
      cmtlUnpacked = parsedList[0];
    }

    const { meta, headerJsonBytes, ageBinary } = cmtlUnpacked;

    // Acquire & verify beacon
    let verifiedBeacon = beacon;
    let beaconEndpoint = 'manual';
    if (!verifiedBeacon) {
      if (!allowNetworkFetch) {
        throw new Error('drandビーコンが提供されていません。オンライン取得を選択するか、ビーコンJSON/署名を貼り付けてください。');
      }
      const fetched = await TL.fetchVerifiedBeacon(meta.round, chainInfo, endpoints);
      verifiedBeacon = fetched.beacon;
      beaconEndpoint = fetched.endpoint;
    } else {
      const ver = await TL.verifyBeaconDetailed(chainInfo, verifiedBeacon, meta.round);
      if (!ver.valid) {
        if (ver.reason === 'ROUND_MISMATCH') {
          throw new Error(`ビーコンのラウンド番号が一致しません（カプセル要求ラウンド: #${meta.round} / 入力されたラウンド: #${ver.actualRound}）。`);
        }
        throw new Error(`drandビーコンのBLS署名検証に失敗しました（理由: ${ver.reason}）。正しいラウンド #${meta.round} のビーコンであるか確認してください。`);
      }
      verifiedBeacon = {
        round: ver.round,
        signature: ver.signature,
        randomness: ver.computedRandomness,
      };
    }

    // Outer layer: tlock IBE + AGE decryption
    const outerPlain = await TL.decryptTimelockWithBeacon(ageBinary, verifiedBeacon, chainInfo, meta);

    let committedInner = null;
    let isDuress = false;
    try {
      if (meta.mode === 'A' || meta.innerType === 'cma1' || meta.innerType === 'cmv1') {
        committedInner = outerPlain;
      } else if (meta.mode === 'B' || meta.innerType === 'cme3') {
        const combo = meta.combo ?? 0;
        const needPass = combo === 0 || combo === 1 || combo === 2 || combo === 3;
        const needKeyfile = combo === 1 || combo === 3 || combo === 4 || combo === 6;
        const needPasskey = combo === 2 || combo === 3 || combo === 5 || combo === 6;
        if (needPass && !password) {
          throw new Error('このPrivate Time Capsuleの復号には「復元用パスワード」の入力が必要です。');
        }
        if (needKeyfile && (!keyfileBytes || keyfileBytes.length === 0)) {
          throw new Error('このPrivate Time Capsuleの復号には「キーファイル」の選択が必要です。');
        }
        const cmeRes = await Preset.decryptBodyCME(outerPlain, password || '', { keyfileBytes, usePasskey: needPasskey });
        committedInner = cmeRes.innerBody || cmeRes.plain;
        isDuress = Boolean(cmeRes.isDuress);
      } else {
        throw new Error(`未対応の内部保護形式です: ${meta.innerType}`);
      }

      const activeSeed = (seedNum !== null && seedNum !== undefined)
        ? String(seedNum).trim()
        : String($('tl-restore-seed-number')?.value || $('input-seed-number')?.value || '0').trim();

      const unpacked = await unpackCommittedInner(committedInner, headerJsonBytes, activeSeed);
      return {
        meta,
        beacon: verifiedBeacon,
        beaconEndpoint,
        type: unpacked.type,
        name: unpacked.name,
        mimeType: unpacked.mimeType,
        payload: unpacked.payload,
        text: unpacked.type === 'text' ? dec.decode(unpacked.payload) : null,
        isDuress,
        seedNum: activeSeed,
        shamirUsed: cmtlUnpacked.shamirUsed || null,
      };
    } finally {
      if (committedInner && committedInner !== outerPlain) zeroizeBuf(committedInner);
      zeroizeBuf(outerPlain);
    }
  }

  /* ===================================================================
   * 4. Recovery Guide Text Generator
   * =================================================================== */
  function generateRecoveryGuideText(artifact) {
    if (!artifact || !artifact.meta) return '';
    const m = artifact.meta;
    const TL = getTLBundle();
    const unlockDateStr = formatLocalDateTime(m.unlockTimeMs);
    const unlockIso = new Date(m.unlockTimeMs).toISOString();
    const createdStr = formatLocalDateTime(m.createdAtMs);
    const beaconUrl1 = `https://api.drand.sh/${m.chainHash}/public/${m.round}`;
    const beaconUrl2 = `https://drand.cloudflare.com/${m.chainHash}/public/${m.round}`;
    const factorDesc =
      m.mode === 'A'
        ? (m.shamir && m.shamir.n > 1 ? `秘密分散のみ（${m.shamir.m}-of-${m.shamir.n}・追加パスワードなし）` : 'なし（時間解禁のみ：指定時刻到達で自動開封可能）')
        : comboLabelTL(m.combo);
    const shamirDesc =
      m.shamir && m.shamir.n > 1
        ? `あり（Shamir ${m.shamir.m}-of-${m.shamir.n} 秘密分散：全${m.shamir.n}シェア中、任意の${m.shamir.m}シェアが必要）`
        : 'なし（単一カプセル）';
    const usesPasskey = m.mode === 'B' && (m.combo === 2 || m.combo === 3);

    return [
      '========================================================================',
      '  CryptoPassKey / crypto_matrix — タイムロック リカバリーガイド (保管用)',
      '========================================================================',
      '※このファイルにはパスワードや秘密鍵は一切含まれていません。',
      '  カプセルファイル (.cmtl) と一緒に長期保管してください。',
      '',
      '【1. カプセル基本情報】',
      `・フォーマット       : CMTL1 (Version ${m.v})`,
      `・作成日時           : ${createdStr}`,
      `・保護タイプ         : ${m.mode === 'A' ? 'タイムカプセル（時間解禁のみ）' : 'パスワード付きタイムカプセル（時刻解禁＋暗号化保護）'}`,
      `・連動カードシード   : #${artifact.seedNum || '0'} (復元時に必要)`,
      `・封入データ種別     : ${payloadKindLabel(m.payloadKind)}`,
      `・秘密分散 (Shamir)  : ${shamirDesc}`,
      `・追加保護要素       : ${factorDesc}`,
      ...(m.mode === 'B' && m.kdfProfile !== null
        ? [`・鍵導出プロファイル : ${getPreset().kdfLabel ? getPreset().kdfLabel(m.kdfProfile) : `Profile #${m.kdfProfile}`}`]
        : []),
      '',
      '【2. 時間解禁条件（drand 分散型ランダムネスビーコン）】',
      `・drandネットワーク  : ${m.net} (${TL.QUICKNET_CHAIN_INFO.schemeID})`,
      `・チェーンハッシュ   : ${m.chainHash}`,
      `・マスター公開鍵(G2) : ${TL.QUICKNET_CHAIN_INFO.public_key}`,
      `・対象ラウンド番号   : Round #${m.round}`,
      `・解禁予定時刻       : ${unlockDateStr} (UTC: ${unlockIso})`,
      '',
      '【3. 解禁時刻到来後の復元手順（オンライン環境）】',
      '1) Crypto Matrix アプリの「⏳ タイムロック」タブ →「🔓 タイムロック解禁・復元」を開く',
      ...(usesPasskey
        ? ['   ※パスキー保護が含まれるため、作成時と同一のドメイン上で開いてください。']
        : ['   （または同梱の単体ファイル「timelock-recover.html」を任意のブラウザで開く）']),
      '2) 保存したカプセルファイル (.cmtl) またはアーマード文字列（秘密分散時は任意のMシェア）を読み込む',
      '3) 「drandネットワークから自動取得して検証」を選択する',
      ...(m.mode === 'B'
        ? ['4) 設定した復元用パスワード／キーファイル／パスキーを入力し、「解禁・復号を実行」を押す']
        : ['4) 「解禁・復号を実行」を押すと即座に元のデータが復元されます']),
      '',
      '【4. 完全オフライン（エアギャップ）環境での手動ビーコン復元手順】',
      '復号を行う端末をインターネットに接続したくない場合：',
      '1) 解禁予定時刻以降に、別のスマホやPCのブラウザで以下のいずれかのURLを開く：',
      `   ・ ${beaconUrl1}`,
      `   ・ ${beaconUrl2}`,
      '2) 表示されたJSON（{"round":' + m.round + ',"randomness":"...","signature":"..."}）をコピーする',
      '3) オフライン端末の復号画面で「ビーコンJSON/署名を直接貼り付け」を選び、JSONまたはsignature値を貼り付けて復号する',
      '   （※端末内でBLS12-381ペアリング署名検証が数学的に実行されます）',
      '',
      '【5. 注意事項】',
      '・解禁予定時刻（対象ラウンドのBLS署名発行）より前には、作成者本人であっても数学的に復号できません。',
      '・端末の時計を未来に進めても、drandネットワークが発行するラウンド署名がなければ復号できません。',
      ...(m.mode === 'B'
        ? ['・設定した復元用パスワードやキーファイルを紛失すると、解禁時刻が来ても復号できなくなります。必ず安全に保管してください。']
        : []),
      '========================================================================',
    ].join('\n');
  }

  function comboLabelTL(combo) {
    if (combo === 0) return '復元用パスワード単独';
    if (combo === 1) return '復元用パスワード ＋ キーファイル';
    if (combo === 2) return '復元用パスワード ＋ パスキー (WebAuthn PRF)';
    if (combo === 3) return '復元用パスワード ＋ キーファイル ＋ パスキー (WebAuthn PRF)';
    if (combo === 4) return 'キーファイル単独';
    if (combo === 5) return 'パスキー単独 (WebAuthn PRF)';
    if (combo === 6) return 'キーファイル ＋ パスキー (WebAuthn PRF)';
    return 'なし';
  }

  function payloadKindLabel(kind) {
    if (kind === 'sec3_backup') return 'セクション3 暗号化バックアップデータ（二重保護）';
    if (kind === 'sec4_vault') return 'セクション4 セキュア保管庫暗号化データ（二重保護）';
    if (kind === 'file') return 'バイナリファイル';
    return 'テキスト／パスワード／メモ';
  }

  function formatLocalDateTime(ms) {
    if (!Number.isFinite(ms)) return '---';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    const tzOffsetMin = -d.getTimezoneOffset();
    const sign = tzOffsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(tzOffsetMin);
    const tzH = pad(Math.floor(absMin / 60));
    const tzM = pad(absMin % 60);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (UTC${sign}${tzH}:${tzM})`;
  }

  function toDatetimeLocalValue(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatRemainingTime(diffMs) {
    if (diffMs <= 0) return '解禁時刻到達済み（0秒）';
    const totalSec = Math.ceil(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}日`);
    if (hours > 0 || days > 0) parts.push(`${hours}時間`);
    if (mins > 0 || hours > 0 || days > 0) parts.push(`${mins}分`);
    parts.push(`${secs}秒`);
    return parts.join(' ');
  }

  /* ===================================================================
   * 5. Transfer Integration with Section 3 & Section 4
   * =================================================================== */
  function switchToTimelockTab(subTab = 'encrypt') {
    const tabBtn = document.querySelector('.cm-tab[aria-controls="tab-timelock"]');
    if (tabBtn) tabBtn.click();
    if (subTab === 'decrypt') {
      $('tl-tab-btn-decrypt')?.click();
    } else {
      $('tl-tab-btn-encrypt')?.click();
    }
    const sec = $('timelock-section');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function receiveTransferredPayload(info) {
    if (!info || (!info.bytes && !info.armoredText)) return;
    const rawBytes = info.bytes instanceof Uint8Array ? info.bytes : enc.encode(info.armoredText);
    tlTransferredPayload = {
      source: info.source || 'sec3',
      label: info.label || '既存の暗号化データ',
      bytes: rawBytes,
      armoredText: info.armoredText || '',
      factorLabel: info.factorLabel || '暗号化済み',
      shamirM: info.shamirM || 1,
      shamirN: info.shamirN || 1,
      createdPassword: info.createdPassword || '',
      filename: info.filename || (info.source === 'sec3' ? 'cryptomatrix-backup.cmenc' : 'vault-secret.cmenc'),
    };
    const radioTransferred = $('tl-type-transferred');
    if (radioTransferred) {
      radioTransferred.disabled = false;
      radioTransferred.checked = true;
    }
    syncPayloadInputUI();
    updatePreSummaryAndRoundPreview();
    switchToTimelockTab('encrypt');
    tlMessage(
      'tl-encrypt-status',
      `✅ ${tlTransferredPayload.label}（${rawBytes.length.toLocaleString()} bytes・元の保護：${tlTransferredPayload.factorLabel}）をタイムロック作成欄へ転記しました。元のデータは消去・変更されていません。`
    );
  }

  /* ===================================================================
   * 6. UI Initialization & Event Wiring
   * =================================================================== */
  function syncPayloadInputUI() {
    const isText = $('tl-type-text')?.checked;
    const isFile = $('tl-type-file')?.checked;
    const isTransferred = $('tl-type-transferred')?.checked;

    if ($('tl-input-text-area')) $('tl-input-text-area').hidden = !isText;
    if ($('tl-input-file-area')) $('tl-input-file-area').hidden = !isFile;
    if ($('tl-input-transferred-area')) $('tl-input-transferred-area').hidden = !isTransferred;

    if (isTransferred && tlTransferredPayload && $('tl-transferred-summary')) {
      const p = tlTransferredPayload;
      const isSec2 = p.source === 'sec2';
      $('tl-transferred-summary').innerHTML = `
        <div style="font-weight:700; color:#fbbf24; margin-bottom:4px;">🔗 転記済みデータ：${escapeHtml(p.label)}</div>
        <div style="font-size:0.8rem; color:#d1d5db; line-height:1.5;">
          ・データサイズ：<strong>${p.bytes.length.toLocaleString()} bytes</strong>（ファイル名：<code>${escapeHtml(p.filename)}</code>）<br>
          ・内側の既存保護：<strong>${escapeHtml(p.factorLabel)}</strong>${p.shamirN > 1 ? ` ＋ 秘密分散 (${p.shamirM}-of-${p.shamirN})` : ''}<br>
          ・<strong>保護構造の説明：</strong> ${isSec2 ? 'セクション2のBIP39復元フレーズ（カード配列・レシピ設定）は未暗号化の平文データです。タイムロックによって暗号化カプセルとして保護されます。' : `内側の暗号化（${escapeHtml(p.factorLabel)}）はそのまま保護され、さらにタイムロック暗号が追加されます。`}<br>
          　→ <strong>タイムカプセル（時間解禁のみ）</strong>を選ぶと、解禁時刻後にそのまま中身を取り出せます（追加パスワード不要）。<br>
          　→ <strong>パスワード付きタイムカプセル</strong>を選ぶと、タイムロック解除時にも追加のパスワード等の保護要素を設定できます。
        </div>
      `;
    }
  }

  function getSelectedTargetTimeMs() {
    const isAbs = $('tl-time-mode-abs')?.checked;
    if (isAbs) {
      const val = $('tl-datetime-input')?.value;
      if (!val) return Date.now() + 3600 * 1000;
      const parsed = new Date(val).getTime();
      return Number.isFinite(parsed) ? parsed : Date.now() + 3600 * 1000;
    } else {
      const amount = Number($('tl-rel-amount')?.value || 1);
      const unitSec = Number($('tl-rel-unit')?.value || 3600);
      const sec = Math.max(3, Math.round(amount * unitSec));
      return Date.now() + sec * 1000;
    }
  }

  function updatePreSummaryAndRoundPreview() {
    let TL;
    try {
      TL = getTLBundle();
    } catch (_) {
      return;
    }
    const mode = $('tl-mode-b')?.checked ? 'B' : 'A';
    if ($('tl-mode-b-options')) $('tl-mode-b-options').hidden = mode !== 'B';

    // Toggle Mode B factor input rows
    const optPw = $('tl-opt-password');
    const optKf = $('tl-opt-keyfile');
    const optPk = $('tl-opt-passkey');
    const hasCmeFactors = Boolean(optPw?.checked || optKf?.checked || optPk?.checked);
    if ($('tl-kdf-row')) $('tl-kdf-row').hidden = !(mode === 'B' && hasCmeFactors);
    if ($('tl-password-row')) $('tl-password-row').hidden = !(mode === 'B' && optPw?.checked);
    if ($('tl-keyfile-row')) $('tl-keyfile-row').hidden = !(mode === 'B' && optKf?.checked);
    if ($('tl-passkey-row')) $('tl-passkey-row').hidden = !(mode === 'B' && optPk?.checked);

    // KDF warning
    const kdfVal = $('tl-kdf')?.value || '1';
    const kdfWarn = $('tl-kdf-warning');
    if (kdfWarn) {
      if (kdfVal === '5') {
        kdfWarn.style.display = 'block';
        kdfWarn.textContent = '🚫 【PC限定運用・スマホ復元困難】Argon2id 256MB設定はスマートフォンのブラウザではメモリ制限で復元できない場合があります。PC専用として運用してください。';
      } else if (kdfVal === '4') {
        kdfWarn.style.display = 'block';
        kdfWarn.textContent = '⚠️ 【PC推奨・スマホ高負荷注意】Argon2id 128MB設定はスマートフォンでの復元に時間がかかる場合があります。';
      } else {
        kdfWarn.style.display = 'none';
      }
    }

    // Time & Round calculation
    const targetMs = getSelectedTargetTimeMs();
    const rInfo = TL.roundForUnlockTime(targetMs, TL.QUICKNET_CHAIN_INFO);
    const previewBox = $('tl-round-preview-box');
    if (previewBox) {
      const diffSec = (rInfo.diffMs / 1000).toFixed(1);
      const isPast = targetMs <= Date.now();
      previewBox.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; font-size:0.82rem;">
          <div><span style="color:var(--text-sub);">希望解禁時刻：</span><br><strong>${escapeHtml(formatLocalDateTime(rInfo.targetTimeMs))}</strong></div>
          <div><span style="color:var(--text-sub);">実際の解禁予定時刻（端数切上）：</span><br><strong style="color:#38bdf8;">${escapeHtml(formatLocalDateTime(rInfo.unlockTimeMs))}</strong> <span style="font-size:0.75rem; color:var(--text-sub);">(+${diffSec}秒)</span></div>
          <div><span style="color:var(--text-sub);">drandネットワーク / 周期：</span><br><strong>quicknet</strong> (${TL.QUICKNET_CHAIN_INFO.period}秒周期 / RFC9380)</div>
          <div><span style="color:var(--text-sub);">対象ラウンド番号：</span><br><strong style="color:#fbbf24; font-family:monospace; font-size:0.95rem;">Round #${rInfo.round}</strong></div>
        </div>
        ${isPast ? '<div style="margin-top:6px; font-size:0.78rem; color:#f97316;">ℹ️ 指定時刻が現在以前のため、既に発行済みのラウンドで暗号化されます（即時解禁テスト用としてはそのまま作成可能です）。本来のタイムロックには未来の日時を指定してください。</div>' : ''}
      `;
    }

    // Payload summary
    let payloadDesc = '未入力';
    if ($('tl-type-text')?.checked) {
      const txt = $('tl-text-content')?.value || '';
      const byteLen = enc.encode(txt).length;
      payloadDesc = txt.trim() ? `テキスト（${Array.from(txt).length}文字 / ${byteLen.toLocaleString()} bytes）` : '⚠️ テキスト未入力';
    } else if ($('tl-type-file')?.checked) {
      payloadDesc = tlSelectedFile
        ? `ファイル「${tlSelectedFile.name}」（${tlSelectedFile.size.toLocaleString()} bytes）`
        : '⚠️ ファイル未選択';
    } else if ($('tl-type-transferred')?.checked && tlTransferredPayload) {
      payloadDesc = `${tlTransferredPayload.label}（${tlTransferredPayload.bytes.length.toLocaleString()} bytes / 内側保護: ${tlTransferredPayload.factorLabel}）`;
    }

    const shamirParts = ($('tl-shamir')?.value || '1-1').split('-').map(Number);
    const shamirM = shamirParts[0] || 1;
    const shamirN = shamirParts[1] || 1;

    const activeSeed = $('input-seed-number')?.value || '0';
    if ($('tl-bound-seed-badge')) $('tl-bound-seed-badge').textContent = `#${activeSeed}`;

    const reqFactors = [`解禁時刻以降の drand quicknet Round #${rInfo.round} ビーコン署名`];
    reqFactors.push(`連動カード配列シード (#${activeSeed})`);
    if (shamirN > 1) reqFactors.push(`Shamir秘密分散 全${shamirN}シェア中の任意の${shamirM}シェア`);
    if (mode === 'B') {
      if (optPw?.checked) reqFactors.push('復元用パスワード（12文字以上）');
      if (optKf?.checked) reqFactors.push(`キーファイル${tlCreationKeyfileName ? ` (${tlCreationKeyfileName})` : ''}`);
      if (optPk?.checked) reqFactors.push('WebAuthn PRF対応パスキー（※同一ドメイン限定）');
    } else if ($('tl-type-transferred')?.checked && tlTransferredPayload) {
      if (tlTransferredPayload.source !== 'sec2') {
        reqFactors.push(`（※カプセル開封後、内側の${tlTransferredPayload.label}を復元する際に元の保護キーが必要です）`);
      }
    }

    const standaloneOk = !(mode === 'B' && optPk?.checked);
    const summaryEl = $('tl-pre-summary-box');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="font-weight:700; font-size:0.88rem; color:#38bdf8; margin-bottom:6px;">📋 暗号化前の設定確認サマリー</div>
        <div style="font-size:0.82rem; line-height:1.6;">
          ・<strong>保護対象データ：</strong> ${escapeHtml(payloadDesc)}<br>
          ・<strong>保護タイプ：</strong> <strong>${(() => {
            if (mode === 'A') {
              return shamirN > 1 ? `タイムロック ＋ 秘密分散（${shamirM}-of-${shamirN}・時間解禁のみ）` : 'タイムカプセル（時間解禁のみ）';
            }
            if (!hasCmeFactors && shamirN > 1) {
              return `タイムロック ＋ 秘密分散のみ（${shamirM}-of-${shamirN}・パスワード不要）`;
            }
            if (!hasCmeFactors && shamirN <= 1) {
              return '<span style="color:#ef4444; font-weight:700;">⚠️ 保護方式未選択（パスワード、キーファイル、パスキー、または秘密分散を1つ以上選択してください）</span>';
            }
            const factorNames = [];
            if (optPw?.checked) factorNames.push('パスワード');
            if (optKf?.checked) factorNames.push('キーファイル');
            if (optPk?.checked) factorNames.push('パスキー');
            if (shamirN > 1) factorNames.push(`秘密分散(${shamirM}-of-${shamirN})`);
            return `追加保護付きタイムカプセル（時刻解禁 ＋ ${factorNames.join(' ＋ ')}）`;
          })()}</strong><br>
          ・<strong>連動カード配列シード番号：</strong> <strong style="color:#38bdf8; font-family:monospace;">#${escapeHtml(activeSeed)}</strong> <span style="font-size:0.75rem; color:var(--text-sub);">（作成時のカード配列シード番号と連動して暗号鍵が導出されます）</span><br>
          ・<strong>解禁予定日時：</strong> <strong style="color:#fbbf24;">${escapeHtml(formatLocalDateTime(rInfo.unlockTimeMs))}</strong>（Round #${rInfo.round}）<br>
          ・<strong>復号に必要な条件：</strong> ${reqFactors.map(escapeHtml).join(' ＋ ')}<br>
          ・<strong>解禁ツール制限：</strong> <span style="color:#38bdf8; font-weight:700;">🔒 本サイトおよび独立復元ツール限定（App-Domain Bindingにより、外部ツールからの直接解凍を遮断）</span><br>
          ・<strong>独立復元ツール (timelock-recover.html) 対応：</strong> ${
            standaloneOk
              ? '<span style="color:#34d399; font-weight:700;">⭕ 完全対応（サイト消滅時も単体HTMLで復元可能）</span>'
              : '<span style="color:#f87171; font-weight:700;">⚠️ 非対応（パスキーPRF併用時は現在のドメイン上でのみ復元可能）</span>'
          }
        </div>
      `;
    }
  }

  function updatePasswordEntropyUI() {
    const el = $('tl-pw-entropy');
    if (!el) return;
    const pw = $('tl-password')?.value || '';
    const pw2 = $('tl-password-confirm')?.value || '';
    if (!pw) {
      el.textContent = 'パスワード強度診断：未入力（12文字以上必須）';
      el.style.color = 'var(--text-sub)';
      return;
    }
    const len = Array.from(pw).length;
    const ent = window.MatrixCardPreset?.estimatePasswordEntropy
      ? window.MatrixCardPreset.estimatePasswordEntropy(pw)
      : { bits: len * 4, length: len };
    const matchStr = pw2 ? (pw === pw2 ? ' ／ 再入力：一致 ✅' : ' ／ 再入力：不一致 ⚠️') : '';
    if (len < 12) {
      el.textContent = `パスワード強度診断：文字数不足（現在 ${len}文字 ／ 最低12文字必要）${matchStr}`;
      el.style.color = '#f87171';
    } else {
      el.textContent = `パスワード強度診断：十分な長さ（${len}文字・推定上限約 ${ent.bits} bits）${matchStr}`;
      el.style.color = '#34d399';
    }
  }

  function renderQrPreviewHtml(text, caption) {
    if (!text || text.length > QR_MAX_CHARS) {
      const kb = ((text ? text.length : 0) / 1024).toFixed(1);
      return `<div class="bv-no-print" style="font-size:0.76rem; color:#fbbf24; background:#292119; border:1px solid #d97706; border-radius:6px; padding:8px; max-width:280px;">⚠️ データ長（${kb} KB / ${text.length}文字）がQRコード上限（${QR_MAX_CHARS}文字）を超えるため、QRコード生成は省略されました。<strong>ファイル保存 (.cmtl)</strong> または <strong>テキスト保存 (.txt)</strong> をご利用ください。</div>`;
    }
    try {
      const qrFn = window.CMQrHelpers?.qrSVG || window.MatrixCardPreset?.qrSVG;
      const svg = qrFn ? qrFn(text) : null;
      if (!svg) throw new Error('no svg');
      return `<figure class="tl-qr-figure" style="margin:0; text-align:center; background:#ffffff; border:1px solid #cbd5e1; border-radius:6px; padding:6px; display:inline-block; flex-shrink:0;">${svg.outerHTML}<figcaption style="font-size:0.72rem; color:#334155; margin-top:2px;">${escapeHtml(caption)}</figcaption></figure>`;
    } catch (_) {
      return `<div class="bv-no-print" style="font-size:0.76rem; color:#fbbf24; background:#292119; border:1px solid #d97706; border-radius:6px; padding:8px;">⚠️ QRコード生成をスキップしました。</div>`;
    }
  }

  /* ===================================================================
   * 7. Parse & Preview Loaded Capsule in Restore Panel
   * =================================================================== */
  function stopCountdown() {
    if (tlCountdownTimer) {
      clearInterval(tlCountdownTimer);
      tlCountdownTimer = null;
    }
  }

  function collectRestorePacketsFromInput() {
    const packets = [];
    for (const item of tlRestoreSharesMap.values()) {
      packets.push(item.rawBytes);
    }
    const rawText = ($('tl-restore-text')?.value || '').trim();
    if (rawText) {
      const dearmored = dearmorTimelock(rawText);
      for (const b of dearmored) packets.push(b);
    }
    return packets;
  }

  function refreshRestoreCapsulePreview() {
    stopCountdown();
    const infoBox = $('tl-capsule-info-box');
    const authBox = $('tl-restore-auth-box');
    if (!infoBox) return;

    let packets = [];
    try {
      packets = collectRestorePacketsFromInput();
    } catch (e) {
      infoBox.hidden = false;
      infoBox.innerHTML = `<div style="color:#f87171; font-weight:700;">❌ 入力データ解析エラー：${escapeHtml(e.message)}</div>`;
      return;
    }

    if (packets.length === 0) {
      infoBox.hidden = true;
      infoBox.innerHTML = '';
      if (authBox) authBox.hidden = true;
      return;
    }

    try {
      const parsed = packets.map((b) => parseAnyTimelockPacket(b));
      const first = parsed[0];
      const meta = first.meta;
      let shamirStatusHtml = '単一カプセル（分割なし）';
      if (first.kind === 'cmts') {
        const uniqueIndices = Array.from(new Set(parsed.filter((p) => p.kind === 'cmts' && p.setIdHex === first.setIdHex).map((p) => p.index))).sort((a, b) => a - b);
        const enough = uniqueIndices.length >= first.m;
        shamirStatusHtml = `<strong style="color:${enough ? '#34d399' : '#fbbf24'};">Shamir ${first.m}-of-${first.n} 秘密分散（読込済みシェア: ${uniqueIndices.map((i) => '#' + i).join('・')} ／ ${uniqueIndices.length} / 必要 ${first.m} シェア ${enough ? '✅ 結合可能' : '⚠️ 追加シェアが必要'}）</strong>`;
      }

      if (authBox) {
        authBox.hidden = meta.mode !== 'B';
        const combo = meta.combo ?? 0;
        const needPw = meta.mode === 'B' && (combo === 0 || combo === 1 || combo === 2 || combo === 3);
        const needKf = meta.mode === 'B' && (combo === 1 || combo === 3 || combo === 4 || combo === 6);
        const needPk = meta.mode === 'B' && (combo === 2 || combo === 3 || combo === 5 || combo === 6);
        if ($('tl-restore-pw-wrap')) $('tl-restore-pw-wrap').hidden = !needPw;
        if ($('tl-restore-kf-wrap')) $('tl-restore-kf-wrap').hidden = !needKf;
        if ($('tl-restore-pk-notice')) $('tl-restore-pk-notice').hidden = !needPk;
      }

      const paintStatus = () => {
        const now = Date.now();
        const diff = meta.unlockTimeMs - now;
        const unlocked = diff <= 0;
        const statusBadge = unlocked
          ? `<span style="display:inline-block; padding:3px 10px; border-radius:999px; background:#064e3b; color:#34d399; border:1px solid #10b981; font-weight:700;">🔓 解禁時刻到達済み（復号可能）</span>`
          : `<span style="display:inline-block; padding:3px 10px; border-radius:999px; background:#451a03; color:#fbbf24; border:1px solid #f59e0b; font-weight:700;">🔒 解禁時刻前（残り ${escapeHtml(formatRemainingTime(diff))}）</span>`;

        infoBox.hidden = false;
        infoBox.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            <strong style="color:#38bdf8; font-size:0.9rem;">📦 カプセル解析情報（CMTL1 v${meta.v}）</strong>
            ${statusBadge}
          </div>
          <div style="font-size:0.82rem; line-height:1.65;">
            ・<strong>保護タイプ：</strong> ${meta.mode === 'A' ? (meta.shamir && meta.shamir.n > 1 ? `タイムロック ＋ 秘密分散（${meta.shamir.m}-of-${meta.shamir.n}・パスワード不要）` : 'タイムカプセル（時間解禁のみ）') : `追加保護付きタイムカプセル（時刻解禁 ＋ ${escapeHtml(comboLabelTL(meta.combo))}）`}<br>
            ・<strong>封入データ種別：</strong> ${escapeHtml(payloadKindLabel(meta.payloadKind))}<br>
            ・<strong>秘密分散：</strong> ${shamirStatusHtml}<br>
            ・<strong>drandネットワーク / 対象ラウンド：</strong> <code>${escapeHtml(meta.net)}</code> ／ <strong style="color:#fbbf24; font-family:monospace;">Round #${meta.round}</strong><br>
            ・<strong>解禁予定日時：</strong> <strong>${escapeHtml(formatLocalDateTime(meta.unlockTimeMs))}</strong><br>
            ・<strong>手動取得用ビーコンURL：</strong> <code style="font-size:0.74rem; word-break:break-all;">https://api.drand.sh/${escapeHtml(meta.chainHash)}/public/${meta.round}</code>
          </div>
        `;
      };

      paintStatus();
      if (meta.unlockTimeMs > Date.now()) {
        tlCountdownTimer = setInterval(paintStatus, 1000);
      }
    } catch (e) {
      infoBox.hidden = false;
      infoBox.innerHTML = `<div style="color:#f87171; font-weight:700;">❌ カプセル解析エラー：${escapeHtml(e.message)}</div>`;
    }
  }

  /* ===================================================================
   * 8. Main DOM Initialization
   * =================================================================== */
  function initTimelockUI() {
    const root = $('timelock-section');
    if (!root) return;

    // Default datetime-local to +1 hour
    const dtInput = $('tl-datetime-input');
    if (dtInput && !dtInput.value) {
      dtInput.value = toDatetimeLocalValue(Date.now() + 3600 * 1000);
    }

    // Sub-tab switching (Encrypt vs Decrypt)
    const btnTabEnc = $('tl-tab-btn-encrypt');
    const btnTabDec = $('tl-tab-btn-decrypt');
    const panelEnc = $('tl-panel-encrypt');
    const panelDec = $('tl-panel-decrypt');

    function setSubTab(mode) {
      tlStopCamera();
      const isEnc = mode === 'encrypt';
      if (btnTabEnc) btnTabEnc.className = isEnc ? 'btn' : 'btn btn-outline';
      if (btnTabDec) btnTabDec.className = !isEnc ? 'btn' : 'btn btn-outline';
      if (panelEnc) panelEnc.hidden = !isEnc;
      if (panelDec) panelDec.hidden = isEnc;
      if (!isEnc) refreshRestoreCapsulePreview();
    }

    btnTabEnc?.addEventListener('click', () => setSubTab('encrypt'));
    btnTabDec?.addEventListener('click', () => setSubTab('decrypt'));

    // Payload type radios
    for (const id of ['tl-type-text', 'tl-type-file', 'tl-type-transferred']) {
      $(id)?.addEventListener('change', () => {
        syncPayloadInputUI();
        updatePreSummaryAndRoundPreview();
      });
    }
    $('tl-text-content')?.addEventListener('input', updatePreSummaryAndRoundPreview);

    // Clear transferred payload button
    $('tl-btn-clear-transferred')?.addEventListener('click', () => {
      tlTransferredPayload = null;
      if ($('tl-type-transferred')) $('tl-type-transferred').disabled = true;
      if ($('tl-type-text')) $('tl-type-text').checked = true;
      syncPayloadInputUI();
      updatePreSummaryAndRoundPreview();
    });

    // File selection & Drag-and-Drop for Creation
    async function handleSelectedCreationFile(file) {
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        tlMessage('tl-encrypt-status', `ファイルサイズが上限（20MB）を超えています（選択ファイル: ${(file.size / (1024 * 1024)).toFixed(1)}MB）。`, true);
        return;
      }
      tlSelectedFile = file;
      tlSelectedFileBytes = new Uint8Array(await file.arrayBuffer());
      if ($('tl-file-info')) {
        $('tl-file-info').textContent = `✅ 選択中: ${file.name} (${file.size.toLocaleString()} bytes / ${file.type || 'application/octet-stream'}) — ブラウザ内でバイナリ保護されます。`;
      }
      updatePreSummaryAndRoundPreview();
    }

    $('tl-file-input')?.addEventListener('change', () => {
      const f = $('tl-file-input')?.files?.[0];
      if (f) void handleSelectedCreationFile(f);
    });

    const createDropzone = $('tl-input-file-area');
    if (createDropzone) {
      createDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        createDropzone.style.borderColor = '#38bdf8';
      });
      createDropzone.addEventListener('dragleave', () => {
        createDropzone.style.borderColor = '#00abf7';
      });
      createDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        createDropzone.style.borderColor = '#00abf7';
        const f = e.dataTransfer?.files?.[0];
        if (f) void handleSelectedCreationFile(f);
      });
    }

    // Mode A vs Mode B radios
    for (const id of ['tl-mode-a', 'tl-mode-b']) {
      $(id)?.addEventListener('change', updatePreSummaryAndRoundPreview);
    }

    // Time specification controls
    function syncTimeModeUI() {
      const isAbs = $('tl-time-mode-abs')?.checked;
      if ($('tl-time-abs-box')) $('tl-time-abs-box').hidden = !isAbs;
      if ($('tl-time-rel-box')) $('tl-time-rel-box').hidden = isAbs;
      updatePreSummaryAndRoundPreview();
    }
    $('tl-time-mode-abs')?.addEventListener('change', syncTimeModeUI);
    $('tl-time-mode-rel')?.addEventListener('change', syncTimeModeUI);
    $('tl-datetime-input')?.addEventListener('input', updatePreSummaryAndRoundPreview);
    $('tl-datetime-input')?.addEventListener('change', updatePreSummaryAndRoundPreview);
    $('tl-rel-amount')?.addEventListener('input', updatePreSummaryAndRoundPreview);
    $('tl-rel-unit')?.addEventListener('change', updatePreSummaryAndRoundPreview);

    // Quick relative preset buttons
    document.querySelectorAll('.tl-preset-time-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = Number(btn.dataset.sec || 3600);
        if ($('tl-time-mode-rel')?.checked) {
          if (sec < 60) {
            if ($('tl-rel-amount')) $('tl-rel-amount').value = String(Math.max(1, Math.round(sec / 60)));
            if ($('tl-rel-unit')) $('tl-rel-unit').value = '60';
          } else if (sec < 3600) {
            if ($('tl-rel-amount')) $('tl-rel-amount').value = String(Math.round(sec / 60));
            if ($('tl-rel-unit')) $('tl-rel-unit').value = '60';
          } else if (sec < 86400) {
            if ($('tl-rel-amount')) $('tl-rel-amount').value = String(Math.round(sec / 3600));
            if ($('tl-rel-unit')) $('tl-rel-unit').value = '3600';
          } else {
            if ($('tl-rel-amount')) $('tl-rel-amount').value = String(Math.round(sec / 86400));
            if ($('tl-rel-unit')) $('tl-rel-unit').value = '86400';
          }
        }
        // Also update the absolute datetime input so both stay synced to now + sec
        if ($('tl-datetime-input')) {
          $('tl-datetime-input').value = toDatetimeLocalValue(Date.now() + sec * 1000);
        }
        if ($('tl-time-mode-abs')) $('tl-time-mode-abs').checked = true;
        syncTimeModeUI();
      });
    });

    // Mode B Protection checkboxes & inputs
    for (const id of ['tl-opt-password', 'tl-opt-keyfile', 'tl-opt-passkey', 'tl-shamir', 'tl-kdf']) {
      $(id)?.addEventListener('change', () => {
        updatePreSummaryAndRoundPreview();
      });
    }

    $('tl-password')?.addEventListener('input', updatePasswordEntropyUI);
    $('tl-password-confirm')?.addEventListener('input', updatePasswordEntropyUI);

    // Reuse transferred password button
    $('tl-btn-use-transferred-pw')?.addEventListener('click', () => {
      if (tlTransferredPayload?.createdPassword) {
        if ($('tl-password')) $('tl-password').value = tlTransferredPayload.createdPassword;
        if ($('tl-password-confirm')) $('tl-password-confirm').value = tlTransferredPayload.createdPassword;
        updatePasswordEntropyUI();
        tlMessage('tl-encrypt-status', '🔄 転記元の復元用パスワードを引き継ぎました。');
      } else {
        tlMessage('tl-encrypt-status', '転記元のパスワードがメモリ上に保持されていないため、直接入力してください。', true);
      }
    });

    // Creation Keyfile selection & KeePass .key generator
    $('tl-keyfile')?.addEventListener('change', async () => {
      const f = $('tl-keyfile')?.files?.[0];
      if (!f) return;
      tlCreationKeyfileBytes = new Uint8Array(await f.arrayBuffer());
      tlCreationKeyfileName = f.name;
      if ($('tl-keyfile-status')) {
        $('tl-keyfile-status').textContent = `✅ キーファイル選択済み: ${f.name} (${f.size.toLocaleString()} bytes)`;
      }
      updatePreSummaryAndRoundPreview();
    });

    $('tl-gen-keyfile')?.addEventListener('click', async () => {
      const Preset = getPreset();
      const seedNum = Preset.getValidSeedOrPrompt ? Preset.getValidSeedOrPrompt('tl-encrypt-status') : 0;
      if (seedNum === null) return;
      const pw = ($('tl-password')?.value || '').trim();
      if (window.__SKIP_KEYFILE_MODAL__ || !Preset.showKeyfileModal) {
        try {
          const filename = `cryptomatrix-card-${seedNum}.key`;
          const res = await Preset.exportKeePassXmlKeyfile({ seedNum, password: pw.length >= 12 ? pw : '', filename });
          tlCreationKeyfileBytes = enc.encode(res.keyData.xml);
          tlCreationKeyfileName = res.filename;
          if ($('tl-keyfile-status')) {
            $('tl-keyfile-status').textContent = `✅ 専用キーファイル (${tlCreationKeyfileName}) を生成・セットしました（ダウンロード済み）。`;
          }
          updatePreSummaryAndRoundPreview();
        } catch (err) {
          tlMessage('tl-encrypt-status', 'キーファイル生成エラー: ' + err.message, true);
        }
        return;
      }
      Preset.showKeyfileModal({ seedNum, defaultPassword: pw.length >= 12 ? pw : '', defaultPasskey: false, context: 'timelock' }, async (opts) => {
        try {
          const filename = `cryptomatrix-card-${opts.seedNum}.key`;
          const res = await Preset.exportKeePassXmlKeyfile({
            seedNum: opts.seedNum,
            password: opts.password,
            passkeyFactor: opts.passkeyFactor,
            passkeyCred: opts.passkeyCred,
            filename,
          });
          tlCreationKeyfileBytes = enc.encode(res.keyData.xml);
          tlCreationKeyfileName = res.filename;
          if ($('tl-keyfile-status')) {
            $('tl-keyfile-status').textContent = `✅ 専用キーファイル (${tlCreationKeyfileName}) を生成・セットしました（ダウンロード済み）。`;
          }
          updatePreSummaryAndRoundPreview();
        } catch (err) {
          tlMessage('tl-encrypt-status', 'キーファイル生成エラー: ' + err.message, true);
        }
      });
    });

    // Execute Time Lock Encryption
    $('tl-btn-encrypt')?.addEventListener('click', async () => {
      const myToken = ++tlOpToken;
      tlMessage('tl-encrypt-status', '⏳ タイムロック・カプセルを作成しています…');
      if ($('tl-encrypt-result')) $('tl-encrypt-result').hidden = true;

      try {
        const mode = $('tl-mode-b')?.checked ? 'B' : 'A';
        let payloadType = 'text';
        let payloadBytes = null;
        let filename = '';
        let mimeType = '';
        let payloadKind = 'text';

        if ($('tl-type-text')?.checked) {
          const txt = $('tl-text-content')?.value || '';
          if (!txt.trim()) {
            throw new Error('暗号化したいテキスト／パスワード／文章を入力してください。');
          }
          payloadType = 'text';
          payloadBytes = enc.encode(txt);
          payloadKind = 'text';
        } else if ($('tl-type-file')?.checked) {
          if (!tlSelectedFile || !tlSelectedFileBytes) {
            throw new Error('暗号化したいファイルを選択してください。');
          }
          payloadType = 'file';
          payloadBytes = tlSelectedFileBytes.slice();
          filename = tlSelectedFile.name;
          mimeType = tlSelectedFile.type || 'application/octet-stream';
          payloadKind = 'file';
        } else if ($('tl-type-transferred')?.checked && tlTransferredPayload) {
          payloadType = tlTransferredPayload.source === 'sec2' ? 'text' : 'file';
          payloadBytes = tlTransferredPayload.bytes.slice();
          filename = tlTransferredPayload.filename;
          mimeType = tlTransferredPayload.source === 'sec2' ? 'text/plain' : 'application/octet-stream';
          payloadKind = tlTransferredPayload.source === 'sec2' ? 'text' : (tlTransferredPayload.source === 'sec3' ? 'sec3_backup' : 'sec4_vault');
        } else {
          throw new Error('保護対象データを選択してください。');
        }

        const targetTimeMs = getSelectedTargetTimeMs();
        const shamirParts = ($('tl-shamir')?.value || '1-1').split('-').map(Number);
        const shamirM = shamirParts[0] || 1;
        const shamirN = shamirParts[1] || 1;

        let effectiveMode = mode;
        const usePassword = mode === 'B' && Boolean($('tl-opt-password')?.checked);
        const useKeyfile = mode === 'B' && Boolean($('tl-opt-keyfile')?.checked);
        const usePasskey = mode === 'B' && Boolean($('tl-opt-passkey')?.checked);
        const kdfProfile = Number($('tl-kdf')?.value ?? 1);
        let password = '';
        let duress = null;

        if (mode === 'B') {
          if (!usePassword && !useKeyfile && !usePasskey) {
            if (shamirN > 1) {
              // 秘密分散のみ（パスワード・キーファイル・パスキーなし）：Mode A (cma1 App/Seed-Bound) で作成
              effectiveMode = 'A';
            } else {
              throw new Error('保護方法（パスワード、キーファイル、パスキー、または2分割以上の秘密分散）のいずれかを有効にしてください。追加保護なし（時間解禁のみ）で作成する場合は「タイムカプセル（時間解禁のみ）」を選択してください。');
            }
          }
          if (usePassword) {
            password = $('tl-password')?.value || '';
            const pwConf = $('tl-password-confirm')?.value || '';
            if (Array.from(password).length < 12) {
              throw new Error('復元用パスワードは12文字以上で入力してください。');
            }
            if (password !== pwConf) {
              throw new Error('復元用パスワードと確認用再入力が一致しません。');
            }
          }
          if (useKeyfile && (!tlCreationKeyfileBytes || tlCreationKeyfileBytes.length === 0)) {
            throw new Error('キーファイルを選択するか、「KeePassキーファイル(.key)生成」を実行してください。');
          }

          // 二重暗号・おとりスロット設定（セクション3・4と同一のポップアップ）
          const skipDuress = (localStorage.getItem('cm_skip_duress_popup') === 'true') || window.__SKIP_DURESS_MODAL__;
          if (!skipDuress && usePassword) {
            if (typeof window.showDuressModal === 'function') {
              const choice = await new Promise(resolve => {
                window.showDuressModal('sec5', password,
                  opts => resolve({ cancelled: false, opts }),
                  () => resolve({ cancelled: true }));
              });
              if (choice.cancelled || myToken !== tlOpToken) {
                tlMessage('tl-encrypt-status', '');
                return;
              }
              if (choice.opts?.enabled) {
                duress = {
                  password: choice.opts.password,
                  decoyBytes: enc.encode(choice.opts.text || ''),
                };
              }
            }
          }
        }

        const currentCardSeed = $('input-seed-number')?.value || '0';
        const res = await createTimelockCapsule({
          mode: effectiveMode,
          seedNum: currentCardSeed,
          targetTimeMs,
          payloadType,
          payloadBytes,
          filename,
          mimeType,
          payloadKind,
          kdfProfile,
          usePassword,
          password,
          useKeyfile,
          keyfileBytes: tlCreationKeyfileBytes,
          usePasskey,
          duress,
          shamirM,
          shamirN,
        });

        if (myToken !== tlOpToken) return;

        // Immediate Built-in Structural & Pre-Unlock Verification Test
        let verifyPassed = false;
        let verifySummary = '';
        try {
          const checkUnpacked = unpackCMTL1(res.cmtl1Bytes);
          const ageHdr = getTLBundle().parseTimelockAgeHeader(checkUnpacked.ageBinary);
          if (ageHdr.roundNumber !== res.meta.round) throw new Error('Round mismatch');
          // Verify that attempting decryption without a valid beacon fails
          let blockedWithoutBeacon = false;
          try {
            await decryptTimelockCapsule({
              packets: [res.cmtl1Bytes],
              beacon: null,
              seedNum: currentCardSeed,
              allowNetworkFetch: false,
            });
          } catch (_) {
            blockedWithoutBeacon = true;
          }
          if (!blockedWithoutBeacon) throw new Error('Pre-unlock check did not block');
          verifyPassed = true;
          verifySummary = `✅ 【構造・解禁前ロック検証テスト合格】CMTL1コンテナ整合性・AGE tlockスタンザ（Round #${res.meta.round}）・ヘッダーコミットメント・ビーコン未提供時の復号拒否を確認しました。`;
        } catch (vErr) {
          verifySummary = `⚠️ 構造検証エラー: ${vErr.message}`;
        }

        tlLastArtifact = {
          ...res,
          createdPassword: password,
          verifyPassed,
          verifySummary,
          baseName: filename ? `timelock-${filename}` : 'cryptomatrix-timelock',
        };

        renderCreationResult(tlLastArtifact);

        if (usePassword) {
          if ($('tl-password')) $('tl-password').value = '';
          if ($('tl-password-confirm')) $('tl-password-confirm').value = '';
          if ($('tl-duress-pw')) $('tl-duress-pw').value = '';
          if ($('tl-duress-pw-conf')) $('tl-duress-pw-conf').value = '';
          updatePasswordEntropyUI();
        }

        tlMessage(
          'tl-encrypt-status',
          `✅ タイムロック・カプセル（${res.meta.mode === 'A' ? (res.meta.shamir && res.meta.shamir.n > 1 ? `タイムロック ＋ 秘密分散 (${res.meta.shamir.m}-of-${res.meta.shamir.n})` : 'タイムカプセル') : '追加保護付きタイムカプセル'} ／ 解禁ラウンド #${res.meta.round}）を作成しました。保管前にリカバリーガイドの保存と復元タブへの転記確認をおすすめします。`
        );
      } catch (err) {
        if (myToken !== tlOpToken) return;
        tlMessage('tl-encrypt-status', err.message || String(err), true);
      }
    });

    // Output action buttons
    $('tl-btn-copy')?.addEventListener('click', async () => {
      if (!tlLastArtifact) return;
      const Preset = getPreset();
      if (Preset.copyWithAutoClear) {
        await Preset.copyWithAutoClear(tlLastArtifact.armoredText, () =>
          tlMessage('tl-encrypt-status', '🛡️ クリップボードのタイムロックデータを自動消去しました。')
        );
      } else {
        await navigator.clipboard.writeText(tlLastArtifact.armoredText);
      }
      tlMessage('tl-encrypt-status', '📋 タイムロックのアーマード文字列をコピーしました（30秒後に自動消去されます）。');
    });

    $('tl-btn-save-cmtl')?.addEventListener('click', async () => {
      if (!tlLastArtifact) return;
      if (tlLastArtifact.shares && tlLastArtifact.shares.length > 1) {
        for (let i = 0; i < tlLastArtifact.shares.length; i++) {
          const s = tlLastArtifact.shares[i];
          const fname = `${tlLastArtifact.baseName}.share${s.index}.cmtl`;
          downloadBlob(new Blob([s.bytes], { type: 'application/octet-stream' }), fname);
          if (i < tlLastArtifact.shares.length - 1) await new Promise((r) => setTimeout(r, 250));
        }
        tlMessage('tl-encrypt-status', `📁 全${tlLastArtifact.shamirN}シェアのタイムロックファイル (.cmtl) を一括保存しました。`);
      } else {
        const fname = `${tlLastArtifact.baseName}.cmtl`;
        downloadBlob(new Blob([tlLastArtifact.cmtl1Bytes], { type: 'application/octet-stream' }), fname);
        tlMessage('tl-encrypt-status', `📁 タイムロックファイル（${fname}）を保存しました。`);
      }
    });

    $('tl-btn-save-txt')?.addEventListener('click', () => {
      if (!tlLastArtifact) return;
      const fname =
        tlLastArtifact.shamirN > 1
          ? `${tlLastArtifact.baseName}-${tlLastArtifact.shamirM}of${tlLastArtifact.shamirN}.txt`
          : `${tlLastArtifact.baseName}.txt`;
      downloadBlob(new Blob([tlLastArtifact.armoredText], { type: 'text/plain;charset=utf-8' }), fname);
      tlMessage('tl-encrypt-status', `💾 アーマードテキスト（${fname}）を保存しました。`);
    });

    $('tl-btn-save-qr')?.addEventListener('click', async () => {
      if (!tlLastArtifact) return;
      const svgs = $('tl-qr-container')?.querySelectorAll('svg');
      if (!svgs || !svgs.length) {
        tlMessage('tl-encrypt-status', '保存可能なQRコードがありません（データサイズが上限を超えている場合は .cmtl 保存をご利用ください）。', true);
        return;
      }
      const Preset = getPreset();
      for (let i = 0; i < svgs.length; i++) {
        const fname =
          svgs.length > 1
            ? `${tlLastArtifact.baseName}-share${i + 1}-qr.png`
            : `${tlLastArtifact.baseName}-qr.png`;
        if (Preset.saveSvgAsPng) Preset.saveSvgAsPng(svgs[i], fname);
        if (i < svgs.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
      tlMessage('tl-encrypt-status', `🖼️ QRコード画像（${svgs.length}枚）を保存しました。`);
    });

    $('tl-btn-save-guide')?.addEventListener('click', () => {
      if (!tlLastArtifact) return;
      const guideTxt = generateRecoveryGuideText(tlLastArtifact);
      const fname = `${tlLastArtifact.baseName}-recovery-guide.txt`;
      downloadBlob(new Blob([guideTxt], { type: 'text/plain;charset=utf-8' }), fname);
      tlMessage('tl-encrypt-status', `📄 リカバリーガイド（${fname}）を保存しました。カプセルと一緒に保管してください。`);
    });

    $('tl-btn-transfer-keeweb')?.addEventListener('click', async () => {
      if (!tlLastArtifact) return;
      const Preset = getPreset();
      const meta = tlLastArtifact.meta;
      const unlockDateStr = formatLocalDateTime(meta.unlockTimeMs);
      const isShamir = tlLastArtifact.shamirN > 1;

      // 1. Prepare attachments
      const attachments = [];

      // 1a. QR Code Image (PNG)
      const qrSvgs = Array.from($('tl-qr-container')?.querySelectorAll('svg') || []);
      if (Preset.svgToPngBase64) {
        for (let i = 0; i < qrSvgs.length; i++) {
          try {
            const qrBase64 = await Preset.svgToPngBase64(qrSvgs[i], 640);
            if (qrBase64) {
              const fname = qrSvgs.length > 1
                ? `${tlLastArtifact.baseName}-share${i + 1}-qr.png`
                : `${tlLastArtifact.baseName}-qr.png`;
              attachments.push({ filename: fname, base64: qrBase64, mime: 'image/png' });
            }
          } catch (_) {}
        }
      }

      // 1b. Time Lock Capsule (.cmtl) binary
      if (tlLastArtifact.cmtl1Bytes) {
        try {
          let bin = '';
          const bytes = tlLastArtifact.cmtl1Bytes;
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          attachments.push({
            filename: `${tlLastArtifact.baseName}.cmtl`,
            base64: btoa(bin),
            mime: 'application/octet-stream'
          });
        } catch (_) {}
      }

      // 1c. Individual share .cmtl files if Shamir
      if (tlLastArtifact.shares && tlLastArtifact.shares.length > 1) {
        for (const s of tlLastArtifact.shares) {
          try {
            let bin = '';
            const bytes = s.bytes;
            const chunk = 8192;
            for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
            attachments.push({
              filename: `${tlLastArtifact.baseName}.share${s.index}.cmtl`,
              base64: btoa(bin),
              mime: 'application/octet-stream'
            });
          } catch (_) {}
        }
      }

      // 1d. Recovery Guide (.txt)
      try {
        const guideTxt = generateRecoveryGuideText(tlLastArtifact);
        attachments.push({
          filename: `${tlLastArtifact.baseName}-recovery-guide.txt`,
          text: guideTxt,
          mime: 'text/plain;charset=utf-8'
        });
      } catch (_) {}

      // 1e. Keyfile if created
      if (tlCreationKeyfileBytes) {
        try {
          let bin = '';
          const bytes = tlCreationKeyfileBytes;
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          attachments.push({
            filename: tlCreationKeyfileName || 'timelock.key',
            base64: btoa(bin),
            mime: 'application/x-kdbx-keyfile'
          });
        } catch (_) {}
      }

      // 2. Prepare notes & entry fields
      const pw = tlLastArtifact.createdPassword || '';
      const modeLabel = meta.mode === 'A' ? 'タイムカプセル（時間解禁のみ）' : 'パスワード付きタイムカプセル';
      const title = `CryptoMatrix タイムロックカプセル (${unlockDateStr} 解禁)`;
      const baseAppUrl = window.location.href.split(/[?#]/)[0];

      const notes = [
        '【CryptoMatrix タイムロックカプセル情報】',
        `■ 保護タイプ: ${modeLabel}`,
        `■ 連動カード配列シード番号: #${tlLastArtifact.seedNum || '0'} (復元時に必要)`,
        `■ 解禁予定日時: ${unlockDateStr}`,
        `■ drand対象ラウンド: Round #${meta.round}`,
        `■ ネットワーク: ${meta.net || 'quicknet'}`,
        `■ 秘密分散: ${isShamir ? `${tlLastArtifact.shamirM}-of-${tlLastArtifact.shamirN} 秘密分散` : 'なし（単一カプセル）'}`,
        ...(pw ? ['■ 復元用パスワード: KeePassの保護された「パスワード」欄に保存（このメモには記録しません）'] : []),
        '',
        '【タイムロック・アーマード文字列】',
        tlLastArtifact.armoredText,
        '',
        '【添付ファイル（全形式自動添付・安心保管）】',
        '1. .cmtl: タイムロック暗号化カプセル（画面にドラッグ＆ドロップで一発復元可能）',
        '2. -qr.png: タイムロックQRコード画像（カメラでスキャン可能）',
        '3. -recovery-guide.txt: 長期保管用リカバリーガイド（オフライン復旧手順記載）',
        ...(tlCreationKeyfileBytes ? ['4. .key: KeePassキーファイル（復元用）'] : []),
        '',
        '【復元方法】',
        '解禁予定時刻以降にCryptoMatrixの「⏳ タイムロック」タブ→「🔓 タイムロック解禁・復元」を開き、上記のアーマード文字列を貼り付けるか添付の.cmtl/QR画像を読み込ませてください。'
      ].join('\n');

      const transferFn = window.MatrixCardPreset?.setPendingKeeWebTransfer || window.setPendingKeeWebTransfer;
      if (transferFn) {
        transferFn('cm_pending_entry', {
          site: title,
          password: pw,
          username: `TimeLock-Round#${meta.round}`,
          url: `${baseAppUrl}#timelock`,
          notes: notes,
          attachments: attachments,
          timestamp: Date.now()
        });
      }

      const btn = $('tl-btn-transfer-keeweb');
      if (btn) {
        const origText = btn.innerHTML;
        btn.innerHTML = '✅ KeePass転送準備完了！';
        setTimeout(() => { btn.innerHTML = origText; }, 2500);
      }

      const openFn = window.MatrixCardPreset?.openKeeWeb || window.openKeeWeb;
      if (openFn) openFn();
      else window.open('keeweb/index.html', '_blank');

      tlMessage('tl-encrypt-status', '📥 KeePass(KeeWeb)に新規エントリーとして保存準備を行い、KeeWebを開きました。');
    });

    $('tl-btn-clear')?.addEventListener('click', () => {
      clearTimelockCreationDisplay('画面上のタイムロック出力表示を消去しました（保存済みのファイルは消えません）。');
    });

    $('tl-btn-test-restore')?.addEventListener('click', () => {
      if (!tlLastArtifact) return;
      tlRestoreSharesMap.clear();
      if ($('tl-restore-file-name')) $('tl-restore-file-name').textContent = '';
      if (tlLastArtifact.shares && tlLastArtifact.shares.length > 1) {
        const subset = tlLastArtifact.shares.slice(0, tlLastArtifact.shamirM);
        if ($('tl-restore-text')) {
          $('tl-restore-text').value = subset.map((s) => s.armored).join('\n\n');
        }
      } else {
        if ($('tl-restore-text')) $('tl-restore-text').value = tlLastArtifact.armoredText;
      }
      if (tlLastArtifact.createdPassword && $('tl-restore-password')) {
        $('tl-restore-password').value = tlLastArtifact.createdPassword;
      }
      if ($('tl-restore-seed-number')) {
        $('tl-restore-seed-number').value = tlLastArtifact.seedNum || '0';
      }
      if (tlCreationKeyfileBytes) {
        tlRestoreKeyfileBytes = tlCreationKeyfileBytes.slice();
        tlRestoreKeyfileName = tlCreationKeyfileName;
        if ($('tl-restore-keyfile-status')) {
          $('tl-restore-keyfile-status').textContent = `✅ 作成時のキーファイル (${tlRestoreKeyfileName}) を自動引き継ぎました。`;
        }
      }
      setSubTab('decrypt');
      tlMessage(
        'tl-decrypt-status',
        '🧪 作成したカプセルを復号・解禁テスト欄に転記しました。解禁時刻前の場合は「解禁時刻前エラー」で正しくブロックされること、解禁時刻到達後は復号できることを確認できます。'
      );
    });

    // Restore Panel Controls
    $('tl-beacon-mode-online')?.addEventListener('change', () => {
      if ($('tl-manual-beacon-box')) $('tl-manual-beacon-box').hidden = true;
    });
    $('tl-beacon-mode-manual')?.addEventListener('change', () => {
      if ($('tl-manual-beacon-box')) $('tl-manual-beacon-box').hidden = false;
    });

    $('tl-restore-text')?.addEventListener('input', refreshRestoreCapsulePreview);

    async function handleRestoreFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      tlStopCamera();
      const loadedNames = [];
      for (const f of files) {
        const lower = f.name.toLowerCase();
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || f.type.startsWith('image/')) {
          await decodeTimelockQrImage(f);
          loadedNames.push(f.name);
          continue;
        }
        const buf = new Uint8Array(await f.arrayBuffer());
        if (isTimelockBinary(buf)) {
          const p = parseAnyTimelockPacket(buf);
          if (p.kind === 'cmts') {
            tlRestoreSharesMap.set(`share-${p.index}`, { shareObj: p, rawBytes: buf });
          } else {
            tlRestoreSharesMap.clear();
            tlRestoreSharesMap.set('single', { shareObj: p, rawBytes: buf });
          }
          loadedNames.push(f.name);
        } else {
          const txt = dec.decode(buf).trim();
          const dearmored = dearmorTimelock(txt);
          if (dearmored.length > 0) {
            if ($('tl-restore-text')) {
              const cur = ($('tl-restore-text').value || '').trim();
              $('tl-restore-text').value = cur ? cur + '\n\n' + txt : txt;
            }
            loadedNames.push(f.name);
          } else {
            throw new Error(`ファイル「${f.name}」は有効なタイムロックデータ (.cmtl / アーマードテキスト) ではありません。`);
          }
        }
      }
      if ($('tl-restore-file-name') && loadedNames.length) {
        $('tl-restore-file-name').textContent = `✅ 読込済み: ${loadedNames.join(', ')}`;
      }
      refreshRestoreCapsulePreview();
    }

    $('tl-restore-file')?.addEventListener('change', async () => {
      try {
        await handleRestoreFiles($('tl-restore-file')?.files);
      } catch (err) {
        tlMessage('tl-decrypt-status', err.message, true);
      } finally {
        if ($('tl-restore-file')) $('tl-restore-file').value = '';
      }
    });

    const restoreDropzone = $('tl-restore-dropzone');
    if (restoreDropzone) {
      restoreDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        restoreDropzone.style.borderColor = '#38bdf8';
      });
      restoreDropzone.addEventListener('dragleave', () => {
        restoreDropzone.style.borderColor = '#304257';
      });
      restoreDropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        restoreDropzone.style.borderColor = '#304257';
        try {
          await handleRestoreFiles(e.dataTransfer?.files);
        } catch (err) {
          tlMessage('tl-decrypt-status', err.message, true);
        }
      });
    }

    $('tl-restore-qr-img')?.addEventListener('change', async () => {
      const f = $('tl-restore-qr-img')?.files?.[0];
      if (!f) return;
      try {
        await decodeTimelockQrImage(f);
        refreshRestoreCapsulePreview();
      } catch (err) {
        tlMessage('tl-decrypt-status', err.message, true);
      } finally {
        $('tl-restore-qr-img').value = '';
      }
    });

    $('tl-btn-camera')?.addEventListener('click', () => void tlStartCamera());
    $('tl-btn-camera-stop')?.addEventListener('click', () => tlStopCamera('カメラを停止しました。'));

    $('tl-btn-reset-restore')?.addEventListener('click', () => {
      tlStopCamera();
      tlRestoreSharesMap.clear();
      if ($('tl-restore-text')) $('tl-restore-text').value = '';
      if ($('tl-restore-file-name')) $('tl-restore-file-name').textContent = '';
      if ($('tl-manual-beacon-input')) $('tl-manual-beacon-input').value = '';
      if ($('tl-decrypt-result')) $('tl-decrypt-result').hidden = true;
      refreshRestoreCapsulePreview();
      tlMessage('tl-decrypt-status', '入力データをリセットしました。');
    });

    $('tl-restore-keyfile')?.addEventListener('change', async () => {
      const f = $('tl-restore-keyfile')?.files?.[0];
      if (!f) return;
      tlRestoreKeyfileBytes = new Uint8Array(await f.arrayBuffer());
      tlRestoreKeyfileName = f.name;
      if ($('tl-restore-keyfile-status')) {
        $('tl-restore-keyfile-status').textContent = `✅ キーファイル選択済み: ${f.name} (${f.size.toLocaleString()} bytes)`;
      }
    });

    $('tl-restore-gen-keyfile')?.addEventListener('click', async () => {
      const Preset = getPreset();
      const seedNum = Preset.getValidSeedOrPrompt ? Preset.getValidSeedOrPrompt('tl-decrypt-status') : 0;
      if (seedNum === null) return;
      const pw = ($('tl-restore-password')?.value || '').trim();
      if (!Preset.showKeyfileModal) return;
      Preset.showKeyfileModal({ seedNum, defaultPassword: pw.length >= 12 ? pw : '', defaultPasskey: false, context: 'timelock-restore' }, async (opts) => {
        try {
          const filename = `cryptomatrix-card-${opts.seedNum}.key`;
          const res = await Preset.exportKeePassXmlKeyfile({
            seedNum: opts.seedNum,
            password: opts.password,
            passkeyFactor: opts.passkeyFactor,
            passkeyCred: opts.passkeyCred,
            filename,
          });
          tlRestoreKeyfileBytes = enc.encode(res.keyData.xml);
          tlRestoreKeyfileName = res.filename;
          if ($('tl-restore-keyfile-status')) {
            $('tl-restore-keyfile-status').textContent = `✅ カード（シード: ${opts.seedNum}）からキーファイル (${tlRestoreKeyfileName}) を再生成・セットしました。`;
          }
        } catch (err) {
          tlMessage('tl-decrypt-status', 'キーファイル再生成エラー: ' + err.message, true);
        }
      });
    });

    // Execute Decryption
    $('tl-btn-decrypt')?.addEventListener('click', async () => {
      const myToken = ++tlOpToken;
      tlMessage('tl-decrypt-status', '⏳ ビーコン検証とタイムロック復号を実行しています…');
      if ($('tl-decrypt-result')) $('tl-decrypt-result').hidden = true;

      try {
        const packets = collectRestorePacketsFromInput();
        if (!packets.length) {
          throw new Error('復号するタイムロックファイル (.cmtl) を選択するか、アーマード文字列を貼り付けてください。');
        }

        const isManualBeacon = $('tl-beacon-mode-manual')?.checked;
        let manualBeacon = null;
        if (isManualBeacon) {
          const rawBeaconStr = ($('tl-manual-beacon-input')?.value || '').trim();
          if (!rawBeaconStr) {
            throw new Error('手動入力モードが選択されています。drandビーコンのJSONまたは署名（96文字の16進数）を入力してください。');
          }
          const parsedFirst = parseAnyTimelockPacket(packets[0]);
          const expectedRound = parsedFirst.meta.round;
          if (rawBeaconStr.startsWith('{')) {
            try {
              manualBeacon = JSON.parse(rawBeaconStr);
            } catch (_) {
              throw new Error('入力されたビーコンJSONの形式が不正です。');
            }
          } else if (/^(0x)?[0-9a-fA-F]{96}$/.test(rawBeaconStr)) {
            manualBeacon = {
              round: expectedRound,
              signature: rawBeaconStr.replace(/^0x/i, ''),
            };
          } else if (/^(0x)?[0-9a-fA-F]{192}$/.test(rawBeaconStr)) {
            throw new Error('入力された署名は192文字（96バイト）です。quicknetは96文字の16進数（48バイト・G1圧縮点）の署名を入力してください。');
          } else {
            throw new Error('ビーコン入力は JSON形式（{"round":...,"signature":"..."}）または 96文字の16進数署名（48バイト）で入力してください。');
          }
        }

        const password = $('tl-restore-password')?.value || '';
        const seedNum = $('tl-restore-seed-number')?.value || $('input-seed-number')?.value || '0';
        const res = await decryptTimelockCapsule({
          packets,
          beacon: manualBeacon,
          password,
          keyfileBytes: tlRestoreKeyfileBytes,
          seedNum,
          allowNetworkFetch: !isManualBeacon,
        });

        if (myToken !== tlOpToken) return;

        if (tlLastDecrypted?.payload) zeroizeBuf(tlLastDecrypted.payload);
        tlLastDecrypted = res;

        renderDecryptionResult(res);
        if ($('tl-restore-password')) $('tl-restore-password').value = '';
        tlMessage(
          'tl-decrypt-status',
          `✅ タイムロックの解禁・復号に成功しました！（検証済みラウンド: #${res.beacon.round} ／ 取得元: ${res.beaconEndpoint === 'manual' ? '手動入力ビーコン' : res.beaconEndpoint}）`
        );
      } catch (err) {
        if (myToken !== tlOpToken) return;
        tlMessage('tl-decrypt-status', err.message || String(err), true);
      }
    });

    // Decrypted output actions
    $('tl-copy-decrypted')?.addEventListener('click', async () => {
      if (!tlLastDecrypted) return;
      const rep = getDecryptedPayloadRepresentation(tlLastDecrypted);
      const textToCopy = rep.isText ? rep.textToCopy : ($('tl-decrypted-content')?.textContent || '');
      if (!textToCopy) {
        tlMessage('tl-decrypt-status', 'コピー可能なテキストがありません。「ファイルをダウンロード」をご利用ください。', true);
        return;
      }
      const Preset = getPreset();
      if (Preset.copyWithAutoClear) {
        await Preset.copyWithAutoClear(textToCopy, () =>
          tlMessage('tl-decrypt-status', '🛡️ クリップボードの復号データを自動消去しました。')
        );
      } else {
        await navigator.clipboard.writeText(textToCopy);
      }
      tlMessage('tl-decrypt-status', '📋 復号された内容をコピーしました（30秒後に自動消去されます）。');
    });

    $('tl-download-decrypted')?.addEventListener('click', () => {
      if (!tlLastDecrypted || !tlLastDecrypted.payload) return;
      const fname = tlLastDecrypted.name || (tlLastDecrypted.type === 'file' ? 'decrypted-file.bin' : 'decrypted-text.txt');
      const mime = tlLastDecrypted.mimeType || (tlLastDecrypted.type === 'file' ? 'application/octet-stream' : 'text/plain;charset=utf-8');
      downloadBlob(new Blob([tlLastDecrypted.payload], { type: mime }), fname);
      tlMessage('tl-decrypt-status', `💾 復号されたファイル「${fname}」を保存しました。`);
    });

    $('tl-route-sec3')?.addEventListener('click', () => {
      if (!tlLastDecrypted) return;
      const rep = getDecryptedPayloadRepresentation(tlLastDecrypted);
      const tabBackup = document.querySelector('.cm-tab[aria-controls="tab-backup"]');
      if (tabBackup) tabBackup.click();
      document.dispatchEvent(new CustomEvent('cm-route-backup-text', { detail: { text: rep.textToCopy } }));
      tlMessage('tl-decrypt-status', '✅ セクション3（暗号化バックアップ復元欄）へ転送しました。復元用パスワードを入力して復元してください。');
    });

    $('tl-route-sec4')?.addEventListener('click', () => {
      if (!tlLastDecrypted) return;
      const rep = getDecryptedPayloadRepresentation(tlLastDecrypted);
      const tabVault = document.querySelector('.cm-tab[aria-controls="tab-vault"]');
      if (tabVault) tabVault.click();
      document.dispatchEvent(new CustomEvent('cm-route-vault-text', { detail: { text: rep.textToCopy } }));
      tlMessage('tl-decrypt-status', '✅ セクション4（セキュア保管庫復元欄）へ転送しました。復元用パスワードを入力して復元してください。');
    });

    // Listen for routed timelock text/files from Section 3 / Section 4
    document.addEventListener('cm-route-timelock-text', (e) => {
      const text = e.detail?.text;
      if (!text) return;
      switchToTimelockTab('decrypt');
      if ($('tl-restore-text')) $('tl-restore-text').value = text;
      refreshRestoreCapsulePreview();
      tlMessage('tl-decrypt-status', '⏳ タイムロックデータを検出したため、タイムロック解禁・復元タブへ自動入力しました。');
    });

    document.addEventListener('cm-route-timelock-files', async (e) => {
      const files = e.detail?.files;
      if (!files || !files.length) return;
      switchToTimelockTab('decrypt');
      try {
        await handleRestoreFiles(files);
        tlMessage('tl-decrypt-status', '⏳ タイムロックファイル (.cmtl) を読み込みました。');
      } catch (err) {
        tlMessage('tl-decrypt-status', err.message, true);
      }
    });

    // Emergency Zeroize hook
    $('btn-zeroize')?.addEventListener('click', () => {
      tlOpToken++;
      tlStopCamera();
      stopCountdown();
      if (tlSelectedFileBytes) zeroizeBuf(tlSelectedFileBytes);
      tlSelectedFileBytes = null;
      tlSelectedFile = null;
      if (tlTransferredPayload?.bytes) zeroizeBuf(tlTransferredPayload.bytes);
      tlTransferredPayload = null;
      if (tlCreationKeyfileBytes) zeroizeBuf(tlCreationKeyfileBytes);
      tlCreationKeyfileBytes = null;
      tlCreationKeyfileName = '';
      if (tlRestoreKeyfileBytes) zeroizeBuf(tlRestoreKeyfileBytes);
      tlRestoreKeyfileBytes = null;
      tlRestoreKeyfileName = '';
      if (tlLastDecrypted?.payload) zeroizeBuf(tlLastDecrypted.payload);
      tlLastDecrypted = null;
      tlLastArtifact = null;
      tlRestoreSharesMap.clear();
      clearTimelockCreationDisplay('');
      if ($('tl-text-content')) $('tl-text-content').value = '';
      if ($('tl-restore-text')) $('tl-restore-text').value = '';
      if ($('tl-restore-password')) $('tl-restore-password').value = '';
      if ($('tl-restore-seed-number')) $('tl-restore-seed-number').value = $('input-seed-number')?.value || '0';
      if ($('tl-decrypt-result')) $('tl-decrypt-result').hidden = true;
      if ($('tl-capsule-info-box')) $('tl-capsule-info-box').hidden = true;
      tlMessage('tl-encrypt-status', '');
      tlMessage('tl-decrypt-status', '');
    });

    if ($('tl-restore-seed-number') && $('input-seed-number')) {
      $('tl-restore-seed-number').value = $('input-seed-number').value || '0';
    }
    $('tl-btn-sync-card-seed')?.addEventListener('click', () => {
      const activeSeed = $('input-seed-number')?.value || '0';
      if ($('tl-restore-seed-number')) {
        $('tl-restore-seed-number').value = activeSeed;
        tlMessage('tl-decrypt-status', `🔑 現在のカード配列シード番号 (#${activeSeed}) を反映しました。`);
      }
    });
    $('input-seed-number')?.addEventListener('input', () => {
      updatePreSummaryAndRoundPreview();
    });

    syncPayloadInputUI();
    syncTimeModeUI();
    updatePasswordEntropyUI();
  }

  function clearTimelockCreationDisplay(note = '') {
    tlLastArtifact = null;
    if ($('tl-encrypt-result')) $('tl-encrypt-result').hidden = true;
    if ($('tl-output-text')) $('tl-output-text').value = '';
    if ($('tl-qr-container')) $('tl-qr-container').replaceChildren();
    if ($('tl-shares-container')) $('tl-shares-container').replaceChildren();
    if ($('tl-verification-box')) $('tl-verification-box').innerHTML = '';
    if (note) tlMessage('tl-encrypt-status', note);
  }

  function renderCreationResult(art) {
    const resBox = $('tl-encrypt-result');
    if (!resBox) return;
    resBox.hidden = false;

    if ($('tl-verification-box')) {
      $('tl-verification-box').innerHTML = `
        <div style="padding:8px 12px; border-radius:6px; background:${art.verifyPassed ? '#064e3b' : '#451a03'}; border:1px solid ${art.verifyPassed ? '#10b981' : '#f59e0b'}; color:${art.verifyPassed ? '#34d399' : '#fbbf24'}; font-size:0.82rem; font-weight:700;">
          ${escapeHtml(art.verifySummary)}
        </div>
      `;
    }

    if ($('tl-output-text')) {
      $('tl-output-text').value = art.armoredText;
    }

    const qrBox = $('tl-qr-container');
    if (qrBox) {
      if (art.shares && art.shares.length > 1) {
        qrBox.innerHTML = art.shares
          .map((s) => renderQrPreviewHtml(s.armored, `Timelock Share ${s.index}/${s.n} (Round #${art.meta.round})`))
          .join('');
      } else {
        qrBox.innerHTML = renderQrPreviewHtml(art.armoredText, `Timelock Capsule (Round #${art.meta.round})`);
      }
      const hasSvg = Boolean(qrBox.querySelector('svg'));
      if ($('tl-btn-save-qr')) $('tl-btn-save-qr').disabled = !hasSvg;
    }

    const sharesBox = $('tl-shares-container');
    if (sharesBox) {
      if (art.shares && art.shares.length > 1) {
        sharesBox.innerHTML = art.shares
          .map(
            (s) => `
          <div style="background:#192129; border:1px solid #304257; border-radius:6px; padding:10px; margin-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
              <strong style="font-size:0.84rem; color:#38bdf8;">🧩 秘密分散シェア #${s.index} / ${s.n}（任意の ${s.m} シェアで復元可能）</strong>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary tl-btn-copy-share" data-idx="${s.index}" style="padding:3px 8px; font-size:0.75rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>コピー</button>
                <button type="button" class="btn btn-outline tl-btn-dl-share" data-idx="${s.index}" style="padding:3px 8px; font-size:0.75rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>.cmtl保存</button>
                <button type="button" class="btn btn-outline tl-btn-txt-share" data-idx="${s.index}" style="padding:3px 8px; font-size:0.75rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>.txt保存</button>
                <button type="button" class="btn btn-outline tl-btn-kw-share" data-idx="${s.index}" style="padding:3px 8px; font-size:0.75rem; font-weight:700; color:#1aaeff; border-color:#1ab1ff; background:#192329;" title="このシェアをKeePassに保存"><svg class="cm-btn-ico" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>KeePassに保存</button>
              </div>
            </div>
            <textarea readonly style="width:100%; height:70px; font-family:monospace; font-size:0.72rem; background:#111827; color:#e5e7eb; border:1px solid #374151; border-radius:4px; padding:6px; box-sizing:border-box;">${escapeHtml(s.armored)}</textarea>
          </div>
        `
          )
          .join('');

        sharesBox.querySelectorAll('.tl-btn-copy-share').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.dataset.idx);
            const target = art.shares.find((x) => x.index === idx);
            if (!target) return;
            await getPreset().copyWithAutoClear?.(target.armored);
            tlMessage('tl-encrypt-status', `📋 シェア #${idx}/${target.n} をコピーしました（30秒後自動消去）。`);
          });
        });
        sharesBox.querySelectorAll('.tl-btn-dl-share').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.idx);
            const target = art.shares.find((x) => x.index === idx);
            if (!target) return;
            downloadBlob(new Blob([target.bytes], { type: 'application/octet-stream' }), `${art.baseName}.share${idx}.cmtl`);
          });
        });
        sharesBox.querySelectorAll('.tl-btn-txt-share').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.idx);
            const target = art.shares.find((x) => x.index === idx);
            if (!target) return;
            downloadBlob(new Blob([target.armored], { type: 'text/plain;charset=utf-8' }), `${art.baseName}.share${idx}.txt`);
          });
        });
        sharesBox.querySelectorAll('.tl-btn-kw-share').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.dataset.idx);
            const target = art.shares.find((x) => x.index === idx);
            if (!target) return;
            const meta = art.meta;
            const unlockDateStr = formatLocalDateTime(meta.unlockTimeMs);
            const attachments = [];

            try {
              let bin = '';
              const bytes = target.bytes;
              const chunk = 8192;
              for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
              attachments.push({
                filename: `${art.baseName}.share${idx}.cmtl`,
                base64: btoa(bin),
                mime: 'application/octet-stream'
              });
            } catch (_) {}

            const qrSvgs = Array.from($('tl-qr-container')?.querySelectorAll('svg') || []);
            const shareSvg = qrSvgs[idx - 1];
            if (shareSvg && getPreset().svgToPngBase64) {
              try {
                const qrBase64 = await getPreset().svgToPngBase64(shareSvg, 640);
                if (qrBase64) {
                  attachments.push({
                    filename: `${art.baseName}-share${idx}-qr.png`,
                    base64: qrBase64,
                    mime: 'image/png'
                  });
                }
              } catch (_) {}
            }

            const title = `CryptoMatrix タイムロック シェア #${idx}/${art.shamirN} (${unlockDateStr} 解禁)`;
            const baseAppUrl = window.location.href.split(/[?#]/)[0];
            const notes = [
              `【CryptoMatrix タイムロック 秘密分散シェア #${idx}/${art.shamirN}】`,
              `■ 解禁予定日時: ${unlockDateStr}`,
              `■ 復元条件: 全${art.shamirN}シェア中 任意の${art.shamirM}シェアが必要`,
              `■ drand対象ラウンド: Round #${meta.round}`,
              '',
              '【シェア・アーマード文字列】',
              target.armored,
              '',
              '【復元方法】',
              `他の${art.shamirM - 1}個のシェアと一緒にCryptoMatrixタイムロック復元タブに貼り付けて復号してください。`
            ].join('\n');

            const transferFn = window.MatrixCardPreset?.setPendingKeeWebTransfer || window.setPendingKeeWebTransfer;
            if (transferFn) {
              transferFn('cm_pending_entry', {
                site: title,
                password: art.createdPassword || '',
                username: `TimeLock-Share#${idx}`,
                url: `${baseAppUrl}#timelock`,
                notes: notes,
                attachments: attachments,
                timestamp: Date.now()
              });
            }
            btn.innerHTML = '✅ 転送完了！';
            setTimeout(() => { btn.innerHTML = '📥 KeePassに保存'; }, 2000);
            const openFn = window.MatrixCardPreset?.openKeeWeb || window.openKeeWeb;
            if (openFn) openFn();
            else window.open('keeweb/index.html', '_blank');
          });
        });
      } else {
        sharesBox.innerHTML = '';
      }
    }
    if (window.cmApplyPeekGuard) window.cmApplyPeekGuard();
  }

  function formatAsArmored(bytes, tag = 'BACKUP', type = '') {
    let s = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(s);
    const wrapped = b64.match(/.{1,64}/g)?.join('\n') || b64;
    const header = type
      ? (tag ? `CRYPTOMATRIX ${type} ${tag}` : `CRYPTOMATRIX ${type}`)
      : (tag ? `CRYPTOMATRIX ${tag}` : 'CRYPTOMATRIX');
    return `-----BEGIN ${header}-----\n${wrapped}\n-----END ${header}-----`;
  }

  function getDecryptedPayloadRepresentation(payloadItem) {
    if (!payloadItem || !payloadItem.payload) {
      return { isText: false, isSec3: false, isSec4: false, displayText: '', textToCopy: '' };
    }
    const p = payloadItem.payload;
    const isCXB = p.length >= 4 && p[0] === 0x43 && p[1] === 0x58 && p[2] === 0x42;
    const isCME = p.length >= 4 && p[0] === 0x43 && p[1] === 0x4d && p[2] === 0x45;
    const isSec3 = payloadItem.meta?.payloadKind === 'sec3_backup' || isCXB;
    const isSec4 = payloadItem.meta?.payloadKind === 'sec4_vault' || isCME;

    if (payloadItem.type === 'text') {
      const txt = payloadItem.text || dec.decode(p);
      return {
        kind: 'text',
        isText: true,
        textToCopy: txt,
        displayText: txt,
        isSec3: false,
        isSec4: false,
      };
    }

    if (isCXB || isSec3) {
      const armored = formatAsArmored(p, 'BACKUP', '');
      return {
        kind: 'sec3_backup',
        isText: true,
        textToCopy: armored,
        displayText: armored,
        isSec3: true,
        isSec4: false,
      };
    }

    if (isCME || isSec4) {
      const armored = formatAsArmored(p, 'ENCRYPTED DATA', 'VAULT');
      return {
        kind: 'sec4_vault',
        isText: true,
        textToCopy: armored,
        displayText: armored,
        isSec3: false,
        isSec4: true,
      };
    }

    const asTextPreview = dec.decode(p.subarray(0, Math.min(2000, p.length)));
    if (asTextPreview.startsWith('-----BEGIN CRYPTOMATRIX')) {
      const fullText = dec.decode(p);
      const isB = /CRYPTOMATRIX\s+BACKUP/i.test(fullText);
      const isV = /CRYPTOMATRIX\s+VAULT/i.test(fullText);
      return {
        kind: isB ? 'sec3_backup' : (isV ? 'sec4_vault' : 'text'),
        isText: true,
        textToCopy: fullText,
        displayText: fullText,
        isSec3: isB,
        isSec4: isV,
      };
    }

    return {
      kind: 'file',
      isText: false,
      textToCopy: '',
      displayText: `📁 バイナリファイル「${payloadItem.name || 'decrypted.bin'}」（${p.length.toLocaleString()} bytes / MIME: ${payloadItem.mimeType || 'application/octet-stream'}）が復号されました。「💾 ファイルをダウンロード」ボタンを押して保存してください。`,
      isSec3: false,
      isSec4: false,
    };
  }

  function renderDecryptionResult(res) {
    const box = $('tl-decrypt-result');
    if (!box) return;
    box.hidden = false;

    const contentEl = $('tl-decrypted-content');
    const metaEl = $('tl-decrypted-meta');
    const dlBtn = $('tl-download-decrypted');
    const sec3Btn = $('tl-route-sec3');
    const sec4Btn = $('tl-route-sec4');

    const rep = getDecryptedPayloadRepresentation(res);

    if (sec3Btn) sec3Btn.style.display = rep.isSec3 ? '' : 'none';
    if (sec4Btn) sec4Btn.style.display = rep.isSec4 ? '' : 'none';

    if (contentEl) contentEl.textContent = rep.displayText;
    if (dlBtn) dlBtn.style.display = '';

    if (metaEl) {
      let extraGuide = '';
      if (rep.isSec3) {
        extraGuide = `
          <div class="tl-guide-banner" style="margin-top:8px; padding:12px 14px; background:#143324; border:1.5px solid #10b981; border-radius:6px; color:#ecfdf5; font-size:0.84rem; line-height:1.6;">
            <strong style="font-size:0.92rem; color:#34d399;">🎉 タイムロックの開封に成功しました！</strong><br>
            カプセルの中に封入されていたのは【<strong>セクション3の暗号化バックアップ</strong>】です。<br>
            データはセクション3作成時の復元用パスワード等で安全に保護されたまま取り出されました。<br>
            上の<strong>『🔄 セクション3（バックアップ復元欄）へ送る』</strong>ボタンを押してセクション3へ移動し、復元用パスワードを入力して【読み込み・検証して内容を確認】を実行すると、元の全パスワード・設定・合言葉が復元されます。
          </div>
        `;
      } else if (rep.isSec4) {
        extraGuide = `
          <div class="tl-guide-banner" style="margin-top:8px; padding:12px 14px; background:#143324; border:1.5px solid #10b981; border-radius:6px; color:#ecfdf5; font-size:0.84rem; line-height:1.6;">
            <strong style="font-size:0.92rem; color:#34d399;">🎉 タイムロックの開封に成功しました！</strong><br>
            カプセルの中に封入されていたのは【<strong>セクション4 セキュア保管庫の暗号化データ</strong>】です。<br>
            上の<strong>『🔄 セクション4（保管庫復号欄）へ送る』</strong>ボタンを押してセクション4へ移動し、復元用パスワードを入力して復号してください。
          </div>
        `;
      }
      metaEl.innerHTML = `
        <div>解禁ラウンド: <strong>#${res.beacon.round}</strong> ／ 保護タイプ: ${res.meta.mode === 'A' ? 'タイムカプセル（時間解禁のみ）' : 'パスワード付きタイムカプセル'} ／ 封入形式: ${escapeHtml(payloadKindLabel(res.meta.payloadKind))} ／ サイズ: ${res.payload.length.toLocaleString()} bytes</div>
        ${extraGuide}
      `;
    }
    if (window.cmApplyPeekGuard) window.cmApplyPeekGuard();
  }

  /* ===================================================================
   * 9. QR Image & Camera Scanner for Time Lock Restore
   * =================================================================== */
  async function decodeTimelockQrImage(file) {
    const decoderFn = window.CMQrHelpers?.decodeQrFromFile || window.MatrixCardPreset?.decodeQrFromFile;
    if (!decoderFn) {
      throw new Error('QR読取モジュールが準備できていません。');
    }
    const texts = await decoderFn(file);
    if (!texts || !texts.length) {
      throw new Error('画像からQRコードを検出できませんでした。');
    }
    for (const t of texts) {
      ingestTimelockScannedText(t);
    }
  }

  function ingestTimelockScannedText(rawText) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return false;
    const dearmored = dearmorTimelock(trimmed);
    if (!dearmored.length) {
      throw new Error('読み取ったQRコードはタイムロックデータ（CRYPTOMATRIX TIMELOCK）ではありません。');
    }
    const cur = ($('tl-restore-text')?.value || '').trim();
    if ($('tl-restore-text')) {
      if (cur && !cur.includes(trimmed)) {
        $('tl-restore-text').value = cur + '\n\n' + trimmed;
      } else if (!cur) {
        $('tl-restore-text').value = trimmed;
      }
    }
    refreshRestoreCapsulePreview();
    return true;
  }

  function tlStopCamera(note = '') {
    tlCameraEpoch++;
    if (tlCameraTimer) {
      clearTimeout(tlCameraTimer);
      tlCameraTimer = null;
    }
    if (tlCameraStream) {
      tlCameraStream.getTracks().forEach((t) => t.stop());
      tlCameraStream = null;
    }
    const video = $('tl-video');
    if (video) {
      video.pause();
      video.srcObject = null;
      video.hidden = true;
    }
    if ($('tl-btn-camera')) $('tl-btn-camera').disabled = false;
    if ($('tl-btn-camera-stop')) $('tl-btn-camera-stop').disabled = true;
    if (note) tlMessage('tl-decrypt-status', note);
  }

  async function tlStartCamera() {
    tlStopCamera();
    const epoch = tlCameraEpoch;
    if ($('tl-btn-camera')) $('tl-btn-camera').disabled = true;
    if ($('tl-btn-camera-stop')) $('tl-btn-camera-stop').disabled = false;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('カメラ読取にはHTTPSまたはlocalhost環境が必要です。QR画像読込またはファイル選択をご利用ください。');
      }
      const getDec = window.CMQrHelpers?.getQrCanvasDecoder || window.MatrixCardPreset?.getQrCanvasDecoder;
      const decodeCanvas = getDec ? await getDec() : null;
      if (!decodeCanvas) throw new Error('QR読取デコーダーを初期化できませんでした。');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (epoch !== tlCameraEpoch) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      tlCameraStream = media;
      const video = $('tl-video');
      video.srcObject = media;
      video.hidden = false;
      await video.play();
      tlMessage('tl-decrypt-status', '📷 タイムロックQRコードをカメラに映してください…');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (epoch !== tlCameraEpoch) return;
        try {
          if (video.readyState >= 2 && video.videoWidth) {
            const scale = Math.min(1, 1400 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const texts = await decodeCanvas(canvas);
            for (const t of texts) {
              if (ingestTimelockScannedText(t)) {
                tlStopCamera('✅ QRコードを読み取りました。');
                return;
              }
            }
          }
        } catch (err) {
          if (epoch === tlCameraEpoch) tlMessage('tl-decrypt-status', err.message, true);
        }
        if (epoch === tlCameraEpoch) tlCameraTimer = setTimeout(tick, 250);
      };
      void tick();
    } catch (err) {
      tlStopCamera();
      tlMessage('tl-decrypt-status', err.message || String(err), true);
    }
  }

  // Expose Public API on window.TimeLockApp
  const TimeLockApp = Object.freeze({
    packCMV1,
    unpackCMV1,
    packCommittedInner,
    unpackCommittedInner,
    packCMTL1,
    unpackCMTL1,
    packCMTSShare,
    unpackCMTSShare,
    isTimelockBinary,
    armorTimelock,
    dearmorTimelock,
    parseAnyTimelockPacket,
    combineTimelockShares,
    createTimelockCapsule,
    decryptTimelockCapsule,
    comboLabelTL,
    generateRecoveryGuideText,
    receiveTransferredPayload,
    switchToTimelockTab,
  });

  if (typeof window !== 'undefined') {
    window.TimeLockApp = TimeLockApp;
    window.CMTimelock = TimeLockApp;
  }

  document.addEventListener('DOMContentLoaded', initTimelockUI);
})();
