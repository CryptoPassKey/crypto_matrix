'use strict';
/*
 * PR-2 regression test: hasRecoveryContext() must not miss a credential that
 * exists only in the v2 map.
 *
 * Scenario (the case a synchronous cache peek would miss):
 *  - the v2 map holds a credential ID for the current seed
 *  - the legacy per-seed key does not exist
 *  - the primary record (cm_registered_passkey_v1) does not exist
 *  - the in-memory cache is cold (fresh page)
 *  - no other recovery inputs are present
 * Expected: the user is treated as an existing user (returns true), so the
 * flow does not fall through to automatic new-passkey registration.
 * Control: with the v2 entry removed, it returns false.
 *
 * Uses the real page via tests/compatibility/load-app.js (jsdom). The HMAC
 * derivation is stubbed to a known identifier because jsdom has no
 * IndexedDB; everything else (storage layout, resolve, the async
 * hasRecoveryContext) is the production code.
 *
 * Run: node tests/security/passkey-recovery-context.test.js
 */
const path = require('path');
const { loadApp } = require('../compatibility/load-app.js');

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log('  PASS', label); }
  else { failures++; console.log('  FAIL', label); }
}

(async () => {
  const win = await loadApp(path.join(__dirname, '..', '..', 'contents'));
  ok(!!(win.MatrixCardPreset && typeof win.MatrixCardPreset.hasRecoveryContext === 'function'),
    'hasRecoveryContext is callable via MatrixCardPreset');
  ok(typeof win.CMPasskeyStore === 'object' && win.CMPasskeyStore !== null,
    'CMPasskeyStore is loaded');

  // jsdom on a file:// origin has no usable localStorage; install a working
  // in-memory one. Page code resolves `localStorage` at call time, so this
  // takes effect for everything called from here on.
  const lsData = new Map();
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
      setItem: (k, v) => { lsData.set(k, String(v)); },
      removeItem: (k) => { lsData.delete(k); },
    },
  });

  const seedInput = win.document.getElementById('input-seed-number');
  const seed = ((seedInput && seedInput.value) || '0').trim() || '0';

  // Known identifier for the current seed (derivation stub; see header).
  win.CMSeedVault.derivePasskeyIdentifier = async (s) => 'id-' + String(s).trim();

  // Clean preconditions: no legacy key, no primary record, empty restore inputs.
  win.localStorage.removeItem('cm_passkey_cred_' + seed);
  win.localStorage.removeItem('cm_registered_passkey_v1');
  win.localStorage.removeItem('cm_passkey_cred_v2');
  ok(win.localStorage.getItem('cm_registered_passkey_v1') === null,
    'precondition: no primary record');

  console.log('v2-only credential -> treated as an existing user');
  win.localStorage.setItem('cm_passkey_cred_v2',
    JSON.stringify({ v: 2, map: { ['id-' + seed]: 'CRED-ONLY-V2' } }));
  const withV2 = await win.MatrixCardPreset.hasRecoveryContext();
  ok(withV2 === true, 'hasRecoveryContext() is true with only the v2 entry');

  console.log('control: nothing stored -> not a recovery context');
  win.localStorage.removeItem('cm_passkey_cred_v2');
  const without = await win.MatrixCardPreset.hasRecoveryContext();
  ok(without === false, 'hasRecoveryContext() is false with nothing stored');

  console.log('derivation unavailable + existing v2 entries -> fail safe');
  // HMAC 導出ができない（鍵の喪失・読み出し不能）状態を再現する。
  win.CMSeedVault.derivePasskeyIdentifier = async () => {
    throw new Error('HMAC device key unavailable (stub)');
  };
  win.localStorage.setItem('cm_passkey_cred_v2',
    JSON.stringify({ v: 2, map: { 'id-unresolvable': 'CRED-ORPHANED' } }));
  const orphaned = await win.MatrixCardPreset.hasRecoveryContext();
  ok(orphaned === true,
    'treated as an existing user when derivation fails but the v2 map has entries');

  console.log('control: derivation unavailable + empty map -> not suppressed');
  win.localStorage.removeItem('cm_passkey_cred_v2');
  const stillFalse = await win.MatrixCardPreset.hasRecoveryContext();
  ok(stillFalse === false,
    'hasRecoveryContext() stays false when derivation fails and no entries exist');

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
