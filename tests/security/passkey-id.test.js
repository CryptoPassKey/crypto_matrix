'use strict';
/*
 * PR-1 foundation tests: HMAC device key + passkey identifier derivation.
 *
 * Covers the PR-1 completion conditions:
 *  - the existing AES-GCM device key and other seed-vault records are untouched
 *  - the HMAC key is stored as a separate record
 *  - key generation is serialized with Web Locks; without Web Locks no new
 *    key is created (explicit error), while an existing key stays usable
 *  - stored key attributes are verified (algorithm, hash, usages, extractable)
 *  - derivation is deterministic and separated by rpId and by seed
 *  - derivation matches a manual HMAC over domain || 0x00 || rpId || 0x00 || seed
 *
 * Run: node tests/security/passkey-id.test.js  (exit code 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { IDBFactory } = require('fake-indexeddb');

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log('  PASS', label); }
  else { failures++; console.log('  FAIL', label); }
}

// ---- browser-like globals -------------------------------------------------
globalThis.indexedDB = new IDBFactory();
const lsData = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
  setItem: (k, v) => { lsData.set(k, String(v)); },
  removeItem: (k) => { lsData.delete(k); },
};
globalThis.window = globalThis;

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value, configurable: true, writable: true,
  });
}
setNavigator({}); // phase 0: no Web Locks

// ---- load the module under test -------------------------------------------
const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'contents', 'seed-vault.js'), 'utf8');
vm.runInThisContext(src, { filename: 'seed-vault.js' });
const vault = globalThis.CMSeedVault;
ok(!!vault, 'CMSeedVault is exposed');
ok(typeof vault.derivePasskeyIdentifier === 'function',
  'derivePasskeyIdentifier is exposed');

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cm-seed-vault', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('keys', 'readonly').objectStore('keys').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('keys', 'readwrite').objectStore('keys').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Web Locks stub: serialize callbacks per lock name.
const lockChains = new Map();
function installLocks() {
  setNavigator({
    locks: {
      request(name, cb) {
        const prev = lockChains.get(name) || Promise.resolve();
        const run = prev.then(() => cb());
        lockChains.set(name, run.catch(() => {}));
        return run;
      },
    },
  });
}

(async () => {
  await vault.loadSeed(); // let initial load settle (empty storage)

  console.log('phase 0: no Web Locks, no existing key -> explicit error, no key created');
  {
    let err = null;
    try { await vault.derivePasskeyIdentifier('12345', 'example.com'); }
    catch (e) { err = e; }
    ok(!!err && /Web Locks/.test(err.message), 'derive rejects without Web Locks');
    const db = await idbOpen();
    ok((await idbGet(db, 'device-hmac-key')) === undefined,
      'no HMAC key record was created');
    db.close();
  }

  console.log('phase 1: with Web Locks -> derivation properties');
  installLocks();
  const id1 = await vault.derivePasskeyIdentifier('12345', 'example.com');
  ok(/^[A-Za-z0-9_-]{43}$/.test(id1), 'identifier is 43-char base64url');
  const id1b = await vault.derivePasskeyIdentifier('12345', 'example.com');
  ok(id1 === id1b, 'deterministic for same seed and rpId');
  const idOtherRp = await vault.derivePasskeyIdentifier('12345', 'other.example');
  ok(idOtherRp !== id1, 'different rpId gives a different identifier');
  const idOtherSeed = await vault.derivePasskeyIdentifier('99999', 'example.com');
  ok(idOtherSeed !== id1, 'different seed gives a different identifier');
  const idTrim = await vault.derivePasskeyIdentifier(' 12345 ', 'example.com');
  ok(idTrim === id1, 'seed is trimmed before derivation');
  const many = await Promise.all(
    Array.from({ length: 5 }, () => vault.derivePasskeyIdentifier('777', 'example.com')));
  ok(many.every((x) => x === many[0]), 'concurrent derivations agree');

  console.log('phase 2: stored key attributes + manual HMAC cross-check');
  {
    const db = await idbOpen();
    const key = await idbGet(db, 'device-hmac-key');
    ok(!!key, 'HMAC key record exists');
    ok(key && key.type === 'secret' && key.extractable === false,
      'key is non-extractable');
    ok(key && key.algorithm && key.algorithm.name === 'HMAC' &&
       key.algorithm.hash && key.algorithm.hash.name === 'SHA-256',
      'key algorithm is HMAC with SHA-256');
    ok(key && Array.isArray(key.usages) && key.usages.length === 1 &&
       key.usages[0] === 'sign', 'key usages are exactly [sign]');

    const enc = new TextEncoder();
    const domain = enc.encode('CryptoMatrix-Passkey-Credential-v2');
    const rp = enc.encode('example.com');
    const sd = enc.encode('12345');
    const msg = new Uint8Array(domain.length + 1 + rp.length + 1 + sd.length);
    msg.set(domain, 0); msg[domain.length] = 0;
    msg.set(rp, domain.length + 1); msg[domain.length + 1 + rp.length] = 0;
    msg.set(sd, domain.length + 1 + rp.length + 1);
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    const manual = Buffer.from(new Uint8Array(sig)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    ok(manual === id1, 'matches manual HMAC over domain/rpId/seed');
    db.close();
  }

  console.log('phase 3: no Web Locks, existing key -> read-only use still works');
  setNavigator({});
  {
    const again = await vault.derivePasskeyIdentifier('12345', 'example.com');
    ok(again === id1, 'same identifier from the existing key without locks');
  }

  console.log('phase 4: other seed-vault records are untouched');
  {
    const db = await idbOpen();
    await idbPut(db, 'sentinel-keep', 'do-not-touch');
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idbPut(db, 'device-key', aesKey);
    db.close();
  }
  installLocks();
  await vault.derivePasskeyIdentifier('4242', 'example.com');
  {
    const db = await idbOpen();
    ok((await idbGet(db, 'sentinel-keep')) === 'do-not-touch',
      'unrelated record is unchanged');
    const aes = await idbGet(db, 'device-key');
    ok(!!aes && aes.algorithm && aes.algorithm.name === 'AES-GCM' &&
       aes.extractable === false,
      'existing AES-GCM device key record is intact');
    db.close();
  }

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
