/**
 * Recover tool beacon acquisition info — regression tests.
 *
 * Verifies that after inspecting a capsule, the recovery tool's meta box
 * shows a beacon acquisition block built from the capsule's own round and
 * chain hash: round label, clickable primary URL, fallback URL, a QR code
 * (SVG) encoding the primary URL, and a copy button. The beacon JSON itself
 * is never embedded; only the public fetch URL.
 *
 * Run: node tests/security/recover-beacon-info.test.js
 */
'use strict';

const fs = require('fs');
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
async function waitFor(fn, label, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout: ' + label);
    await sleep(100);
  }
}

// A2 verification-kit capsule A (time-only, Round #33745001).
const CAPSULE_A = "-----BEGIN CRYPTOMATRIX TIMELOCK-----\nQ01UTAEAAAFAeyJ2IjoxLCJtb2RlIjoiQSIsIm5ldCI6InF1aWNrbmV0IiwiY2hh\naW5IYXNoIjoiNTJkYjliYTcwZTBjYzBmNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3Nzcz\nNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3MSIsInJvdW5kIjozMzc0NTAwMSwidGFy\nZ2V0VGltZU1zIjoxNzk0MDM4MzY3MDAwLCJ1bmxvY2tUaW1lTXMiOjE3OTQwMzgz\nNjcwMDAsImNyZWF0ZWRBdE1zIjoxNzk0MDQ1NTY4MDc2LCJpbm5lclR5cGUiOiJj\nbWExIiwia2RmUHJvZmlsZSI6bnVsbCwiY29tYm8iOm51bGwsImhhc0R1cmVzcyI6\nZmFsc2UsInBheWxvYWRLaW5kIjoidGV4dCIsInNoYW1pciI6bnVsbH1hZ2UtZW5j\ncnlwdGlvbi5vcmcvdjEKLT4gdGxvY2sgMzM3NDUwMDEgNTJkYjliYTcwZTBjYzBm\nNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3NzczNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3\nMQpndjU0czZvVjdReG1QR3VaZzNLNW1BWVNnMXVFKzNEQWc5T1FZTWdMcnFYelNH\ncVRqRnRhTE02M3YzVmlFRVNXCkZVVThBY0xKTzFuL1FJTlIrU0ZFRkVteXFyVE1k\nMkJscXREVm5sdkJoVng0UURGZ3VmbXdwbUFJekNiRk9SRDEKZll6VERVdmlIeEZ4\nYXpBN1lRUU91QUR0aUsxMjBGZVVSUHk3Y3R1RzIxYwotLS0gZ3ZKdmgwU1R6V2xh\nbnRwVHFzU3Q5enBydWtXUEMxZ2ZMdUVFWXJJWGtKOApQBJY4gPpC9AGe3x8Y71hp\nv8EL6I/vUf0lY30/OPYMikScAfBm53VrnEcA9mYOh/VmZMNcNHX+QYsc+SW6WwiS\n8FOTnWag0B3n/Y2kOIyap8c2TxYvlrf+EeqdNo0HfFoGsTJAieEry9ekDzqwgyFH\nJlYX8Amc/mJVu0vc9sG0NUy6o1hMaZ4l93MT5uH8kfkUpFHVZ82uK6K7pfHhjE6B\nrItxfcvU5ze4f1pTFUIEhzR46y9/+Eoc3Er8oK4JfZVVjhVHLXxTIwDFYgQB3CbD\ng0scl7hUyTj4lDTKDGrTUxM5tU+ufFBmVcBabisaxH4VwwUwp1Kc7+pu00w=\n-----END CRYPTOMATRIX TIMELOCK-----";
const CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const ROUND = 33745001;
const URL1 = 'https://api.drand.sh/' + CHAIN_HASH + '/public/' + ROUND;
const URL2 = 'https://drand.cloudflare.com/' + CHAIN_HASH + '/public/' + ROUND;

async function main() {
  const { webcrypto } = require('crypto');
  const virtualConsole = new VirtualConsole();
  const dom = await JSDOM.fromFile(path.join(CONTENTS, 'timelock-recover.html'), {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
      window.scrollTo = () => {};
      if (window.Element) window.Element.prototype.scrollIntoView = () => {};
    }
  });
  const win = dom.window;
  await new Promise((r) => {
    if (win.document.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  await sleep(1200);
  const $ = (id) => win.document.getElementById(id);

  console.log('[recover-beacon-info] initial state');
  check('beacon box exists and starts hidden', !!$('rec-beacon-box') && $('rec-beacon-box').hidden === true);
  check('copy button exists', !!$('rec-btn-copy-beacon-url'));

  console.log('[recover-beacon-info] after inspecting capsule A');
  $('rec-text').value = CAPSULE_A;
  $('rec-btn-inspect').click();
  await waitFor(() => !$('rec-meta-box').hidden, 'meta box visible');
  await sleep(200);

  check('beacon box is shown', $('rec-beacon-box').hidden === false);
  check('round label uses the capsule round', ($('rec-beacon-round').textContent || '').includes('#' + ROUND));
  const link = $('rec-beacon-url-link');
  check('primary URL is a clickable link to api.drand.sh for the capsule round',
    link.getAttribute('href') === URL1 && link.textContent === URL1 && link.target === '_blank');
  const link2 = $('rec-beacon-url-link2');
  check('fallback URL points to drand.cloudflare.com for the same round',
    link2.getAttribute('href') === URL2 && link2.textContent === URL2);
  check('URL is built from the capsule chain hash (not hardcoded latest)',
    URL1.includes(CHAIN_HASH) && link.getAttribute('href').includes(CHAIN_HASH));
  const svg = $('rec-beacon-qr').querySelector('svg');
  check('QR code (SVG) is rendered', !!svg);
  check('QR code has module paths', !!svg && (svg.querySelector('path')?.getAttribute('d') || '').length > 100);
  check('manual-box URL hint is updated to the same URL',
    ($('rec-beacon-url-hint').textContent || '') === URL1);


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

async function expectBeaconRejected(label, capsuleText, badFragment) {
  $('rec-btn-clear').click();
  await sleep(200);
  $('rec-text').value = capsuleText;
  $('rec-btn-inspect').click();
  const status = await waitFor(() => {
    const t = $('rec-status').textContent || '';
    return t.includes('❌') ? t : null;
  }, label + ' のエラー表示');
  check(label + ': 解析エラーとして拒否される', status.includes('ビーコン情報'));
  check(label + ': ビーコン取得ブロックは表示されない', $('rec-beacon-box').hidden === true);
  check(label + ': 不正な値でURLが生成されない',
    !($('rec-beacon-url-link').getAttribute('href') || '').includes(badFragment) &&
    !($('rec-beacon-url-hint').textContent || '').includes(badFragment));
}

  console.log('[recover-beacon-info] invalid beacon metadata is rejected');
  await expectBeaconRejected('chainHash が16進数でない場合', capsuleWithHeader((m) => { m.chainHash = 'z'.repeat(64); }), 'zzzz');
  await expectBeaconRejected('chainHash が短すぎる場合', capsuleWithHeader((m) => { m.chainHash = 'abcd'; }), 'abcd');

  console.log('[recover-beacon-info] clear resets the meta box');
  $('rec-btn-clear').click();
  await sleep(200);
  check('meta box (incl. beacon block) is hidden after clear', $('rec-meta-box').hidden === true);

  console.log(`\nrecover-beacon-info: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
