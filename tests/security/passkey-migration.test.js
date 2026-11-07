'use strict';
/*
 * PR-2 tests: legacy per-seed passkey entries migrate to the v2 map
 * (contents/passkey-store.js) without ever stranding an existing passkey.
 *
 * Covered design cases:
 *  1-A migration + reachability confirmed via the primary record -> legacy removed
 *  1-B migration + reachability NOT confirmed -> legacy kept
 *  2   write failure -> legacy kept, retry succeeds
 *  3   idempotent re-runs
 *  5   corrupted v2 data -> legacy fallback, corrupted data never overwritten
 *  10  two tabs storing different seeds concurrently -> both entries survive
 *  11  slow migration carrying a stale legacy value vs a newer store -> newer wins
 *  12  persistent write failure -> store reports false, legacy intact
 *  13  no Web Locks -> no migration, no writes, legacy reads keep working
 *
 * Run: node tests/security/passkey-migration.test.js  (exit 1 on failure)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log('  PASS', label); }
  else { failures++; console.log('  FAIL', label); }
}

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'contents', 'passkey-store.js'), 'utf8');

function makeLocalStorage() {
  const data = new Map();
  return {
    data,
    failWrites: false,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      if (this.failWrites) throw new Error('QuotaExceededError (stub)');
      data.set(k, String(v));
    },
    removeItem(k) { data.delete(k); },
  };
}

function makeLocks() {
  const chains = new Map();
  return {
    request(name, cb) {
      const prev = chains.get(name) || Promise.resolve();
      const run = prev.then(() => cb());
      chains.set(name, run.catch(() => {}));
      return run;
    },
  };
}

// One "tab": a fresh module instance over shared storage/navigator.
function makeTab(localStorage, navigator) {
  const sandbox = {
    window: {},
    localStorage,
    navigator,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'passkey-store.js' });
  return sandbox.window.CMPasskeyStore;
}

function readV2(localStorage) {
  const raw = localStorage.getItem('cm_passkey_cred_v2');
  return raw ? JSON.parse(raw) : null;
}

const deriveStub = async (seed) => 'id-' + seed;

(async () => {
  console.log('1-A: migration with reachability confirmed -> legacy removed');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_111', 'CRED-A');
    const tab = makeTab(ls, { locks: makeLocks() });
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => 'CRED-A' };
    const v = await tab.resolve('111', opts);
    ok(v === 'CRED-A', 'resolve returns the legacy credential');
    const v2 = readV2(ls);
    ok(v2 && v2.map['id-111'] === 'CRED-A', 'entry migrated into the v2 map');
    ok(ls.getItem('cm_passkey_cred_111') === null, 'legacy key removed');
    ok(tab.peek('111') === 'CRED-A', 'peek returns the migrated value');
  }

  console.log('1-B: migration without reachability confirmation -> legacy kept');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_111', 'CRED-A');
    const tab = makeTab(ls, { locks: makeLocks() });
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => 'OTHER' };
    const v = await tab.resolve('111', opts);
    ok(v === 'CRED-A', 'resolve returns the legacy credential');
    const v2 = readV2(ls);
    ok(v2 && v2.map['id-111'] === 'CRED-A', 'entry migrated into the v2 map');
    ok(ls.getItem('cm_passkey_cred_111') === 'CRED-A', 'legacy key kept');
  }

  console.log('2: write failure -> legacy kept, retry succeeds');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_222', 'CRED-B');
    const tab = makeTab(ls, { locks: makeLocks() });
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => null };
    ls.failWrites = true;
    const v1 = await tab.resolve('222', opts);
    ok(v1 === 'CRED-B', 'resolve still returns the legacy credential');
    ok(ls.getItem('cm_passkey_cred_222') === 'CRED-B', 'legacy key kept after failure');
    ok(readV2(ls) === null, 'nothing was written');
    ls.failWrites = false;
    const v2v = await tab.resolve('222', opts);
    ok(v2v === 'CRED-B', 'retry returns the credential');
    const v2 = readV2(ls);
    ok(v2 && v2.map['id-222'] === 'CRED-B', 'retry migrated the entry');
  }

  console.log('3: idempotent re-runs');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_333', 'CRED-C');
    const tab = makeTab(ls, { locks: makeLocks() });
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => null };
    await tab.resolve('333', opts);
    await tab.resolve('333', opts);
    ok(await tab.store('333', 'CRED-C', opts) === true, 're-store succeeds');
    const v2 = readV2(ls);
    ok(v2 && Object.keys(v2.map).length === 1 && v2.map['id-333'] === 'CRED-C',
      'single stable entry');
  }

  console.log('5: corrupted v2 data -> fallback, never overwritten');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_v2', 'not-json{');
    ls.setItem('cm_passkey_cred_444', 'CRED-D');
    const tab = makeTab(ls, { locks: makeLocks() });
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => 'CRED-D' };
    const v = await tab.resolve('444', opts);
    ok(v === 'CRED-D', 'resolve falls back to the legacy credential');
    ok(ls.getItem('cm_passkey_cred_v2') === 'not-json{',
      'corrupted v2 data is left untouched');
    ok((await tab.store('444', 'CRED-D', opts)) === false,
      'store refuses to overwrite corrupted data');
    ok(ls.getItem('cm_passkey_cred_444') === 'CRED-D', 'legacy key kept');
  }

  console.log('10: two tabs, different seeds, concurrent stores -> both survive');
  {
    const ls = makeLocalStorage();
    const nav = { locks: makeLocks() };
    const tabA = makeTab(ls, nav);
    const tabB = makeTab(ls, nav);
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => null };
    const [ra, rb] = await Promise.all([
      tabA.store('111', 'CRED-1', opts),
      tabB.store('222', 'CRED-2', opts),
    ]);
    ok(ra && rb, 'both stores succeeded');
    const v2 = readV2(ls);
    ok(v2 && v2.map['id-111'] === 'CRED-1' && v2.map['id-222'] === 'CRED-2',
      'both entries are present');
  }

  console.log('11: slow migration (stale legacy) vs newer store -> newer wins');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_555', 'CRED-OLD');
    const nav = { locks: makeLocks() };
    const tabA = makeTab(ls, nav);
    const tabB = makeTab(ls, nav);
    // Tab A reads the legacy value first; its migration write is held back
    // (second derivation is parked) until Tab B has stored the new credential.
    let deriveCalls = 0;
    let releaseSecond;
    const slowDerive = () => {
      deriveCalls++;
      if (deriveCalls === 2) {
        return new Promise((res) => { releaseSecond = () => res('id-555'); });
      }
      return Promise.resolve('id-555');
    };
    const optsA = { deriveIdentifier: slowDerive, getPrimaryCredB64: () => 'CRED-NEW' };
    const optsB = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => 'CRED-NEW' };
    const pendingA = tabA.resolve('555', optsA);
    // let Tab A reach the parked second derivation
    await new Promise((r) => setTimeout(r, 10));
    ok(deriveCalls === 2, 'tab A migration is in flight with the stale value');
    ok((await tabB.store('555', 'CRED-NEW', optsB)) === true,
      'tab B stored the new credential');
    releaseSecond();
    const resolvedA = await pendingA;
    ok(resolvedA === 'CRED-NEW',
      'tab A returns the newer credential, not its stale legacy value');
    const v2 = readV2(ls);
    ok(v2 && v2.map['id-555'] === 'CRED-NEW', 'map keeps the newer credential');
    ok(ls.getItem('cm_passkey_cred_555') === 'CRED-OLD',
      'legacy key kept (the old value itself was not confirmed reachable)');
    ok(tabA.peek('555') === 'CRED-NEW', 'tab A cache converged to the newer value');
  }

  console.log('12: persistent write failure -> store false, legacy intact');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_666', 'CRED-F');
    const tab = makeTab(ls, { locks: makeLocks() });
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => 'CRED-F' };
    ls.failWrites = true;
    ok((await tab.store('666', 'CRED-F', opts)) === false, 'store reports failure');
    ok(ls.getItem('cm_passkey_cred_666') === 'CRED-F', 'legacy key intact');
    ls.failWrites = false;
  }

  console.log('13: no Web Locks -> migration deferred, legacy reads keep working');
  {
    const ls = makeLocalStorage();
    ls.setItem('cm_passkey_cred_777', 'CRED-G');
    const tab = makeTab(ls, {}); // no locks
    const opts = { deriveIdentifier: deriveStub, getPrimaryCredB64: () => 'CRED-G' };
    const v = await tab.resolve('777', opts);
    ok(v === 'CRED-G', 'resolve returns the legacy credential');
    ok(readV2(ls) === null, 'no v2 map was written');
    ok(ls.getItem('cm_passkey_cred_777') === 'CRED-G', 'legacy key kept');
    ok((await tab.store('777', 'CRED-G', opts)) === false, 'store is deferred');
    ok(tab.peek('777') === 'CRED-G', 'peek still reads the legacy value');
  }

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
