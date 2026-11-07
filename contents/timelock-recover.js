
  (() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const decFatal = new TextDecoder('utf-8', { fatal: true });

    function concat(...arrays) {
      let total = 0;
      for (const a of arrays) total += a.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const a of arrays) { out.set(a, off); off += a.length; }
      return out;
    }
    function equal(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      let d = 0;
      for (let i = 0; i < a.length; i++) d |= (a[i] ^ b[i]);
      return d === 0;
    }
    function bytesToHex(bytes) {
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    async function sha256(bytes) {
      return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    }
    async function sha512(bytes) {
      return new Uint8Array(await crypto.subtle.digest('SHA-512', bytes));
    }

    // GF(2^8) Shamir Combine
    const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
    (() => {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x; GF_EXP[i + 255] = x; GF_LOG[x] = i;
        const x2 = (x << 1) ^ ((x & 0x80) ? 0x11b : 0);
        x = (x2 ^ x) & 0xff;
      }
    })();
    function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
    function gfDiv(a, b) { if (b === 0) throw new Error('GF(2^8) zero division'); return a === 0 ? 0 : GF_EXP[GF_LOG[a] + 255 - GF_LOG[b]]; }
    function shamirCombine(shareItems) {
      if (!Array.isArray(shareItems) || shareItems.length < 2) throw new Error('秘密分散の復元に十分なシェアがありません。');
      const m = shareItems.length, first = shareItems[0], len = first.data.length;
      const L = new Uint8Array(m);
      for (let j = 0; j < m; j++) {
        const item = shareItems[j], xj = item.index;
        if (item.data.length !== len) throw new Error('シェア間でデータ長が一致しません。');
        let prod = 1;
        for (let q = 0; q < m; q++) {
          if (q !== j) {
            const xq = shareItems[q].index;
            if (xj === xq) throw new Error('同一番号の秘密分散シェアが重複しています。');
            prod = gfMul(prod, gfDiv(xq, xj ^ xq));
          }
        }
        L[j] = prod;
      }
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        let val = 0;
        for (let j = 0; j < m; j++) val ^= gfMul(shareItems[j].data[i], L[j]);
        out[i] = val;
      }
      return out;
    }

    // ChaCha20-Poly1305
    const ChaCha20Poly1305 = (() => {
      function chacha20Block(key, counter, nonce) {
        const state = new Uint32Array(16);
        state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
        const keyView = new DataView(key.buffer, key.byteOffset, 32);
        for (let i = 0; i < 8; i++) state[4 + i] = keyView.getUint32(i * 4, true);
        state[12] = counter;
        const nonceView = new DataView(nonce.buffer, nonce.byteOffset, 12);
        for (let i = 0; i < 3; i++) state[13 + i] = nonceView.getUint32(i * 4, true);
        const x = new Uint32Array(state);
        function qr(a, b, c, d) {
          x[a] = (x[a] + x[b]) | 0; x[d] ^= x[a]; x[d] = (x[d] << 16) | (x[d] >>> 16);
          x[c] = (x[c] + x[d]) | 0; x[b] ^= x[c]; x[b] = (x[b] << 12) | (x[b] >>> 20);
          x[a] = (x[a] + x[b]) | 0; x[d] ^= x[a]; x[d] = (x[d] << 8) | (x[d] >>> 24);
          x[c] = (x[c] + x[d]) | 0; x[b] ^= x[c]; x[b] = (x[b] << 7) | (x[b] >>> 25);
        }
        for (let i = 0; i < 10; i++) {
          qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
          qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
        }
        const out = new Uint8Array(64), outView = new DataView(out.buffer);
        for (let i = 0; i < 16; i++) outView.setUint32(i * 4, (x[i] + state[i]) | 0, true);
        return out;
      }
      function chacha20Xor(key, counter, nonce, data) {
        const out = new Uint8Array(data.length), blockCount = Math.ceil(data.length / 64);
        for (let b = 0; b < blockCount; b++) {
          const ks = chacha20Block(key, counter + b, nonce);
          const start = b * 64, end = Math.min(data.length, start + 64);
          for (let i = start; i < end; i++) out[i] = data[i] ^ ks[i - start];
        }
        return out;
      }
      function poly1305(key32, msg) {
        const P = (1n << 130n) - 5n;
        const rBytes = key32.slice(0, 16);
        rBytes[3] &= 15; rBytes[7] &= 15; rBytes[11] &= 15; rBytes[15] &= 15;
        rBytes[4] &= 252; rBytes[8] &= 252; rBytes[12] &= 252;
        function toBI(b) { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v; }
        const r = toBI(rBytes), s = toBI(key32.slice(16, 32));
        let acc = 0n;
        for (let off = 0; off < msg.length; off += 16) {
          const c = msg.subarray(off, Math.min(msg.length, off + 16));
          const c1 = new Uint8Array(c.length + 1); c1.set(c); c1[c.length] = 1;
          acc = ((acc + toBI(c1)) * r) % P;
        }
        acc = (acc + s) % (1n << 128n);
        const tag = new Uint8Array(16);
        for (let i = 0; i < 16; i++) tag[i] = Number((acc >> BigInt(i * 8)) & 0xffn);
        return tag;
      }
      function pad16(b) { const r = b.length % 16; if (!r) return b; const o = new Uint8Array(b.length + 16 - r); o.set(b); return o; }
      function num64(n) { const b = new Uint8Array(8), v = new DataView(b.buffer); v.setUint32(0, n & 0xffffffff, true); v.setUint32(4, Math.floor(n / 0x100000000), true); return b; }
      return {
        decrypt(key, nonce, ciphertext, tag, aad = new Uint8Array(0)) {
          const otk = chacha20Block(key, 0, nonce).slice(0, 32);
          const macData = concat(pad16(aad), pad16(ciphertext), num64(aad.length), num64(ciphertext.length));
          const computed = poly1305(otk, macData);
          if (!equal(tag, computed)) throw new Error('ChaCha20-Poly1305 MAC tag mismatch');
          return chacha20Xor(key, 1, nonce, ciphertext);
        }
      };
    })();

    // CME3 Decryption
    const KDF_ITERATIONS = { 0: 600000, 1: 2100000, 2: 5000000, 3: 'argon2id', 4: 'argon2id', 5: 'argon2id' };
    const ARGON2_PROFILES = {
      3: { memorySize: 65536, iterations: 3, parallelism: 1 },
      4: { memorySize: 131072, iterations: 3, parallelism: 1 },
      5: { memorySize: 262144, iterations: 4, parallelism: 1 }
    };

    async function derivePasskeyPrf(salt32, credentialId) {
      if (!window.PublicKeyCredential || !navigator.credentials) {
        throw new Error('このブラウザ環境ではWebAuthnパスキーが利用できません。');
      }
      const rpId = location.hostname || 'localhost';
      const prfInput = await sha256(concat(enc.encode('CryptoMatrix-WebAuthn-PRF-v1:'), salt32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId,
          allowCredentials: [{ type: 'public-key', id: credentialId }],
          userVerification: 'required',
          timeout: 60000,
          extensions: { prf: { eval: { first: prfInput } } }
        }
      });
      const extRes = assertion?.getClientExtensionResults?.()?.prf;
      if (!extRes?.results?.first) throw new Error('パスキーからPRF拡張出力を取得できませんでした。作成時と同じドメインで開いているか確認してください。');
      return { extraFactor: await sha512(new Uint8Array(extRes.results.first)), credentialId };
    }

    async function deriveKeysCME3(password, salt, kdfProfile, extraFactor, hasPassword) {
      const iterations = KDF_ITERATIONS[kdfProfile];
      let keyMaterial;
      if (hasPassword) {
        const pwBytes = enc.encode(String(password ?? ''));
        if (!pwBytes.length) throw new Error('復元用パスワードを入力してください。');
        keyMaterial = extraFactor && extraFactor.length ? concat(pwBytes, new Uint8Array([0x00, 0xff, 0x43, 0x4d]), extraFactor) : pwBytes;
      } else {
        keyMaterial = concat(enc.encode('CM-NOPASS:'), extraFactor);
      }
      let masterBits;
      if (kdfProfile >= 3 && kdfProfile <= 5) {
        const cfg = ARGON2_PROFILES[kdfProfile];
        const argonSalt = concat(salt, enc.encode(':ARGON2ID:'));
        masterBits = await hashwasm.argon2id({
          password: keyMaterial,
          salt: argonSalt.subarray(0, 32),
          parallelism: cfg.parallelism,
          iterations: cfg.iterations,
          memorySize: cfg.memorySize,
          hashLength: 64,
          outputType: 'binary'
        });
      } else {
        const baseKey = await crypto.subtle.importKey('raw', keyMaterial, 'PBKDF2', false, ['deriveBits']);
        masterBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-512' }, baseKey, 512);
      }
      const hkdfKey = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveKey', 'deriveBits']);
      const infoSuffix = extraFactor && extraFactor.length ? concat(enc.encode(':2FA:'), await sha256(extraFactor)) : new Uint8Array(0);
      const aesKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-512', salt, info: concat(enc.encode('CryptoMatrix-CME3-AES256GCM-Key'), infoSuffix) }, hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const chachaKey = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-512', salt, info: concat(enc.encode('CryptoMatrix-CME3-ChaCha20Poly1305-Key'), infoSuffix) }, hkdfKey, 256));
      const hmacKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-512', salt, info: concat(enc.encode('CryptoMatrix-CME3-KeyCommit-HMAC'), infoSuffix) }, hkdfKey, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
      return { aesKey, chachaKey, hmacKey };
    }

    async function decryptBodyCME(cmeBody, password, twoFaOpts = null) {
      if (!cmeBody || cmeBody.length < 4 || cmeBody[0] !== 0x43 || cmeBody[1] !== 0x4d || cmeBody[2] !== 0x45) {
        throw new Error('未対応のCME暗号化フォーマットです。');
      }
      if (cmeBody.length > 7 && (cmeBody[4] & 0x80) !== 0) {
        const lenSlot1 = new DataView(cmeBody.buffer, cmeBody.byteOffset + 5, 2).getUint16(0, false);
        const slot1 = cmeBody.subarray(7, 7 + lenSlot1);
        const slot2 = cmeBody.subarray(7 + lenSlot1);
        const sharedOpts = Object.assign({}, twoFaOpts || {}, { __cmPasskeyCache: new Map() });
        let realRes, decoyRes;
        try { realRes = await decryptBodyCME(slot2, password, sharedOpts); } catch (_) {}
        try { decoyRes = await decryptBodyCME(slot1, password, sharedOpts); } catch (_) {}
        if (realRes) return { ...realRes, isDuress: false };
        if (decoyRes) return { ...decoyRes, isDuress: true };
        throw new Error('復元用パスワードが違うか、保護キー（キーファイル／パスキー）が一致しません。');
      }
      const version = cmeBody[3];
      if (version !== 3 && version !== 4) throw new Error(`未対応のCMEバージョン(v${version})です。`);
      const profileByte = cmeBody[4], profile = profileByte & 0x0f, combo = (profileByte >>> 4) & 0x0f;
      const needPass = (combo === 0 || combo === 1 || combo === 2 || combo === 3);
      const needKeyfile = (combo === 1 || combo === 3 || combo === 4 || combo === 6);
      const needPasskey = (combo === 2 || combo === 3 || combo === 5 || combo === 6);
      const salt = cmeBody.slice(5, 37), aesIv = cmeBody.slice(37, 49), chachaNonce = cmeBody.slice(49, 61);
      if (needPass && (!password || !String(password).length)) throw new Error('このカプセルには「復元用パスワード」が設定されています。パスワードを入力してください。');
      if (needKeyfile && (!twoFaOpts?.keyfileBytes || !twoFaOpts.keyfileBytes.length)) throw new Error('このカプセルには「キーファイル」が設定されています。同じキーファイルを選択してください。');
      let headerLen = 61, passkeyFactor = null;
      if (needPasskey) {
        const prfOffset = version === 4 ? 93 : 61;
        const credLen = new DataView(cmeBody.buffer, cmeBody.byteOffset + prfOffset, 2).getUint16(0, false);
        headerLen = prfOffset + 2 + credLen;
        const credId = cmeBody.slice(prfOffset + 2, headerLen);
        const prfSalt = version === 4 ? cmeBody.slice(61, 93) : salt;
        const cacheKey = Array.from(prfSalt).join(',') + '|' + Array.from(credId).join(',');
        let prf = twoFaOpts?.__cmPasskeyCache?.get(cacheKey);
        if (!prf) {
          prf = await derivePasskeyPrf(prfSalt, credId);
          twoFaOpts?.__cmPasskeyCache?.set(cacheKey, prf);
        }
        passkeyFactor = prf.extraFactor;
      }
      let extraFactor = null;
      if (needKeyfile && needPasskey) extraFactor = await sha512(concat(enc.encode('CM-KEYFILE-PASSKEY:'), await sha512(twoFaOpts.keyfileBytes), passkeyFactor));
      else if (needKeyfile) extraFactor = await sha512(twoFaOpts.keyfileBytes);
      else if (needPasskey) extraFactor = passkeyFactor;

      const header = cmeBody.slice(0, headerLen);
      const commitTag = cmeBody.slice(headerLen, headerLen + 16);
      const outerCiphertext = cmeBody.slice(headerLen + 16);
      const { aesKey, chachaKey, hmacKey } = await deriveKeysCME3(needPass ? password : '', salt, profile, extraFactor, needPass);
      const expectedCommit = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, concat(header, outerCiphertext))).slice(0, 16);
      if (!equal(expectedCommit, commitTag)) throw new Error('復元用パスワードまたはキーファイルが違うか、暗号化データが破損しています。');
      const aadAes = concat(enc.encode('CME3:AEAD:v3:'), header);
      const innerPayload = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: aesIv, additionalData: aadAes, tagLength: 128 }, aesKey, outerCiphertext));
      const chachaCiphertext = innerPayload.subarray(0, innerPayload.length - 16);
      const chachaTag = innerPayload.subarray(innerPayload.length - 16);
      const innerBody = ChaCha20Poly1305.decrypt(chachaKey, chachaNonce, chachaCiphertext, chachaTag, concat(enc.encode('CME3:CHACHA:v3:'), chachaNonce));
      return { innerBody };
    }

    // CMTL1 / CMTS / CMV1 / CMA1 Unpacking (exact match with timelock.js)
    // ドメイン分離子（Domain Separator）: CryptoMatrixのタイムロック名前空間を他アプリケーションから論理分離するための固定コンテキスト文字列（RFC 5869準拠）。
    // ※ 注意: これは公開ソースコードに含まれる固定文字列であり、「秘密鍵」ではありません。
    // 本機能の真の秘密保護エントロピーは、ユーザーが保持する物理「カード配列シード番号 (seed)」によって担保されます。
    const CM_APP_DOMAIN_PEPPER = 'CryptoMatrix:TimeLock:AppDomainSecret:v1:2026';

    async function deriveAppDomainKey(hdrHash, seedNum = '0') {
      const cleanSeed = (seedNum !== undefined && seedNum !== null) ? String(seedNum).trim() : '0';
      const seed = enc.encode(`${CM_APP_DOMAIN_PEPPER}:seed=${cleanSeed}:${bytesToHex(hdrHash)}`);
      const keyHash = await sha256(seed);
      return crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    async function unpackCMV1AppBound(bodyBytes, headerJsonBytes, seedNum = '0') {
      if (!(bodyBytes instanceof Uint8Array) || bodyBytes.length < 32) {
        throw new Error('内部ペイロード形式が不正です（サイズ不足）。');
      }
      if (bodyBytes[0] === 0x43 && bodyBytes[1] === 0x4d && bodyBytes[2] === 0x41 && bodyBytes[3] === 0x31) {
        const hdrHash = await sha256(headerJsonBytes);
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
      if (bodyBytes[0] === 0x43 && bodyBytes[1] === 0x4d && bodyBytes[2] === 0x56 && bodyBytes[3] === 0x31) {
        return unpackCMV1(bodyBytes);
      }
      throw new Error('内部ペイロードのヘッダマジック（CMA1 / CMV1）が一致しません。');
    }

    function unpackCMV1(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 52) throw new Error('内部ペイロード形式が不正です（サイズ不足）。');
      if (bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x56 || bytes[3] !== 0x31) throw new Error('内部ペイロードのCMV1ヘッダが一致しません。');
      const isFile = bytes[4] === 1;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const nameLen = dv.getUint16(46, false);
      const rawName = dec.decode(bytes.subarray(48, 48 + nameLen));
      const nulIdx = rawName.indexOf('\0');
      const name = nulIdx >= 0 ? rawName.slice(0, nulIdx) : rawName;
      const mimeType = nulIdx >= 0 ? rawName.slice(nulIdx + 1) : '';
      const pOffset = 48 + nameLen;
      const payloadLen = dv.getUint32(pOffset, false);
      if (bytes.length !== pOffset + 4 + payloadLen) throw new Error('内部ペイロードのデータ長が一致しません。');
      const payload = bytes.slice(pOffset + 4, pOffset + 4 + payloadLen);
      return {
        type: isFile ? 'file' : 'text',
        name,
        mime: mimeType,
        data: payload,
        text: isFile ? null : dec.decode(payload)
      };
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

    function unpackCMTL1(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x54 || bytes[3] !== 0x4c || bytes[4] !== 1) {
        throw new Error('CMTL1マジックヘッダが一致しません。');
      }
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const hdrLen = dv.getUint32(5, false);
      if (hdrLen < 2 || 9 + hdrLen >= bytes.length) throw new Error('CMTL1ヘッダー長が不正です。');
      const headerJsonBytes = bytes.slice(9, 9 + hdrLen);
      const meta = JSON.parse(decFatal.decode(headerJsonBytes));
      const ageBinary = bytes.slice(9 + hdrLen);
      const ageHdr = TLockBundle.parseTimelockAgeHeader(ageBinary);
      if (ageHdr.roundNumber !== meta.round) throw new Error('外装メタデータのラウンド番号と内部tlockスタンザのラウンド番号が一致しません。');
      return { kind: 'cmtl1', meta, headerJsonBytes, ageBinary };
    }

    function unpackCMTSShare(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x54 || bytes[3] !== 0x53 || bytes[4] !== 1) {
        throw new Error('CMTS秘密分散シェア形式ではありません。');
      }
      const m = bytes[5], n = bytes[6], index = bytes[7];
      const setIdHex = bytesToHex(bytes.subarray(8, 16));
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const hdrLen = dv.getUint32(16, false);
      const headerJsonBytes = bytes.slice(20, 20 + hdrLen);
      const meta = JSON.parse(decFatal.decode(headerJsonBytes));
      const data = bytes.slice(20 + hdrLen);
      return { kind: 'cmts', m, n, index, setIdHex, meta, headerJsonBytes, data };
    }

    function dearmorAll(str) {
      const regex = /-----BEGIN CRYPTOMATRIX TIMELOCK[^-]*-----([\s\S]*?)-----END CRYPTOMATRIX TIMELOCK[^-]*-----/gi;
      const items = [];
      let m;
      while ((m = regex.exec(str)) !== null) {
        const b64 = m[1].replace(/[\r\n\s]/g, '');
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        items.push(bytes);
      }
      return items;
    }

    let loadedRawItems = [];
    let countdownTimer = null;
    let lastDecrypted = null;

    function setStatus(msg, cls = '') {
      const el = $('rec-status');
      el.hidden = !msg;
      el.className = 'status' + (cls ? ' ' + cls : '');
      el.textContent = msg;
    }

    // 動的文字列を HTML として解釈させないための DOM 構築ヘルパー
    function textEl(tag, text) {
      const e = document.createElement(tag);
      e.textContent = text;
      return e;
    }

    function metaRow(label, value) {
      const d = document.createElement('div');
      d.appendChild(textEl('strong', label));
      d.appendChild(document.createTextNode(' ' + value));
      return d;
    }

    function buildRecoverGuide(kindLabel, tailText) {
      const d = document.createElement('div');
      d.style.cssText = 'margin-top:8px; padding:10px 12px; background:var(--ok-bg); border:1.5px solid var(--ok-border); border-radius:6px; color:var(--ok-text); font-size:0.84rem; line-height:1.55;';
      d.appendChild(textEl('strong', '🎉 タイムカプセルの開封に成功しました！'));
      d.appendChild(document.createElement('br'));
      d.appendChild(document.createTextNode('カプセルの中に封入されていたのは【'));
      d.appendChild(textEl('strong', kindLabel));
      d.appendChild(document.createTextNode('】です。'));
      d.appendChild(document.createElement('br'));
      d.appendChild(document.createTextNode(tailText));
      return d;
    }

    async function collectRawItems() {
      const items = [...loadedRawItems];
      const text = $('rec-text').value.trim();
      if (text) {
        const dearmored = dearmorAll(text);
        if (dearmored.length) items.push(...dearmored);
      }
      if (!items.length) throw new Error('カプセルファイルを選択するか、アーマード文字列を貼り付けてください。');
      if (items[0][0] === 0x43 && items[0][1] === 0x4d && items[0][2] === 0x54 && items[0][3] === 0x53) {
        const shares = items.map(unpackCMTSShare);
        const first = shares[0];
        const uniqueMap = new Map();
        for (const s of shares) {
          if (s.setIdHex !== first.setIdHex || s.m !== first.m || s.n !== first.n) {
            throw new Error('異なるカプセルから生成された秘密分散シェアが混在しています。');
          }
          if (!uniqueMap.has(s.index)) uniqueMap.set(s.index, s);
        }
        if (uniqueMap.size < first.m) {
          throw new Error(`秘密分散（${first.m}-of-${first.n}）の復元に必要なしきい値に達していません（現在 ${uniqueMap.size} / 必要 ${first.m} シェア）。`);
        }
        const selected = Array.from(uniqueMap.values()).slice(0, first.m);
        const combined = shamirCombine(selected.map(s => ({ index: s.index, data: s.data })));
        return unpackCMTL1(combined);
      }
      return unpackCMTL1(items[0]);
    }

    function renderMeta(parsed) {
      const h = parsed.meta;
      $('rec-meta-box').hidden = false;
      $('rec-beacon-url-hint').textContent = `https://api.drand.sh/${h.chainHash}/public/${h.round}`;
      const isPasskey = h.combo === 2 || h.combo === 3 || h.combo === 5 || h.combo === 6;
      $('rec-passkey-warn').hidden = !isPasskey;

      const unlockMs = h.unlockTimeMs;
      const updateTick = () => {
        const rem = unlockMs - Date.now();
        if (rem <= 0) {
          $('rec-countdown').textContent = '🟢 解禁時刻に到達しています（復号可能）';
          $('rec-countdown').style.color = 'var(--ok-text)';
        } else {
          const s = Math.ceil(rem / 1000);
          const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
          $('rec-countdown').textContent = `🔒 解禁まで残り: ${d > 0 ? d + '日 ' : ''}${hr}時間 ${m}分 ${sec}秒`;
          $('rec-countdown').style.color = 'var(--warn-text)';
        }
      };
      if (countdownTimer) clearInterval(countdownTimer);
      updateTick();
      countdownTimer = setInterval(updateTick, 1000);

      $('rec-meta-grid').replaceChildren(
        metaRow('保護タイプ:', h.mode === 'B' ? '🔐 パスワード付きタイムカプセル (追加保護あり)' : '🕰️ タイムカプセル (時間解禁のみ)'),
        metaRow('解禁予定日時:', new Date(unlockMs).toLocaleString('ja-JP')),
        metaRow('対象ラウンド:', 'Round #' + h.round),
        metaRow('ネットワーク:', h.net || 'quicknet'),
        metaRow('ペイロード種別:', h.payloadKind || 'text'),
        metaRow('作成日時:', h.createdAtMs ? new Date(h.createdAtMs).toLocaleString('ja-JP') : '-')
      );
    }

    $('rec-file').addEventListener('change', async (e) => {
      loadedRawItems = [];
      for (const f of Array.from(e.target.files || [])) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const txt = dec.decode(buf.subarray(0, Math.min(buf.length, 256)));
        if (txt.includes('-----BEGIN CRYPTOMATRIX TIMELOCK')) {
          loadedRawItems.push(...dearmorAll(dec.decode(buf)));
        } else {
          loadedRawItems.push(buf);
        }
      }
      try {
        const parsed = await collectRawItems();
        renderMeta(parsed);
        setStatus('✅ カプセルのヘッダを読み込みました。', 'ok');
      } catch (err) {
        setStatus('⚠️ ' + (err.message || err), 'warn');
      }
    });

    $('rec-btn-inspect').addEventListener('click', async () => {
      try {
        const parsed = await collectRawItems();
        renderMeta(parsed);
        setStatus('✅ カプセルのヘッダを読み込みました。', 'ok');
      } catch (err) {
        setStatus('❌ ' + (err.message || err), 'err');
      }
    });

    $('rec-btn-clear').addEventListener('click', () => {
      loadedRawItems = [];
      lastDecrypted = null;
      $('rec-file').value = '';
      $('rec-text').value = '';
      $('rec-password').value = '';
      $('rec-keyfile').value = '';
      $('rec-manual-beacon').value = '';
      $('rec-meta-box').hidden = true;
      $('rec-result-card').hidden = true;
      setStatus('');
    });

    document.querySelectorAll('input[name="rec-beacon-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        $('rec-manual-box').hidden = !$('rec-beacon-manual').checked;
      });
    });

    $('rec-btn-decrypt').addEventListener('click', async () => {
      try {
        setStatus('⏳ カプセルの検証と復号を実行しています...', 'warn');
        const parsed = await collectRawItems();
        renderMeta(parsed);
        const h = parsed.meta;
        const chainInfo = TLockBundle.QUICKNET_CHAIN_INFO;

        let beacon;
        if ($('rec-beacon-manual').checked) {
          const raw = $('rec-manual-beacon').value.trim();
          if (!raw) throw new Error('手動ビーコンJSONまたは署名hexを入力してください。');
          if (raw.startsWith('{')) {
            beacon = JSON.parse(raw);
          } else {
            const sig = raw.replace(/^0x/i, '');
            if (/^[0-9a-fA-F]{192}$/.test(sig)) {
              throw new Error('入力された署名は192文字（96バイト）です。quicknetは96文字の16進数（48バイト・G1圧縮点）の署名を入力してください。');
            }
            if (!/^[0-9a-fA-F]{96}$/.test(sig)) {
              throw new Error('ビーコン入力は JSON形式（{"round":...,"signature":"..."}）または 96文字の16進数署名（48バイト）で入力してください。');
            }
            beacon = { round: h.round, signature: sig };
          }
          const v = await TLockBundle.verifyBeaconDetailed(chainInfo, beacon, h.round);
          if (!v.valid) throw new Error('手動入力されたビーコンのBLS12-381署名検証に失敗しました: ' + v.reason);
        } else {
          const fetched = await TLockBundle.fetchVerifiedBeacon(h.round, chainInfo);
          beacon = fetched.beacon;
        }

        const tlLayer = await TLockBundle.decryptTimelockWithBeacon(
          parsed.ageBinary,
          beacon,
          chainInfo,
          h
        );

        let committedBytes = tlLayer;
        if (h.mode === 'B') {
          const pw = $('rec-password').value;
          const kfFile = $('rec-keyfile').files?.[0];
          const kfBytes = kfFile ? new Uint8Array(await kfFile.arrayBuffer()) : null;
          const cmeRes = await decryptBodyCME(tlLayer, pw, { keyfileBytes: kfBytes });
          committedBytes = cmeRes.innerBody;
        }

        if (committedBytes.length < 32 + 32) throw new Error('内部コミットメントデータが破損しています。');
        const storedHash = committedBytes.subarray(0, 32);
        const expectedHash = await sha256(parsed.headerJsonBytes);
        if (!equal(storedHash, expectedHash)) {
          throw new Error('外装メタデータと内部暗号ペイロードのコミットメントハッシュが一致しません（ヘッダー改ざん・差し替え検出）。');
        }
        const seedNum = $('rec-seed-number')?.value || '0';
        const payload = await unpackCMV1AppBound(committedBytes.subarray(32), parsed.headerJsonBytes, seedNum);
        lastDecrypted = payload;

        $('rec-result-card').hidden = false;
        const p = payload.data;
        const isCXB = p && p.length >= 4 && p[0] === 0x43 && p[1] === 0x58 && p[2] === 0x42;
        const isCME = p && p.length >= 4 && p[0] === 0x43 && p[1] === 0x4d && p[2] === 0x45;
        let guideEl = null;
        if (isCXB) {
          payload.text = formatAsArmored(p, 'BACKUP', '');
          guideEl = buildRecoverGuide('セクション3の暗号化バックアップ', '下のアーマードテキストをコピーし、メインアプリのセクション3（バックアップ）の復元欄に貼り付けて、バックアップ作成時のパスワードを入力すると元の全データが復元されます。');
        } else if (isCME) {
          payload.text = formatAsArmored(p, 'ENCRYPTED DATA', 'VAULT');
          guideEl = buildRecoverGuide('セクション4 セキュア保管庫の暗号化データ', '下のアーマードテキストをコピーし、メインアプリのセクション4（保管庫復号）に貼り付けて復号してください。');
        }

        const resultMetaLine = document.createElement('div');
        resultMetaLine.textContent = `種別: ${payload.type === 'file' && !isCXB && !isCME ? 'ファイル (' + payload.name + ')' : 'テキスト / 暗号化データ'} ／ サイズ: ${payload.data.length.toLocaleString()} bytes ／ 解禁に使用したビーコン番号: #${h.round}`;
        $('rec-result-meta').replaceChildren(resultMetaLine);
        if (guideEl) $('rec-result-meta').appendChild(guideEl);
        if (payload.type === 'file' && !isCXB && !isCME) {
          $('rec-result-text-wrap').hidden = true;
          $('rec-result-file-wrap').hidden = false;
        } else {
          $('rec-result-text-wrap').hidden = false;
          $('rec-result-file-wrap').hidden = true;
          $('rec-result-text').value = payload.text || '';
        }
        setStatus('✅ タイムカプセルの正当性を確認し、開封しました。', 'ok');
      } catch (err) {
        $('rec-result-card').hidden = true;
        setStatus('❌ 復号失敗: ' + (err.message || err), 'err');
      }
    });

    // クリップボード自動消去（単体動作のため本体の共通ヘルパーには依存しない。
    // 仕様は本体と同じ: 30秒後に内容を照合し、変わっていれば消去しない。
    // 照合できない場合は消去を試み、結果は必ず通知する）
    let recClipTimer = null, recClipGen = 0, recClipExpected = '';
    async function recSettleClipboard(gen) {
      if (gen !== recClipGen) return;
      const expected = recClipExpected;
      let current = null, readOk = false;
      try { current = await navigator.clipboard.readText(); readOk = true; } catch (_) {}
      if (gen !== recClipGen) return;
      if (readOk && current !== expected) {
        setStatus('🛡️ クリップボードの内容が変わっていたため、自動消去しませんでした。', 'ok');
        return;
      }
      try {
        await navigator.clipboard.writeText('');
        setStatus('🛡️ クリップボードの復号テキストを自動消去しました。', 'ok');
      } catch (_) {
        setStatus('⚠ クリップボードを自動消去できませんでした。', 'err');
      }
      if (gen === recClipGen) recClipTimer = null;
    }
    async function recCopyWithAutoClear(text) {
      await navigator.clipboard.writeText(text);
      recClipGen++; const gen = recClipGen; recClipExpected = String(text);
      if (recClipTimer) clearTimeout(recClipTimer);
      recClipTimer = setTimeout(() => { void recSettleClipboard(gen); }, 30000);
    }
    window.CMRecoverClipboardCopy = recCopyWithAutoClear;

    $('rec-btn-copy').addEventListener('click', async () => {
      if (!lastDecrypted?.text) return;
      await recCopyWithAutoClear(lastDecrypted.text);
      setStatus('📋 復号されたテキストをクリップボードにコピーしました（30秒後に自動消去）。', 'ok');
    });

    $('rec-btn-save-txt').addEventListener('click', () => {
      if (!lastDecrypted?.text) return;
      const blob = new Blob([lastDecrypted.text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = lastDecrypted.name || 'timelock-recovered.txt';
      a.click();
    });

    $('rec-btn-save-file').addEventListener('click', () => {
      if (!lastDecrypted?.data) return;
      const blob = new Blob([lastDecrypted.data], { type: lastDecrypted.mime || 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = lastDecrypted.name || 'timelock-recovered.bin';
      a.click();
    });
  })();
  