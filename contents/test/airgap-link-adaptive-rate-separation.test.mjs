import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync(new URL('./airgap-link-ui-v17.js', import.meta.url), 'utf8');

assert.match(js, /var txAutoRateController\s*=/, 'TX-local controller must exist');
assert.match(js, /var rxRateAdvisor\s*=/, 'RX-side advisor must exist');
assert.match(js, /txAutoRateController\.recordRender\(elapsed\)/, 'TX controller must consume local render timing');

const txLoopStart = js.indexOf('function txAnimationLoop(');
const txLoopEnd = js.indexOf('function playTx(', txLoopStart);
assert(txLoopStart >= 0 && txLoopEnd > txLoopStart, 'TX animation loop must be present');
const txLoop = js.slice(txLoopStart, txLoopEnd);
assert.match(txLoop, /var effectiveFps = txAutoRateController\.enabled \? txAutoRateController\.currentFps : Number\(valueOf\('fps', '10'\)\)/,
  'TX animation loop must use only the TX-local controller or the manual FPS value');
assert.doesNotMatch(txLoop, /rxRateAdvisor/, 'TX loop must not depend on RX-side measurements or recommendations');
assert.doesNotMatch(js, /rxRateAdvisor[\s\S]{0,1200}\$\('fps'\)\.value\s*=/,
  'RX advisor must not write the TX FPS input');

console.log('PASS: TX/RX adaptive-rate separation');
