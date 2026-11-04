import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync(new URL('./airgap-link-ui-v17.js', import.meta.url), 'utf8');

assert.match(js, /var txAutoRateController\s*=/, 'TX-local controller must exist');
assert.match(js, /var rxRateAdvisor\s*=/, 'RX advisor must exist');
assert.match(js, /txAutoRateController\.recordRender\(elapsed\)/, 'TX controller must consume local render timing');
assert.match(js, /var effectiveFps = txAutoRateController\.enabled \? txAutoRateController\.currentFps : Number\(\$\('fps'\)\.value\)/,
  'TX animation loop must use only local TX controller or manual FPS');
assert.doesNotMatch(js, /rxRateAdvisor\.currentFps\s*\)/, 'TX loop must not use RX recommendation');
assert.doesNotMatch(js, /rxRateAdvisor[\s\S]{0,1200}\$\('fps'\)\.value\s*=/,
  'RX advisor must not write TX FPS input');
assert.match(js, /RX advisor is display-only/, 'RX advisor must be explicitly display-only');
console.log('PASS: TX/RX adaptive-rate separation');
