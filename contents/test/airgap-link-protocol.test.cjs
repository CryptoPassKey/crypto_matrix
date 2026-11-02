'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const page = fs.readFileSync('contents/test/index.html', 'utf8');
  const qrPosition = page.indexOf('id="txCanvas"');
  const txMapPosition = page.indexOf('id="txBlockMap"');
  const cameraStagePosition = page.indexOf('class="camera-stage"');
  const videoPosition = page.indexOf('id="camera"');
  const cameraStageEnd = page.indexOf('</div>', videoPosition);
  const scanCanvasPosition = page.indexOf('id="scanCanvas"');
  const rxMapSectionPosition = page.indexOf('class="blockmap-section rx-blockmap"');
  const rxMapPosition = page.indexOf('id="rxBlockMap"');
  assert(qrPosition >= 0 && txMapPosition > qrPosition, 'TX block map must be below the animated QR');
  assert(cameraStagePosition >= 0 && videoPosition > cameraStagePosition, 'RX camera must be inside camera stage');
  assert(cameraStageEnd > videoPosition && scanCanvasPosition > cameraStageEnd &&
    rxMapSectionPosition > scanCanvasPosition && rxMapPosition > rxMapSectionPosition,
    'RX block map must be a separate section immediately below the camera preview');
  assert(!page.includes('rx-blockmap-hud'), 'RX block map must not be overlaid on camera preview');
  assert(page.includes('RX BLOCK MAP · 受信位置'), 'RX block map label must be present');
  assert(page.includes('TX BLOCK MAP · 送信位置'), 'TX block map label must be present');

  assert(page.includes('<script src="airgap-link-ui-v2.js" defer></script>'),
    'Airgap page must load the cache-busted UI runtime');
  const ui = fs.readFileSync('contents/test/airgap-link-ui-v2.js', 'utf8');
  const prepareStart = ui.indexOf('async function prepareTx()');
  const prepareEnd = ui.indexOf('function stopTx()', prepareStart);
  const frameStart = ui.indexOf('async function showNextFrame()');
  const frameEnd = ui.indexOf('function playTx()', frameStart);
  assert(prepareStart >= 0 && prepareEnd > prepareStart &&
    ui.slice(prepareStart, prepareEnd).includes('updateTxBlockMap();'),
    'TX map must update immediately after transfer preparation');
  assert(frameStart >= 0 && frameEnd > frameStart &&
    ui.slice(frameStart, frameEnd).includes('updateTxBlockMap();'),
    'TX map must update for every displayed QR frame');
  assert(ui.includes("txCurrentBlocks = new Set(Core.packetBlockIndexes(parsed));"),
    'Legacy TX map cursor must follow data and P0/P1 packets');
  assert(ui.includes("txCurrentBlocks = new Set(txFountainPart.indexes);"),
    'Fountain TX map cursor must follow current XOR source blocks');
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
    'PASS duplicate/CRC/transfer isolation; PASS TX/RX block-cursor mapping; PASS block maps below QR/camera\n'
  );
}

main().catch((error) => {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
