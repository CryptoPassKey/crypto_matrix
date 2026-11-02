'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = nodeCrypto.webcrypto;
}
if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
}
if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');
}
globalThis.window = globalThis;

require('./airgap-link-core.js');
require('./airgap-link-fountain.js');

async function main() {
  const legacy = globalThis.AirgapLinkCore.selfTest();
  assert.equal(legacy.crc32, 'CBF43926');
  assert.equal(legacy.p1OnlyRecovery, true);
  assert.equal(legacy.cursorDataBlock, 3);
  assert.equal(legacy.cursorParityBlocks, 8);
  assert.equal(legacy.cursorFinalGroupBlocks, 7);
  assert.equal(legacy.crcTamperRejected, true);

  const fountain = await globalThis.AirgapLinkFountain.selfTest();
  assert.equal(fountain.officialChooserVectors, 'PASS');
  assert.equal(fountain.sequence12, '9');
  assert.equal(fountain.sequence13, '2,5,6,8,9,10');
  assert.equal(fountain.outOfOrder, true);
  assert.equal(fountain.duplicate, true);
  assert.equal(fountain.crcTamperRejected, true);
  assert.equal(fountain.mixedTransferRejected, true);

  process.stdout.write(
    'PASS legacy CMAL1/P0/P1; PASS LT chooser vectors; PASS out-of-order fountain recovery; ' +
    'PASS duplicate/CRC/transfer isolation; PASS TX/RX block-cursor mapping\n'
  );
}

main().catch((error) => {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
