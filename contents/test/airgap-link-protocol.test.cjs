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
require('./airgap-link-fountain-v5.js');

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

  assert(page.includes('<title>Airgap Link V6 — QR Animation Lab</title>'), 'Page title must show V6');
  assert(page.includes('/ Test Lab <span>V6</span>'), 'Page heading must show V6');
  assert(page.includes('Airgap Link Test Lab V6'), 'Footer must show V6');
  assert(page.includes('<script src="airgap-link-fountain-v5.js"></script>'),
    'Airgap page must load the cache-busted V5 Fountain runtime');
  assert(page.includes('<script src="airgap-link-ui-v6.js" defer></script>'),
    'Airgap page must load the cache-busted V6 UI runtime');
  assert(page.includes('id="rxElapsed"') && page.includes('2枚目の有効なQR'),
    'RX must display elapsed time starting at the second valid QR');
  assert(page.includes('value="hybrid"') && page.includes('value="hybrid-data"'),
    'Test Lab must expose LT Hybrid and Data-only Hybrid comparison modes');
  assert(page.includes('先頭QRを1枚読み取る') && page.includes('途中参加は対象外'),
    'RX must require a first-frame preflight before TX playback');
  assert(page.includes('そのブロックのDataから再生します'), 'TX block map must explain click-to-seek');
  assert(page.includes('role="slider" tabindex="-1"'), 'TX block map must be keyboard-focusable after data preparation');
  const txSectionStart = page.indexOf('class="blockmap-section tx-blockmap"');
  const txSectionEnd = page.indexOf('</div>\n <p class="muted" id="txFrameInfo">', txSectionStart);
  const txSection = page.slice(txSectionStart, txSectionEnd);
  assert(txSection.includes('現在表示中のQR位置') && txSection.includes('map-tx-current'), 'TX map legend must describe the colored active QR position');
  assert(txSection.includes('クリックで') || txSection.includes('クリックすると'), 'TX map must document click-to-seek');
  assert(!txSection.includes('直接送信済み') && !txSection.includes('未送信'),
    'TX map must not imply sent/unsent state');
  const rxSectionStart = page.indexOf('class="blockmap-section rx-blockmap"');
  const rxSectionEnd = page.indexOf('<p id="rxStatus"', rxSectionStart);
  const rxSection = page.slice(rxSectionStart, rxSectionEnd);
  assert(rxSection.includes('直接取得') && rxSection.includes('復元済み') && rxSection.includes('未取得') && rxSection.includes('map-active'),
    'RX map must retain acquisition state legend');
  const ui = fs.readFileSync('contents/test/airgap-link-ui-v6.js', 'utf8');
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
  assert(!ui.includes('txDirectBlocks'), 'TX UI must not track sent/unsent block state');
  assert(ui.includes("drawBlockMap('txBlockMap', total, null, null, txCurrentBlocks, true,"),
    'TX map must fill current packet blocks with a distinct active color');
  assert(ui.includes('onTxBlockMapClick') && ui.includes('onTxBlockMapKeyDown'),
    'TX block map must support pointer and keyboard navigation');
  assert(ui.includes('txFountainEncoder.seekToBlock(blockIndex)'),
    'Fountain seek must jump to the selected systematic Data packet');
  assert(ui.includes('legacyFrameIndexForBlock(blockIndex, txPlan)'),
    'Legacy seek must map source blocks to the corresponding Data frame');
  assert(ui.includes('renderGeneration !== txRenderGeneration'),
    'Stale asynchronous frame generation must not overwrite a newer seek');
  assert(!ui.includes('直接送信 '), 'TX summary must not show direct-sent counts');
  assert(ui.includes("txCurrentBlocks = new Set(txFountainPart.indexes);"),
    'Fountain TX map cursor must follow current XOR source blocks');
  const pointStart = ui.indexOf('function blockIndexFromPoint(');
  const pointEnd = ui.indexOf('\n  function legacyFrameIndexForBlock', pointStart);
  const blockIndexFromPoint = vm.runInNewContext('(' + ui.slice(pointStart, pointEnd).trim() + '\n)');
  assert.equal(blockIndexFromPoint(20 * 8 + 4, 4, 52 * 8, 8, 52), 20,
    'TX map coordinates must resolve a block in a one-row map');
  assert.equal(blockIndexFromPoint(8 + 4, 8 + 4, 75 * 8, 14 * 8, 1000), 76,
    'TX map coordinates must resolve rows correctly for large maps');
  assert.equal(blockIndexFromPoint(-1, 0, 600, 112, 1000), -1,
    'TX map coordinates outside the canvas must be rejected');

  const seekStart = ui.indexOf('function legacyFrameIndexForBlock(');
  const seekEnd = ui.indexOf('\n  function seekTxToBlock', seekStart);
  const legacyFrameIndexForBlock = vm.runInNewContext('(' + ui.slice(seekStart, seekEnd).trim() + '\n)');
  const parityPlan = globalThis.AirgapLinkCore.buildFrames(new Uint8Array(52 * 80),
    { chunkSize: 80, parity: true, id: 'A1B2C3D4' });
  for (const index of [0, 7, 8, 15, 16, 31, 48, 51]) {
    const frameIndex = legacyFrameIndexForBlock(index, parityPlan);
    const packet = globalThis.AirgapLinkCore.parseFrame(parityPlan.frames[frameIndex]);
    assert.equal(packet.type, 'data');
    assert.equal(packet.index, index, 'Parity-enabled seek must land on the requested Data block');
  }
  const dataOnlyPlan = globalThis.AirgapLinkCore.buildFrames(new Uint8Array(52 * 80),
    { chunkSize: 80, parity: false, id: '11223344' });
  assert.equal(legacyFrameIndexForBlock(51, dataOnlyPlan), 51,
    'Data-only seek must not apply parity offsets');

  assert.equal(typeof globalThis.AirgapLinkFountain.Encoder.prototype.seekToBlock, 'function',
    'The loaded V5 Fountain runtime must expose the exact seek API used by the V5 UI');
  assert.equal(typeof globalThis.AirgapLinkFountain.Encoder.prototype.startRepairPhase, 'function',
    'V5 Fountain runtime must expose the LT Hybrid repair-phase API');
  assert.equal(typeof globalThis.AirgapLinkFountain.Receiver.prototype.addKnownBlock, 'function',
    'V5 Fountain receiver must import legacy-recovered source blocks');
  assert(ui.includes("txHybridPhase = 'fountain'"), 'Hybrid sender must transition to LT repair packets');
  assert(ui.includes('fountainRx.addKnownBlock'), 'Hybrid RX must import legacy decoded blocks');
  assert(ui.includes('isInitialTransferFrame(rawText)'), 'RX must require initial QR before accepting transfer frames');
  const initialFrameStart = ui.indexOf('function isInitialTransferFrame(');
  const initialFrameEnd = ui.indexOf('\n  async function ingest(', initialFrameStart);
  const isInitialTransferFrame = vm.runInNewContext(
    '(' + ui.slice(initialFrameStart, initialFrameEnd).trim() + '\n)',
    { window: globalThis, Core: globalThis.AirgapLinkCore, Fountain: globalThis.AirgapLinkFountain }
  );
  const preflightLegacy = globalThis.AirgapLinkCore.buildFrames(new Uint8Array(10 * 80),
    { chunkSize: 80, parity: true, id: 'A1B2C3D4' });
  assert.equal(isInitialTransferFrame(preflightLegacy.frames[0]), true);
  assert.equal(isInitialTransferFrame(preflightLegacy.frames[1]), false);
  const preflightLtEncoder = new globalThis.AirgapLinkFountain.Encoder(new Uint8Array(10 * 80),
    { chunkSize: 80, id: 'A1B2C3D4' });
  assert.equal(isInitialTransferFrame((await preflightLtEncoder.nextPart()).frame), true);
  assert.equal(isInitialTransferFrame((await preflightLtEncoder.nextPart()).frame), false);

  const timerStart = ui.indexOf('function recordTransferFrame(');
  const timerEnd = ui.indexOf('\n  function elapsedTransferMs(', timerStart);
  assert(timerStart >= 0 && timerEnd > timerStart, 'Second-frame timer helper must exist');
  const recordTransferFrame = vm.runInNewContext('(' + ui.slice(timerStart, timerEnd).trim() + '\n)');
  const elapsedStart = ui.indexOf('function elapsedTransferMs(');
  const elapsedEnd = ui.indexOf('\n  function formatElapsedMs(', elapsedStart);
  const elapsedTransferMs = vm.runInNewContext('(' + ui.slice(elapsedStart, elapsedEnd).trim() + '\n)');
  const formatStart = ui.indexOf('function formatElapsedMs(');
  const formatEnd = ui.indexOf('\n  function updateControls(', formatStart);
  const formatElapsedMs = vm.runInNewContext('(' + ui.slice(formatStart, formatEnd).trim() + '\n)');
  const timing = { startedAt: null, endedAt: null, frameCount: 0 };
  assert.equal(recordTransferFrame(timing, true, false, 1000), false,
    'The first QR preflight frame must not start the stopwatch');
  assert.equal(recordTransferFrame(timing, false, true, 1500), false,
    'A repeated QR must not start the stopwatch');
  assert.equal(timing.startedAt, null);
  assert.equal(recordTransferFrame(timing, false, false, 2000), true,
    'The second unique valid QR must start the stopwatch');
  assert.equal(timing.startedAt, 2000);
  assert.equal(timing.frameCount, 1);
  assert.equal(recordTransferFrame(timing, false, true, 2200), false,
    'Duplicate reads must not increment transfer frame count');
  assert.equal(recordTransferFrame(timing, false, false, 3000), false);
  assert.equal(timing.frameCount, 2);
  assert.equal(elapsedTransferMs(timing, 4500), 2500);
  timing.endedAt = 4000;
  assert.equal(elapsedTransferMs(timing, 4500), 2000,
    'The stopwatch must freeze at the final required QR');
  assert.equal(formatElapsedMs(100000), '01:40');
  assert(ui.includes('recordTransferFrame(transferTiming, firstFramePending, result.duplicate'),
    'The RX ingest path must start timing on the second distinct accepted QR');

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
  assert.equal(fountain.randomAccessSeek, true);

  const hybridMessage = Uint8Array.from({ length: 20 * 128 - 37 }, (_, i) => (i * 73 + 19) & 0xff);
  const hybridPlan = globalThis.AirgapLinkCore.buildFrames(hybridMessage,
    { chunkSize: 128, parity: true, id: 'A1B2C3D4' });
  const legacyReceiver = new globalThis.AirgapLinkCore.Receiver();
  const dropped = new Set([0, 1, 2, 8, 9]);
  const legacyDirect = new Set();
  for (const frame of hybridPlan.frames) {
    const packet = globalThis.AirgapLinkCore.parseFrame(frame);
    if (packet.type === 'data' && dropped.has(packet.index)) continue;
    if (packet.type === 'data') legacyDirect.add(packet.index);
    legacyReceiver.feed(frame);
  }
  assert.equal(legacyReceiver.isComplete(), false);
  assert.equal(legacyReceiver.recoveredCount, 2, 'P0/P1 must recover two dropped blocks in the second group');
  const hybridEncoder = new globalThis.AirgapLinkFountain.Encoder(hybridMessage,
    { chunkSize: 128, id: hybridPlan.id });
  assert.equal(hybridEncoder.seqLen, hybridPlan.dataFrames.length);
  assert.equal(hybridEncoder.fragmentLen, hybridPlan.chunkSize);
  assert.equal(hybridEncoder.startRepairPhase(), hybridEncoder.seqLen);
  const firstRepair = await hybridEncoder.nextPart();
  assert.equal(firstRepair.seqNum, hybridEncoder.seqLen + 1);
  assert.equal(firstRepair.direct, false);
  const repairMetadata = globalThis.AirgapLinkFountain.parseFrame(firstRepair.frame);
  const hybridReceiver = new globalThis.AirgapLinkFountain.Receiver();
  for (const [index, shard] of legacyReceiver.shards.entries()) {
    hybridReceiver.addKnownBlock(repairMetadata, index, shard, legacyDirect.has(index));
  }
  await hybridReceiver.feed(firstRepair.frame);
  let packets = 1;
  while (!hybridReceiver.isComplete() && packets < 2500) {
    await hybridReceiver.feed((await hybridEncoder.nextPart()).frame);
    packets++;
  }
  assert.equal(hybridReceiver.isComplete(), true, 'LT must repair the remaining blocks after the P0/P1 pass');
  assert.deepEqual(Array.from(hybridReceiver.bytes()), Array.from(hybridMessage));
  assert([0, 1, 2].every(index => hybridReceiver.recoveredIndexes.has(index)),
    'LT must recover the three blocks not recoverable by P0/P1');

  // A user may seek on the TX map immediately after entering the Hybrid LT phase.
  // In that case the first LT frame is a direct systematic resend (seq <= K),
  // followed by the normal rateless repair stream.
  const seekHybridEncoder = new globalThis.AirgapLinkFountain.Encoder(hybridMessage,
    { chunkSize: 128, id: hybridPlan.id });
  seekHybridEncoder.startRepairPhase();
  seekHybridEncoder.seekToBlock(0);
  const firstSeekPart = await seekHybridEncoder.nextPart();
  assert.equal(firstSeekPart.direct, true);
  assert.equal(firstSeekPart.seqNum, 1);
  const seekMetadata = globalThis.AirgapLinkFountain.parseFrame(firstSeekPart.frame);
  const seekHybridReceiver = new globalThis.AirgapLinkFountain.Receiver();
  for (const [index, shard] of legacyReceiver.shards.entries()) {
    seekHybridReceiver.addKnownBlock(seekMetadata, index, shard, legacyDirect.has(index));
  }
  await seekHybridReceiver.feed(firstSeekPart.frame);
  let seekPackets = 1;
  while (!seekHybridReceiver.isComplete() && seekPackets < 2500) {
    await seekHybridReceiver.feed((await seekHybridEncoder.nextPart()).frame);
    seekPackets++;
  }
  assert.equal(seekHybridReceiver.isComplete(), true,
    'Hybrid receiver must accept a systematic seek frame before Fountain repair packets');
  assert(seekHybridReceiver.directIndexes.has(0),
    'Hybrid seek target must be registered as directly received');
  assert([1, 2].every(index => seekHybridReceiver.recoveredIndexes.has(index)),
    'Subsequent LT equations must repair the remaining missing source blocks');
  assert.deepEqual(Array.from(seekHybridReceiver.bytes()), Array.from(hybridMessage));

  process.stdout.write(
    'PASS legacy CMAL1/P0/P1; PASS LT chooser vectors; PASS out-of-order fountain recovery; ' +
    'PASS duplicate/CRC/transfer isolation; PASS V6 second-frame stopwatch; PASS V5 seek API; PASS first-frame RX preflight; PASS Hybrid P0/P1-to-LT recovery including systematic seek\n'
  );
}

main().catch((error) => {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
