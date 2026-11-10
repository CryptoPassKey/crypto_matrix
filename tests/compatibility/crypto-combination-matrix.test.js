'use strict';

/**
 * CryptoMatrix CME2/CME3 combination regression matrix.
 *
 * Production KDF, credential-combination derivation, HMAC commitment,
 * AES-GCM and ChaCha20-Poly1305 are exercised unchanged. WebAuthn PRF is
 * deterministic at the platform boundary; this does not claim authenticator
 * interoperability.
 */
const path = require('path');
const { loadApp } = require('../compatibility/load-app.js');
const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const PASSWORD = 'crypto-matrix-regression-password';
const WRONG_PASSWORD = 'crypto-matrix-regression-wrong-password';
const KEYFILE = new TextEncoder().encode('crypto-matrix-test-keyfile-v1');
const WRONG_KEYFILE = new TextEncoder().encode('crypto-matrix-test-keyfile-wrong');
const PRF_SALT = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 0xff);
const PRF_FACTOR = Uint8Array.from({ length: 64 }, (_, i) => (255 - i * 3) & 0xff);
const CREDENTIAL_ID = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 5) & 0xff);
const PLAIN = new TextEncoder().encode('CryptoMatrix regression payload :: UTF-8 / 日本語 / 0123456789');
let pass = 0, fail = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('PASS ' + name); }
  else { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.error('FAIL ' + name + (detail ? ': ' + detail : '')); }
}
function bytesEqual(a, b) {
  if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.byteLength !== b.byteLength) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0;
}
async function rejects(fn) { try { await fn(); return false; } catch (_) { return true; } }
function makeFactors(combo) {
  return {
    usePassword: [0, 1, 2, 3].includes(combo),
    useKeyfile: [1, 3, 4, 6].includes(combo),
    usePasskey: [2, 3, 5, 6].includes(combo),
    keyfileBytes: [1, 3, 4, 6].includes(combo) ? new Uint8Array(KEYFILE) : undefined,
    passkeyContext: [2, 3, 5, 6].includes(combo) ? {
      salt: new Uint8Array(PRF_SALT), extraFactor: new Uint8Array(PRF_FACTOR), credentialId: new Uint8Array(CREDENTIAL_ID)
    } : undefined
  };
}
function makeDecryptFactors(combo, overrides = {}) {
  const factors = {};
  if ([1, 3, 4, 6].includes(combo)) factors.keyfileBytes = new Uint8Array(KEYFILE);
  if ([2, 3, 5, 6].includes(combo)) {
    const key = Array.from(PRF_SALT).join(',') + '|' + Array.from(CREDENTIAL_ID).join(',');
    factors.__cmPasskeyCache = new Map([[key, { extraFactor: new Uint8Array(PRF_FACTOR), credentialId: new Uint8Array(CREDENTIAL_ID) }]]);
  }
  return Object.assign(factors, overrides);
}
(async () => {
  const win = await loadApp(CONTENTS);
  const M = win.MatrixCardPreset;
  check('MatrixCardPreset encryption API is available', !!M && typeof M.encryptBodyCME2 === 'function' && typeof M.decryptBodyCME2 === 'function');
  const combos = [
    { id: 0, name: 'password' }, { id: 1, name: 'password+keyfile' },
    { id: 2, name: 'password+passkey-PRF' }, { id: 3, name: 'password+keyfile+passkey-PRF' },
    { id: 4, name: 'keyfile-only' }, { id: 5, name: 'passkey-PRF-only' }, { id: 6, name: 'keyfile+passkey-PRF' }
  ];
  // Full combo matrix on PBKDF2 profiles and standard Argon2id.
  for (const profile of [0, 1, 2, 3]) {
    for (const combo of combos) {
      const f = makeFactors(combo.id), password = f.usePassword ? PASSWORD : '';
      const label = `CME3 profile=${profile} combo=${combo.id} (${combo.name})`;
      try {
        const encrypted = await M.encryptBodyCME2(new Uint8Array(PLAIN), password, profile, f);
        check(label + ' emits CME header', encrypted[0] === 0x43 && encrypted[1] === 0x4d && encrypted[2] === 0x45 && (encrypted[3] === 3 || encrypted[3] === 4));
        check(label + ' encodes KDF profile', (encrypted[4] & 0x0f) === profile);
        check(label + ' encodes credential combo', ((encrypted[4] >>> 4) & 0x0f) === combo.id);
        const decrypted = await M.decryptBodyCME2(encrypted, password, makeDecryptFactors(combo.id));
        check(label + ' roundtrip plaintext exact', bytesEqual(decrypted.innerBody, PLAIN));
        check(label + ' reports profile/combo', decrypted.kdfProfile === profile && decrypted.combo === combo.id);
        if ([0, 1, 2, 3].includes(combo.id)) check(label + ' reports password required', decrypted.needPass === true);
        if ([1, 3, 4, 6].includes(combo.id)) check(label + ' reports keyfile required', decrypted.needKeyfile === true);
        if ([2, 3, 5, 6].includes(combo.id)) check(label + ' reports passkey required', decrypted.needPasskey === true);
        if ([0, 1, 2, 3].includes(combo.id)) check(label + ' rejects wrong password', await rejects(() => M.decryptBodyCME2(encrypted, WRONG_PASSWORD, makeDecryptFactors(combo.id))));
        if ([1, 3, 4, 6].includes(combo.id)) {
          check(label + ' rejects missing keyfile', await rejects(() => M.decryptBodyCME2(encrypted, password, makeDecryptFactors(combo.id, { keyfileBytes: undefined }))));
          check(label + ' rejects wrong keyfile', await rejects(() => M.decryptBodyCME2(encrypted, password, makeDecryptFactors(combo.id, { keyfileBytes: new Uint8Array(WRONG_KEYFILE) }))));
        }
        if ([2, 3, 5, 6].includes(combo.id)) {
          check(label + ' rejects missing PRF context', await rejects(() => M.decryptBodyCME2(encrypted, password, {})));
          const key = Array.from(PRF_SALT).join(',') + '|' + Array.from(CREDENTIAL_ID).join(',');
          check(label + ' rejects wrong PRF factor', await rejects(() => M.decryptBodyCME2(encrypted, password, { __cmPasskeyCache: new Map([[key, { extraFactor: new Uint8Array(64).fill(0x42), credentialId: new Uint8Array(CREDENTIAL_ID) }]]) })));
        }
      } catch (error) { check(label + ' completes', false, error && error.stack || String(error)); }
    }
  }
  // Bounded representative coverage for memory-heavy Argon2id levels.
  for (const c of [{ profile: 4, combo: 0 }, { profile: 4, combo: 3 }, { profile: 4, combo: 4 }, { profile: 5, combo: 2 }, { profile: 5, combo: 6 }]) {
    const f = makeFactors(c.combo), password = f.usePassword ? PASSWORD : '', label = `CME3 high-cost profile=${c.profile} combo=${c.combo}`;
    try {
      const encrypted = await M.encryptBodyCME2(new Uint8Array(PLAIN), password, c.profile, f);
      const decrypted = await M.decryptBodyCME2(encrypted, password, makeDecryptFactors(c.combo));
      check(label + ' roundtrip exact', bytesEqual(decrypted.innerBody, PLAIN));
      check(label + ' profile/combo exact', decrypted.kdfProfile === c.profile && decrypted.combo === c.combo);
    } catch (error) { check(label + ' completes', false, error && error.stack || String(error)); }
  }
  check('CME3 rejects no credential factor', await rejects(() => M.encryptBodyCME2(new Uint8Array(PLAIN), '', 1, { usePassword: false, useKeyfile: false, usePasskey: false })));
  check('CME3 rejects short password', await rejects(() => M.encryptBodyCME2(new Uint8Array(PLAIN), 'short-pass', 1, { usePassword: true, useKeyfile: false, usePasskey: false })));
  check('CME3 rejects missing keyfile on encryption', await rejects(() => M.encryptBodyCME2(new Uint8Array(PLAIN), PASSWORD, 1, { usePassword: true, useKeyfile: true, usePasskey: false })));
  check('CME3 rejects unsupported KDF profile', await rejects(() => M.encryptBodyCME2(new Uint8Array(PLAIN), PASSWORD, 99, { usePassword: true })));
  try {
    const real = new TextEncoder().encode('REAL-SECRET-SLOT::synthetic fixture');
    const decoy = new TextEncoder().encode('DECOY-SLOT::harmless synthetic content');
    const dual = await M.encryptDuressDualCME(real, PASSWORD, decoy, WRONG_PASSWORD, 1, { usePassword: true, useKeyfile: false, usePasskey: false });
    const realResult = await M.decryptBodyCME2(dual, PASSWORD, {});
    const decoyResult = await M.decryptBodyCME2(dual, WRONG_PASSWORD, {});
    check('Duress container recovers real slot', realResult.isDuress === false && bytesEqual(realResult.innerBody, real));
    check('Duress container recovers decoy slot', decoyResult.isDuress === true && bytesEqual(decoyResult.innerBody, decoy));
    check('Duress container rejects unrelated password', await rejects(() => M.decryptBodyCME2(dual, 'unrelated-wrong-password', {})));
  } catch (error) { check('Duress dual roundtrip completes', false, error && error.stack || String(error)); }
  // Seed-bound app encryption: domain and seed are part of the recovery contract.
  try {
    const bound = await M.packAppBound('Backup', new Uint8Array(PLAIN), '314159');
    const restored = await M.unpackAppBound('Backup', bound, '314159');
    check('CMA1 app-bound backup roundtrip exact', bytesEqual(restored, PLAIN));
    check('CMA1 rejects a different card-array seed', await rejects(() => M.unpackAppBound('Backup', bound, '271828')));
    check('CMA1 rejects a different application domain', await rejects(() => M.unpackAppBound('Vault', bound, '314159')));
    const changed = new Uint8Array(bound); changed[changed.length - 1] ^= 0x80;
    check('CMA1 rejects ciphertext tampering', await rejects(() => M.unpackAppBound('Backup', changed, '314159')));
  } catch (error) { check('CMA1 app-bound tests complete', false, error && error.stack || String(error)); }

  // CMS3 Shamir threshold combinations: every M-sized subset must restore.
  const shamirSecret = Uint8Array.from({ length: 64 }, (_, i) => (i * 19 + 37) & 0xff);
  function combinations(items, choose) {
    const out = [];
    function visit(start, picked) {
      if (picked.length === choose) { out.push(picked.slice()); return; }
      for (let i = start; i < items.length; i++) { picked.push(items[i]); visit(i + 1, picked); picked.pop(); }
    }
    visit(0, []); return out;
  }
  for (const [m, n] of [[2, 3], [3, 5], [4, 7]]) {
    const raw = M.shamirSplit(new Uint8Array(shamirSecret), m, n);
    const indices = Array.from({ length: n }, (_, i) => i + 1);
    const subsets = combinations(indices, m);
    let subsetFailures = 0;
    for (const subset of subsets) {
      const selected = subset.map(index => ({ index, data: raw[index - 1], m, n, setId: 'fixture-set-A' }));
      try { if (!bytesEqual(M.shamirCombine(selected), shamirSecret)) subsetFailures++; }
      catch (_) { subsetFailures++; }
    }
    check(`CMS3 ${m}-of-${n} restores every threshold subset (${subsets.length})`, subsetFailures === 0, `${subsetFailures} subset(s) failed`);
    const insufficient = indices.slice(0, m - 1).map(index => ({ index, data: raw[index - 1], m, n, setId: 'fixture-set-A' }));
    check(`CMS3 ${m}-of-${n} rejects fewer than threshold`, await rejects(() => M.shamirCombine(insufficient)));
    const duplicate = [
      { index: 1, data: raw[0], m, n, setId: 'fixture-set-A' },
      { index: 1, data: raw[0], m, n, setId: 'fixture-set-A' }
    ];
    check(`CMS3 ${m}-of-${n} rejects duplicate share indices`, await rejects(() => M.shamirCombine(duplicate)));
    const mixed = [
      { index: 1, data: raw[0], m, n, setId: 'fixture-set-A' },
      { index: 2, data: raw[1], m, n, setId: 'fixture-set-B' },
      ...indices.slice(2, m).map(index => ({ index, data: raw[index - 1], m, n, setId: 'fixture-set-A' }))
    ];
    check(`CMS3 ${m}-of-${n} rejects mixed set identifiers`, await rejects(() => M.shamirCombine(mixed)));
  }

  console.log(`crypto-combination-matrix: ${pass} passed, ${fail} failed`);
  if (failures.length) console.error(failures.join('\n'));
  process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error('crypto-combination-matrix fatal:', error && error.stack || error); process.exitCode = 1; });
