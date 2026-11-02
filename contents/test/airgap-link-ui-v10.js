(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Core = window.AirgapLinkCore;
  var Fountain = window.AirgapLinkFountain;
  var Wire = window.AirgapLinkWire;
  var txPlan = null;
  var txFountainEncoder = null;
  var txFountainPart = null;
  var txMode = 'legacy';
  var txHybridPhase = 'legacy';
  var txCurrentBlocks = new Set();
  var txMapSelectedIndex = 0;
  var txIndex = 0;
  var txTimer = 0;
  var txPlaying = false;
  var txRenderGeneration = 0;
  var rx = new Core.Receiver();
  var fountainRx = new Fountain.Receiver();
  var activeProtocol = null;
  var hybridFountainMeta = null;
  var hybridImportedBlocks = new Set();
  var rxFirstFrameCaptured = false;
  var rxDirectBlocks = new Set();
  var rxCurrentBlocks = new Set();
  var rxCurrentLabel = '';
  var txCurrentLabel = '';
  var stream = null;
  var detector = null;
  var zxingDecoder = null;
  var scannerType = '';
  var scannerPreference = 'auto';
  var scannerName = '未初期化';
  var scanBusy = false;
  var scanTimer = 0;
  var uniqueFrameCount = 0;
  var scanAttempts = 0;
  var scanHits = 0;
  var scanDecodeTotalMs = 0;
  var scanIngestTotalMs = 0;
  var scanDecodeSamples = [];
  var benchmarkRuns = [];
  var benchmarkRunRecorded = false;
  var rxCameraSettings = null;
  var rxRequestedResolution = null;
  var scanVideoFrameCallback = null;
  var cameraFpsCallback = null;
  var cameraFpsWindowStart = 0;
  var cameraFpsWindowFrames = 0;
  var cameraFpsPreviousPresentedFrames = null;
  var cameraObservedFps = null;
  var txMapLastBlocks = null;
  var txMapLastTotal = -1;
  var txMapLastFocusIndex = null;
  var rxMapDirty = true;
  var scanStartAt = 0;
  var scanFirstHitAt = 0;
  var transferTiming = { startedAt: null, endedAt: null, frameCount: 0 };
  var objectUrl = null;
  var receivedDone = false;
  var rxTransferId = '';
  var autoTestRunning = false;
  var autoTestTimer = 0;
  var autoResetTimer = 0;
  var autoTestResolve = null;

  function status(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB';
  }

  function formatRate(bytes, elapsedMs) {
    if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return '—';
    var kibPerSecond = bytes * 1000 / elapsedMs / 1024;
    return kibPerSecond.toFixed(2) + ' KB/s';
  }

  function sameSet(left, right) {
    if (!left || !right || left.size !== right.size) return false;
    for (var value of left) if (!right.has(value)) return false;
    return true;
  }

  function recordTransferFrame(timing, firstFramePending, duplicate, now) {
    if (!timing || firstFramePending || duplicate) return false;
    if (timing.startedAt === null) {
      timing.startedAt = now;
      timing.endedAt = null;
      timing.frameCount = 1;
      return true;
    }
    if (timing.endedAt === null) timing.frameCount++;
    return false;
  }

  function elapsedTransferMs(timing, now) {
    if (!timing || timing.startedAt === null) return null;
    var endAt = timing.endedAt === null ? now : timing.endedAt;
    return Math.max(0, endAt - timing.startedAt);
  }

  function formatElapsedMs(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
    var totalSeconds = Math.floor(milliseconds / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var mm = String(minutes).padStart(2, '0');
    var ss = String(seconds).padStart(2, '0');
    return hours
      ? String(hours).padStart(2, '0') + ':' + mm + ':' + ss
      : mm + ':' + ss;
  }

  function percentileValue(samples, percentile) {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    var sorted = samples.filter(Number.isFinite).slice().sort(function (a, b) { return a - b; });
    if (!sorted.length) return null;
    var p = Math.min(1, Math.max(0, Number(percentile) || 0));
    var position = (sorted.length - 1) * p;
    var lower = Math.floor(position);
    var upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function nextLegacyFrameIndexAfterPreflight(frameCount) {
    return Number.isSafeInteger(frameCount) && frameCount > 1 ? 1 : 0;
  }

  function updateControls() {
    $('chunkSizeValue').textContent = $('chunkSize').value + ' B';
    $('fpsValue').textContent = $('fps').value + ' fps';
  }

  function packetBlockIndexes(packet) {
    if (!packet || !Number.isSafeInteger(packet.total) || packet.total < 1) {
      throw new Error('ブロック位置を計算できないQRフレームです');
    }
    if (packet.type === 'data') {
      if (!Number.isSafeInteger(packet.index) || packet.index < 0 || packet.index >= packet.total) {
        throw new Error('データ片のブロック番号が不正です');
      }
      return [packet.index];
    }
    if (packet.type === 'parity') {
      if (!Number.isSafeInteger(packet.group) || packet.group < 0 || packet.group * 8 >= packet.total) {
        throw new Error('パリティグループ番号が不正です');
      }
      var start = packet.group * 8;
      var count = Math.min(8, packet.total - start);
      return Array.from({ length: count }, function (_, offset) { return start + offset; });
    }
    throw new Error('未対応のQRフレーム種別です');
  }

  function drawBlockMap(canvasId, total, directSet, recoveredSet, activeSet, activeFill, focusIndex) {
    var canvas = $(canvasId);
    if (!canvas) return;
    total = Math.max(0, Number(total) || 0);

    var columns = total ? Math.min(75, total) : 75;
    var rows = Math.max(1, Math.ceil(total / columns));

    var cell = Math.max(1, Math.min(8, Math.floor(4096 / rows)));
    canvas.width = columns * cell;
    canvas.height = rows * cell;
    var context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#17283a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!total) return;
    for (var index = 0; index < total; index++) {
      var color = '#253b52';
      if (directSet && directSet.has(index)) color = '#27bd8d';
      if (recoveredSet && recoveredSet.has(index)) color = '#e5b44f';
      if (activeFill && activeSet && activeSet.has(index)) color = '#20c9d7';
      var x = (index % columns) * cell;
      var y = Math.floor(index / columns) * cell;
      context.fillStyle = color;
      context.fillRect(x, y, cell - 1, cell - 1);
      if (activeSet && activeSet.has(index)) {

        if (cell >= 5) {
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          context.strokeRect(x + 0.5, y + 0.5, cell - 2, cell - 2);
        }
        context.strokeStyle = '#07111d';
        context.lineWidth = cell >= 5 ? 1.5 : 1;
        context.strokeRect(x + 1, y + 1, Math.max(0, cell - 3), Math.max(0, cell - 3));
      }
      if (focusIndex === index) {
        context.save();
        context.setLineDash([2, 1]);
        context.strokeStyle = '#ffd166';
        context.lineWidth = 1.5;
        context.strokeRect(x + 0.75, y + 0.75, Math.max(0, cell - 1.5), Math.max(0, cell - 1.5));
        context.restore();
      }
    }
  }

  function txBlockTotal() {
    if (txMode === 'fountain' && txFountainEncoder) return txFountainEncoder.seqLen;
    return txPlan ? txPlan.dataFrames.length : 0;
  }

  function updateTxBlockMap() {
    var canvas = $('txBlockMap');
    var total = txBlockTotal();
    if (total) {
      txMapSelectedIndex = Math.max(0, Math.min(total - 1, txMapSelectedIndex));
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-disabled', 'false');
      canvas.setAttribute('aria-valuemax', String(total));
      canvas.setAttribute('aria-valuenow', String(txMapSelectedIndex + 1));
      canvas.setAttribute('aria-valuetext', 'ブロック ' + (txMapSelectedIndex + 1) + ' を選択');
      var focusIndex = document.activeElement === canvas ? txMapSelectedIndex : -1;
      if (total !== txMapLastTotal || !sameSet(txCurrentBlocks, txMapLastBlocks) ||
          focusIndex !== txMapLastFocusIndex) {
        drawBlockMap('txBlockMap', total, null, null, txCurrentBlocks, true, focusIndex);
        txMapLastBlocks = new Set(txCurrentBlocks);
        txMapLastTotal = total;
        txMapLastFocusIndex = focusIndex;
      }
      $('txBlockSummary').textContent = '元データ ' + total + 'ブロック · ' +
        (txCurrentLabel || '現在のQR位置を表示します');
    } else {
      canvas.tabIndex = -1;
      canvas.setAttribute('aria-disabled', 'true');
      canvas.setAttribute('aria-valuemax', '1');
      canvas.setAttribute('aria-valuenow', '1');
      canvas.setAttribute('aria-valuetext', '転送データなし');
      if (txMapLastTotal !== 0) {
        drawBlockMap('txBlockMap', 0, null, null, null, false, -1);
        txMapLastBlocks = new Set();
        txMapLastTotal = 0;
        txMapLastFocusIndex = -1;
      }
      $('txBlockSummary').textContent = '転送データを準備するとブロックが表示されます';
    }
  }

  function blockIndexFromPoint(x, y, canvasWidth, canvasHeight, total) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || total < 1 || canvasWidth < 1 || canvasHeight < 1 ||
        x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return -1;
    var columns = Math.min(75, total);
    var rows = Math.max(1, Math.ceil(total / columns));
    var cell = Math.max(1, Math.min(8, Math.floor(4096 / rows)));
    var column = Math.floor(x / cell);
    var row = Math.floor(y / cell);
    if (column >= columns || row >= rows) return -1;
    var index = row * columns + column;
    return index < total ? index : -1;
  }

  function legacyFrameIndexForBlock(blockIndex, plan) {
    if (!plan || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= plan.dataFrames.length) return -1;
    var groupSize = plan.groupSize || 8;
    var groupsBefore = Math.floor(blockIndex / groupSize);
    return blockIndex + (plan.parityFrames ? groupsBefore * 2 : 0);
  }

  function seekTxToBlock(blockIndex) {
    var total = txBlockTotal();
    if (!total || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= total) return;
    try {
      if (txTimer) clearTimeout(txTimer);
      txTimer = 0;
      txRenderGeneration++;
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      var fountainPhase = txMode === 'fountain' || (hybridMode && txHybridPhase === 'fountain');
      if (fountainPhase && txFountainEncoder) {
        if (typeof txFountainEncoder.seekToBlock !== 'function') {
          throw new Error('Fountain EncoderとUIのAPI版が一致しません。ページを再読み込みしてください');
        }
        txFountainEncoder.seekToBlock(blockIndex);
      } else {
        var frameIndex = legacyFrameIndexForBlock(blockIndex, txPlan);
        if (frameIndex < 0 || frameIndex >= txPlan.frames.length) throw new Error('指定ブロックのフレーム位置が見つかりません');
        var packet = Core.parseFrame(txPlan.frames[frameIndex]);
        if (packet.type !== 'data' || packet.index !== blockIndex) throw new Error('指定ブロックとDataフレームの位置が一致しません');
        txIndex = frameIndex;
      }
      txMapSelectedIndex = blockIndex;
      txPlaying = true;
      $('playTx').disabled = true;
      $('pauseTx').disabled = false;
      status('txStatus', 'ブロック ' + (blockIndex + 1) + ' から再生を開始しました。', 'info');
      showNextFrame();
    } catch (error) {
      status('txStatus', '再生位置の変更に失敗しました: ' + error.message, 'error');
    }
  }

  function onTxBlockMapClick(event) {
    var total = txBlockTotal();
    if (!total) return;
    var canvas = $('txBlockMap');
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = (event.clientX - rect.left) * canvas.width / rect.width;
    var y = (event.clientY - rect.top) * canvas.height / rect.height;
    var index = blockIndexFromPoint(x, y, canvas.width, canvas.height, total);
    if (index < 0) return;
    canvas.focus();
    txMapSelectedIndex = index;
    seekTxToBlock(index);
  }

  function onTxBlockMapKeyDown(event) {
    var total = txBlockTotal();
    if (!total) return;
    var columns = Math.min(75, total);
    var next = txMapSelectedIndex;
    if (event.key === 'ArrowLeft') next = Math.max(0, next - 1);
    else if (event.key === 'ArrowRight') next = Math.min(total - 1, next + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, next - columns);
    else if (event.key === 'ArrowDown') next = Math.min(total - 1, next + columns);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = total - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      seekTxToBlock(txMapSelectedIndex);
      return;
    } else return;
    event.preventDefault();
    txMapSelectedIndex = next;
    updateTxBlockMap();
  }

  function updateModeControls() {
    var mode = $('transferMode').value;
    var fountainMode = mode === 'fountain';
    var hybridMode = mode === 'hybrid';
    var dataOnlyMode = mode === 'legacy-data' || mode === 'hybrid-data';
    var parityLocked = fountainMode || hybridMode || dataOnlyMode;
    if (hybridMode) $('parityEnabled').checked = true;
    if (dataOnlyMode) $('parityEnabled').checked = false;
    $('parityEnabled').disabled = parityLocked;
    $('parityEnabled').parentElement.style.opacity = parityLocked ? '.45' : '1';
    if (fountainMode) {
      $('txModeHint').textContent = 'Pure LT: 最初のK片を直接送信し、その後はXOR合成パケットを継続送信します。';
    } else if (hybridMode) {
      $('txModeHint').textContent = 'LT Hybrid: 最初に従来Data + P0/P1を1周し、その後LT XORパケットで残った欠落を補完します。先頭QRをRXで読み取ってから送信開始してください。';
    } else if (mode === 'hybrid-data') {
      $('txModeHint').textContent = 'Data-only + LT: 最初にDataのみを1周し、その後LT XORパケットで残った欠落を補完します。';
    } else if (mode === 'legacy-data') {
      $('txModeHint').textContent = '従来Data-only: パリティなしでデータ片を順番に1周します。';
    } else {
      $('txModeHint').textContent = '従来方式: 順次データ片と、任意のP0/P1ブロックパリティを送信します。';
    }
    $('txFrameCountLabel').textContent = fountainMode
      ? '元データ片数 / 送信は継続'
      : hybridMode || mode === 'hybrid-data'
        ? '初回 Data/Parity 周回 → LT補完'
        : 'データ / 総フレーム';
  }

  $('transferMode').addEventListener('change', function () {
    stopTx();
    txPlan = null;
    txFountainEncoder = null;
    txFountainPart = null;
    txHybridPhase = 'legacy';
    txCurrentBlocks.clear();
    txMapSelectedIndex = 0;
    txCurrentLabel = '';
    $('playTx').disabled = true;
    $('pauseTx').disabled = true;
    $('txPlaceholder').classList.remove('hidden');
    updateTxBlockMap();
    status('txStatus', '方式を変更しました。転送データを再準備してください。', 'info');
    updateModeControls();
  });
  $('chunkSize').addEventListener('input', updateControls);
  $('fps').addEventListener('input', updateControls);
  $('txBlockMap').addEventListener('click', onTxBlockMapClick);
  $('txBlockMap').addEventListener('keydown', onTxBlockMapKeyDown);
  $('txBlockMap').addEventListener('focus', updateTxBlockMap);
  $('txBlockMap').addEventListener('blur', updateTxBlockMap);
  updateControls();

  function renderQr(text) {
    if (!window.MatrixQRCode) throw new Error('MatrixQRCode が読み込まれていません');
    var matrix = MatrixQRCode.matrix(text);
    var canvas = $('txCanvas');
    var context = canvas.getContext('2d', { alpha: false });
    var size = canvas.width;
    var quiet = 4;
    var modules = matrix.length;
    var total = modules + quiet * 2;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#000';
    context.beginPath();

    for (var row = 0; row < modules; row++) {
      var run = -1;
      for (var col = 0; col <= modules; col++) {
        var dark = col < modules && matrix[row][col];
        if (dark && run < 0) run = col;
        if (!dark && run >= 0) {
          var x0 = Math.floor((run + quiet) * size / total);
          var x1 = Math.ceil((col + quiet) * size / total);
          var y0 = Math.floor((row + quiet) * size / total);
          var y1 = Math.ceil((row + 1 + quiet) * size / total);
          context.rect(x0, y0, x1 - x0, y1 - y0);
          run = -1;
        }
      }
    }
    context.fill();
    return { versionModules: modules, matrix: matrix };
  }

  async function prepareTx() {
    stopTx();
    $('prepareTx').disabled = true;
    try {
      var file = $('txFile').files && $('txFile').files[0];
      var sourceBytes;
      var sourceName;
      if (file) {
        if (file.size > 8 * 1000 * 1000) throw new Error('試験ページの上限は8 MBです');
        sourceBytes = new Uint8Array(await file.arrayBuffer());
        sourceName = file.name;
      } else {
        var text = $('txText').value;
        if (!text) throw new Error('ファイルまたはテキストを指定してください');
        sourceBytes = new TextEncoder().encode(text);
        sourceName = 'message.txt';
      }

      var wireBytes = sourceBytes;
      var compressionNote = '圧縮なし';
      if ($('compressionEnabled').checked) {
        var packed = await Core.compressIfSmaller(sourceBytes);
        wireBytes = packed.bytes;
        compressionNote = packed.compressed
          ? 'Deflate: ' + formatBytes(sourceBytes.length) + ' → ' + formatBytes(wireBytes.length)
          : 'Deflate省略: ' + packed.reason;
      }

      txMode = $('transferMode').value;
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      var wireFormat = $('wireFormat').value === 'base64url' ? 'base64url' : 'base45';
      txHybridPhase = 'legacy';
      txPlan = null;
      txFountainEncoder = null;
      txFountainPart = null;
      txCurrentBlocks.clear();
      txMapSelectedIndex = 0;
      txIndex = 0;

      var firstFrame;
      var transferId;
      var blockCount;
      var frameLabel;
      if (txMode === 'fountain') {
        txFountainEncoder = new Fountain.Encoder(wireBytes, {
          chunkSize: Number($('chunkSize').value),
          wireFormat: wireFormat
        });
        if (typeof txFountainEncoder.seekToBlock !== 'function') {
          throw new Error('Fountain Encoder APIが不完全です。V5のFountainモジュールを確認してください');
        }
        txFountainPart = await txFountainEncoder.nextPart();
        firstFrame = txFountainPart.frame;
        transferId = txFountainEncoder.id;
        blockCount = txFountainEncoder.seqLen;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq 1 · Data · 対象 1';
        $('txFrameCount').textContent = blockCount + ' / ∞';
        frameLabel = 'LT seq 1 / K=' + blockCount + ' · system';
      } else {
        var parityEnabled = txMode === 'hybrid' ? true
          : (txMode === 'legacy-data' || txMode === 'hybrid-data' ? false : $('parityEnabled').checked);
        txPlan = Core.buildFrames(wireBytes, {
          chunkSize: Number($('chunkSize').value),
          parity: parityEnabled,
          wireFormat: wireFormat
        });
        firstFrame = txPlan.frames[0];
        transferId = txPlan.id;
        blockCount = txPlan.dataFrames.length;
        var firstPacket = Core.parseFrame(firstFrame);
        txCurrentBlocks = new Set(packetBlockIndexes(firstPacket));
        if (firstPacket.type === 'data') {
          txCurrentLabel = 'Data ' + (firstPacket.index + 1) + ' / ' + firstPacket.total;
        } else {
          txCurrentLabel = 'P' + firstPacket.parityType + ' · group ' +
            (firstPacket.group + 1) + ' · block ' +
            (firstPacket.group * Core.GROUP_SIZE + 1) + '–' +
            Math.min(firstPacket.total, (firstPacket.group + 1) * Core.GROUP_SIZE);
        }
        if (hybridMode) {
          txFountainEncoder = new Fountain.Encoder(wireBytes, {
            chunkSize: Number($('chunkSize').value),
            id: txPlan.id,
            wireFormat: wireFormat
          });
          if (txFountainEncoder.seqLen !== blockCount ||
              txFountainEncoder.fragmentLen !== txPlan.chunkSize) {
            throw new Error('HybridのDataブロックとLTブロック境界が一致しません');
          }
          if (typeof txFountainEncoder.seekToBlock !== 'function') {
            throw new Error('Fountain Encoder APIが不完全です。V5のFountainモジュールを確認してください');
          }
          txFountainEncoder.startRepairPhase();
          txHybridPhase = 'legacy';
          txIndex = 1;
          $('txFrameCount').textContent = blockCount + ' / ' + txPlan.frames.length + ' → LT';
          frameLabel = 'Hybrid 初回QR · Data 1 / ' + blockCount + ' · RX読取待ち';
        } else {
          txIndex = nextLegacyFrameIndexAfterPreflight(txPlan.frames.length);
          $('txFrameCount').textContent = txPlan.dataFrames.length + ' / ' + txPlan.frames.length;
          frameLabel = 'フレーム 1 / ' + txPlan.frames.length + ' · ' + firstPacket.type;
        }
      }
      var planStart = performance.now();
      renderQr(firstFrame);
      var initialRenderMs = performance.now() - planStart;
      $('txPlaceholder').classList.add('hidden');
      $('playTx').disabled = false;
      $('pauseTx').disabled = true;
      $('txPayloadSize').textContent = formatBytes(wireBytes.length);
      $('txQrGenMs').textContent = initialRenderMs.toFixed(1) + ' ms';
      $('txFrameInfo').textContent = frameLabel;
      $('txProgress').style.width = (txMode === 'fountain' || hybridMode ? (1 / blockCount * 100) : 0).toFixed(1) + '%';
      updateTxBlockMap();
      status('txStatus',
        '準備完了: ' + sourceName + ' · 元データ ' + formatBytes(sourceBytes.length) +
        ' · 転送 ' + formatBytes(wireBytes.length) + ' · ' + compressionNote +
        ' · ' + (txMode === 'fountain' ? 'Pure LT' : hybridMode ? (txMode === 'hybrid' ? 'LT Hybrid Data+P0/P1' : 'Data-only + LT') : txMode === 'legacy-data' ? 'Data-only' : 'Legacy') +
        ' · QR形式 ' + (wireFormat === 'base45' ? 'CMAL2 / Base45 / Alphanumeric' : 'CMAL1 / Base64URL / Byte') +
        ' · ID ' + transferId,
        'ok');
    } catch (error) {
      txPlan = null;
      txFountainEncoder = null;
      txFountainPart = null;
      $('playTx').disabled = true;
      $('pauseTx').disabled = true;
      $('txPlaceholder').classList.remove('hidden');
      status('txStatus', '準備失敗: ' + error.message, 'error');
    } finally {
      $('prepareTx').disabled = false;
    }
  }

  function stopTx() {
    txPlaying = false;
    txRenderGeneration++;
    if (txTimer) clearTimeout(txTimer);
    txTimer = 0;
    $('playTx').disabled = !(txPlan || txFountainEncoder);
    $('pauseTx').disabled = true;
  }

  async function showNextFrame() {
    if (!txPlan && !txFountainEncoder) return;
    var renderGeneration = ++txRenderGeneration;
    var started = performance.now();
    try {
      var frame;
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      if (hybridMode && txHybridPhase === 'legacy' && txIndex >= txPlan.frames.length) {
        txHybridPhase = 'fountain';
        status('txStatus', '従来Data/P0/P1の初回周回が終了しました。LT修復パケットへ移行します。', 'info');
      }
      var fountainPhase = txMode === 'fountain' || (hybridMode && txHybridPhase === 'fountain');
      if (fountainPhase) {
        var nextFountainPart = await txFountainEncoder.nextPart();
        if (renderGeneration !== txRenderGeneration) return;
        txFountainPart = nextFountainPart;
        frame = txFountainPart.frame;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq ' + txFountainPart.seqNum + ' · ' +
          (txFountainPart.direct ? 'Data再送' : 'XOR修復') + ' · 対象 ' +
          txFountainPart.indexes.map(function (index) { return index + 1; }).join(',');
        $('txFrameCount').textContent = txFountainEncoder.seqLen + ' / ∞';
        $('txFrameInfo').textContent =
          (hybridMode ? 'Hybrid LT修復' : 'LT') + ' seq ' + txFountainPart.seqNum + ' · ' +
          (txFountainPart.direct ? '直接片再送' : 'XOR合成 degree=' + txFountainPart.indexes.length) +
          ' · K=' + txFountainEncoder.seqLen;
        $('txProgress').style.width =
          (Math.min(txFountainEncoder.seqLen, txFountainPart.seqNum) / txFountainEncoder.seqLen * 100).toFixed(1) + '%';
      } else {
        frame = txPlan.frames[txIndex];
        var parsed = Core.parseFrame(frame);
        txCurrentBlocks = new Set(packetBlockIndexes(parsed));
        if (parsed.type === 'data') txCurrentLabel = 'Data ' + (parsed.index + 1) + ' / ' + parsed.total;
        else txCurrentLabel = 'P' + parsed.parityType + ' · group ' + (parsed.group + 1) +
          ' · block ' + (parsed.group * Core.GROUP_SIZE + 1) + '–' +
          Math.min(parsed.total, (parsed.group + 1) * Core.GROUP_SIZE);
        $('txFrameInfo').textContent =
          (hybridMode ? 'Hybrid初回周回 ' : 'フレーム ') + (txIndex + 1) + ' / ' + txPlan.frames.length +
          ' · ' + parsed.type + ' · ' + (1000 / Number($('fps').value)).toFixed(1) + ' ms/frame';
        $('txProgress').style.width = ((txIndex + 1) / txPlan.frames.length * 100).toFixed(1) + '%';
        if (hybridMode) txIndex++;
        else txIndex = (txIndex + 1) % txPlan.frames.length;
      }
      if (renderGeneration !== txRenderGeneration) return;
      renderQr(frame);
      updateTxBlockMap();
      // During an automatic sweep, send one finite pass per condition so RX records one run.
      if (autoTestRunning && txPlaying) {
        var autoStop = false;
        if (txMode === 'fountain') {
          autoStop = txFountainPart && txFountainPart.seqNum >= Math.ceil(txFountainEncoder.seqLen * 1.6);
        } else if (txMode === 'hybrid' || txMode === 'hybrid-data') {
          autoStop = txHybridPhase === 'fountain' && txFountainPart &&
            txFountainPart.seqNum >= Math.ceil(txFountainEncoder.seqLen * 1.6);
        } else {
          autoStop = txIndex >= txPlan.frames.length;
        }
        if (autoStop) { stopTx(); return; }
      }
      var elapsed = performance.now() - started;
      $('txQrGenMs').textContent = elapsed.toFixed(1) + ' ms';
      if (txPlaying) {
        var target = 1000 / Number($('fps').value);
        txTimer = setTimeout(showNextFrame, Math.max(0, target - elapsed));
      }
    } catch (error) {
      if (renderGeneration !== txRenderGeneration) return;
      stopTx();
      status('txStatus', 'QR生成エラー: ' + error.message + '。密度を下げてください。', 'error');
    }
  }

  function playTx() {
    if ((!txPlan && !txFountainEncoder) || txPlaying) return;
    txPlaying = true;
    $('playTx').disabled = true;
    $('pauseTx').disabled = false;
    showNextFrame();
  }

  $('prepareTx').addEventListener('click', prepareTx);
  $('playTx').addEventListener('click', playTx);
  $('pauseTx').addEventListener('click', function () {
    stopTx();
    status('txStatus', '送信を停止しました。再生で続きから再開できます。', 'info');
  });

  async function runTxAutoTest() {
    if (autoTestRunning) {
      autoTestRunning = false;
      if (autoTestTimer) clearTimeout(autoTestTimer);
      autoTestTimer = 0;
      if (autoTestResolve) { autoTestResolve(); autoTestResolve = null; }
      stopTx();
      $('autoTxTest').textContent = '送信条件の自動テスト';
      $('prepareTx').disabled = false;
      status('txStatus', '自動テストを停止しました。', 'info');
      return;
    }
    var file = $('txFile').files && $('txFile').files[0];
    var inputText = $('txText').value;
    if (!file && !inputText) {
      status('txStatus', '自動テスト用のファイルまたはテキストを指定してください。', 'error');
      return;
    }
    var inputSize = file ? file.size : new TextEncoder().encode(inputText).length;
    if (inputSize > 128 * 1024) {
      status('txStatus', '自動テストは128 KiB以下のデータで実行してください。大容量転送は条件ごとの所要時間が長くなります。', 'error');
      return;
    }
    var original = {
      mode: $('transferMode').value,
      chunk: $('chunkSize').value,
      fps: $('fps').value
    };
    // Deliberately use a compact, repeatable matrix to keep the run practical.
    var modes = ['legacy', 'fountain', 'hybrid'];
    var chunks = [180, 360, 540];
    var rates = [6, 12, 18];
    var cases = [];
    modes.forEach(function (mode) {
      chunks.forEach(function (chunk) {
        rates.forEach(function (fps) {
          cases.push({ mode: mode, chunk: chunk, fps: fps });
        });
      });
    });
    autoTestRunning = true;
    $('autoTxTest').textContent = '自動テストを停止';
    $('prepareTx').disabled = true;
    try {
      for (var i = 0; i < cases.length && autoTestRunning; i++) {
        var test = cases[i];
        $('transferMode').value = test.mode;
        $('chunkSize').value = String(test.chunk);
        $('fps').value = String(test.fps);
        $('chunkSizeValue').textContent = test.chunk + ' B';
        $('fpsValue').textContent = test.fps + ' fps';
        stopTx();
        await prepareTx();
        if (!autoTestRunning || (!txPlan && !txFountainEncoder)) break;
        var units = txMode === 'fountain'
          ? Math.ceil(txFountainEncoder.seqLen * 1.6)
          : (txPlan ? txPlan.frames.length : txFountainEncoder.seqLen);
        // Leave a short receive-reset interval between independent transfers.
        var duration = Math.min(90000, Math.max(10000, units * 1000 / test.fps * 1.35 + 3500));
        status('txStatus', '自動テスト ' + (i + 1) + '/' + cases.length + ' · ' +
          test.mode + ' · ' + test.chunk + ' B · ' + test.fps + ' fps · 送信中', 'info');
        playTx();
        await new Promise(function (resolve) {
          autoTestResolve = resolve;
          autoTestTimer = setTimeout(function () {
            autoTestTimer = 0; autoTestResolve = null; resolve();
          }, duration);
        });
        if (!autoTestRunning) break;
        stopTx();
        await new Promise(function (resolve) {
          autoTestResolve = resolve;
          autoTestTimer = setTimeout(function () {
            autoTestTimer = 0; autoTestResolve = null; resolve();
          }, 2200);
        });
      }
    } catch (error) {
      status('txStatus', '自動テストを中断しました: ' + error.message, 'error');
    } finally {
      autoTestRunning = false;
      if (autoTestTimer) clearTimeout(autoTestTimer);
      autoTestTimer = 0;
      stopTx();
      $('transferMode').value = original.mode;
      $('chunkSize').value = original.chunk;
      $('fps').value = original.fps;
      $('chunkSizeValue').textContent = original.chunk + ' B';
      $('fpsValue').textContent = original.fps + ' fps';
      $('autoTxTest').textContent = '送信条件の自動テスト';
      $('prepareTx').disabled = false;
      status('txStatus', '自動テスト終了。受信側のCSVに記録された条件別結果を比較してください。', 'ok');
    }
  }
  $('autoTxTest').addEventListener('click', runTxAutoTest);

  function resetRx() {
    if (autoResetTimer) { clearTimeout(autoResetTimer); autoResetTimer = 0; }
    rx.reset();
    fountainRx.reset();
    activeProtocol = null;
    hybridFountainMeta = null;
    hybridImportedBlocks.clear();
    rxFirstFrameCaptured = false;
    rxDirectBlocks.clear();
    rxCurrentBlocks.clear();
    rxCurrentLabel = '';
    uniqueFrameCount = 0;
    scanAttempts = 0;
    scanHits = 0;
    scanDecodeTotalMs = 0;
    scanIngestTotalMs = 0;
    scanDecodeSamples = [];
    benchmarkRunRecorded = false;
    rxMapDirty = false;
    scanStartAt = 0;
    scanFirstHitAt = 0;
    transferTiming.startedAt = null;
    transferTiming.endedAt = null;
    transferTiming.frameCount = 0;
    receivedDone = false;
    rxTransferId = '';
    $('rxProgress').style.width = '0%';
    $('rxProgressText').textContent = '0 / 0';
    $('rxRate').textContent = '0.0';
    $('rxElapsed').textContent = '—';
    $('rxAvgMs').textContent = '0 ms';
    $('rxP50Ms').textContent = '—';
    $('rxP95Ms').textContent = '—';
    $('rxSamples').textContent = '0 / 0';
    $('rxIngestMs').textContent = '0 ms';
    $('rxThroughput').textContent = '—';
    $('rxFileRate').textContent = '—';
    $('rxLost').textContent = '—';
    $('rxRecovered').textContent = '0';
    $('rxHitRate').textContent = '0%';
    $('rxBlockSummary').textContent = '受信を開始するとブロック状態が表示されます';
    drawBlockMap('rxBlockMap', 0, null, null, null);
    rxMapDirty = false;
    $('rxResultMeta').textContent = '';
    $('downloadResult').classList.add('hidden');
    $('downloadResult').removeAttribute('href');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    status('rxStatus', '受信待機中', 'info');
  }

  function updateRxStats() {
    var elapsedMs = elapsedTransferMs(transferTiming, performance.now());
    var elapsed = elapsedMs === null ? 0 : elapsedMs / 1000;
    $('rxElapsed').textContent = elapsedMs === null ? '—' : formatElapsedMs(elapsedMs);
    var have;
    var total;
    var recovered;
    var directSet;
    var recoveredSet;
    var activeSet;
    if (activeProtocol === 'fountain' || activeProtocol === 'hybrid') {
      have = fountainRx.simpleParts.size;
      total = fountainRx.seqLen;
      recovered = fountainRx.recoveredIndexes.size;
      directSet = fountainRx.directIndexes;
      recoveredSet = fountainRx.recoveredIndexes;
      activeSet = rxCurrentBlocks;
      $('rxBlockSummary').textContent =
        '元データ ' + total + 'ブロック · 直接取得 ' + fountainRx.directIndexes.size +
        ' · 合成片から復元 ' + recovered + ' · 受信パケット ' + fountainRx.receivedPartCount +
        ' · 直近読取: ' + (rxCurrentLabel || '—');
    } else {
      have = rx.shards.size;
      total = rx.total;
      recovered = rx.recoveredCount;
      directSet = rxDirectBlocks;
      recoveredSet = new Set();
      rx.shards.forEach(function (_value, index) {
        if (!rxDirectBlocks.has(index)) recoveredSet.add(index);
      });
      activeSet = rxCurrentBlocks;
      $('rxBlockSummary').textContent = total
        ? '元データ ' + total + 'ブロック · 直接取得 ' + rxDirectBlocks.size +
          ' · パリティ復元 ' + recoveredSet.size + ' · 直近読取: ' +
          (rxCurrentLabel || '—')
        : '受信を開始するとブロック状態が表示されます';
    }
    $('rxProgressText').textContent = have + ' / ' + total;
    $('rxProgress').style.width = total ? (have / total * 100).toFixed(1) + '%' : '0%';
    $('rxRate').textContent = elapsed >= 1 ? (transferTiming.frameCount / elapsed).toFixed(2) : '0.0';
    $('rxAvgMs').textContent = scanAttempts ? (scanDecodeTotalMs / scanAttempts).toFixed(1) + ' ms' : '0 ms';
    if (scanAttempts === 0 || scanAttempts % 8 === 0 || receivedDone) {
      var p50 = percentileValue(scanDecodeSamples, 0.50);
      var p95 = percentileValue(scanDecodeSamples, 0.95);
      $('rxP50Ms').textContent = p50 === null ? '—' : p50.toFixed(1) + ' ms';
      $('rxP95Ms').textContent = p95 === null ? '—' : p95.toFixed(1) + ' ms';
    }
    $('rxIngestMs').textContent = scanHits ? (scanIngestTotalMs / scanHits).toFixed(1) + ' ms' : '0 ms';
    $('rxSamples').textContent = scanAttempts + ' / ' + scanHits;
    $('rxLost').textContent = total ? String(Math.max(0, total - have)) : '—';
    $('rxRecovered').textContent = String(recovered);
    $('rxHitRate').textContent = scanAttempts ? (scanHits / scanAttempts * 100).toFixed(1) + '%' : '0%';
    if (rxMapDirty) {
      drawBlockMap('rxBlockMap', total, directSet, recoveredSet, activeSet);
      rxMapDirty = false;
    }
  }

  function currentRxProgress() {
    if (activeProtocol === 'fountain' || activeProtocol === 'hybrid') {
      return { have: fountainRx.simpleParts.size, total: fountainRx.seqLen };
    }
    return { have: rx.shards.size, total: rx.total };
  }

  function recordBenchmarkRun() {
    if (!receivedDone || benchmarkRunRecorded) return;
    var progress = currentRxProgress();
    var elapsedMs = elapsedTransferMs(transferTiming, performance.now());
    var p50 = percentileValue(scanDecodeSamples, 0.50);
    var p95 = percentileValue(scanDecodeSamples, 0.95);
    var camera = rxCameraSettings || {};
    var sampleCount = scanAttempts;
    var run = {
      recordedAt: new Date().toISOString(),
      transferId: rxTransferId,
      requestedResolution: camera.requestedResolution || rxRequestedResolution || '',
      actualWidth: camera.width || '',
      actualHeight: camera.height || '',
      actualFrameRate: camera.frameRate || '',
      observedVideoFps: cameraObservedFps,
      scanner: scannerName,
      attempts: sampleCount,
      hits: scanHits,
      hitRatePercent: sampleCount ? scanHits / sampleCount * 100 : 0,
      decodeMeanMs: sampleCount ? scanDecodeTotalMs / sampleCount : null,
      decodeP50Ms: p50,
      decodeP95Ms: p95,
      uniqueFrames: transferTiming.frameCount,
      uniqueFramesPerSecond: elapsedMs && elapsedMs > 0
        ? transferTiming.frameCount * 1000 / elapsedMs : null,
      receivedBlocks: progress.have,
      totalBlocks: progress.total,
      completionMs: elapsedMs,
      samples: scanDecodeSamples.slice()
    };
    benchmarkRuns.push(run);
    benchmarkRunRecorded = true;
    $('benchmarkRunCount').textContent =
      '完了した計測: ' + benchmarkRuns.length + '件（このページを開いている間保持）';
    $('exportBenchmarkCsv').disabled = false;
  }

  function csvCell(value) {
    return '"' + String(value === null || value === undefined ? '' : value).replace(/"/g, '""') + '"';
  }

  function exportBenchmarkCsv() {
    if (!benchmarkRuns.length) return;
    var rows = [[
      'record_type', 'run', 'recorded_at', 'transfer_id', 'requested_resolution',
      'actual_resolution', 'actual_frame_rate', 'observed_video_fps', 'scanner', 'scan_attempts',
      'scan_hits', 'hit_rate_percent', 'decode_mean_ms', 'decode_p50_ms',
      'decode_p95_ms', 'unique_frames_per_second', 'unique_frames',
      'received_blocks', 'total_blocks', 'completion_ms', 'sample_index', 'decode_ms'
    ]];
    benchmarkRuns.forEach(function (run, runIndex) {
      var common = [
        runIndex + 1,
        run.recordedAt,
        run.transferId,
        run.requestedResolution,
        run.actualWidth && run.actualHeight ? run.actualWidth + 'x' + run.actualHeight : '',
        run.actualFrameRate,
        run.observedVideoFps === null ? '' : run.observedVideoFps,
        run.scanner,
        run.attempts,
        run.hits,
        run.hitRatePercent.toFixed(2),
        run.decodeMeanMs === null ? '' : run.decodeMeanMs.toFixed(3),
        run.decodeP50Ms === null ? '' : run.decodeP50Ms.toFixed(3),
        run.decodeP95Ms === null ? '' : run.decodeP95Ms.toFixed(3),
        run.uniqueFramesPerSecond === null ? '' : run.uniqueFramesPerSecond.toFixed(3),
        run.uniqueFrames,
        run.receivedBlocks,
        run.totalBlocks,
        run.completionMs === null ? '' : run.completionMs.toFixed(1)
      ];
      rows.push(['summary'].concat(common, ['', '']).map(csvCell).join(','));
      run.samples.forEach(function (sample, sampleIndex) {
        rows.push(['scan'].concat(common, [sampleIndex + 1, sample.toFixed(3)]).map(csvCell).join(','));
      });
    });
    var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'airgap-link-resolution-benchmark-' +
      new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function safeFilename(value) {
    var name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return name || 'airgap-link-received.bin';
  }

  function stopCameraFpsMeasurement() {
    var video = $('camera');
    if (cameraFpsCallback !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(cameraFpsCallback);
    }
    cameraFpsCallback = null;
    cameraFpsWindowStart = 0;
    cameraFpsWindowFrames = 0;
    cameraFpsPreviousPresentedFrames = null;
    cameraObservedFps = null;
    var output = $('rxObservedFps');
    if (output) output.textContent = '—';
  }

  function startCameraFpsMeasurement() {
    stopCameraFpsMeasurement();
    var video = $('camera');
    var output = $('rxObservedFps');
    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
      if (output) output.textContent = '計測非対応';
      return;
    }
    cameraFpsWindowStart = performance.now();
    cameraFpsWindowFrames = 0;
    cameraFpsPreviousPresentedFrames = null;

    function onVideoFrame(now, metadata) {
      if (!stream || !video.srcObject) {
        cameraFpsCallback = null;
        return;
      }
      var presented = metadata && Number.isFinite(metadata.presentedFrames)
        ? metadata.presentedFrames : null;
      if (presented !== null && cameraFpsPreviousPresentedFrames !== null) {
        cameraFpsWindowFrames += Math.max(0, presented - cameraFpsPreviousPresentedFrames);
      } else {
        cameraFpsWindowFrames += 1;
      }
      cameraFpsPreviousPresentedFrames = presented;
      var elapsed = now - cameraFpsWindowStart;
      if (elapsed >= 1000) {
        cameraObservedFps = cameraFpsWindowFrames * 1000 / elapsed;
        if (output) output.textContent = cameraObservedFps.toFixed(1) + ' fps';
        cameraFpsWindowStart = now;
        cameraFpsWindowFrames = 0;
      }
      cameraFpsCallback = video.requestVideoFrameCallback(onVideoFrame);
    }
    cameraFpsCallback = video.requestVideoFrameCallback(onVideoFrame);
  }

  function captureCameraSettings() {
    var cameraTrack = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    var settings = {};
    var settingsAvailable = !!(cameraTrack && typeof cameraTrack.getSettings === 'function');
    if (settingsAvailable) {
      try { settings = cameraTrack.getSettings() || {}; }
      catch (_) { settings = {}; settingsAvailable = false; }
    }
    var video = $('camera');
    var width = Number(settings.width) || (video && video.videoWidth) || 0;
    var height = Number(settings.height) || (video && video.videoHeight) || 0;
    var frameRate = Number(settings.frameRate) || 0;
    rxCameraSettings = {
      requestedResolution: rxRequestedResolution || $('rxResolution').value,
      width: width,
      height: height,
      frameRate: frameRate,
      fromGetSettings: settingsAvailable
    };
    $('rxCameraSettings').textContent =
      '要求: ' + rxCameraSettings.requestedResolution +
      ' · 実解像度: ' + (width && height ? width + '×' + height : '取得不可') +
      ' · 実FPS: ' + (frameRate ? frameRate.toFixed(1) : '取得不可') +
      (settingsAvailable ? ' · getSettings()' : ' · video intrinsic size fallback');
    return rxCameraSettings;
  }

  async function finishReceive(bytes) {
    if (receivedDone) return;
    receivedDone = true;
    var unpacked = await Core.decompressIfWrapped(bytes);
    var finalBytes = unpacked.bytes;
    var name = safeFilename($('rxFilename').value);
    var blob = new Blob([finalBytes], { type: 'application/octet-stream' });
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    var link = $('downloadResult');
    link.href = objectUrl;
    link.download = name;
    link.classList.remove('hidden');
    var completedElapsedMs = elapsedTransferMs(transferTiming, performance.now());
    $('rxThroughput').textContent = completedElapsedMs === null ? '—' : formatRate(bytes.length, completedElapsedMs);
    $('rxFileRate').textContent = completedElapsedMs === null ? '—' : formatRate(finalBytes.length, completedElapsedMs);
    var firstDetection = scanFirstHitAt && scanStartAt ? ((scanFirstHitAt - scanStartAt) / 1000).toFixed(2) + '秒' : '—';
    var cameraSettings = captureCameraSettings();
    var cameraSize = cameraSettings.width && cameraSettings.height ? cameraSettings.width + '×' + cameraSettings.height : '—';
    $('rxResultMeta').textContent =
      '復元サイズ ' + formatBytes(finalBytes.length) +
      (unpacked.decompressed ? ' · Deflate展開済み' : '') +
      ' · 初回検出 ' + firstDetection +
      ' · 転送時間 ' + (completedElapsedMs === null ? '未計測（1枚目で完了）' : formatElapsedMs(completedElapsedMs) + '（2枚目QRから）') +
      ' · ' + scannerName + ' · カメラ ' + cameraSize +
      ' · CRC32検証済み · 転送ID ' + ((activeProtocol === 'fountain' || activeProtocol === 'hybrid') ? fountainRx.id : rx.id) +
      ' · 復元 ' + ((activeProtocol === 'fountain' || activeProtocol === 'hybrid') ? fountainRx.recoveredIndexes.size : rx.recoveredCount) + '片';
    status('rxStatus', '受信完了。ファイルを保存できます。', 'ok');
    updateRxStats();
    if ($('autoBenchmarkReset') && $('autoBenchmarkReset').checked) {
      // In benchmark mode, keep the camera alive; scanTick records this run before reset.
      if (autoResetTimer) clearTimeout(autoResetTimer);
      autoResetTimer = setTimeout(function () {
        autoResetTimer = 0;
        if ($('autoBenchmarkReset').checked && receivedDone) resetRx();
      }, 1800);
    } else {
      stopCamera();
    }
  }

  function isInitialTransferFrame(rawText) {
    try {
      if (!Wire.isAirgapFrame(rawText)) return false;
      if (Wire.isFountainFrame(rawText)) return Fountain.parseFrame(rawText).seqNum === 1;
      var packet = Core.parseFrame(rawText);
      return packet.type === 'data' && packet.index === 0;
    } catch (_) { return false; }
  }

  async function ingest(rawText) {
    if (receivedDone) return;
    if (!Wire.isAirgapFrame(rawText)) return;
    try {
      var firstFramePending = !rxFirstFrameCaptured;
      if (firstFramePending && !isInitialTransferFrame(rawText)) {
        throw new Error('先頭QRではありません。TXを停止し、Data 1（またはLT seq 1）を表示してから読み取ってください');
      }
      var isFountain = Wire.isFountainFrame(rawText);
      var hybridTransition = isFountain && activeProtocol === 'legacy';
      if (!isFountain && (activeProtocol === 'fountain' || activeProtocol === 'hybrid')) {
        throw new Error('同じ転送中にLegacyフレームへ戻ることはできません');
      }
      var result, have, total, recovered;
      if (isFountain) {
        var fountainPacket = Fountain.parseFrame(rawText);
        if (!rxTransferId) rxTransferId = fountainPacket.id;
        if (hybridTransition) {
          if (rx.id !== fountainPacket.id || rx.total !== fountainPacket.seqLen) {
            throw new Error('HybridのLT修復フレームが初回CMAL1と同じ転送ID／ブロック数ではありません');
          }
          hybridFountainMeta = fountainPacket;
          hybridImportedBlocks.clear();
          rx.shards.forEach(function (block, index) {
            fountainRx.addKnownBlock(hybridFountainMeta, index, block, rxDirectBlocks.has(index));
            hybridImportedBlocks.add(index);
          });
          activeProtocol = 'hybrid';
        } else if (activeProtocol === null) activeProtocol = 'fountain';
        else if (activeProtocol !== 'fountain' && activeProtocol !== 'hybrid') {
          throw new Error('別の転送方式のフレームです。受信をリセットしてください');
        }
        result = await fountainRx.feed(rawText);
        var indexes = result.lastIndexes || await fountainRx.chooser.choose(fountainPacket.seqNum);
        rxCurrentBlocks = new Set(indexes);
        rxCurrentLabel = 'LT seq ' + fountainPacket.seqNum + ' · blocks ' + indexes.map(function (index) { return index + 1; }).join(',');
        have = fountainRx.simpleParts.size;
        total = fountainRx.seqLen;
        recovered = fountainRx.recoveredIndexes.size;
      } else {
        var packet = Core.parseFrame(rawText);
        if (!rxTransferId) rxTransferId = packet.id;
        result = rx.feed(rawText);
        rxCurrentBlocks = new Set(packetBlockIndexes(packet));
        if (packet.type === 'data') {
          rxDirectBlocks.add(packet.index);
          rxCurrentLabel = 'Data ' + (packet.index + 1) + ' / ' + packet.total;
        } else {
          rxCurrentLabel = 'P' + packet.parityType + ' · group ' + (packet.group + 1) +
            ' · block ' + (packet.group * Core.GROUP_SIZE + 1) + '–' +
            Math.min(packet.total, (packet.group + 1) * Core.GROUP_SIZE);
        }
        if (activeProtocol === null) activeProtocol = 'legacy';
        have = rx.shards.size;
        total = rx.total;
        recovered = rx.recoveredCount;
      }
      var transferTimerStarted = recordTransferFrame(transferTiming, firstFramePending, result.duplicate, performance.now());
      if (!result.duplicate) rxMapDirty = true;
      if (firstFramePending) rxFirstFrameCaptured = true;
      if (!result.duplicate) uniqueFrameCount++;
      if (result.complete && transferTiming.startedAt !== null && transferTiming.endedAt === null) {
        transferTiming.endedAt = performance.now();
      }
      updateRxStats();
      if (transferTimerStarted) {
        status('rxStatus', '2枚目の有効なQRを受信しました。ここから転送時間を計測します。', 'ok');
      } else if (uniqueFrameCount <= 1) {
        status('rxStatus', '先頭QRを確認しました。送信側で再生を開始してください。途中参加は対象外です。', 'ok');
      } else {
        var modeLabel = activeProtocol === 'hybrid' ? 'LT Hybrid（P0/P1取得分 + LT修復）'
          : isFountain ? 'Pure LTファウンテン' : 'CMAL1';
        status('rxStatus', modeLabel + ' 受信中 · ' + have + ' / ' + total + 'ブロック · 復元 ' + recovered + '片', 'info');
      }
      if (result.complete) {
        try { await finishReceive(result.bytes); }
        catch (error) {
          receivedDone = false;
          status('rxStatus', '復元後の展開・保存準備に失敗しました: ' + error.message, 'error');
        }
      }
    } catch (error) {
      status('rxStatus', 'フレーム拒否: ' + error.message, 'error');
    }
  }

  async function initScanner() {
    detector = null;
    zxingDecoder = null;
    scannerType = '';
    scannerPreference = $('rxScanner') ? $('rxScanner').value : 'auto';
    var nativeError = null;

    if (scannerPreference === 'auto' || scannerPreference === 'native') {
      if (typeof window.BarcodeDetector === 'function') {
        try {
          var formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.indexOf('qr_code') !== -1) {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            scannerType = 'native';
            scannerName = 'Native BarcodeDetector';
          }
        } catch (error) {
          nativeError = error;
          detector = null;
        }
      }
      if (detector) {
        $('scannerMode').textContent = '読み取り方式: ' + scannerName;
        $('scannerMode').className = 'status info';
        return;
      }
      if (scannerPreference === 'native') {
        throw new Error(nativeError
          ? 'Native BarcodeDetector初期化失敗: ' + nativeError.message
          : 'このブラウザではQR対応のNative BarcodeDetectorを利用できません');
      }
    }

    if (scannerPreference === 'auto' || scannerPreference === 'zxing-wasm') {
      $('scannerMode').textContent = '読み取り方式: ZXing-C++ WASMを準備中…';
      $('scannerMode').className = 'status info';
      try {
        if (!window.AirgapLinkZXingLoader ||
            typeof window.AirgapLinkZXingLoader.load !== 'function') {
          throw new Error('ZXing WASMローダーを読み込めません');
        }
        zxingDecoder = await window.AirgapLinkZXingLoader.load();
        if (!zxingDecoder || typeof zxingDecoder.readBarcodes !== 'function') {
          throw new Error('ZXing WASMのreadBarcodes APIが見つかりません');
        }
        scannerType = 'zxing-wasm';
        scannerName = 'ZXing-C++ WASM 3.1.6';
        $('scannerMode').textContent = '読み取り方式: ' + scannerName;
        $('scannerMode').className = 'status info';
        return;
      } catch (error) {
        zxingDecoder = null;
        if (scannerPreference === 'zxing-wasm') {
          throw new Error('ZXing-C++ WASMを起動できません: ' + error.message);
        }
        nativeError = nativeError || error;
      }
    }

    if (scannerPreference !== 'jsqr' && scannerPreference !== 'auto') {
      throw new Error('未対応の読み取り方式です');
    }
    if (typeof window.jsQR !== 'function') {
      throw new Error('jsQR.jsを読み込めませんでした');
    }
    scannerType = 'jsqr';
    scannerName = scannerPreference === 'auto' ? 'jsQR fallback' : 'jsQR（指定）';
    $('scannerMode').textContent = '読み取り方式: ' + scannerName +
      (scannerPreference === 'auto' && nativeError ? ' · WASM利用不可: ' + nativeError.message : '');
    $('scannerMode').className = 'status info';
  }

  async function startCamera() {
    if (stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status('rxStatus', 'カメラにはHTTPSまたはlocalhostが必要です。手動フレーム入力を利用してください。', 'error');
      return;
    }
    $('startCamera').disabled = true;
    if ($('rxScanner')) $('rxScanner').disabled = true;
    status('rxStatus', '読み取り方式を初期化しています…', 'info');
    try {
      await initScanner();
      var resolutionParts = String($('rxResolution').value || '1920x1080').split('x');
      var requestedWidth = Number(resolutionParts[0]);
      var requestedHeight = Number(resolutionParts[1]);
      if (!Number.isInteger(requestedWidth) || !Number.isInteger(requestedHeight) ||
          ![[640, 480], [1280, 720], [1920, 1080]].some(function (pair) {
            return pair[0] === requestedWidth && pair[1] === requestedHeight;
          })) {
        throw new Error('カメラ解像度の選択値が不正です');
      }
      rxRequestedResolution = requestedWidth + '×' + requestedHeight;
      rxCameraSettings = null;
      $('rxCameraSettings').textContent = '要求: ' + rxRequestedResolution + ' · 実解像度を取得中…';
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: requestedWidth },
          height: { ideal: requestedHeight },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      var video = $('camera');
      video.srcObject = stream;
      await video.play();
      captureCameraSettings();
      startCameraFpsMeasurement();
      $('rxResolution').disabled = true;
      if ($('rxScanner')) $('rxScanner').disabled = true;
      $('startCamera').disabled = true;
      $('stopCamera').disabled = false;
      scanStartAt = performance.now();
      status('rxStatus', '初回QR待ち: TX側で先頭QRを静止表示し、このカメラで1枚目を確認してください。確認後にTXを再生します。2枚目の有効なQRを読み込んだ時点から転送時間を計測します。途中参加は対象外です。', 'info');
      scheduleScan(0);
    } catch (error) {
      stopCamera();
      status('rxStatus', 'カメラ開始失敗: ' + error.message, 'error');
    }
  }

  function scheduleScan(delay) {
    if (!stream || receivedDone) return;
    var video = $('camera');
    if ((!delay || delay === 0) && video && typeof video.requestVideoFrameCallback === 'function') {
      if (scanVideoFrameCallback !== null) return;
      scanVideoFrameCallback = video.requestVideoFrameCallback(function () {
        scanVideoFrameCallback = null;
        scanTick();
      });
      return;
    }
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      scanTick();
    }, Math.max(0, Number(delay) || 0));
  }

  function cancelScanSchedule() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = 0;
    var video = $('camera');
    if (scanVideoFrameCallback !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(scanVideoFrameCallback);
    }
    scanVideoFrameCallback = null;
  }

  function stopCamera() {
    cancelScanSchedule();
    stopCameraFpsMeasurement();
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    var video = $('camera');
    if (video.srcObject) video.srcObject = null;
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
    $('rxResolution').disabled = false;
    if ($('rxScanner')) $('rxScanner').disabled = false;
  }

  async function scanTick() {
    if (!stream || scanBusy || receivedDone) return;
    var video = $('camera');
    if (video.readyState < 2 || !video.videoWidth) {
      scheduleScan(30);
      return;
    }
    scanBusy = true;
    var raw = null;
    var decodeElapsed = 0;
    var ingestElapsed = 0;
    try {
      var decodeStarted = performance.now();
      try {
        if (detector) {
          try {
            var results = await detector.detect(video);
            var hit = results.find(function (item) { return Wire.isAirgapFrame(item.rawValue); });
            if (hit) raw = hit.rawValue;
          } catch (nativeError) {
            detector = null;
            scannerType = 'jsqr';
            if (scannerPreference === 'auto' && window.AirgapLinkZXingLoader) {
              try {
                zxingDecoder = await window.AirgapLinkZXingLoader.load();
                scannerType = 'zxing-wasm';
                scannerName = 'ZXing-C++ WASM 3.1.6（Native error fallback）';
              } catch (_) {
                scannerType = 'jsqr';
                scannerName = 'jsQR fallback (Native error)';
              }
            } else {
              scannerType = 'jsqr';
              scannerName = 'jsQR fallback (Native error)';
            }
            $('scannerMode').textContent = '読み取り方式: ' + scannerName;
          }
        }
        if (!detector && !raw) {
          var canvas = $('scanCanvas');
          var scale = Math.min(1, 1440 / video.videoWidth);
          var width = Math.max(1, Math.round(video.videoWidth * scale));
          var height = Math.max(1, Math.round(video.videoHeight * scale));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          var context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0, width, height);
          var image = context.getImageData(0, 0, width, height);
          if (scannerType === 'zxing-wasm') {
            var zxingResults = await zxingDecoder.readBarcodes(image, {
              formats: ['QRCode'],
              maxNumberOfSymbols: 1,
              tryHarder: false
            });
            var zxingHit = zxingResults.find(function (item) {
              return item && Wire.isAirgapFrame(item.text);
            });
            if (zxingHit) raw = zxingHit.text;
          } else {
            var decoded = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
            if (decoded) raw = decoded.data;
          }
        }
      } finally {
        decodeElapsed = performance.now() - decodeStarted;
      }
      if (raw) {
        scanHits++;
        if (!scanFirstHitAt) scanFirstHitAt = performance.now();
        var ingestStarted = performance.now();
        try {
          await ingest(raw.replace(/^[\r\n]+|[\r\n]+$/g, ''));
        } finally {
          ingestElapsed = performance.now() - ingestStarted;
        }
      }
    } catch (error) {
      status('rxStatus', '解析・受信処理エラー: ' + error.message, 'error');
    } finally {
      scanAttempts++;
      scanDecodeSamples.push(decodeElapsed);
      if (scanDecodeSamples.length > 4096) scanDecodeSamples.shift();
      scanDecodeTotalMs += decodeElapsed;
      scanIngestTotalMs += ingestElapsed;
      updateRxStats();
      scanBusy = false;
      if (receivedDone) recordBenchmarkRun();
      if (stream && !receivedDone) scheduleScan(0);
    }
  }

  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('resetRx').addEventListener('click', resetRx);
  $('exportBenchmarkCsv').addEventListener('click', exportBenchmarkCsv);
  $('ingestManual').addEventListener('click', function () {
    ingest($('manualFrame').value.replace(/^[\r\n]+|[\r\n]+$/g, ''));
  });

  $('runSelfTest').addEventListener('click', async function () {
    var button = $('runSelfTest');
    button.disabled = true;
    try {
      var legacyResult = Core.selfTest();
      var fountainResult = await Fountain.selfTest();
      status('selfTestStatus',
        'PASS · 旧CMAL1/P0/P1 ' + legacyResult.pairPositions + '欠落位置 · ' +
        'LT公式chooserベクトル seq12=' + fountainResult.sequence12 +
        ' / seq13=' + fountainResult.sequence13 +
        ' · 順不同復元 · 2片欠落 · 重複処理 · CRC検証 · 転送混在拒否',
        'ok');
    } catch (error) {
      status('selfTestStatus', 'FAIL · ' + error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  window.addEventListener('pagehide', function () {
    stopTx();
    stopCamera();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  if (!Core || typeof Core.buildFrames !== 'function' ||
      !Fountain || typeof Fountain.Encoder !== 'function' ||
      !Fountain.Encoder.prototype || typeof Fountain.Encoder.prototype.seekToBlock !== 'function' ||
      typeof Fountain.Encoder.prototype.startRepairPhase !== 'function' ||
      !Fountain.Receiver.prototype || typeof Fountain.Receiver.prototype.addKnownBlock !== 'function') {
    status('txStatus', 'Airgap Linkプロトコルの初期化に失敗しました', 'error');
    $('prepareTx').disabled = true;
  }
  updateModeControls();
  resetRx();
  updateTxBlockMap();
})();
