/**
 * Main app TimeLock: beacon acquisition info in the manual beacon box.
 *
 * Verifies that after a capsule is loaded in the Time Capsule restore
 * panel, the manual beacon box shows the acquisition URL (primary +
 * fallback links), its QR code and a copy button, built from verified
 * values (known Quicknet chain hash + AGE-header round). Tampered chain
 * metadata must not produce a URL.
 *
 * Run: node tests/security/tl-beacon-url.test.js
 */
'use strict';

const path = require('path');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.error('jsdom is required: npm --prefix tests ci');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..', '..');
const CONTENTS = path.join(ROOT, 'contents');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAPSULE_A = "-----BEGIN CRYPTOMATRIX TIMELOCK-----\nQ01UTAEAAAFAeyJ2IjoxLCJtb2RlIjoiQSIsIm5ldCI6InF1aWNrbmV0IiwiY2hh\naW5IYXNoIjoiNTJkYjliYTcwZTBjYzBmNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3Nzcz\nNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3MSIsInJvdW5kIjozMzc0NTAwMSwidGFy\nZ2V0VGltZU1zIjoxNzk0MDM4MzY3MDAwLCJ1bmxvY2tUaW1lTXMiOjE3OTQwMzgz\nNjcwMDAsImNyZWF0ZWRBdE1zIjoxNzk0MDQ1NTY4MDc2LCJpbm5lclR5cGUiOiJj\nbWExIiwia2RmUHJvZmlsZSI6bnVsbCwiY29tYm8iOm51bGwsImhhc0R1cmVzcyI6\nZmFsc2UsInBheWxvYWRLaW5kIjoidGV4dCIsInNoYW1pciI6bnVsbH1hZ2UtZW5j\ncnlwdGlvbi5vcmcvdjEKLT4gdGxvY2sgMzM3NDUwMDEgNTJkYjliYTcwZTBjYzBm\nNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3NzczNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3\nMQpndjU0czZvVjdReG1QR3VaZzNLNW1BWVNnMXVFKzNEQWc5T1FZTWdMcnFYelNH\ncVRqRnRhTE02M3YzVmlFRVNXCkZVVThBY0xKTzFuL1FJTlIrU0ZFRkVteXFyVE1k\nMkJscXREVm5sdkJoVng0UURGZ3VmbXdwbUFJekNiRk9SRDEKZll6VERVdmlIeEZ4\nYXpBN1lRUU91QUR0aUsxMjBGZVVSUHk3Y3R1RzIxYwotLS0gZ3ZKdmgwU1R6V2xh\nbnRwVHFzU3Q5enBydWtXUEMxZ2ZMdUVFWXJJWGtKOApQBJY4gPpC9AGe3x8Y71hp\nv8EL6I/vUf0lY30/OPYMikScAfBm53VrnEcA9mYOh/VmZMNcNHX+QYsc+SW6WwiS\n8FOTnWag0B3n/Y2kOIyap8c2TxYvlrf+EeqdNo0HfFoGsTJAieEry9ekDzqwgyFH\nJlYX8Amc/mJVu0vc9sG0NUy6o1hMaZ4l93MT5uH8kfkUpFHVZ82uK6K7pfHhjE6B\nrItxfcvU5ze4f1pTFUIEhzR46y9/+Eoc3Er8oK4JfZVVjhVHLXxTIwDFYgQB3CbD\ng0scl7hUyTj4lDTKDGrTUxM5tU+ufFBmVcBabisaxH4VwwUwp1Kc7+pu00w=\n-----END CRYPTOMATRIX TIMELOCK-----";
const CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const ROUND = 33745001;
const URL1 = 'https://api.drand.sh/' + CHAIN_HASH + '/public/' + ROUND;
const URL2 = 'https://drand.cloudflare.com/' + CHAIN_HASH + '/public/' + ROUND;

function capsuleWithHeader(patch) {
  const lines = CAPSULE_A.split('\n').filter((l) => l && !l.startsWith('-----'));
  const bytes = Buffer.from(lines.join(''), 'base64');
  const hdrLen = bytes.readUInt32BE(5);
  const meta = JSON.parse(bytes.subarray(9, 9 + hdrLen).toString('utf8'));
  patch(meta);
  const hj = Buffer.from(JSON.stringify(meta), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(hj.length, 0);
  const out = Buffer.concat([bytes.subarray(0, 5), lenBuf, hj, bytes.subarray(9 + hdrLen)]);
  const b64 = out.toString('base64').replace(/.{1,64}/g, '$&\n').trim();
  return '-----BEGIN CRYPTOMATRIX TIMELOCK-----\n' + b64 + '\n-----END CRYPTOMATRIX TIMELOCK-----';
}

async function main() {
  const { webcrypto } = require('crypto');
  const virtualConsole = new VirtualConsole();
  const dom = await JSDOM.fromFile(path.join(CONTENTS, 'index.html'), {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      const store = new Map();
      const ls = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null
      };
      Object.defineProperty(ls, 'length', { get: () => store.size });
      Object.defineProperty(window, 'localStorage', {
        value: new Proxy(ls, {
          ownKeys: () => [...store.keys()],
          getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
        }),
        configurable: true
      });
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => ({})), set: () => true });
      if (!window.crypto?.subtle) Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
      window.scrollTo = () => {};
    }
  });
  const win = dom.window;
  await new Promise((r) => {
    if (win.document.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  await sleep(600);
  const $ = (id) => win.document.getElementById(id);
  const paste = (text) => {
    $('tl-restore-text').value = text;
    $('tl-restore-text').dispatchEvent(new win.Event('input', { bubbles: true }));
  };

  console.log('[tl-beacon-url] initial state');
  check('beacon URL box exists and starts hidden', !!$('tl-beacon-url-box') && $('tl-beacon-url-box').hidden === true);
  check('copy button exists', !!$('tl-btn-copy-beacon-url'));

  console.log('[tl-beacon-url] capsule A loaded + manual mode');
  paste(CAPSULE_A);
  await sleep(300);
  $('tl-beacon-mode-manual').click();
  await sleep(200);
  check('manual beacon box is shown', $('tl-manual-beacon-box').hidden === false);
  check('beacon URL box is shown', $('tl-beacon-url-box').hidden === false);
  check('round label uses the capsule round', ($('tl-beacon-round').textContent || '').includes('#' + ROUND));
  const a1 = $('tl-beacon-url-link');
  check('primary URL link points at the capsule round on api.drand.sh', a1.getAttribute('href') === URL1 && a1.textContent === URL1);
  const a2 = $('tl-beacon-url-link2');
  check('fallback URL link points at drand.cloudflare.com', a2.getAttribute('href') === URL2 && a2.textContent === URL2);
  check('QR figure with SVG is rendered', !!$('tl-beacon-qr').querySelector('figure svg') || !!$('tl-beacon-qr').querySelector('svg'));

  console.log('[tl-beacon-url] tampered chain hash produces no URL');
  paste(capsuleWithHeader((m) => { m.chainHash = '00'.repeat(32); }));
  await sleep(300);
  check('beacon URL box is hidden for a foreign chain hash', $('tl-beacon-url-box').hidden === true);
  check('link target is reset', a1.getAttribute('href') === '#');

  console.log('[tl-beacon-url] clearing the capsule hides the box');
  paste(CAPSULE_A);
  await sleep(300);
  check('box shown again for the valid capsule', $('tl-beacon-url-box').hidden === false);
  paste('');
  await sleep(200);
  check('box hidden after clearing input', $('tl-beacon-url-box').hidden === true);

  console.log(`\ntl-beacon-url: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
