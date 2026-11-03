'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const jsQR = require('../vendor/jsQR.js');

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

require('./airgap-link-wire-v8.js');
require('./airgap-link-core-v8.js');
require('./airgap-link-fountain-v8.js');
require('./airgap-link-qr-encoder-v8.js');

async function main() {
  const page = fs.readFileSync('contents/test/index.html', 'utf8');
  const serviceWorker = fs.readFileSync('contents/sw.js', 'utf8');
  const ui = fs.readFileSync('contents/test/airgap-link-ui-v11.js', 'utf8');
  const zxingLoader = fs.readFileSync('contents/test/airgap-link-zxing-loader-v10.js', 'utf8');
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

  assert(page.includes('<title>Airgap Link V11 — ZXing-C++ WASM Receiver</title>'), 'Page title must show V11');
  assert(page.includes('/ Test Lab <span>V11</span>'), 'Page heading must show V11');
  assert(page.includes('Airgap Link Test Lab V11'), 'Footer must show V11');
  assert(page.includes('<script src="airgap-link-wire-v8.js"></script>') &&
    page.includes('<script src="airgap-link-core-v8.js"></script>') &&
    page.includes('<script src="airgap-link-fountain-v8.js"></script>'),
    'Airgap page must load V8 wire, Legacy and Fountain runtimes');
  assert(page.includes('<script src="airgap-link-qr-encoder-v8.js"></script>'),
    'Airgap page must load the V8 Alphanumeric QR encoder');
  assert(page.includes('<script src="airgap-link-zxing-loader-v10.js" defer></script>') &&
    page.includes('<script src="airgap-link-ui-v11.js" defer></script>'),
    'Airgap page must load the V11 ZXing loader before the UI runtime');
  assert(page.includes('id="rxScanner"') &&
    page.includes('value="zxing-wasm"') &&
    page.includes('value="native"') &&
    page.includes('value="jsqr"'),
    'RX must offer explicit Native, ZXing-C++ WASM and jsQR decoder selection');
  assert(serviceWorker.includes('"test/airgap-link-zxing-loader-v10.js"') &&
    serviceWorker.includes('"test/airgap-link-ui-v11.js"') &&
    serviceWorker.includes("const ZXING_WASM_VERSION = '3.1.6'"),
    'Service Worker must precache V11 scripts and expose the pinned ZXing virtual script route');
  assert(page.includes('id="rxResolution"') &&
    ['640x480', '1280x720', '1920x1080'].every((value) => page.includes('value="' + value + '"')) &&
    page.includes('value="1920x1080" selected'),
    'RX must offer the 640x480, 1280x720 and 1920x1080 requested resolution profiles with 1080p as baseline');
  assert(['rxCameraSettings', 'rxP50Ms', 'rxP95Ms', 'rxSamples', 'copyBenchmarkText', 'benchmarkRunCount']
    .every((id) => page.includes('id="' + id + '"')),
    'V11 must expose actual camera settings, P50/P95, attempt counts and text-copy results');
  assert(page.includes('<button id="copyBenchmarkText" type="button">'),
    'The text-copy button must remain clickable when there are zero benchmark runs');
  assert(!page.includes('id="exportBenchmarkCsv"') && !ui.includes('function exportBenchmarkCsv'),
    'V11 must not expose the retired CSV export control');
  assert(ui.includes("window.addEventListener('error'") && ui.includes("window.addEventListener('unhandledrejection'"),
    'Initialization and asynchronous runtime errors must be surfaced in the UI');
  assert(ui.includes("$('autoTxTest').addEventListener('click', runTxAutoTest)"),
    'The automatic TX benchmark button must have a click handler');
  assert(ui.includes("$('copyBenchmarkText').addEventListener('click', copyBenchmarkText)"),
    'The benchmark text-copy button must have a click handler');
  assert(ui.includes('var prepared = await prepareTx()') && ui.includes('if (!prepared || (!txPlan && !txFountainEncoder))'),
    'The TX sweep must stop and report when preparation fails instead of silently ending as success');
  assert(ui.includes('if (!benchmarkRuns.length)') && ui.includes('clipboardFallback'),
    'The benchmark copy flow must explain the empty state and provide a visible clipboard fallback');
  assert(page.includes('チャンクサイズ・FPS・QR表示サイズを固定'),
    'The page must instruct the operator to keep TX conditions fixed during resolution comparison');
  assert(serviceWorker.includes("const VERSION = 'cm-v2.19.0-airgap-link-test-lab-v10-zxing-wasm'") &&
    serviceWorker.includes('"test/airgap-link-ui-v11.js"'),
    'Service Worker must cache-bust and precache the V11 runtime');
  new vm.Script(ui, { filename: 'airgap-link-ui-v11.js' });
  new vm.Script(zxingLoader, { filename: 'airgap-link-zxing-loader-v10.js' });
  assert(ui.includes("zxingDecoder.readBarcodes(image,") &&
    ui.includes("formats: ['QRCode']") &&
    ui.includes("scannerType === 'zxing-wasm'"),
    'V11 must pass canvas ImageData to the ZXing-C++ QR reader');
  assert(zxingLoader.includes("zxing-wasm@' + VERSION + '/dist/iife/reader/index.js") &&
    zxingLoader.includes("zxing-wasm@' + VERSION + '/dist/reader/zxing_reader.wasm") &&
    zxingLoader.includes("SCRIPT_LOCAL_URL = 'zxing-wasm-reader-v10.js'") &&
    zxingLoader.includes('api.prepareZXingModule'),
    'ZXing assets must be version-pinned and WASM initialized from a cached local blob');
  assert(ui.includes("width: { ideal: requestedWidth }") &&
    ui.includes("height: { ideal: requestedHeight }") &&
    ui.includes("frameRate: { ideal: 30, max: 60 }"),
    'Resolution comparison must vary only the requested RX width/height and keep camera frame-rate constraints fixed');
  assert(ui.includes('cameraTrack.getSettings()'),
    'RX must record the actual camera track settings, not just the requested profile');
  assert(ui.includes('detector.detect(video)'),
    'V11 must retain direct Video input so the resolution-only experiment has a stable baseline');
  assert(ui.includes('function percentileValue('),
    'V11 must calculate decode-time percentiles');
  const percentileStart = ui.indexOf('function percentileValue(');
  const percentileEnd = ui.indexOf('\n  function nextLegacyFrameIndexAfterPreflight', percentileStart);
  assert(percentileStart >= 0 && percentileEnd > percentileStart, 'Percentile helper must be extractable for unit tests');
  const percentileValue = vm.runInNewContext('(' + ui.slice(percentileStart, percentileEnd).trim() + '\n)');
  assert.equal(percentileValue([10, 20, 30, 40, 50], 0.50), 30);
  assert.equal(percentileValue([10, 20, 30, 40, 50], 0.95), 48);
  assert.equal(percentileValue([], 0.50), null);
  assert(ui.includes('scanDecodeSamples.push(decodeElapsed)') &&
    ui.includes('if (receivedDone) recordBenchmarkRun()') &&
    ui.includes('run.samples.forEach'),
    'V11 must retain bounded per-attempt measurements and log completed runs with raw samples');

  assert(page.includes('id="wireFormat"') && page.includes('value="base45"') && page.includes('value="base64url"'),
    'TX must offer Base45 and legacy Base64URL wire-format selection');
  assert(page.indexOf('airgap-link-wire-v8.js') < page.indexOf('airgap-link-core-v8.js'),
    'Wire codec must load before the V8 protocol runtimes');
  assert(page.includes('id="rxElapsed"') && page.includes('2枚目の有効なQR'),
    'RX must display elapsed time starting at the second valid QR');
  assert(['rxThroughput', 'rxFileRate', 'rxIngestMs'].every((id) => page.includes('id="' + id + '"')),
    'RX must show wire-payload throughput, saved-file throughput, and ingest timing');
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
  const wire = globalThis.AirgapLinkWire;
  const base45Sample = Uint8Array.from([0, 44, 0, 36, 0, 45, 0, 46, 255, 0, 128, 1]);
  const base45Text = wire.encodeBase45(base45Sample);
  assert(base45Text.includes(':') && base45Text.includes(' '),
    'Base45 fixture must cover colon and ordinary-space payload characters');
  assert.deepEqual(Array.from(wire.decodeBase45(base45Text)), Array.from(base45Sample),
    'Base45 must round-trip arbitrary bytes including colon and spaces');
  assert.throws(() => wire.decodeBase45('1'), 'Base45 must reject a 1-character remainder');
  const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  assert.deepEqual(Array.from(wire.decodeBase45(wire.encodeBase45(allBytes))), Array.from(allBytes),
    'Base45 must round-trip every possible byte value');
  const base45Plan = globalThis.AirgapLinkCore.buildFrames(base45Sample,
    { chunkSize: 80, parity: false, id: 'A1B2C3D4', wireFormat: 'base45' });
  const base45Frame = base45Plan.frames[0];
  assert(base45Frame.startsWith('CMAL2:'), 'Base45 frames must use the versioned CMAL2 prefix');
  assert.equal(globalThis.AirgapLinkCore.parseFrame(base45Frame).wireFormat, 'base45');
  assert.deepEqual(Array.from(globalThis.AirgapLinkCore.parseFrame(base45Frame).payload), Array.from(base45Sample),
    'Legacy CMAL2 parser must recover original payload bytes');
  const base45Receiver = new globalThis.AirgapLinkCore.Receiver();
  const base45Result = base45Receiver.feed(base45Frame);
  assert.equal(base45Result.complete, true);
  assert.deepEqual(Array.from(base45Result.bytes), Array.from(base45Sample));
  const legacyFormatPlan = globalThis.AirgapLinkCore.buildFrames(base45Sample,
    { chunkSize: 80, parity: false, id: 'A1B2C3D4' });
  assert(legacyFormatPlan.frames[0].startsWith('CMAL1:'),
    'Default legacy format must remain CMAL1/Base64URL for backwards compatibility');
  assert.equal(globalThis.AirgapLinkCore.parseFrame(legacyFormatPlan.frames[0]).wireFormat, 'base64url');
  const mixedWireReceiver = new globalThis.AirgapLinkCore.Receiver();
  mixedWireReceiver.feed(legacyFormatPlan.frames[0]);
  assert.throws(() => mixedWireReceiver.feed(base45Frame),
    'One transfer must not mix CMAL1 and CMAL2 frames');
  const fountainBase45Encoder = new globalThis.AirgapLinkFountain.Encoder(base45Sample,
    { chunkSize: 80, id: 'A1B2C3D4', wireFormat: 'base45' });
  const fountainBase45Part = await fountainBase45Encoder.nextPart();
  assert(fountainBase45Part.frame.startsWith('CMAL2:F'),
    'LT Fountain systematic packets must use CMAL2 when Base45 is selected');
  assert.equal(globalThis.AirgapLinkFountain.parseFrame(fountainBase45Part.frame).wireFormat, 'base45');
  const fountainBase45Receiver = new globalThis.AirgapLinkFountain.Receiver();
  const fountainBase45Result = await fountainBase45Receiver.feed(fountainBase45Part.frame);
  assert.equal(fountainBase45Result.complete, true);
  assert.deepEqual(Array.from(fountainBase45Receiver.bytes()), Array.from(base45Sample));
  const base45QrFrame = 'CMAL2:1/1:11223344:ABCDEF12:' + base45Text;
  assert.equal(globalThis.MatrixQRCode.modeFor(base45QrFrame), 2,
    'CMAL2/Base45 frames must use QR Alphanumeric mode');
  assert.equal(globalThis.MatrixQRCode.modeFor('CMAL1:1/1:11223344:ABCDEF12:ab_cd-1'), 4,
    'Legacy Base64URL-like payloads must remain in QR Byte mode');
  assert(globalThis.MatrixQRCode.matrix(base45QrFrame).length > 0,
    'The Alphanumeric QR encoder must generate a matrix for Base45 frames');
  const base45QrMatrix = globalThis.MatrixQRCode.matrix(base45QrFrame);
  const moduleScale = 6;
  const quietZone = 4;
  const qrDimension = (base45QrMatrix.length + quietZone * 2) * moduleScale;
  const qrPixels = new Uint8ClampedArray(qrDimension * qrDimension * 4);
  for (let offset = 0; offset < qrPixels.length; offset += 4) {
    qrPixels[offset] = 255;
    qrPixels[offset + 1] = 255;
    qrPixels[offset + 2] = 255;
    qrPixels[offset + 3] = 255;
  }
  for (let row = 0; row < base45QrMatrix.length; row++) {
    for (let column = 0; column < base45QrMatrix.length; column++) {
      if (!base45QrMatrix[row][column]) continue;
      const left = (column + quietZone) * moduleScale;
      const top = (row + quietZone) * moduleScale;
      for (let py = top; py < top + moduleScale; py++) {
        for (let px = left; px < left + moduleScale; px++) {
          const pixel = (py * qrDimension + px) * 4;
          qrPixels[pixel] = 0;
          qrPixels[pixel + 1] = 0;
          qrPixels[pixel + 2] = 0;
        }
      }
    }
  }
  const decodedBase45Qr = jsQR(qrPixels, qrDimension, qrDimension, { inversionAttempts: 'dontInvert' });
  assert(decodedBase45Qr, 'The bundled jsQR reader must decode a generated Base45/Alphanumeric QR');
  assert.equal(decodedBase45Qr.data, base45QrFrame,
    'The bundled jsQR reader must preserve Base45 colons and spaces byte-for-byte');
  assert.equal(wire.splitFrame(base45Frame).payload, base45Text,
    'Wire parser must preserve spaces and colons after the four structural separators');

  const nextLegacyStart = ui.indexOf('function nextLegacyFrameIndexAfterPreflight(');
  const nextLegacyEnd = ui.indexOf('\n  function updateControls(', nextLegacyStart);
  assert(nextLegacyStart >= 0 && nextLegacyEnd > nextLegacyStart,
    'Legacy playback must skip the already displayed preflight QR');
  const nextLegacyFrameIndexAfterPreflight = vm.runInNewContext(
    '(' + ui.slice(nextLegacyStart, nextLegacyEnd).trim() + '\n)'
  );
  assert.equal(nextLegacyFrameIndexAfterPreflight(5), 1,
    'After the preflight Data 1, legacy playback must continue at Data 2');
  assert.equal(nextLegacyFrameIndexAfterPreflight(1), 0,
    'A one-frame transfer must remain on its only frame and report unmeasured duration');

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
    { window: globalThis, Core: globalThis.AirgapLinkCore, Fountain: globalThis.AirgapLinkFountain, Wire: globalThis.AirgapLinkWire }
  );
  const preflightLegacy = globalThis.AirgapLinkCore.buildFrames(new Uint8Array(10 * 80),
    { chunkSize: 80, parity: true, id: 'A1B2C3D4' });
  assert.equal(isInitialTransferFrame(preflightLegacy.frames[0]), true);
  assert.equal(isInitialTransferFrame(preflightLegacy.frames[1]), false);
  const preflightLtEncoder = new globalThis.AirgapLinkFountain.Encoder(new Uint8Array(10 * 80),
    { chunkSize: 80, id: 'A1B2C3D4' });
  assert.equal(isInitialTransferFrame((await preflightLtEncoder.nextPart()).frame), true);
  assert.equal(isInitialTransferFrame((await preflightLtEncoder.nextPart()).frame), false);
  const preflightLegacyBase45 = globalThis.AirgapLinkCore.buildFrames(new Uint8Array(10 * 80),
    { chunkSize: 80, parity: true, id: 'A1B2C3D4', wireFormat: 'base45' });
  assert.equal(isInitialTransferFrame(preflightLegacyBase45.frames[0]), true,
    'CMAL2 Legacy Data 1 must be accepted as the initial preflight QR');
  const preflightLtBase45Encoder = new globalThis.AirgapLinkFountain.Encoder(new Uint8Array(10 * 80),
    { chunkSize: 80, id: 'A1B2C3D4', wireFormat: 'base45' });
  assert.equal(isInitialTransferFrame((await preflightLtBase45Encoder.nextPart()).frame), true,
    'CMAL2 LT seq 1 must be accepted as the initial preflight QR');
  assert.equal(isInitialTransferFrame((await preflightLtBase45Encoder.nextPart()).frame), false,
    'CMAL2 LT seq 2 must not be accepted as a preflight frame');
  const prepareSource = ui.slice(ui.indexOf('async function prepareTx()'), ui.indexOf('function stopTx()'));
  assert(prepareSource.includes("$('wireFormat').value"),
    'TX preparation must read the selected wire format');
  assert.equal((prepareSource.match(/wireFormat: wireFormat/g) || []).length, 3,
    'The selected wire format must propagate to Pure LT, Legacy and Hybrid encoders');
  assert(ui.includes('Wire.isAirgapFrame(rawText)') && ui.includes('Wire.isFountainFrame(rawText)'),
    'RX recognition must accept both CMAL1 and CMAL2 across Legacy and LT');
  assert(ui.includes("raw.replace(/^[\\r\\n]+|[\\r\\n]+$/g, '')"),
    'Camera ingestion must preserve Base45 leading/trailing spaces');
  assert(ui.includes("manualFrame').value.replace(/^[\\r\\n]+|[\\r\\n]+$/g, '')"),
    'Manual ingestion must preserve Base45 leading/trailing spaces');

  const timerStart = ui.indexOf('function recordTransferFrame(');
  const timerEnd = ui.indexOf('\n  function elapsedTransferMs(', timerStart);
  assert(timerStart >= 0 && timerEnd > timerStart, 'Second-frame timer helper must exist');
  const recordTransferFrame = vm.runInNewContext('(' + ui.slice(timerStart, timerEnd).trim() + '\n)');
  const elapsedStart = ui.indexOf('function elapsedTransferMs(');
  const elapsedEnd = ui.indexOf('\n  function formatElapsedMs(', elapsedStart);
  const elapsedTransferMs = vm.runInNewContext('(' + ui.slice(elapsedStart, elapsedEnd).trim() + '\n)');
  const formatStart = ui.indexOf('function formatElapsedMs(');
  const formatEnd = ui.indexOf('\n  function percentileValue(', formatStart);
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
  const rateStart = ui.indexOf('function formatRate(');
  const rateEnd = ui.indexOf('\n  function sameSet(', rateStart);
  assert(rateStart >= 0 && rateEnd > rateStart, 'Completed throughput formatter must exist');
  const formatRate = vm.runInNewContext('(' + ui.slice(rateStart, rateEnd).trim() + '\n)');
  assert.equal(formatRate(307200, 100000), '3.00 KB/s',
    '300 KiB reconstructed in 100 seconds must report 3.00 KiB/s');
  assert.equal(formatRate(1000, 0), '—', 'A zero-duration sample must not report an infinite rate');
  assert(ui.includes('requestVideoFrameCallback') && ui.includes('cancelVideoFrameCallback'),
    'RX scanner must schedule work against camera frames and cancel pending callbacks');
  assert(ui.includes("inversionAttempts: 'dontInvert'"),
    'The QR-only light-background scanner must avoid unnecessary inverted-image search');
  assert(ui.includes('if (rxMapDirty)') && ui.includes('sameSet(txCurrentBlocks, txMapLastBlocks)'),
    'RX must redraw only after unique accepted packets and TX must compare block sets without sorting');
  assert(!ui.includes('setTimeout(scanTick, 20)'),
    'Camera-frame scheduling must replace the unconditional 20 ms polling loop');
  assert(ui.includes('recordTransferFrame(transferTiming, firstFramePending, result.duplicate'),
    'The RX ingest path must start timing on the second distinct accepted QR');
  assert(ui.includes('txIndex = nextLegacyFrameIndexAfterPreflight(txPlan.frames.length)'),
    'Legacy TX must not replay Data 1 after RX preflight; Data 2 is the first timed QR');

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
    { chunkSize: 128, parity: true, id: 'A1B2C3D4', wireFormat: 'base45' });
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
    { chunkSize: 128, id: hybridPlan.id, wireFormat: 'base45' });
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
    { chunkSize: 128, id: hybridPlan.id, wireFormat: 'base45' });
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

  execFileSync(process.execPath, [require('node:path').join(__dirname, 'airgap-link-ui-smoke.test.cjs')],
    { stdio: 'inherit' });

  process.stdout.write(
    'PASS legacy CMAL1/P0/P1; PASS LT chooser vectors; PASS out-of-order fountain recovery; ' +
    'PASS duplicate/CRC/transfer isolation; PASS V6 second-frame stopwatch and legacy Data 2 start; PASS V5 seek API; PASS first-frame RX preflight; PASS Hybrid P0/P1-to-LT recovery including systematic seek\n'
  );
}

main().catch((error) => {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
