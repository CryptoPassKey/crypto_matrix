'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const jsQR = require('../vendor/jsQR.js');

function extractFunctionDeclaration(source, name) {
  const marker = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\(');
  const match = marker.exec(source);
  assert(match, 'Function declaration not found: ' + name);
  const start = source.indexOf('function', match.index);
  const bodyStart = source.indexOf('{', start);
  assert(bodyStart >= 0, 'Function body not found: ' + name);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unterminated function declaration: ' + name);
}

const extractionFixture = [
  'function first() {',
  '  const brace = "}";',
  '  /* } is not a closing brace */',
  '  return { ok: true };',
  '}',
  'function second() { return false; }'
].join('\\n');
assert(!extractFunctionDeclaration(extractionFixture, 'first').includes('function second'),
  'Function extraction must stop at the matching closing brace, not the next function name');

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
  const fountainSource = fs.readFileSync('contents/test/airgap-link-fountain-v8.js', 'utf8');
  const ui = fs.readFileSync('contents/test/airgap-link-ui-v16.js', 'utf8');
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
  assert(page.includes('受信ブロック'), 'RX block map label must be present');
  assert(page.includes('送信ブロック'), 'TX block map label must be present');

  assert(page.includes('<title>Airgap Link — Offline File Transfer</title>'), 'Page title must use the production name');
  assert(page.includes('<h1>Airgap <span>Link</span></h1>'), 'Page heading must use the production name');
  assert(page.includes('OFFLINE TRANSFER · V16'), 'Page must identify the V16 runtime');
  assert(page.includes('<script src="airgap-link-wire-v8.js"></script>') &&
    page.includes('<script src="airgap-link-core-v8.js"></script>') &&
    page.includes('<script src="airgap-link-fountain-v8.js"></script>'),
    'Airgap page must load V8 wire, Legacy and Fountain runtimes');
  assert(page.includes('<script src="airgap-link-qr-encoder-v8.js"></script>'),
    'Airgap page must load the V8 Alphanumeric QR encoder');
  assert(page.includes('<script src="airgap-link-zxing-loader-v10.js" defer></script>') &&
    page.includes('<script src="airgap-link-ui-v16.js" defer></script>'),
    'Airgap page must load the unchanged ZXing loader before the V16 UI runtime');
  assert(page.includes('id="rxGaussianEnabled"') && page.includes('id="rxGaussianStatus"') &&
    page.includes('id="runRxGaussian"'),
    'RX must expose opt-in GF(2) recovery with a manual execution control');
  assert(ui.includes('fountainRx.gaussianEnabled = !!$(\'rxGaussianEnabled\').checked') &&
    ui.includes("$('runRxGaussian').addEventListener"),
    'GF(2) recovery must be explicitly enabled');
  assert(ui.includes('cameraLive || scanBusy || rxWorkerBusy || scanIngestBusy') &&
    ui.includes('カメラを停止して受信処理が終わってから実行'),
    'GF(2) elimination must refuse to run while camera capture or ingest is active');
  assert(!ui.includes('result.gaussian') &&
    !fountainSource.includes('this.runGaussianElimination()'),
    'The live QR feed path must never invoke synchronous Gaussian elimination');
  assert(page.includes('id="rxScanner"') && page.includes('value="zxing-wasm"') &&
    !page.includes('value="native"') && !page.includes('value="jsqr"'),
    'Production RX must use the fixed ZXing-C++ WASM decoder');
  assert(serviceWorker.includes('"test/airgap-link-zxing-loader-v10.js"') &&
    serviceWorker.includes('"test/airgap-link-ui-v16.js"') &&
    serviceWorker.includes("const ZXING_WASM_VERSION = '3.1.6'"),
    'Service Worker must precache V16 scripts and expose the pinned ZXing virtual script route');
  assert(!page.includes('benchmarkSizeRange') && !page.includes('benchmarkSizeInput') &&
    !page.includes('benchmarkPreset'),
    'Production DOM must not expose synthetic test-payload size controls');
  assert(['rxWireBytes', 'rxOutputBytes', 'rxMemoryPeak'].every((id) => page.includes('id="' + id + '"')),
    'V16 must expose received payload size, reconstructed file size and optional heap measurement');
  assert(ui.includes('var MAX_BENCHMARK_BYTES = 64 * 1024 * 1024') &&
    ui.includes('missingBlocks: Math.max(0, progress.total - progress.have)') &&
    ui.includes('wireBytes: rxWireByteCount') && ui.includes('memoryPeakBytes: benchmarkPeakHeapBytes'),
    'V16 must record payload size, missing blocks and optional JS heap usage');
  const autoStart = ui.indexOf('async function runTxAutoTest()');
  const autoEnd = ui.indexOf("  $('autoTxTest').addEventListener", autoStart);
  const autoBody = ui.slice(autoStart, autoEnd);
  assert(!autoBody.includes('autoBenchmarkReset') && !autoBody.includes('cameraVideo') &&
    !autoBody.includes('stream.active'),
    'TX automatic benchmark must not require access to RX camera state');
  assert(page.includes('id="rxResolution"') && page.includes('value="640x480" selected') &&
    !page.includes('value="1280x720"') && !page.includes('value="1920x1080"'),
    'Production RX must use a fixed 640x480 camera request');
  assert(['rxCameraSettings', 'rxP50Ms', 'rxP95Ms', 'rxSamples', 'benchmarkRunCount']
    .every((id) => page.includes('id="' + id + '"')),
    'Internal RX metrics must remain available for result reporting');
  assert(!page.includes('copyBenchmarkText') && !page.includes('計測結果をテキストコピー'),
    'Benchmark text-copy UI must be absent from the production DOM');
  assert(!page.includes('id="exportBenchmarkCsv"') && !ui.includes('function exportBenchmarkCsv'),
    'V16 must not expose the retired CSV export control');
  assert(ui.includes("window.addEventListener('error'") && ui.includes("window.addEventListener('unhandledrejection'"),
    'Initialization and asynchronous runtime errors must be surfaced in the UI');
  assert(!ui.includes("$('autoTxTest').addEventListener('click', runTxAutoTest)") &&
    !ui.includes("$('copyBenchmarkText').addEventListener('click', copyBenchmarkText)"),
    'Production runtime must not register test benchmark controls');
  assert(ui.includes('var prepared = await prepareTx()') && ui.includes('if (!prepared || (!txPlan && !txFountainEncoder))'),
    'The TX sweep must stop and report when preparation fails instead of silently ending as success');
  assert(ui.includes('if (!benchmarkRuns.length)') && ui.includes('clipboardFallback'),
    'The benchmark copy flow must explain the empty state and provide a visible clipboard fallback');
  assert(!page.includes('テストデータ量') && !page.includes('自動ベンチマーク') &&
    !page.includes('計測結果をテキストコピー') && !page.includes('手動フレーム入力') &&
    !page.includes('copyBenchmarkText'),
    'Production UI must not expose benchmark or debug controls');
  assert(serviceWorker.includes("const VERSION = 'cm-v2.26.0-airgap-link-production-v18'") &&
    serviceWorker.includes('"test/airgap-link-ui-v16.js"'),
    'Service Worker must cache-bust and precache the V16 runtime');
  assert(page.includes('id="chunkSizeNumber"') && page.includes('max="2800"'),
    'V16 must expose the expanded numeric and range chunk-size controls');
  assert(ui.includes('maximum = $(\'wireFormat\').value === \'base64url\' ? 2100 : 2800'),
    'V16 must apply wire-format-specific chunk limits');
  new vm.Script(ui, { filename: 'airgap-link-ui-v16.js' });
  new vm.Script(zxingLoader, { filename: 'airgap-link-zxing-loader-v10.js' });
  assert(ui.includes("zxingDecoder.readBarcodes(image,") &&
    ui.includes("formats: ['QRCode']") &&
    ui.includes("scannerType === 'zxing-wasm'"),
    'V16 must pass canvas ImageData to the ZXing-C++ QR reader');
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
    'V16 must retain direct Video input so the resolution-only experiment has a stable baseline');
  assert(ui.includes('function percentileValue('),
    'V16 must calculate decode-time percentiles');
  const percentileValue = vm.runInNewContext('(' + extractFunctionDeclaration(ui, 'percentileValue') + ')');
  assert.equal(percentileValue([10, 20, 30, 40, 50], 0.50), 30);
  assert.equal(percentileValue([10, 20, 30, 40, 50], 0.95), 48);
  assert.equal(percentileValue([], 0.50), null);
  assert(ui.includes('scanDecodeSamples.push(decodeElapsed)') &&
    ui.includes('if (receivedDone) recordBenchmarkRun()') &&
    ui.includes('run.samples.forEach'),
    'V16 must retain bounded per-attempt measurements and log completed runs with raw samples');

  assert(page.includes('id="wireFormat"') && page.includes('value="base45"') && page.includes('value="base64url"'),
    'TX must offer Base45 and legacy Base64URL wire-format selection');
  assert(page.indexOf('airgap-link-wire-v8.js') < page.indexOf('airgap-link-core-v8.js'),
    'Wire codec must load before the V8 protocol runtimes');
  assert(page.includes('id="rxElapsed"') && page.includes('先頭QRを読み取ると受信を開始します'),
    'RX must display elapsed time starting at the second valid QR');
  assert(['rxThroughput', 'rxFileRate', 'rxIngestMs'].every((id) => page.includes('id="' + id + '"')),
    'RX must show wire-payload throughput, saved-file throughput, and ingest timing');
  assert(page.includes('QRの情報量') && !page.includes('チャンクサイズ') &&
    ui.includes("+ ' 枚/秒'") && !ui.includes("+ ' fps'"),
    'TX controls must use plain Japanese labels and units rather than implementation jargon');
  assert(!page.includes('フレーム待機中') && !page.includes('QRコードの表示待ち') &&
    !page.includes('読み取り方式') && !page.includes('ZXing-C++ WASM') &&
    !page.includes('Web Worker非同期') && !page.includes('最後に読取'),
    'Production UI must hide scanner implementation details and redundant status copy');
  assert(!page.includes('80〜2,800B') && !page.includes('800〜1,000B') &&
    !page.includes('6〜120 fps') && !page.includes('10〜12 fps'),
    'Production UI must not expose implementation ranges or device-specific tuning recommendations');
  assert(!ui.includes('Data-only + LT:') && !ui.includes('Hybrid LT修復') &&
    !ui.includes('XOR合成 degree=') && !ui.includes(' / ∞') &&
    !ui.includes('初回 Data/Parity 周回 → LT補完'),
    'Production UI must not expose internal transfer algorithm names or sequence counters');
  assert(!ui.includes("'元データ ' + total + 'ブロック") &&
    !ui.includes("'LT seq ' + fountainPacket.seqNum") &&
    !ui.includes("'受信したデータの状態を表示しています'"),
    'RX block status must not expose internal packet and repair diagnostics');
  assert(ui.includes("$('txFrameCountLabel').textContent = '送信状態'") &&
    !ui.includes("'QRコードを表示しています。'"),
    'TX progress must not repeat an explanation of the visible QR code');
  assert(page.includes('<input id="transferMode" type="hidden" value="hybrid-data">') &&
    !page.includes('<select id="transferMode"'),
    'Production transport must be fixed to Data-only + LT without a selector');
  assert(page.includes('先頭QRを読み取ると受信を開始します') && page.includes('先頭QRを確認してから送信側の再生を開始してください'),
    'RX must require a first-frame preflight before TX playback');
  assert(page.includes('ブロックをタップすると、その位置から再生できます'), 'TX block map must explain tap-to-seek');
  assert(page.includes('role="slider" tabindex="-1"'), 'TX block map must be keyboard-focusable after data preparation');
  const txSectionStart = page.indexOf('class="blockmap-section tx-blockmap"');
  const txSectionEnd = page.indexOf('</div>\n <p class="muted" id="txFrameInfo">', txSectionStart);
  const txSection = page.slice(txSectionStart, txSectionEnd);
  assert(txSection.includes('現在表示中のQR位置') && txSection.includes('map-tx-current'), 'TX map legend must describe the colored active QR position');
  assert(txSection.includes('タップすると'), 'TX map must document tap-to-seek');
  assert(!txSection.includes('直接送信済み') && !txSection.includes('未送信'),
    'TX map must not imply sent/unsent state');
  const rxSectionStart = page.indexOf('class="blockmap-section rx-blockmap"');
  const rxSectionEnd = page.indexOf('<p id="rxStatus"', rxSectionStart);
  const rxSection = page.slice(rxSectionStart, rxSectionEnd);
  assert(rxSection.includes('直接取得') && rxSection.includes('復元済み') && rxSection.includes('未取得') &&
    !rxSection.includes('最後に読取') && !rxSection.includes('map-active'),
    'RX map must show acquisition/recovery state without a last-read marker');
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
  const largeBase45Plan = globalThis.AirgapLinkCore.buildFrames(new Uint8Array(5600),
    { chunkSize: 2800, parity: true, id: 'A1B2C3D4', wireFormat: 'base45' });
  assert.equal(largeBase45Plan.chunkSize, 2800, 'Legacy Core must preserve the expanded 2,800-byte chunk size');
  assert.equal(globalThis.AirgapLinkCore.parseFrame(largeBase45Plan.frames[0]).payload.length, 2800);
  const oversizedChunk = new Uint8Array(2801);
  const oversizedFrame = 'CMAL2:1/1:A1B2C3D4:' +
    globalThis.AirgapLinkCore.hex32(globalThis.AirgapLinkCore.crc32(oversizedChunk)) + ':' +
    globalThis.AirgapLinkWire.encodeBase45(oversizedChunk);
  assert.throws(() => globalThis.AirgapLinkCore.parseFrame(oversizedFrame),
    /上限2,800B/, 'Legacy receiver must reject a data fragment beyond the advertised cap');
  assert.equal(globalThis.MatrixQRCode.matrix(largeBase45Plan.frames[3]).length, 177,
    'A maximum-size Base45 parity frame must fit QR Version 40 at ECC-L fallback');
  const largeFountainEncoder = new globalThis.AirgapLinkFountain.Encoder(new Uint8Array(2800),
    { chunkSize: 2800, id: 'A1B2C3D4', wireFormat: 'base45' });
  assert.equal(largeFountainEncoder.fragmentLen, 2800, 'Fountain must preserve the expanded fragment size');
  const largeFountainPart = await largeFountainEncoder.nextPart();
  assert.equal(globalThis.AirgapLinkFountain.parseFrame(largeFountainPart.frame).data.length, 2800);
  assert.equal(globalThis.MatrixQRCode.matrix(largeFountainPart.frame).length, 177,
    'A maximum-size Fountain frame must fit QR Version 40 at ECC-L fallback');
  assert.equal(globalThis.MatrixQRCode.matrix('A'.repeat(4200)).length, 177,
    'The QR encoder must automatically evaluate Version 40');
  assert.throws(() => globalThis.MatrixQRCode.matrix('A'.repeat(4300)),
    /code length overflow|Version 40/i, 'Payloads beyond Version 40 capacity must fail clearly');
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

  const nextLegacyFrameIndexAfterPreflight = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'nextLegacyFrameIndexAfterPreflight') + ')'
  );
  assert.equal(nextLegacyFrameIndexAfterPreflight(5), 1,
    'After the preflight Data 1, legacy playback must continue at Data 2');
  assert.equal(nextLegacyFrameIndexAfterPreflight(1), 0,
    'A one-frame transfer must remain on its only frame and report unmeasured duration');

  const packetBlockIndexes = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'packetBlockIndexes') + ')'
  );
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
  assert(!ui.includes('updateBenchmarkSizeControls();') &&
    !ui.includes("autoTxTest').addEventListener"),
    'Removed benchmark controls must not be referenced during V16 startup or wired as UI actions');
  assert(!page.includes('id="autoTxTest"') && !page.includes('id="autoTxLog"') &&
    !page.includes('id="copyTxTestLog"'),
    'Hidden automatic benchmark DOM must be removed with the test controls');
  assert(!page.includes('保存ファイル名') && !page.includes('rxFilename') &&
    !page.includes('rxCompletionFilename') && !page.includes('received-file.bin'),
    'Receiver filename customization and filename display must be absent from the production UI');
  assert(!page.includes('<details') && !page.includes('<summary'),
    'Airgap Link input and receiver sections must be displayed directly without collapsible details');
  assert(!ui.includes("copyTxTestLog').addEventListener"),
    'Removed copy-log UI must not leave a null addEventListener startup failure');
  const packNamedPayload = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'packNamedPayload') + ')',
    { Uint8Array, DataView, TextEncoder }
  );
  const unpackNamedPayload = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'unpackNamedPayload') + ')',
    { Uint8Array, DataView, TextDecoder, MAX_BENCHMARK_BYTES: 64 * 1024 * 1024 }
  );
  const namedSourceBytes = Uint8Array.from([0, 1, 2, 127, 128, 255]);
  const namedPayload = packNamedPayload(namedSourceBytes, '撮影データ 01.png');
  const namedResult = unpackNamedPayload(namedPayload);
  assert.equal(namedResult.named, true);
  assert.equal(namedResult.filename, '撮影データ 01.png',
    'UTF-8 source filename must survive the transfer envelope');
  assert.deepEqual(Array.from(namedResult.bytes), Array.from(namedSourceBytes),
    'Filename metadata must not alter the original file bytes');
  const legacyNamedResult = unpackNamedPayload(namedSourceBytes);
  assert.equal(legacyNamedResult.named, false,
    'Previously created transfers without filename metadata must remain readable');
  assert.deepEqual(Array.from(legacyNamedResult.bytes), Array.from(namedSourceBytes));
  assert.throws(() => unpackNamedPayload(namedPayload.subarray(0, namedPayload.length - 1)),
    'Truncated filename envelopes must be rejected');
  assert(ui.includes('packNamedPayload(sourceBytes, sourceName)') &&
    ui.includes('unpackNamedPayload(unpacked.bytes)'),
    'Sender must package filename metadata and receiver must restore it after decompression');
  assert(ui.includes('if (copyBenchmarkButton) copyBenchmarkButton.disabled = false;'),
    'Completion benchmark recording must not dereference a removed copy button');
  assert(ui.includes('txFountainEncoder.seekToBlock(blockIndex)'),
    'Fountain seek must jump to the selected systematic Data packet');
  assert(ui.includes("txStage.addEventListener('click'") &&
    (ui.match(/txStage\.addEventListener\('click'/g) || []).length === 1,
    'QR display must use one click toggle for mouse and synthesized touch');
  assert(!ui.includes("txStage.addEventListener('touchend'") &&
    !ui.includes("txStage.addEventListener('pointerup'"),
    'QR display must not double-toggle with parallel touch/pointer handlers');
  assert(ui.includes("txHybridPhase = 'legacy';") && ui.includes('txIndex = frameIndex;'),
    'Block seek must restart the first-pass Data frame at the selected block');
  assert(ui.includes('legacyFrameIndexForBlock(blockIndex, txPlan)'),
    'Legacy seek must map source blocks to the corresponding Data frame');
  assert(ui.includes('renderGeneration !== txRenderGeneration'),
    'Stale asynchronous frame generation must not overwrite a newer seek');
  assert(!ui.includes('直接送信 '), 'TX summary must not show direct-sent counts');
  assert(ui.includes("txCurrentBlocks = new Set(txFountainPart.indexes);"),
    'Fountain TX map cursor must follow current XOR source blocks');
  const blockIndexFromPoint = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'blockIndexFromPoint') + ')'
  );
  assert.equal(blockIndexFromPoint(20 * 8 + 4, 4, 52 * 8, 8, 52), 20,
    'TX map coordinates must resolve a block in a one-row map');
  assert.equal(blockIndexFromPoint(8 + 4, 8 + 4, 75 * 8, 14 * 8, 1000), 76,
    'TX map coordinates must resolve rows correctly for large maps');
  assert.equal(blockIndexFromPoint(-1, 0, 600, 112, 1000), -1,
    'TX map coordinates outside the canvas must be rejected');

  const legacyFrameIndexForBlock = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'legacyFrameIndexForBlock') + ')'
  );
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
  const isInitialTransferFrame = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'isInitialTransferFrame') + ')',
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

  const recordTransferFrame = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'recordTransferFrame') + ')'
  );
  const elapsedTransferMs = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'elapsedTransferMs') + ')'
  );
  const formatElapsedMs = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'formatElapsedMs') + ')'
  );
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
  const formatRate = vm.runInNewContext(
    '(' + extractFunctionDeclaration(ui, 'formatRate') + ')'
  );
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
  assert.equal(fountain.gaussianFullRankRecovery, true,
    'Sparse GF(2) elimination must recover a full-rank system with no degree-1 equation');
  assert.equal(fountain.gaussianRank, 3);
  assert.equal(fountain.gaussianRecoveredBlocks, 3);
  assert.equal(fountain.gaussianUnderdeterminedNoGuess, true,
    'Sparse GF(2) elimination must leave free variables unknown');

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
  assert.equal(firstRepair.data.length, hybridPlan.chunkSize,
    'The first repair frame must carry a full fragment, not an empty transition marker');
  assert(firstRepair.frame.length > 0, 'The first repair frame must contain a complete encoded packet');
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
    'PASS duplicate/CRC/transfer isolation; PASS sparse GF(2) Gaussian recovery; PASS V6 second-frame stopwatch and legacy Data 2 start; PASS V5 seek API; PASS first-frame RX preflight; PASS Hybrid P0/P1-to-LT recovery including systematic seek\n'
  );
}

main().catch((error) => {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
