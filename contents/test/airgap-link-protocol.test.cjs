'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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

  assert(page.includes('<title>Airgap Link V2 — QR Animation Lab</title>'), 'Page title must show V2');
  assert(page.includes('/ Test Lab <span>V2</span>'), 'Page heading must show V2');
  assert(page.includes('Airgap Link Test Lab V2'), 'Footer must show V2');
  assert(page.includes('<script src="airgap-link-ui-v2_1.js" defer></script>'),
    'Airgap page must load the cache-busted V2.1 UI runtime');
  const ui = fs.readFileSync('contents/test/airgap-link-ui-v2_1.js', 'utf8');
  const mapperStart = ui.indexOf('function packetBlockIndexes(packet)');
  const mapperEnd = ui.indexOf('function drawBlockMap(', mapperStart);
  assert(mapperStart >= 0 && mapperEnd > mapperStart, 'UI-local packet block mapper must exist');
  const mapperSource = ui.slice(mapperStart, mapperEnd).trim();
  const packetBlockIndexes = vm.runInNewContext('(' + mapperSource + ')');
  assert.deepEqual(Array.from(packetBlockIndexes({ type: 'data', index: 4, total: 52 })), [4],
    'Data packets must point to one zero-based source block');
  assert.deepEqual(Array.from(packetBlockIndexes({ type: 'parity', parityType: 0, group: 1, total: 52 })),
    [8, 9, 10, 11, 12, 13, 14, 15], 'P0/P1 must point to the full 8-block group');
  assert.deepEqual(Array.from(packetBlockIndexes({ type: 'parity', parityType: 1, group: 6, total: 52 })),
    [48, 49, 50, 51], 'Final partial parity groups must be clipped to actual block count');
  assert.throws(() => packetBlockIndexes({ type: 'parity', parityType: 0, group: 7, total: 52 }),
    'Out-of-range parity groups must be rejected');
  assert(!ui.includes('Core.packetBlockIndexes('), 'UI must not depend on newer Core.packetBlockIndexes API');
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
  assert(ui.includes("txCurrentBlocks = new Set(packetBlockIndexes(parsed));"),
    'Legacy TX map cursor must use the UI-local mapper');
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
