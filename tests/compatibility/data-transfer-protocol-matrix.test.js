'use strict';
/** Data Transfer wire/protocol regression matrix. */
const assert = require('node:assert/strict');
require('../../contents/data-transfer-protocol.js');
(async () => {
  const core = globalThis.DataTransferCore;
  const fountain = globalThis.DataTransferFountain;
  const wire = globalThis.DataTransferWire;
  assert.ok(core && fountain && wire);
  const c = await core.selfTest();
  for (const k of ['crcTamperRejected','p1OnlyRecovery']) assert.equal(c[k], true, k);
  assert.ok(c.cursorDataBlock !== undefined);
  const f = await fountain.selfTest();
  for (const k of ['outOfOrder','duplicate','crcTamperRejected','mixedTransferRejected','gaussianFullRankRecovery','gaussianUnderdeterminedNoGuess']) assert.equal(f[k], true, k);
  const sample = Uint8Array.from([0,1,2,44,45,127,128,254,255]);
  assert.deepEqual(Array.from(wire.decodeBase45(wire.encodeBase45(sample))), Array.from(sample));
  assert.throws(() => wire.decodeBase45('A'), /文字数/);
  assert.throws(() => wire.decodeBase45('***'), /範囲外|未対応/);
  assert.throws(() => wire.splitFrame('NOTCMAL:1/1:01020304:00000000:AA'), /未対応/);
  assert.throws(() => wire.splitFrame('CMAL1:1/1'), /途中で切れ/);
  console.log('Data Transfer protocol matrix: ALL PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
