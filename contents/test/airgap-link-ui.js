(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Core = window.AirgapLinkCore;
  var txPlan = null;
  var txIndex = 0;
  var txTimer = 0;
  var txPlaying = false;
  var rx = new Core.Receiver();
  var stream = null;
  var detector = null;
  var scannerName = '未初期化';
  var scanBusy = false;
  var scanTimer = 0;
  var seenFrames = new Set();
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
  $('chunkSize').addEventListener('input', updateControls);
  $('fps').addEventListener('input', updateControls);
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

      txPlan = Core.buildFrames(wireBytes, {
        chunkSize: Number($('chunkSize').value),
        parity: $('parityEnabled').checked
      });
      txIndex = 0;
      var planStart = performance.now();
      renderQr(txPlan.frames[0]);
      var initialRenderMs = performance.now() - planStart;
      $('txPlaceholder').classList.add('hidden');
      $('playTx').disabled = false;
      $('pauseTx').disabled = true;
      $('txFrameCount').textContent = txPlan.dataFrames.length + ' / ' + txPlan.frames.length;
      $('txPayloadSize').textContent = formatBytes(wireBytes.length);
      $('txQrGenMs').textContent = initialRenderMs.toFixed(1) + ' ms';
      $('txFrameInfo').textContent = 'フレーム 1 / ' + txPlan.frames.length + ' · ' + Core.parseFrame(txPlan.frames[0]).type;
      $('txProgress').style.width = '0%';
      status('txStatus',
        '準備完了: ' + sourceName + ' · 元データ ' + formatBytes(sourceBytes.length) +
        ' · 転送 ' + formatBytes(wireBytes.length) + ' · ' + compressionNote +
        ' · ID ' + txPlan.id,
        'ok');
    } catch (error) {
      txPlan = null;
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
    if (txTimer) clearTimeout(txTimer);
    txTimer = 0;
    $('playTx').disabled = !txPlan;
    $('pauseTx').disabled = true;
  }

  function showNextFrame() {
    if (!txPlan) return;
    var started = performance.now();
    try {
      var frame = txPlan.frames[txIndex];
      renderQr(frame);
      var elapsed = performance.now() - started;
      $('txQrGenMs').textContent = elapsed.toFixed(1) + ' ms';
      $('txFrameInfo').textContent = 'フレーム ' + (txIndex + 1) + ' / ' + txPlan.frames.length +
        ' · ' + Core.parseFrame(frame).type + ' · ' + (1000 / Number($('fps').value)).toFixed(1) + ' ms/frame';
      $('txProgress').style.width = ((txIndex + 1) / txPlan.frames.length * 100).toFixed(1) + '%';
      txIndex = (txIndex + 1) % txPlan.frames.length;
      if (txPlaying) {
        var target = 1000 / Number($('fps').value);
        txTimer = setTimeout(showNextFrame, Math.max(0, target - elapsed));
      }
    } catch (error) {
      stopTx();
      status('txStatus', 'QR生成エラー: ' + error.message + '。密度を下げてください。', 'error');
    }
  }

  function playTx() {
    if (!txPlan || txPlaying) return;
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
    seenFrames.clear();
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
    $('rxResultMeta').textContent = '';
    $('downloadResult').classList.add('hidden');
    $('downloadResult').removeAttribute('href');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    status('rxStatus', '受信待機中', 'info');
  }

  function updateRxStats() {
    var elapsed = scanStartAt ? Math.max(0.001, (performance.now() - scanStartAt) / 1000) : 0;
    var have = rx.shards.size;
    var total = rx.total;
    $('rxProgressText').textContent = have + ' / ' + total;
    $('rxProgress').style.width = total ? (have / total * 100).toFixed(1) + '%' : '0%';
    $('rxRate').textContent = elapsed ? (seenFrames.size / elapsed).toFixed(2) : '0.0';
    $('rxAvgMs').textContent = scanAttempts ? (scanTotalMs / scanAttempts).toFixed(1) + ' ms' : '0 ms';
    $('rxLost').textContent = total ? String(Math.max(0, total - have)) : '—';
    $('rxRecovered').textContent = String(rx.recoveredCount);
    $('rxHitRate').textContent = scanAttempts ? (scanHits / scanAttempts * 100).toFixed(1) + '%' : '0%';
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
    $('rxResultMeta').textContent =
      '復元サイズ ' + formatBytes(finalBytes.length) +
      (unpacked.decompressed ? ' · Deflate展開済み' : '') +
      ' · CRC32検証済み · 転送ID ' + rx.id +
      ' · パリティ復元 ' + rx.recoveredCount + '片';
    status('rxStatus', '受信完了。ファイルを保存できます。', 'ok');
    updateRxStats();
    stopCamera();
  }

  async function ingest(rawText) {
    if (receivedDone) return;
    if (typeof rawText !== 'string' || rawText.indexOf('CMAL1:') !== 0) return;
    if (seenFrames.has(rawText)) return;
    seenFrames.add(rawText);
    try {
      var result = rx.feed(rawText);
      updateRxStats();
      status('rxStatus',
        'CMAL1受信中 · ' + result.have + ' / ' + result.total +
        ' · 復元 ' + result.recovered + '片',
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

  $('runSelfTest').addEventListener('click', function () {
    try {
      var result = Core.selfTest();
      status('selfTestStatus',
        'PASS · CRC32 ' + result.crc32 +
        ' · 欠落 ' + result.droppedFrames + '片 → 復元 ' + result.recoveredFrames +
        '片 · 送信フレーム ' + result.packetFrames +
        ' · 欠落位置テスト ' + result.pairPositions + '種 · P1単独 ' + (result.p1OnlyRecovery ? 'PASS' : 'FAIL') +
        ' · CRC改ざん ' + (result.crcTamperRejected ? 'PASS' : 'FAIL') +
        ' · 旧形式 ' + result.legacyFrames,
        'ok');
    } catch (error) {
      status('selfTestStatus', 'FAIL · ' + error.message, 'error');
    }
  });

  window.addEventListener('pagehide', function () {
    stopTx();
    stopCamera();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  if (!Core || typeof Core.buildFrames !== 'function') {
    status('txStatus', 'AirgapLinkCoreの初期化に失敗しました', 'error');
    $('prepareTx').disabled = true;
  }
  resetRx();
})();
