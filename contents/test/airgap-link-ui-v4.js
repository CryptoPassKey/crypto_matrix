(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Core = window.AirgapLinkCore;
  var Fountain = window.AirgapLinkFountain;
  var txPlan = null;
  var txFountainEncoder = null;
  var txFountainPart = null;
  var txMode = 'legacy';
  var txCurrentBlocks = new Set();
  var txMapSelectedIndex = 0;
  var txIndex = 0;
  var txTimer = 0;
  var txPlaying = false;
  var txRenderGeneration = 0;
  var rx = new Core.Receiver();
  var fountainRx = new Fountain.Receiver();
  var activeProtocol = null;
  var rxDirectBlocks = new Set();
  var rxCurrentBlocks = new Set();
  var rxCurrentLabel = '';
  var txCurrentLabel = '';
  var stream = null;
  var detector = null;
  var scannerName = '未初期化';
  var scanBusy = false;
  var scanTimer = 0;
  var uniqueFrameCount = 0;
  var scanAttempts = 0;
  var scanHits = 0;
  var scanTotalMs = 0;
  var scanStartAt = 0;
  var scanFirstHitAt = 0;
  var objectUrl = null;
  var receivedDone = false;

  function status(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB';
  }

  function updateControls() {
    $('chunkSizeValue').textContent = $('chunkSize').value + ' B';
    $('fpsValue').textContent = $('fps').value + ' fps';
  }

  // Resolve the source blocks represented by a CMAL1 data/parity packet.
  // Keep this helper local to the UI so a cached older Core build remains compatible.
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
    // Use only as many columns as there are source blocks (up to 75),
    // so small transfers still render with large, easy-to-track cells.
    var columns = total ? Math.min(75, total) : 75;
    var rows = Math.max(1, Math.ceil(total / columns));
    // Keep tall heatmaps below common mobile canvas dimension limits.
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
        // High-contrast double outline remains visible over green and amber state cells.
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
      drawBlockMap('txBlockMap', total, null, null, txCurrentBlocks, true,
        document.activeElement === canvas ? txMapSelectedIndex : -1);
      $('txBlockSummary').textContent = '元データ ' + total + 'ブロック · ' +
        (txCurrentLabel || '現在のQR位置を表示します');
    } else {
      canvas.tabIndex = -1;
      canvas.setAttribute('aria-disabled', 'true');
      canvas.setAttribute('aria-valuemax', '1');
      canvas.setAttribute('aria-valuenow', '1');
      canvas.setAttribute('aria-valuetext', '転送データなし');
      drawBlockMap('txBlockMap', 0, null, null, null, false, -1);
      $('txBlockSummary').textContent = '転送データを準備するとブロックが表示されます';
    }
  }

  // Convert a canvas-pixel coordinate into a source-block index.
  // The geometry matches drawBlockMap(), including its 75-column cap and row scaling.
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

  // Frame arrays contain each group's Data frames followed by P0/P1.
  // A click always jumps to the requested block's Data frame, not to its parity packet.
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
      if (txMode === 'fountain' && txFountainEncoder) {
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
    var fountainMode = $('transferMode').value === 'fountain';
    $('parityEnabled').disabled = fountainMode;
    $('parityEnabled').parentElement.style.opacity = fountainMode ? '.45' : '1';
    $('txModeHint').textContent = fountainMode
      ? 'LTファウンテン: 最初のK片を直接送信し、その後は疑似ランダムXOR合成片を追加します。受信側からの応答は不要です。最初のK片を直接送信し、その後はXOR合成片を継続送信します。'
      : '従来方式: 順次データ片と、任意のP0/P1ブロックパリティを送信します。';
    $('txFrameCountLabel').textContent = fountainMode
      ? '元データ片数 / 送信パケットは継続'
      : 'データ / 総フレーム';
  }

  $('transferMode').addEventListener('change', function () {
    stopTx();
    txPlan = null;
    txFountainEncoder = null;
    txFountainPart = null;
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
          chunkSize: Number($('chunkSize').value)
        });
        txFountainPart = await txFountainEncoder.nextPart();
        firstFrame = txFountainPart.frame;
        transferId = txFountainEncoder.id;
        blockCount = txFountainEncoder.seqLen;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq 1 · Data · 対象 1';
        $('txFrameCount').textContent = blockCount + ' / ∞';
        frameLabel = 'LT seq 1 / K=' + blockCount + ' · system';
      } else {
        txPlan = Core.buildFrames(wireBytes, {
          chunkSize: Number($('chunkSize').value),
          parity: $('parityEnabled').checked
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
        $('txFrameCount').textContent = txPlan.dataFrames.length + ' / ' + txPlan.frames.length;
        frameLabel = 'フレーム 1 / ' + txPlan.frames.length + ' · ' + firstPacket.type;
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
      $('txProgress').style.width = (txMode === 'fountain' ? (1 / blockCount * 100) : 0).toFixed(1) + '%';
      updateTxBlockMap();
      status('txStatus',
        '準備完了: ' + sourceName + ' · 元データ ' + formatBytes(sourceBytes.length) +
        ' · 転送 ' + formatBytes(wireBytes.length) + ' · ' + compressionNote +
        ' · ' + (txMode === 'fountain' ? 'LTファウンテン' : 'CMAL1') +
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
      if (txMode === 'fountain') {
        var nextFountainPart = await txFountainEncoder.nextPart();
        if (renderGeneration !== txRenderGeneration) return;
        txFountainPart = nextFountainPart;
        frame = txFountainPart.frame;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq ' + txFountainPart.seqNum + ' · ' +
          (txFountainPart.direct ? 'Data' : 'XOR合成') + ' · 対象 ' +
          txFountainPart.indexes.map(function (index) { return index + 1; }).join(',');
        $('txFrameCount').textContent = txFountainEncoder.seqLen + ' / ∞';
        $('txFrameInfo').textContent =
          'LT seq ' + txFountainPart.seqNum + ' · ' +
          (txFountainPart.direct ? '直接片' : 'XOR合成 degree=' + txFountainPart.indexes.length) +
          ' · K=' + txFountainEncoder.seqLen;
        $('txProgress').style.width =
          (Math.min(txFountainEncoder.seqLen, txFountainPart.seqNum) /
            txFountainEncoder.seqLen * 100).toFixed(1) + '%';
      } else {
        frame = txPlan.frames[txIndex];
        var parsed = Core.parseFrame(frame);
        txCurrentBlocks = new Set(packetBlockIndexes(parsed));
        if (parsed.type === 'data') {
          txCurrentLabel = 'Data ' + (parsed.index + 1) + ' / ' + parsed.total;
        } else {
          txCurrentLabel = 'P' + parsed.parityType + ' · group ' +
            (parsed.group + 1) + ' · block ' +
            (parsed.group * Core.GROUP_SIZE + 1) + '–' +
            Math.min(parsed.total, (parsed.group + 1) * Core.GROUP_SIZE);
        }
        $('txFrameInfo').textContent = 'フレーム ' + (txIndex + 1) + ' / ' + txPlan.frames.length +
          ' · ' + parsed.type + ' · ' + (1000 / Number($('fps').value)).toFixed(1) + ' ms/frame';
        $('txProgress').style.width = ((txIndex + 1) / txPlan.frames.length * 100).toFixed(1) + '%';
        txIndex = (txIndex + 1) % txPlan.frames.length;
      }
      if (renderGeneration !== txRenderGeneration) return;
      renderQr(frame);
      updateTxBlockMap();
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

  function resetRx() {
    rx.reset();
    fountainRx.reset();
    activeProtocol = null;
    rxDirectBlocks.clear();
    rxCurrentBlocks.clear();
    rxCurrentLabel = '';
    uniqueFrameCount = 0;
    scanAttempts = 0;
    scanHits = 0;
    scanTotalMs = 0;
    scanStartAt = 0;
    scanFirstHitAt = 0;
    receivedDone = false;
    $('rxProgress').style.width = '0%';
    $('rxProgressText').textContent = '0 / 0';
    $('rxRate').textContent = '0.0';
    $('rxAvgMs').textContent = '0 ms';
    $('rxLost').textContent = '—';
    $('rxRecovered').textContent = '0';
    $('rxHitRate').textContent = '0%';
    $('rxBlockSummary').textContent = '受信を開始するとブロック状態が表示されます';
    drawBlockMap('rxBlockMap', 0, null, null, null);
    $('rxResultMeta').textContent = '';
    $('downloadResult').classList.add('hidden');
    $('downloadResult').removeAttribute('href');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    status('rxStatus', '受信待機中', 'info');
  }

  function updateRxStats() {
    var elapsed = scanStartAt ? Math.max(0.001, (performance.now() - scanStartAt) / 1000) : 0;
    var have;
    var total;
    var recovered;
    var directSet;
    var recoveredSet;
    var activeSet;
    if (activeProtocol === 'fountain') {
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
    $('rxRate').textContent = elapsed ? (uniqueFrameCount / elapsed).toFixed(2) : '0.0';
    $('rxAvgMs').textContent = scanAttempts ? (scanTotalMs / scanAttempts).toFixed(1) + ' ms' : '0 ms';
    $('rxLost').textContent = total ? String(Math.max(0, total - have)) : '—';
    $('rxRecovered').textContent = String(recovered);
    $('rxHitRate').textContent = scanAttempts ? (scanHits / scanAttempts * 100).toFixed(1) + '%' : '0%';
    drawBlockMap('rxBlockMap', total, directSet, recoveredSet, activeSet);
  }

  function safeFilename(value) {
    var name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return name || 'airgap-link-received.bin';
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
    var totalElapsed = scanStartAt ? (performance.now() - scanStartAt) / 1000 : 0;
    var firstDetection = scanFirstHitAt && scanStartAt ? ((scanFirstHitAt - scanStartAt) / 1000).toFixed(2) + '秒' : '—';
    var cameraTrack = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    var cameraSettings = cameraTrack && cameraTrack.getSettings ? cameraTrack.getSettings() : {};
    var cameraSize = cameraSettings.width && cameraSettings.height ? cameraSettings.width + '×' + cameraSettings.height : '—';
    $('rxResultMeta').textContent =
      '復元サイズ ' + formatBytes(finalBytes.length) +
      (unpacked.decompressed ? ' · Deflate展開済み' : '') +
      ' · 初回QR ' + firstDetection +
      ' · 完了 ' + totalElapsed.toFixed(2) + '秒' +
      ' · ' + scannerName + ' · カメラ ' + cameraSize +
      ' · CRC32検証済み · 転送ID ' + (activeProtocol === 'fountain' ? fountainRx.id : rx.id) +
      ' · 復元 ' + (activeProtocol === 'fountain' ? fountainRx.recoveredIndexes.size : rx.recoveredCount) + '片';
    status('rxStatus', '受信完了。ファイルを保存できます。', 'ok');
    updateRxStats();
    stopCamera();
  }

  async function ingest(rawText) {
    if (receivedDone) return;
    if (typeof rawText !== 'string' || rawText.indexOf('CMAL1:') !== 0) return;
    try {
      var isFountain = rawText.indexOf('CMAL1:F') === 0;
      if (activeProtocol && activeProtocol !== (isFountain ? 'fountain' : 'legacy')) {
        throw new Error('別の転送方式のフレームです。受信をリセットしてください');
      }
      var result;
      var have;
      var total;
      var recovered;
      if (isFountain) {
        var fountainPacket = Fountain.parseFrame(rawText);
        result = await fountainRx.feed(rawText);
        var indexes = result.lastIndexes || await fountainRx.chooser.choose(fountainPacket.seqNum);
        rxCurrentBlocks = new Set(indexes);
        rxCurrentLabel = 'LT seq ' + fountainPacket.seqNum + ' · blocks ' +
          indexes.map(function (index) { return index + 1; }).join(',');
        have = fountainRx.simpleParts.size;
        total = fountainRx.seqLen;
        recovered = fountainRx.recoveredIndexes.size;
      } else {
        var packet = Core.parseFrame(rawText);
        result = rx.feed(rawText);
        rxCurrentBlocks = new Set(packetBlockIndexes(packet));
        if (packet.type === 'data') {
          rxDirectBlocks.add(packet.index);
          rxCurrentLabel = 'Data ' + (packet.index + 1) + ' / ' + packet.total;
        } else {
          rxCurrentLabel = 'P' + packet.parityType + ' · group ' +
            (packet.group + 1) + ' · block ' +
            (packet.group * Core.GROUP_SIZE + 1) + '–' +
            Math.min(packet.total, (packet.group + 1) * Core.GROUP_SIZE);
        }
        have = rx.shards.size;
        total = rx.total;
        recovered = rx.recoveredCount;
      }
      activeProtocol = isFountain ? 'fountain' : 'legacy';
      if (!result.duplicate) uniqueFrameCount++;
      updateRxStats();
      status('rxStatus',
        (isFountain ? 'LTファウンテン受信中' : 'CMAL1受信中') +
        ' · ' + have + ' / ' + total + 'ブロック · 復元 ' + recovered + '片',
        'info');
      if (result.complete) {
        try {
          await finishReceive(result.bytes);
        } catch (error) {
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
    if (typeof window.BarcodeDetector === 'function') {
      try {
        var formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.indexOf('qr_code') !== -1) {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          scannerName = 'Native BarcodeDetector';
        }
      } catch (_) { detector = null; }
    }
    if (!detector) {
      if (typeof window.jsQR !== 'function') throw new Error('jsQR.jsを読み込めませんでした');
      scannerName = 'jsQR fallback';
    }
    $('scannerMode').textContent = '読み取り方式: ' + scannerName;
    $('scannerMode').className = 'status info';
  }

  async function startCamera() {
    if (stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status('rxStatus', 'カメラにはHTTPSまたはlocalhostが必要です。手動フレーム入力を利用してください。', 'error');
      return;
    }
    try {
      await initScanner();
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      var video = $('camera');
      video.srcObject = stream;
      await video.play();
      $('startCamera').disabled = true;
      $('stopCamera').disabled = false;
      scanStartAt = performance.now();
      status('rxStatus', 'カメラ読み取り中。送信側のQRを画面に映してください。', 'info');
      scanTick();
    } catch (error) {
      stopCamera();
      status('rxStatus', 'カメラ開始失敗: ' + error.message, 'error');
    }
  }

  function stopCamera() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = 0;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    var video = $('camera');
    if (video.srcObject) video.srcObject = null;
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
  }

  async function scanTick() {
    if (!stream || scanBusy || receivedDone) return;
    var video = $('camera');
    if (video.readyState < 2 || !video.videoWidth) {
      scanTimer = setTimeout(scanTick, 30);
      return;
    }
    scanBusy = true;
    var started = performance.now();
    var raw = null;
    try {
      if (detector) {
        try {
          var results = await detector.detect(video);
          var hit = results.find(function (item) { return typeof item.rawValue === 'string' && item.rawValue.indexOf('CMAL1:') === 0; });
          if (hit) raw = hit.rawValue;
        } catch (nativeError) {
          detector = null;
          scannerName = 'jsQR fallback (Native error)';
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
        var decoded = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
        if (decoded) raw = decoded.data;
      }
    } catch (error) {
      status('rxStatus', '解析エラー: ' + error.message, 'error');
    } finally {
      var elapsed = performance.now() - started;
      scanAttempts++;
      scanTotalMs += elapsed;
      if (raw) {
        scanHits++;
        if (!scanFirstHitAt) scanFirstHitAt = performance.now();
        await ingest(raw.trim());
      }
      updateRxStats();
      scanBusy = false;
      if (stream && !receivedDone) scanTimer = setTimeout(scanTick, 20);
    }
  }

  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('resetRx').addEventListener('click', resetRx);
  $('ingestManual').addEventListener('click', function () {
    ingest($('manualFrame').value.trim());
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
      !Fountain || typeof Fountain.Encoder !== 'function') {
    status('txStatus', 'Airgap Linkプロトコルの初期化に失敗しました', 'error');
    $('prepareTx').disabled = true;
  }
  updateModeControls();
  resetRx();
  updateTxBlockMap();
})();
