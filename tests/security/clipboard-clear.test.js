'use strict';
// Clipboard auto-clear unification tests.
// Semantics under test (both the main page helper and the standalone
// recovery tool implementation):
//   - read matches at clear time     -> clear, status 'cleared'
//   - read differs at clear time     -> do NOT clear, status 'protected'
//   - read fails, clear succeeds     -> status 'cleared-unverified'
//   - read fails, clear also fails   -> status 'failed'
//   - a newer copy supersedes        -> the old timer never acts
const path = require('path');
const fs = require('fs');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (_) {
  ({ JSDOM } = require(path.join(__dirname, 'node_modules', 'jsdom')));
}

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

// Controllable timers: page scripts register through these; the test
// fires 30000ms timeouts manually.
function makeTimers() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms, cleared: false }); return id; },
    clearTimeout(id) { const t = timers.get(id); if (t) t.cleared = true; },
    setInterval() { return ++seq; },
    clearInterval() {},
    fire30s() {
      for (const t of timers.values()) {
        if (!t.cleared && t.ms === 30000) { t.cleared = true; t.fn(); }
      }
    },
  };
}

function makeClipboard() {
  return {
    value: '',
    readMode: 'same', // same | different | reject
    failClear: false,
    writes: [],
    async writeText(t) {
      if (t === '' && this.failClear) throw new Error('denied');
      this.writes.push(t);
      this.value = t;
    },
    async readText() {
      if (this.readMode === 'reject') throw new Error('denied');
      if (this.readMode === 'different') return 'SOMETHING-ELSE';
      return this.value;
    },
  };
}

async function loadPage(file, clip, timers, store) {
  const dom = await JSDOM.fromFile(path.join(CONTENTS, file), {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; },
      }, configurable: true });
      Object.defineProperty(window.navigator, 'clipboard', { value: clip, configurable: true });
      window.setTimeout = timers.setTimeout;
      window.clearTimeout = timers.clearTimeout;
      window.setInterval = timers.setInterval;
      window.clearInterval = timers.clearInterval;
      window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
      if (window.HTMLCanvasElement) {
        window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
      }
    },
  });
  await new Promise((res) => {
    if (dom.window.document.readyState === 'complete') res();
    else dom.window.addEventListener('load', res);
    setTimeout(res, 9000);
  });
  await new Promise((r) => setTimeout(r, 400));
  return dom;
}

const tick = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  // ---- main page helper ----
  {
    const clip = makeClipboard();
    const timers = makeTimers();
    const dom = await loadPage('index.html', clip, timers, {});
    const api = dom.window.MatrixCardPreset;
    check('main: copyWithAutoClear is exposed', !!(api && api.copyWithAutoClear));

    // case 1: match -> cleared
    let status = null;
    clip.readMode = 'same'; clip.failClear = false;
    await api.copyWithAutoClear('SECRET-1', (s) => { status = s; });
    timers.fire30s(); await tick();
    check('main case1: cleared on match', status === 'cleared' && clip.value === '');

    // case 2: different -> protected
    status = null; clip.readMode = 'different';
    await api.copyWithAutoClear('SECRET-2', (s) => { status = s; });
    const before = clip.writes.length;
    timers.fire30s(); await tick();
    check('main case2: protected on mismatch', status === 'protected' && clip.writes.length === before && clip.value === 'SECRET-2');

    // case 3: read fails, clear succeeds -> cleared-unverified
    status = null; clip.readMode = 'reject'; clip.failClear = false;
    await api.copyWithAutoClear('SECRET-3', (s) => { status = s; });
    timers.fire30s(); await tick();
    check('main case3: cleared-unverified', status === 'cleared-unverified' && clip.value === '');

    // case 4: read fails, clear fails -> failed
    status = null; clip.failClear = true;
    await api.copyWithAutoClear('SECRET-4', (s) => { status = s; });
    timers.fire30s(); await tick();
    check('main case4: failed', status === 'failed' && clip.value === 'SECRET-4');
    clip.failClear = false;

    // case 5: newer copy supersedes; old timer must not act
    let statusA = null; let statusB = null;
    clip.readMode = 'same';
    await api.copyWithAutoClear('OLD', (s) => { statusA = s; });
    await api.copyWithAutoClear('NEW', (s) => { statusB = s; });
    const clearsBefore = clip.writes.filter((x) => x === '').length;
    timers.fire30s(); await tick();
    const clearsAfter = clip.writes.filter((x) => x === '').length;
    check('main case5: superseded timer does not act', statusA === null && statusB === 'cleared' && clearsAfter - clearsBefore === 1);
    dom.window.close();
  }

  // ---- recovery tool (standalone implementation) ----
  {
    const clip = makeClipboard();
    const timers = makeTimers();
    const dom = await loadPage('timelock-recover.html', clip, timers, {});
    const w = dom.window;
    check('recover: standalone copy fn is exposed', typeof w.CMRecoverClipboardCopy === 'function');
    const statusEl = () => w.document.getElementById('rec-status').textContent;

    clip.readMode = 'different';
    await w.CMRecoverClipboardCopy('PLAIN-TEXT');
    timers.fire30s(); await tick();
    check('recover: protected on mismatch', clip.value === 'PLAIN-TEXT' && statusEl().includes('消去しませんでした'));

    clip.readMode = 'same';
    await w.CMRecoverClipboardCopy('PLAIN-TEXT-2');
    timers.fire30s(); await tick();
    check('recover: cleared on match', clip.value === '' && statusEl().includes('自動消去しました'));
    dom.window.close();
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
