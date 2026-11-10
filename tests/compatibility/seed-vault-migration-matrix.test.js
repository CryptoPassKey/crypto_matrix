'use strict';
/** Seed Vault storage/migration regression matrix. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const source = fs.readFileSync(path.join(__dirname, '../../contents/seed-vault.js'), 'utf8');
function makeWindow(storage, idb) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://cryptomatrix.test/', runScripts: 'outside-only',
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: {
        getItem: k => storage.has(k) ? storage.get(k) : null,
        setItem: (k,v) => storage.set(k,String(v)), removeItem: k => storage.delete(k)
      }});
      window.indexedDB = idb;
      Object.defineProperty(window, 'crypto', { configurable: true, value: require('node:crypto').webcrypto });
    }
  });
  dom.window.eval(source);
  return dom;
}
(async () => {
  const storage = new Map([['cm_active_seed','seed-legacy-123456']]);
  const first = makeWindow(storage, new IDBFactory());
  const vault = first.window.CMSeedVault;
  assert.ok(vault);
  assert.equal(await vault.loadSeed(), 'seed-legacy-123456');
  assert.equal(storage.has('cm_active_seed'), false);
  const initial = JSON.parse(storage.get('cm_active_seed_wrapped'));
  assert.equal(initial.v, 1); assert.ok(initial.iv && initial.ct);
  assert.equal(storage.get('cm_active_seed_wrapped').includes('seed-legacy-123456'), false);
  vault.markRestored();
  await vault.saveSeed('seed-updated-987654');
  assert.equal(await vault.loadSeed(), 'seed-legacy-123456');
  assert.equal(vault.getCurrentSeed(), 'seed-updated-987654');
  assert.notEqual(JSON.parse(storage.get('cm_active_seed_wrapped')).ct, initial.ct);
  const lostKeyProfile = makeWindow(storage, new IDBFactory());
  assert.equal(await lostKeyProfile.window.CMSeedVault.loadSeed(), null);
  assert.equal(lostKeyProfile.window.CMSeedVault.status().unwrapFailed, true);
  assert.equal(storage.has('cm_active_seed_wrapped'), true);
  assert.equal(storage.has('cm_active_seed'), false);
  first.window.close(); lostKeyProfile.window.close();
  console.log('Seed Vault migration matrix: ALL PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
