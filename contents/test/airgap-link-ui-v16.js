(function () {
  'use strict';

  // Report startup/runtime failures instead of leaving controls apparently inert.
  window.addEventListener('error', function (event) {
    var message = event && event.message ? event.message : '不明なJavaScriptエラー';
    ['txStatus', 'rxStatus'].forEach(function (id) {
      var element = document.getElementById(id);
      if (element) {
        element.textContent = 'JavaScriptエラー: ' + message;
        element.className = 'status error';
      }
    });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : String(reason || '不明な非同期エラー');
    ['txStatus', 'rxStatus'].forEach(function (id) {
      var element = document.getElementById(id);
      if (element) {
        element.textContent = '非同期処理エラー: ' + message;
        element.className = 'status error';
      }
    });
  });

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
  var txRafId = 0;
  var txFrameStartTime = 0;
  var txIsRendering = false;
  var txPausedByVisibility = false;
  var txPlaying = false;
  var txRenderGeneration = 0;
  // QR matrices are encoded before playback and stored as compact 1-bit data.
  var txQrMatrixCache = [];
  var txFountainQrCache = [];
  var txFountainQrCacheIndex = 1;
  var txQrCacheBytes = 0;
  var TX_QR_CACHE_MAX_BYTES = 64 * 1024 * 1024;
  var txDisplayWindowStart = 0;
  var txDisplayWindowFrames = 0;
  var txLastFrameSwitchAt = 0;
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
  var scanVideoFrameCallback = null;
  var scanLatestPresentedFrames = null;
  var scanLastAnalyzedPresentedFrames = null;
  var scanLastIngestedRawText = '';
  var scanConsecutiveNoQrCount = 0;
  var scanIngestQueue = [];
  var scanIngestBusy = false;
  var scanCachedContext = null;
  var rxWorker = null;
  var rxWorkerReady = false;
  var rxWorkerBusy = false;
  var rxWorkerFailed = false;
  var rxWorkerRequestId = 0;
  var rxScanSessionId = 0;
  var MAX_INGEST_QUEUE = 16;
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
  var autoTestErrorMessage = '';
  var autoTestWasCancelled = false;
  var autoTestPayloadBytes = null;
  var benchmarkPeakHeapBytes = null;
  var benchmarkHeapLimitBytes = null;
  var rxWireByteCount = null;
  var rxOutputByteCount = null;
  var MAX_BENCHMARK_BYTES = 64 * 1024 * 1024;
  var DEFAULT_BENCHMARK_BYTES = 711 * 1024;

  // TX local adaptive FPS: based only on this sender's QR render cost.
  // No RX scan/decode/ingest measurements are read here.
  var txAutoRateController = {
    enabled: false,
    currentFps: Number($('fps') ? $('fps').value : 6) || 6,
    minFps: 3,
    maxFps: 120,
    windowStartedAt: 0,
    renderSamples: [],
    statusText: '待機中',
    clearWindow: function () {
      this.windowStartedAt = performance.now();
      this.renderSamples = [];
    },
    reset: function () {
      this.currentFps = Number($('fps') ? $('fps').value : 6) || 6;
      this.minFps = Math.max(1, Number($('minFps') ? $('minFps').value : 3) || 3);
      this.maxFps = Math.max(this.minFps, Math.min(120, Number($('maxFps') ? $('maxFps').value : 24) || 24));
      this.statusText = this.enabled ? 'TXローカル性能を観測中' : '固定FPS';
      this.clearWindow();
      this.updateUi();
    },
    recordRender: function (renderMs) {
      if (!this.enabled || !Number.isFinite(renderMs) || renderMs < 0) return;
      this.renderSamples.push(renderMs);
      if (this.renderSamples.length > 32) this.renderSamples.shift();
      var now = performance.now();
      if (now - this.windowStartedAt < 1200 || this.renderSamples.length < 4) return;
      var sorted = this.renderSamples.slice().sort(function(a,b){return a-b;});
      var p95 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))];
      var interval = 1000 / Math.max(1, this.currentFps);
      if (p95 > interval * 0.75) {
        this.currentFps = Math.max(this.minFps, this.currentFps - 1);
        this.statusText = 'QR生成負荷により減速 (P95 ' + p95.toFixed(1) + ' ms)';
      } else if (p95 < interval * 0.30) {
        this.currentFps = Math.min(this.maxFps, this.currentFps + 1);
        this.statusText = '送信端末の描画余力により増速 (P95 ' + p95.toFixed(1) + ' ms)';
      } else {
        this.statusText = 'TX描画性能に合わせて維持 (P95 ' + p95.toFixed(1) + ' ms)';
      }
      this.windowStartedAt = now;
      this.renderSamples = [];
      this.updateUi();
    },
    updateUi: function () {
      var out = $('fpsValue');
      if (out) out.textContent = this.enabled
        ? this.currentFps + ' 枚/秒'
        : ($('fps') ? $('fps').value : 6) + ' 枚/秒';
      var badge = $('autoFpsStatus');
      if (badge) badge.textContent = this.statusText;
    }
  };

  // 優先6: 送信速度の適応制御（受信成功率・遅延・復元効率を優先した自動速度調整）
  var rxRateAdvisor = {
    enabled: false,
    minFps: 3,
    maxFps: 24,
    currentFps: 6,
    windowMs: 1200,
    lastEvalTime: 0,
    cooldownUntil: 0,
    statusText: '待機中',
    recommendationText: '—',

    // 観測ウィンドウ積算値
    windowAttempts: 0,
    windowHits: 0,
    windowDuplicates: 0,
    windowNovel: 0,
    windowSamples: [],
    windowQueueSum: 0,
    windowQueueCount: 0,
    windowStartDecoded: 0,
    windowRedundantFountain: 0,
    windowUsefulFountain: 0,

    reset: function () {
      var manualFps = Number($('fps') ? $('fps').value : 6) || 6;
      this.currentFps = manualFps;
      this.lastEvalTime = performance.now();
      this.cooldownUntil = 0;
      this.statusText = this.enabled ? '観測中 (' + this.currentFps + ' fps)' : 'OFF (固定 ' + manualFps + ' fps)';
      this.recommendationText = '—';
      this.clearWindow();
      this.updateUi();
    },

    clearWindow: function () {
      this.windowAttempts = 0;
      this.windowHits = 0;
      this.windowDuplicates = 0;
      this.windowNovel = 0;
      this.windowSamples = [];
      this.windowQueueSum = 0;
      this.windowQueueCount = 0;
      var curDecoded = (activeProtocol === 'fountain' || activeProtocol === 'hybrid')
        ? (fountainRx ? fountainRx.simpleParts.size : 0)
        : (rx ? rx.shards.size : 0);
      this.windowStartDecoded = curDecoded;
      this.windowRedundantFountain = 0;
      this.windowUsefulFountain = 0;
    },

    recordScanAttempt: function (hit, isNovel, decodeMs) {
      this.windowAttempts++;
      if (hit) {
        this.windowHits++;
        if (isNovel) this.windowNovel++;
        else this.windowDuplicates++;
        if (typeof decodeMs === 'number' && Number.isFinite(decodeMs)) {
          this.windowSamples.push(decodeMs);
        }
      }
    },

    recordQueueLength: function (queueLen) {
      this.windowQueueSum += queueLen;
      this.windowQueueCount++;
    },

    recordIngestResult: function (isDuplicate, isComplete) {
      if (isDuplicate) this.windowRedundantFountain++;
      else this.windowUsefulFountain++;
    },

    evaluate: function (now) {
      if (receivedDone) return;
      var elapsed = now - this.lastEvalTime;
      if (elapsed < this.windowMs) return;

      var attempts = this.windowAttempts;
      var hits = this.windowHits;
      var novel = this.windowNovel;
      var duplicates = this.windowDuplicates;
      var samples = this.windowSamples;
      var curDecoded = (activeProtocol === 'fountain' || activeProtocol === 'hybrid')
        ? (fountainRx ? fountainRx.simpleParts.size : 0)
        : (rx ? rx.shards.size : 0);
      var progressDelta = curDecoded - this.windowStartDecoded;
      var avgQueue = this.windowQueueCount > 0 ? (this.windowQueueSum / this.windowQueueCount) : 0;
      var currentQueue = scanIngestQueue ? scanIngestQueue.length : 0;

      this.lastEvalTime = now;

      // ユーザー設定上限・下限の反映
      var minVal = Number($('minFps') ? $('minFps').value : 3) || 3;
      var maxVal = Number($('maxFps') ? $('maxFps').value : 24) || 24;
      if (minVal > maxVal) { var tmp = minVal; minVal = maxVal; maxVal = tmp; }
      this.minFps = Math.max(1, minVal);
      this.maxFps = Math.min(120, maxVal);

      // サンプル数が少なすぎる場合は判定保留
      if (attempts < 3) {
        this.clearWindow();
        return;
      }

      var hitRate = hits / attempts;
      var duplicateRate = hits > 0 ? (duplicates / hits) : 0;
      var p50Ms = percentileValue(samples, 0.50) || 0;
      var p95Ms = percentileValue(samples, 0.95) || 0;
      var currentInterval = 1000 / Math.max(1, this.currentFps);

      // 推奨値と状況表示の更新
      this.recommendationText = '実測: ' + (hits * 1000 / elapsed).toFixed(1) + ' fps · 検出率: ' +
        (hitRate * 100).toFixed(0) + '%' + ' · P95: ' + p95Ms.toFixed(1) + 'ms · 重複率: ' +
        (duplicateRate * 100).toFixed(0) + '%' +
        (progressDelta > 0 ? ' · 復元進捗: +' + progressDelta + '片' : ' · 復元進捗: 停滞');
      var recEl = $('rxSpeedRecommendation');
      if (recEl) recEl.textContent = this.recommendationText;

      // 自動調整が無効な場合は推奨表示のみ更新してリターン
      if (!this.enabled) {
        this.statusText = 'OFF (固定 ' + ($('fps') ? $('fps').value : 6) + ' fps)';
        this.clearWindow();
        this.updateUi();
        return;
      }

      // クールダウン（速度変更直後の安定待ち）期間の確認
      if (now < this.cooldownUntil) {
        this.statusText = '変更後安定確認中 (' + this.currentFps + ' fps)';
        this.clearWindow();
        this.updateUi();
        return;
      }

      var nextFps = this.currentFps;
      var reason = '';

      // === 判定ルール（受信成功率と実効復元スループット最優先） ===
      // 1. キュー滞留・処理追いつき不能（即時減速）
      if (currentQueue >= 4 || avgQueue >= 3) {
        nextFps = Math.max(this.minFps, this.currentFps - 2);
        reason = '受信キュー滞留 (' + currentQueue + '件) による減速';
      }
      // 2. デコード時間P95/P50の飽和（CPU/Worker過負荷、即時減速）
      else if (p95Ms > currentInterval * 0.85 || p50Ms > currentInterval * 0.70) {
        var backoff = Math.max(1, Math.round(this.currentFps * 0.2));
        nextFps = Math.max(this.minFps, this.currentFps - backoff);
        reason = '解析遅延増加 (P95: ' + p95Ms.toFixed(1) + 'ms / 目標間隔: ' + currentInterval.toFixed(1) + 'ms) による減速';
      }
      // 3. QR検出率の低下（露出・ブレ・コマ落ち、速度抑制）
      else if (hitRate < 0.65) {
        nextFps = Math.max(this.minFps, this.currentFps - 1);
        reason = '検出率低下 (' + (hitRate * 100).toFixed(0) + '%) による減速';
      }
      // 4. 重複過多および復元停滞（無駄なパケット空転、減速して確実なパケット取得へ）
      else if (hits >= 6 && progressDelta <= 0 && duplicateRate > 0.75) {
        if (this.currentFps > this.minFps) {
          nextFps = Math.max(this.minFps, this.currentFps - 1);
          reason = '復元進捗停滞・重複過多 (' + (duplicateRate * 100).toFixed(0) + '%) による減速';
        } else {
          reason = '重複率高 (' + (duplicateRate * 100).toFixed(0) + '%)・下限 (' + this.minFps + ' fps) 維持';
        }
      }
      // 5. 安定・検出率高・余力十分・復元進捗あり（+1 fps 漸増）
      else if (hitRate >= 0.85 && p95Ms < currentInterval * 0.55 && currentQueue <= 1 && (progressDelta > 0 || duplicateRate < 0.50)) {
        if (this.currentFps < this.maxFps) {
          nextFps = Math.min(this.maxFps, this.currentFps + 1);
          reason = '受信安定・検出率 ' + (hitRate * 100).toFixed(0) + '%・余力あり: 速度向上 (+1 fps)';
        } else {
          reason = '上限到達 (' + this.maxFps + ' fps) で安定継続';
        }
      }
      // 6. 均衡状態（維持）
      else {
        reason = '最適速度で安定中 (' + this.currentFps + ' fps · 検出率: ' + (hitRate * 100).toFixed(0) + '%)';
      }

      // 速度変更の適用
      if (nextFps !== this.currentFps) {
        this.currentFps = nextFps;
        this.cooldownUntil = now + this.windowMs * 1.2;
      }

      this.statusText = reason;
      this.clearWindow();
      this.updateUi();
    },

    updateUi: function () {
      var badge = $('autoFpsStatus');
      if (badge) badge.textContent = this.statusText;
      // RX advisor is display-only. It must never update TX controls.
      var rxStatus = $('rxSpeedRecommendation');
      if (rxStatus) rxStatus.textContent = this.recommendationText + ' · ' + this.statusText;
    }
  };

  function status(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KiB';
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1) + ' MiB';
  }

  function selectedBenchmarkBytes() {
    var value = Number($('benchmarkSizeInput').value);
    if (!Number.isFinite(value) || value < 1024) value = DEFAULT_BENCHMARK_BYTES;
    return Math.max(1024, Math.min(MAX_BENCHMARK_BYTES, Math.round(value / 1024) * 1024));
  }

  function updateBenchmarkSizeControls(source) {
    var bytes = source === 'range' ? Number($('benchmarkSizeRange').value) : Number($('benchmarkSizeInput').value);
    if (!Number.isFinite(bytes) || bytes < 1024) bytes = DEFAULT_BENCHMARK_BYTES;
    bytes = Math.max(1024, Math.min(MAX_BENCHMARK_BYTES, Math.round(bytes / 1024) * 1024));
    $('benchmarkSizeRange').value = String(bytes);
    $('benchmarkSizeInput').value = String(bytes);
    $('benchmarkSizeValue').textContent = formatBytes(bytes) + ' · ' + bytes.toLocaleString() + ' B';
  }

  function createBenchmarkPayload(length) {
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BENCHMARK_BYTES) {
      throw new RangeError('テストデータ量は1 KiB～64 MiBで指定してください');
    }
    var bytes = new Uint8Array(length);
    var state = 0x9e3779b9;
    for (var i = 0; i < bytes.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[i] = state & 0xff;
    }
    return bytes;
  }

  function sampleBenchmarkMemory() {
    var memory = typeof performance !== 'undefined' ? performance.memory : null;
    if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return;
    benchmarkPeakHeapBytes = Math.max(benchmarkPeakHeapBytes || 0, memory.usedJSHeapSize);
    if (Number.isFinite(memory.jsHeapSizeLimit)) benchmarkHeapLimitBytes = memory.jsHeapSizeLimit;
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

  function syncChunkSizeControls(source) {
    var range = $('chunkSize');
    var number = $('chunkSizeNumber');
    var maximum = $('wireFormat').value === 'base64url' ? 2100 : 2800;
    range.max = String(maximum);
    number.max = String(maximum);
    var requested = Number(source === 'number' ? number.value : range.value);
    if (!Number.isFinite(requested)) requested = 180;
    var value = Math.max(80, Math.min(maximum, Math.round(requested / 20) * 20));
    range.value = String(value);
    number.value = String(value);
    $('chunkSizeValue').textContent = value + ' B';
  }

  function updateControls() {
    syncChunkSizeControls('range');
    $('fpsValue').textContent = txAutoRateController.enabled
      ? txAutoRateController.currentFps + ' 枚/秒'
      : $('fps').value + ' 枚/秒';
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

    var columns = total ? Math.min(50, total) : 50;
    var rows = Math.max(1, Math.ceil(total / columns));

    var cell = Math.max(3, Math.min(12, Math.floor(4096 / rows)));
    canvas.width = columns * cell;
    canvas.height = rows * cell;
    var context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#17283a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!total) return;
    for (var index = 0; index < total; index++) {
      var color = '#405a75';
      if (directSet && directSet.has(index)) color = '#20d69a';
      if (recoveredSet && recoveredSet.has(index)) color = '#ffc247';
      if (activeFill && activeSet && activeSet.has(index)) color = '#00e5ff';
      var x = (index % columns) * cell;
      var y = Math.floor(index / columns) * cell;
      context.fillStyle = color;
      context.fillRect(x, y, cell - 1, cell - 1);
      if (activeSet && activeSet.has(index)) {

        if (cell >= 4) {
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2.5;
          context.strokeRect(x + 0.5, y + 0.5, cell - 2, cell - 2);
        }
        context.strokeStyle = '#07111d';
        context.lineWidth = cell >= 4 ? 2 : 1;
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
      $('txBlockSummary').textContent = '現在の送信位置を表示しています';
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
      $('txBlockSummary').textContent = '転送データを準備すると送信位置が表示されます';
    }
  }

  function blockIndexFromPoint(x, y, canvasWidth, canvasHeight, total) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || total < 1 || canvasWidth < 1 || canvasHeight < 1 ||
        x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return -1;
    var columns = Math.min(50, total);
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
      if (txRafId) cancelAnimationFrame(txRafId);
      txRafId = 0;
      if (txTimer) clearTimeout(txTimer);
      txTimer = 0;
      txRenderGeneration++;
      txIsRendering = false;
      txPausedByVisibility = false;
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      if (hybridMode && txPlan) {
        // どの周回・LT修復中でも、対象ブロックの1周目Dataフレームから再開
        txHybridPhase = 'legacy';
        var frameIndex = legacyFrameIndexForBlock(blockIndex, txPlan);
        if (frameIndex < 0 || frameIndex >= txPlan.frames.length) throw new Error('指定ブロックのフレーム位置が見つかりません');
        var packet = Core.parseFrame(txPlan.frames[frameIndex]);
        if (packet.type !== 'data' || packet.index !== blockIndex) throw new Error('指定ブロックとDataフレームの位置が一致しません');
        txIndex = frameIndex;
      } else if (txMode === 'fountain' && txFountainEncoder) {
        if (typeof txFountainEncoder.seekToBlock !== 'function') {
          throw new Error('Fountain EncoderとUIのAPI版が一致しません。ページを再読み込みしてください');
        }
        txFountainEncoder.seekToBlock(blockIndex);
        // Random access invalidates the precomputed Fountain sequence; continue from the seek point.
        txFountainQrCacheIndex = txFountainQrCache.length;
      } else if (txPlan) {
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
      updateTxPlayBadge();
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
    $('txModeHint').textContent = '受信側で先頭QRを読み取ってから、送信を開始してください。';
    $('txFrameCountLabel').textContent = '送信状態';
  }

  $('chunkSize').addEventListener('input', function () {
    syncChunkSizeControls('range');
    updateControls();
  });
  $('chunkSizeNumber').addEventListener('input', function () {
    syncChunkSizeControls('number');
    updateControls();
  });
  $('wireFormat').addEventListener('change', function () {
    syncChunkSizeControls('range');
    updateControls();
  });
  $('fps').addEventListener('input', function () {
    txAutoRateController.currentFps = Number(this.value) || 6;
    txAutoRateController.clearWindow();
    updateControls();
  });
  if ($('autoFpsEnabled')) {
    $('autoFpsEnabled').addEventListener('change', function () {
      txAutoRateController.enabled = this.checked;
      rxRateAdvisor.enabled = this.checked;
      if ($('autoFpsControls')) {
        $('autoFpsControls').style.display = this.checked ? 'block' : 'none';
      }
      txAutoRateController.reset();
      rxRateAdvisor.reset();
      updateControls();
    });
  }
  if ($('minFps')) {
    $('minFps').addEventListener('change', function () {
      txAutoRateController.minFps = Math.max(1, Math.min(120, Number(this.value) || 3));
      rxRateAdvisor.minFps = txAutoRateController.minFps;
      txAutoRateController.reset();
      rxRateAdvisor.reset();
    });
  }
  if ($('maxFps')) {
    $('maxFps').addEventListener('change', function () {
      txAutoRateController.maxFps = Math.max(1, Math.min(120, Number(this.value) || 24));
      rxRateAdvisor.maxFps = txAutoRateController.maxFps;
      txAutoRateController.reset();
      rxRateAdvisor.reset();
    });
  }
  $('txBlockMap').addEventListener('click', onTxBlockMapClick);
  $('txBlockMap').addEventListener('keydown', onTxBlockMapKeyDown);
  $('txBlockMap').addEventListener('focus', updateTxBlockMap);
  $('txBlockMap').addEventListener('blur', updateTxBlockMap);
  updateControls();

  function packQrMatrix(matrix) {
    var modules = matrix.length;
    var packed = new Uint8Array(Math.ceil(modules * modules / 8));
    for (var row = 0; row < modules; row++) {
      for (var col = 0; col < modules; col++) {
        if (matrix[row][col]) {
          var bitIndex = row * modules + col;
          packed[bitIndex >>> 3] |= 1 << (bitIndex & 7);
        }
      }
    }
    return { modules: modules, packed: packed, bytes: packed.byteLength + 16 };
  }

  function encodeQrMatrix(text) {
    if (!window.MatrixQRCode) throw new Error('MatrixQRCode が読み込まれていません');
    return packQrMatrix(MatrixQRCode.matrix(text));
  }

  async function createQrCacheEntry(text, scratchCanvas) {
    if (!window.MatrixQRCode) throw new Error('MatrixQRCode が読み込まれていません');
    var matrix = MatrixQRCode.matrix(text);
    var modules = matrix.length;
    var total = modules + 8;
    if (typeof createImageBitmap === 'function') {
      scratchCanvas.width = total;
      scratchCanvas.height = total;
      var scratchContext = scratchCanvas.getContext('2d', { alpha: false });
      var imageData = scratchContext.createImageData(total, total);
      imageData.data.fill(255);
      for (var row = 0; row < modules; row++) {
        for (var col = 0; col < modules; col++) {
          if (!matrix[row][col]) continue;
          var offset = ((row + 4) * total + col + 4) * 4;
          imageData.data[offset] = 0;
          imageData.data[offset + 1] = 0;
          imageData.data[offset + 2] = 0;
        }
      }
      scratchContext.putImageData(imageData, 0, 0);
      try {
        var bitmap = await createImageBitmap(scratchCanvas);
        return { bitmap: bitmap, width: total, height: total, bytes: total * total * 4 };
      } catch (_) {
        // Packed-matrix fallback remains available on browsers without a usable bitmap path.
      }
    }
    return packQrMatrix(matrix);
  }

  function disposeQrCache(entries) {
    if (!entries) return;
    for (var i = 0; i < entries.length; i++) {
      var qr = entries[i] && entries[i].qr;
      if (qr && qr.bitmap && typeof qr.bitmap.close === 'function') qr.bitmap.close();
    }
  }

  function renderQrMatrix(entry) {
    if (!entry) throw new Error('事前生成QRキャッシュがありません');
    var canvas = $('txCanvas');
    var context = canvas.getContext('2d', { alpha: false });
    var size = canvas.width;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);

    if (entry.bitmap) {
      context.imageSmoothingEnabled = false;
      context.drawImage(entry.bitmap, 0, 0, size, size);
      context.imageSmoothingEnabled = true;
      return { versionModules: entry.width - 8 };
    }

    var quiet = 4;
    var modules = entry.modules;
    var total = modules + quiet * 2;
    context.fillStyle = '#000';
    context.beginPath();
    for (var row = 0; row < modules; row++) {
      var run = -1;
      for (var col = 0; col <= modules; col++) {
        var bitIndex = row * modules + col;
        var dark = col < modules && ((entry.packed[bitIndex >>> 3] >>> (bitIndex & 7)) & 1) !== 0;
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
    return { versionModules: modules };
  }

  function renderQr(text) {
    return renderQrMatrix(encodeQrMatrix(text));
  }

  async function prepareTxQrCache() {
    disposeQrCache(txQrMatrixCache);
    disposeQrCache(txFountainQrCache);
    txQrMatrixCache = [];
    txFountainQrCache = [];
    txFountainQrCacheIndex = 1;
    txQrCacheBytes = 0;
    var fountainMode = txMode === 'fountain';
    var total = fountainMode
      ? (txFountainEncoder ? txFountainEncoder.seqLen : 0)
      : (txPlan ? txPlan.frames.length : 0);
    var cache = [];
    var currentPart = txFountainPart;
    var scratchCanvas = document.createElement('canvas');
    var startedAt = performance.now();

    for (var i = 0; i < total; i++) {
      var frame;
      if (fountainMode) {
        if (i > 0) currentPart = await txFountainEncoder.nextPart();
        frame = currentPart.frame;
      } else {
        frame = txPlan.frames[i];
      }

      var qr = await createQrCacheEntry(frame, scratchCanvas);
      var entryBytes = qr.bytes || (qr.packed.byteLength + 16);
      var cacheLimitReached = cache.length > 0 &&
        txQrCacheBytes + entryBytes > TX_QR_CACHE_MAX_BYTES;
      // Keep the frame already requested from the Fountain encoder; otherwise
      // stopping at the memory limit would silently skip that sequence number.
      cache.push({ frame: frame, qr: qr, part: fountainMode ? currentPart : null });
      txQrCacheBytes += entryBytes;
      if (cacheLimitReached) break;

      if ((i + 1) % 16 === 0) {
        $('txCacheStatus').textContent =
          'QR事前生成: ' + cache.length + ' / ' + total + ' 枚 · ' +
          formatBytes(txQrCacheBytes);
        status('txStatus', 'QRコードを事前生成しています: ' + cache.length + ' / ' + total, 'info');
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    }

    if (fountainMode) {
      txFountainQrCache = cache;
      // Entry 0 is already displayed as the preflight QR.
      txFountainQrCacheIndex = 1;
    } else {
      txQrMatrixCache = cache;
    }

    var elapsed = performance.now() - startedAt;
    $('txCacheStatus').textContent =
      'QR事前生成: ' + cache.length + ' / ' + total + ' 枚 · ' +
      formatBytes(txQrCacheBytes) +
      (cache.length < total ? '（メモリ上限のため残りは再生時生成）' : '（全件完了）');
    $('txQrGenMs').textContent = elapsed.toFixed(1) + ' ms';
    return { cachedFrames: cache.length, totalFrames: total, durationMs: elapsed };
  }

  function recordTxDisplayFrame(now) {
    if (!txDisplayWindowStart) {
      txDisplayWindowStart = now;
      txLastFrameSwitchAt = now;
      txDisplayWindowFrames = 0;
      return;
    }
    txDisplayWindowFrames++;
    txLastFrameSwitchAt = now;
    var elapsed = now - txDisplayWindowStart;
    if (elapsed >= 1000) {
      $('txDisplayFps').textContent = (txDisplayWindowFrames * 1000 / elapsed).toFixed(1);
      txDisplayWindowStart = now;
      txDisplayWindowFrames = 0;
    }
  }

  async function prepareTx() {
    stopTx();
    $('prepareTx').disabled = true;
    try {
      var file = $('txFile').files && $('txFile').files[0];
      var sourceBytes;
      var sourceName;
      if (file) {
        if (file.size > MAX_BENCHMARK_BYTES) throw new Error('最大転送サイズは64 MiBです');
        sourceBytes = new Uint8Array(await file.arrayBuffer());
        sourceName = file.name;
      } else {
        var text = $('txText').value;
        if (!text) throw new Error('転送するファイルまたはテキストを指定してください');
        sourceBytes = new TextEncoder().encode(text);
        sourceName = 'message.txt';
      }
      if (sourceBytes.length > MAX_BENCHMARK_BYTES) throw new Error('試験ページの上限は64 MiBです');

      var namedPayload = packNamedPayload(sourceBytes, sourceName);
      if (namedPayload.length > MAX_BENCHMARK_BYTES) {
        throw new Error('ファイル名メタデータを含む転送データが64 MiBを超えています');
      }
      var wireBytes = namedPayload;
      var compressionNote = '圧縮なし';
      if ($('compressionEnabled').checked) {
        var packed = await Core.compressIfSmaller(namedPayload);
        wireBytes = packed.bytes;
        compressionNote = packed.compressed
          ? 'Deflate: ' + formatBytes(sourceBytes.length) + ' → ' + formatBytes(wireBytes.length)
          : 'Deflate省略: ' + packed.reason;
      }

      txMode = $('transferMode').value;
      var chunkBytes = Number($('chunkSize').value);
      if (Math.ceil(wireBytes.length / chunkBytes) > 100000) {
        throw new Error('このデータ量ではデータ片数が100,000片を超えます。チャンクサイズを大きくしてください');
      }
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
        $('txFrameCount').textContent = '準備完了';
        frameLabel = '先頭QRコード · 受信側で読み取り待ち';
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
          $('txFrameCount').textContent = '準備完了';
          frameLabel = '先頭QRコード · 受信側で読み取り待ち';
        } else {
          txIndex = nextLegacyFrameIndexAfterPreflight(txPlan.frames.length);
          $('txFrameCount').textContent = '準備完了';
          frameLabel = '先頭QRコード · 受信側で読み取り待ち';
        }
      }
      var cacheResult = await prepareTxQrCache();
      var planStart = performance.now();
      var firstCacheEntry = txMode === 'fountain' ? txFountainQrCache[0] : txQrMatrixCache[0];
      if (firstCacheEntry && firstCacheEntry.qr) renderQrMatrix(firstCacheEntry.qr);
      else renderQr(firstFrame);
      var initialRenderMs = performance.now() - planStart;
      txFrameStartTime = performance.now();
      $('txPlaceholder').classList.add('hidden');
      if ($('txInputDetails')) $('txInputDetails').open = false;
      $('playTx').disabled = false;
      $('pauseTx').disabled = true;
      updateTxPlayBadge();
      $('txPayloadSize').textContent = formatBytes(wireBytes.length);
      $('txQrGenMs').textContent = cacheResult.durationMs.toFixed(1) + ' ms';
      $('txCacheStatus').textContent = 'QR事前生成: ' + cacheResult.cachedFrames + ' / ' + cacheResult.totalFrames + ' 枚';
      $('txFrameInfo').textContent = frameLabel;
      $('txProgress').style.width = (txMode === 'fountain' || hybridMode ? (1 / blockCount * 100) : 0).toFixed(1) + '%';
      updateTxBlockMap();
      status('txStatus',
        '準備完了: ' + sourceName + ' · ' + formatBytes(sourceBytes.length) +
        '。先頭QRを受信側で読み取ってから再生してください。',
        'ok');
      return true;
    } catch (error) {
      txPlan = null;
      txFountainEncoder = null;
      txFountainPart = null;
      disposeQrCache(txQrMatrixCache);
      disposeQrCache(txFountainQrCache);
      txQrMatrixCache = [];
      txFountainQrCache = [];
      txFountainQrCacheIndex = 1;
      txQrCacheBytes = 0;
      $('txCacheStatus').textContent = 'QR事前生成: 失敗';
      $('playTx').disabled = true;
      $('pauseTx').disabled = true;
      $('txPlaceholder').classList.remove('hidden');
      status('txStatus', '準備失敗: ' + error.message, 'error');
      return false;
    } finally {
      $('prepareTx').disabled = autoTestRunning;
    }
  }

  function stopTx() {
    txPlaying = false;
    txIsRendering = false;
    txPausedByVisibility = false;
    txRenderGeneration++;
    if (txRafId) {
      cancelAnimationFrame(txRafId);
      txRafId = 0;
    }
    if (txTimer) clearTimeout(txTimer);
    txTimer = 0;
    $('playTx').disabled = !(txPlan || txFountainEncoder);
    $('pauseTx').disabled = true;
    updateTxPlayBadge();
  }

  function txAnimationLoop(now) {
    txRafId = 0;
    if (!txPlaying) {
      return;
    }

    // バックグラウンド中はフレーム進行を停止（visibilitychange で復帰時に再開）
    if (typeof document !== 'undefined' && document.hidden) {
      txRafId = 0;
      return;
    }

    var effectiveFps = txAutoRateController.enabled ? txAutoRateController.currentFps : Number($('fps').value);
    var targetInterval = 1000 / Math.max(1, effectiveFps);

    // 初回描画時刻が未記録なら現在時刻で初期化
    if (!txFrameStartTime) {
      txFrameStartTime = now;
    }

    // 最低表示時間を保証：現在フレームの表示時間が targetInterval 未満なら次の rAF を待つ
    if (now - txFrameStartTime < targetInterval) {
      txRafId = requestAnimationFrame(txAnimationLoop);
      return;
    }

    // すでに非同期フレーム生成（Fountain等）または描画が進行中の場合は多重実行を防ぐ
    if (txIsRendering) {
      txRafId = requestAnimationFrame(txAnimationLoop);
      return;
    }

    // 目標表示時間を満たしたため、次のフレームへ進む
    showNextFrame();
  }

  async function showNextFrame() {
    if (!txPlan && !txFountainEncoder) return;
    if (txIsRendering) return;
    txIsRendering = true;
    var renderGeneration = ++txRenderGeneration;
    var started = performance.now();
    // Cadence is measured from frame-switch start; QR generation time is no longer added after the wait.
    txFrameStartTime = started;
    try {
      var frame;
      var cachedQr = null;
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      if (hybridMode && txHybridPhase === 'legacy' && txIndex >= txPlan.frames.length) {
        txHybridPhase = 'fountain';
        status('txStatus', '初回データ送信が終了しました。受信側で不足ブロックがある場合、LT修復フレームで補完します。', 'info');
      }
      var fountainPhase = txMode === 'fountain' || (hybridMode && txHybridPhase === 'fountain');
      if (fountainPhase) {
        var cachedFountainEntry = txMode === 'fountain' && txFountainQrCacheIndex < txFountainQrCache.length
          ? txFountainQrCache[txFountainQrCacheIndex++] : null;
        var nextFountainPart = cachedFountainEntry
          ? cachedFountainEntry.part
          : await txFountainEncoder.nextPart();
        if (renderGeneration !== txRenderGeneration || !txPlaying) return;
        cachedQr = cachedFountainEntry ? cachedFountainEntry.qr : null;
        txFountainPart = nextFountainPart;
        frame = txFountainPart.frame;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq ' + txFountainPart.seqNum + ' · ' +
          (txFountainPart.direct ? 'Data再送' : 'XOR修復') + ' · ' +
          (txFountainPart.indexes.length <= 4
            ? '対象 ' + txFountainPart.indexes.map(function (index) { return index + 1; }).join(',')
            : txFountainPart.indexes.length + 'ブロック合成');
        $('txFrameCount').textContent = '送信中';
        $('txFrameInfo').textContent = 'QRコードを表示しています。';
        $('txProgress').style.width =
          (Math.min(txFountainEncoder.seqLen, txFountainPart.seqNum) / txFountainEncoder.seqLen * 100).toFixed(1) + '%';
      } else {
        var legacyFrameIndex = txIndex;
        frame = txPlan.frames[legacyFrameIndex];
        cachedQr = txQrMatrixCache[legacyFrameIndex] ? txQrMatrixCache[legacyFrameIndex].qr : null;
        var parsed = Core.parseFrame(frame);
        txCurrentBlocks = new Set(packetBlockIndexes(parsed));
        if (parsed.type === 'data') txCurrentLabel = 'Data ' + (parsed.index + 1) + ' / ' + parsed.total;
        else txCurrentLabel = 'P' + parsed.parityType + ' · group ' + (parsed.group + 1) +
          ' · block ' + (parsed.group * Core.GROUP_SIZE + 1) + '–' +
          Math.min(parsed.total, (parsed.group + 1) * Core.GROUP_SIZE);
        var effectiveFps = txAutoRateController.enabled ? txAutoRateController.currentFps : Number($('fps').value);
        $('txFrameInfo').textContent = 'QRコードを表示しています。';
        $('txProgress').style.width = ((txIndex + 1) / txPlan.frames.length * 100).toFixed(1) + '%';
        if (hybridMode) txIndex++;
        else txIndex = (txIndex + 1) % txPlan.frames.length;
      }
      if (renderGeneration !== txRenderGeneration || !txPlaying) return;
      if (cachedQr) renderQrMatrix(cachedQr);
      else renderQr(frame);
      updateTxBlockMap();
      recordTxDisplayFrame(performance.now());

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
      txAutoRateController.recordRender(elapsed);
    } catch (error) {
      if (renderGeneration !== txRenderGeneration) return;
      stopTx();
      if (autoTestRunning) autoTestErrorMessage = error.message || String(error);
      status('txStatus', 'QR生成エラー: ' + error.message + '。密度を下げてください。', 'error');
    } finally {
      txIsRendering = false;
      // 送信継続中なら次の rAF ループを要求して最低表示時間の待機へ入る
      if (txPlaying && !txRafId && !(typeof document !== 'undefined' && document.hidden)) {
        txRafId = requestAnimationFrame(txAnimationLoop);
      }
    }
  }

  function playTx() {
    if ((!txPlan && !txFountainEncoder) || txPlaying) return;
    txPlaying = true;
    txPausedByVisibility = false;
    $('playTx').disabled = true;
    $('pauseTx').disabled = false;
    updateTxPlayBadge();
    // 再生開始時、現在画面に表示されているフレームの表示開始時刻を現在時刻に設定
    txFrameStartTime = performance.now();
    txDisplayWindowStart = txFrameStartTime;
    txDisplayWindowFrames = 0;
    txLastFrameSwitchAt = txFrameStartTime;
    $('txDisplayFps').textContent = '計測中';
    if (!txRafId && !txIsRendering) {
      txRafId = requestAnimationFrame(txAnimationLoop);
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (txPlaying) {
          txPausedByVisibility = true;
          if (txRafId) {
            cancelAnimationFrame(txRafId);
            txRafId = 0;
          }
        }
        if (stream && !receivedDone) {
          cancelScanSchedule();
        }
      } else {
        if (txPlaying && txPausedByVisibility) {
          txPausedByVisibility = false;
          // 復帰直後のフレームスキップを防ぐため、現在フレームの表示開始時刻を復帰時刻でリセット
          txFrameStartTime = performance.now();
          txDisplayWindowStart = txFrameStartTime;
          txDisplayWindowFrames = 0;
          txLastFrameSwitchAt = txFrameStartTime;
          if (!txRafId && !txIsRendering) {
            txRafId = requestAnimationFrame(txAnimationLoop);
          }
        }
        if (stream && !receivedDone) {
          scheduleScan(0);
        }
      }
    });
  }

  function updateTxPlayBadge() {
    var badge = $('txPlayBadge');
    if (!badge) return;
    if (!txPlan && !txFountainEncoder) {
      badge.classList.add('hidden');
      return;
    }
    if (txPlaying) {
      // 再生中はQRコード読み取りの邪魔になるためバッジを完全非表示にする
      badge.classList.add('hidden');
    } else {
      // 一時停止中のみタップ再生案内を表示
      badge.textContent = '⏸ 一時停止（タップで再生）';
      badge.className = 'qr-stage-badge paused';
      badge.classList.remove('hidden');
    }
  }

  function toggleTxPlayback() {
    if (!txPlan && !txFountainEncoder) return;
    if (txPlaying) {
      stopTx();
      status('txStatus', '送信を一時停止しました（QRタップで再開できます）。', 'info');
    } else {
      playTx();
      status('txStatus', '送信を再開しました（QRタップで一時停止できます）。', 'info');
    }
  }

  var txStage = $('txStage');
  if (txStage) {
    // A browser-generated click is shared by mouse and touch. Keep one handler only.
    // Adding touchend/pointerup here would cause a tap to toggle playback twice.
    txStage.addEventListener('click', function (event) {
      if (event && event.target && event.target.closest &&
          event.target.closest('a,button,input,select,textarea')) return;
      if (!txPlan && !txFountainEncoder) return;
      toggleTxPlayback();
    });
  }

  $('prepareTx').addEventListener('click', prepareTx);
  $('playTx').addEventListener('click', playTx);
  $('pauseTx').addEventListener('click', function () {
    stopTx();
    status('txStatus', '送信を一時停止しました。再生ボタンまたはQRタップで続きから再開できます。', 'info');
  });

  async function runTxAutoTest() {
    if (autoTestRunning) {
      autoTestWasCancelled = true;
      autoTestRunning = false;
      if (autoTestTimer) clearTimeout(autoTestTimer);
      autoTestTimer = 0;
      if (autoTestResolve) { autoTestResolve(); autoTestResolve = null; }
      stopTx();
      autoTestPayloadBytes = null;
      $('autoTxTest').textContent = '選択条件で自動ベンチマーク';
      $('prepareTx').disabled = false;
      status('txStatus', '自動ベンチマークを停止しました。', 'info');
      return;
    }

    var requestedBytes = selectedBenchmarkBytes();
    var selectedMode = $('transferMode').value;
    var selectedChunk = Number($('chunkSize').value);
    var selectedFps = Number($('fps').value);
    autoTestPayloadBytes = createBenchmarkPayload(requestedBytes);
    autoTestRunning = true;
    autoTestWasCancelled = false;
    autoTestErrorMessage = '';
    $('autoTxLog').value = 'case,mode,data_bytes,chunk_bytes,fps,transfer_id,estimated_duration_ms\n';
    $('autoTxTest').textContent = '自動ベンチマークを停止';
    $('prepareTx').disabled = true;
    status('txStatus',
      'TXベンチマークを準備しています。RX側のカメラ状態は確認しません。RX側は別途カメラを開始し、先頭QRを読み取ってください（ACK／同期なし）。',
      'info');

    var failure = '';
    try {
      var prepared = await prepareTx();
      if (!autoTestRunning) return;
      if (!prepared || (!txPlan && !txFountainEncoder)) {
        failure = 'ベンチマーク用データの準備に失敗しました。TXのエラー表示を確認してください。';
        return;
      }
      var units = txMode === 'fountain'
        ? Math.ceil(txFountainEncoder.seqLen * 1.6)
        : (txMode === 'hybrid' || txMode === 'hybrid-data')
          ? txPlan.frames.length + Math.ceil(txFountainEncoder.seqLen * 1.6)
          : txPlan.frames.length;
      var duration = Math.min(2147483647,
        Math.max(10000, Math.ceil(units * 1000 / Math.max(1, selectedFps) * 1.35 + 3500)));
      var transferId = txMode === 'fountain' ? txFountainEncoder.id : txPlan.id;
      $('autoTxLog').value += [
        1, selectedMode, requestedBytes, selectedChunk, selectedFps, transferId, duration
      ].join(',') + '\n';
      status('txStatus',
        '自動ベンチマーク送信中 · ' + formatBytes(requestedBytes) +
        ' · ' + selectedMode + ' · chunk ' + selectedChunk + ' B · ' + selectedFps +
        ' fps · 推定 ' + formatElapsedMs(duration) +
        ' · RXの準備状態は送信側では判定できません。',
        'info');
      playTx();
      await new Promise(function (resolve) {
        autoTestResolve = resolve;
        autoTestTimer = setTimeout(function () {
          autoTestTimer = 0;
          autoTestResolve = null;
          resolve();
        }, duration);
      });
      if (!autoTestRunning) return;
      if (autoTestErrorMessage) failure = '送信中にエラーが発生しました: ' + autoTestErrorMessage;
    } catch (error) {
      failure = '自動ベンチマークを中断しました: ' + error.message;
    } finally {
      autoTestRunning = false;
      if (autoTestTimer) clearTimeout(autoTestTimer);
      autoTestTimer = 0;
      autoTestResolve = null;
      stopTx();
      autoTestPayloadBytes = null;
      $('autoTxTest').textContent = '選択条件で自動ベンチマーク';
      $('prepareTx').disabled = false;
      if (!autoTestWasCancelled) {
        if (failure) status('txStatus', failure, 'error');
        else status('txStatus', '自動ベンチマーク送信を終了しました。RX側の計測結果とTransfer IDを照合してください。', 'ok');
      }
    }
  }

  function resetRx() {
    if (autoResetTimer) { clearTimeout(autoResetTimer); autoResetTimer = 0; }
    if (rxRateAdvisor) rxRateAdvisor.reset();
    rx.reset();
    fountainRx.reset();
    fountainRx.gaussianEnabled = !!$('rxGaussianEnabled').checked;
    $('runRxGaussian').disabled = !fountainRx.gaussianEnabled;
    $('rxGaussianStatus').textContent = fountainRx.gaussianEnabled
      ? 'GF(2)実験: 使用可能。カメラ停止後に手動実行してください。受信中はpeelingのみです。'
      : '通常受信中はpeelingのみ。ガウス消去は無効です。';
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
    var guide = $('rxDistanceGuide');
    if (guide) {
      updateDistanceGuide(false, null, 0);
    }
    scanBusy = false;
    scanLatestPresentedFrames = null;
    scanLastAnalyzedPresentedFrames = null;
    scanLastIngestedRawText = '';
    scanConsecutiveNoQrCount = 0;
    scanIngestQueue = [];
    scanIngestBusy = false;
    rxWorkerBusy = false;
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
    rxWireByteCount = null;
    rxOutputByteCount = null;
    $('rxWireBytes').textContent = '—';
    $('rxOutputBytes').textContent = '—';
    benchmarkPeakHeapBytes = null;
    benchmarkHeapLimitBytes = null;
    $('rxMemoryPeak').textContent = '—';
    $('rxLost').textContent = '—';
    $('rxRecovered').textContent = '0';
    $('rxHitRate').textContent = '0%';
    $('rxBlockSummary').textContent = '受信を開始するとブロック状態が表示されます';
    drawBlockMap('rxBlockMap', 0, null, null, null);
    rxMapDirty = false;
    $('rxResultMeta').textContent = '';
    if ($('rxCompletionCard')) $('rxCompletionCard').classList.add('hidden');
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
      $('rxBlockSummary').textContent = '受信したデータの状態を表示しています';
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
        ? '受信したデータの状態を表示しています'
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
    $('rxMemoryPeak').textContent = benchmarkPeakHeapBytes === null
      ? '非対応' : formatBytes(benchmarkPeakHeapBytes);
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
      txMode: activeProtocol || '',
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
      missingBlocks: Math.max(0, progress.total - progress.have),
      wireBytes: rxWireByteCount,
      outputBytes: rxOutputByteCount,
      memoryPeakBytes: benchmarkPeakHeapBytes,
      memoryLimitBytes: benchmarkHeapLimitBytes,
      completionMs: elapsedMs,
      samples: scanDecodeSamples.slice()
    };
    benchmarkRuns.push(run);
    benchmarkRunRecorded = true;
    $('benchmarkRunCount').textContent =
      '完了した計測: ' + benchmarkRuns.length + '件（このページを開いている間保持）';
    var copyBenchmarkButton = $('copyBenchmarkText');
    if (copyBenchmarkButton) copyBenchmarkButton.disabled = false;
  }

  function benchmarkResultsText() {
    var lines = [
      'Airgap Link Test Lab — 計測結果',
      '計測日時\tTransfer ID\tモード\t要求解像度\t実解像度\t実測映像FPS\t読み取り方式\t検出率(%)\t解析平均(ms)\t解析P95(ms)\t有効フレーム/秒\t受信ブロック\t総ブロック\t欠損ブロック\t転送データ量(B)\t復元ファイル量(B)\tJSヒープ最大(B)\tJSヒープ上限(B)\t完了時間(ms)'
    ];
    benchmarkRuns.forEach(function (run) {
      lines.push([
        run.recordedAt,
        run.transferId || '',
        run.txMode || '',
        run.requestedResolution || '',
        run.actualWidth && run.actualHeight ? run.actualWidth + 'x' + run.actualHeight : '',
        run.observedVideoFps === null ? '' : run.observedVideoFps,
        run.scanner || '',
        run.hitRatePercent.toFixed(2),
        run.decodeMeanMs === null ? '' : run.decodeMeanMs.toFixed(3),
        run.decodeP95Ms === null ? '' : run.decodeP95Ms.toFixed(3),
        run.uniqueFramesPerSecond === null ? '' : run.uniqueFramesPerSecond.toFixed(3),
        run.receivedBlocks,
        run.totalBlocks,
        run.missingBlocks,
        run.wireBytes === null ? '' : run.wireBytes,
        run.outputBytes === null ? '' : run.outputBytes,
        run.memoryPeakBytes === null ? '' : run.memoryPeakBytes,
        run.memoryLimitBytes === null ? '' : run.memoryLimitBytes,
        run.completionMs === null ? '' : run.completionMs.toFixed(1)
      ].join('\t'));
      if (run.samples && run.samples.length) {
        lines.push('Raw scan samples (ms) for ' + (run.transferId || 'unknown') + ':');
        run.samples.forEach(function (sample, index) {
          lines.push((index + 1) + '\t' + Number(sample).toFixed(3));
        });
      }
    });
    return lines.join('\n');
  }

  async function copyTextToClipboard(value, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('copy command unavailable');
      }
      status('rxStatus', successMessage, 'ok');
    } catch (_error) {
      var previousFallback = $('clipboardFallback');
      if (previousFallback) previousFallback.remove();
      var fallback = document.createElement('textarea');
      fallback.id = 'clipboardFallback';
      fallback.value = value;
      fallback.setAttribute('readonly', '');
      fallback.setAttribute('aria-label', 'コピー用テキスト');
      fallback.style.position = 'fixed';
      fallback.style.inset = '10px';
      fallback.style.width = 'calc(100% - 20px)';
      fallback.style.height = '40vh';
      fallback.style.opacity = '1';
      fallback.style.zIndex = '99999';
      fallback.style.background = '#fff';
      fallback.style.color = '#111';
      fallback.style.padding = '10px';
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      status('rxStatus', '自動コピーできませんでした。画面に表示したテキストを選択してコピーしてください。', 'info');
    }
  }

  function copyBenchmarkText() {
    if (!benchmarkRuns.length) {
      status('rxStatus', 'コピーできる計測結果はまだありません。受信を完了すると計測結果が保存され、このボタンが有効になります。', 'info');
      $('benchmarkRunCount').textContent = '完了した計測: 0件（受信完了後にコピーできます）';
      return;
    }
    copyTextToClipboard(benchmarkResultsText(), '計測結果をテキストとしてコピーしました。メモ帳などに貼り付けて確認できます。');
  }


  function packNamedPayload(payload, filename) {
    if (!(payload instanceof Uint8Array)) payload = new Uint8Array(payload);
    var nameBytes = new TextEncoder().encode(String(filename || 'received-file.bin'));
    if (!nameBytes.length || nameBytes.length > 4096) {
      throw new Error('ファイル名メタデータの長さが不正です');
    }
    var headerLength = 16;
    var output = new Uint8Array(headerLength + nameBytes.length + payload.length);
    output.set([0x41, 0x47, 0x4c, 0x46, 0x4e, 0x30, 0x30, 0x31], 0); // AGLFN001
    var view = new DataView(output.buffer);
    view.setUint32(8, nameBytes.length, false);
    view.setUint32(12, payload.length, false);
    output.set(nameBytes, headerLength);
    output.set(payload, headerLength + nameBytes.length);
    return output;
  }

  function unpackNamedPayload(value) {
    var payload = value instanceof Uint8Array ? value : new Uint8Array(value);
    var magic = [0x41, 0x47, 0x4c, 0x46, 0x4e, 0x30, 0x30, 0x31]; // AGLFN001
    if (payload.length < 8 || magic.some(function (byte, index) { return payload[index] !== byte; })) {
      return { bytes: payload.slice(), filename: null, named: false };
    }
    if (payload.length < 16) throw new Error('ファイル名メタデータのヘッダーが途中で切れています');
    var view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    var nameLength = view.getUint32(8, false);
    var dataLength = view.getUint32(12, false);
    if (!nameLength || nameLength > 4096 || dataLength > MAX_BENCHMARK_BYTES ||
        16 + nameLength + dataLength !== payload.length) {
      throw new Error('ファイル名メタデータの長さが不正です');
    }
    var filename = new TextDecoder('utf-8', { fatal: true })
      .decode(payload.subarray(16, 16 + nameLength));
    return {
      bytes: payload.slice(16 + nameLength),
      filename: filename,
      named: true
    };
  }

  function safeFilename(value) {
    var name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return name;
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
    var named = unpackNamedPayload(unpacked.bytes);
    var finalBytes = named.bytes;
    var name = safeFilename(named.filename) || 'received-file.bin';
    var blob = new Blob([finalBytes], { type: 'application/octet-stream' });
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    var link = $('downloadResult');
    link.href = objectUrl;
    link.download = name;
    link.classList.remove('hidden');
    var completedElapsedMs = elapsedTransferMs(transferTiming, performance.now());
    rxWireByteCount = bytes.length;
    rxOutputByteCount = finalBytes.length;
    $('rxWireBytes').textContent = formatBytes(rxWireByteCount) + ' (' + rxWireByteCount.toLocaleString() + ' B)';
    $('rxOutputBytes').textContent = formatBytes(rxOutputByteCount) + ' (' + rxOutputByteCount.toLocaleString() + ' B)';
    $('rxThroughput').textContent = completedElapsedMs === null ? '—' : formatRate(bytes.length, completedElapsedMs);
    $('rxFileRate').textContent = completedElapsedMs === null ? '—' : formatRate(finalBytes.length, completedElapsedMs);
    var firstDetection = scanFirstHitAt && scanStartAt ? ((scanFirstHitAt - scanStartAt) / 1000).toFixed(2) + '秒' : '—';
    var cameraSettings = captureCameraSettings();
    var cameraSize = cameraSettings.width && cameraSettings.height ? cameraSettings.width + '×' + cameraSettings.height : '—';
    $('rxResultMeta').textContent = 'CRC32検証済み · 転送ID ' +
      ((activeProtocol === 'fountain' || activeProtocol === 'hybrid') ? fountainRx.id : rx.id);
    if ($('rxCompletionSize')) $('rxCompletionSize').textContent =
      formatBytes(finalBytes.length) + ' (' + finalBytes.length.toLocaleString() + ' bytes)';
    if ($('rxCompletionTime')) $('rxCompletionTime').textContent =
      completedElapsedMs === null ? '—' : formatElapsedMs(completedElapsedMs);
    if ($('rxCompletionSpeed')) $('rxCompletionSpeed').textContent =
      completedElapsedMs === null ? '—' : formatRate(finalBytes.length, completedElapsedMs);
    if ($('rxCompletionCard')) $('rxCompletionCard').classList.remove('hidden');
    status('rxStatus', '受信完了。復元データの整合性を確認しました。', 'ok');
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
          status('rxStatus', '初回データで不足したブロックをLT修復中です。', 'info');
        } else if (activeProtocol === null) activeProtocol = 'fountain';
        else if (activeProtocol !== 'fountain' && activeProtocol !== 'hybrid') {
          throw new Error('別の転送方式のフレームです。受信をリセットしてください');
        }
        result = await fountainRx.feed(rawText);
        var indexes = result.lastIndexes || await fountainRx.chooser.choose(fountainPacket.seqNum);
        rxCurrentBlocks = new Set(indexes);
        rxCurrentLabel = 'LT seq ' + fountainPacket.seqNum + ' · ' +
          (indexes.length <= 4
            ? 'blocks ' + indexes.map(function (index) { return index + 1; }).join(',')
            : indexes.length + ' blocks');
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
      if (rxRateAdvisor) {
        rxRateAdvisor.recordIngestResult(result.duplicate, result.complete);
      }
      if (result.complete && transferTiming.startedAt !== null && transferTiming.endedAt === null) {
        transferTiming.endedAt = performance.now();
      }
      updateRxStats();
      if (transferTimerStarted) {
        var guide = $('rxDistanceGuide');
        if (guide) guide.style.display = 'none';
        var targetBox = $('rxCameraTargetBox');
        if (targetBox) targetBox.style.display = 'none';
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
    scannerPreference = $('rxScanner') ? $('rxScanner').value : 'zxing-wasm';
    var allowFallback = $('rxAllowFallback') ? $('rxAllowFallback').checked : false;
    var wasmError = null;
    var nativeError = null;

    // 1. ZXing-C++ WASM (3.1.6) を最優先で試行（実測でNativeより高速かつ安定）
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
        scannerName = 'ZXing-C++ WASM 3.1.6（最高速）';
        $('scannerMode').textContent = '読み取り方式: ' + scannerName;
        $('scannerMode').className = 'status info';
        return;
      } catch (error) {
        zxingDecoder = null;
        wasmError = error;
        // フォールバック未許可時は遅いNativeに勝手に落とさずエラー提示
        if (!allowFallback && scannerPreference === 'zxing-wasm') {
          throw new Error('ZXing-C++ WASMを起動できません: ' + error.message + '（互換フォールバックをONにしてください）');
        }
      }
    }

    // 2. 互換フォールバックが許可されている場合、または明示的に指定された場合のみ Native / jsQR を試行
    if (scannerPreference === 'native' || (allowFallback && (scannerPreference === 'auto' || scannerPreference === 'zxing-wasm'))) {
      if (typeof window.BarcodeDetector === 'function') {
        try {
          var formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.indexOf('qr_code') !== -1) {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            scannerType = 'native';
            scannerName = 'Native BarcodeDetector' + (scannerPreference === 'auto' ? '（互換フォールバック）' : '');
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

    // 3. 最終フォールバック: jsQR
    if (scannerPreference === 'jsqr' || (allowFallback && (scannerPreference === 'auto' || scannerPreference === 'zxing-wasm'))) {
      if (typeof window.jsQR !== 'function') {
        throw new Error('jsQR.jsを読み込めませんでした');
      }
      scannerType = 'jsqr';
      scannerName = scannerPreference === 'jsqr' ? 'jsQR（指定）' : 'jsQR（最終フォールバック）';
      var failReason = wasmError ? ' · WASM利用不可: ' + wasmError.message : (nativeError ? ' · Native利用不可: ' + nativeError.message : '');
      $('scannerMode').textContent = '読み取り方式: ' + scannerName + failReason;
      $('scannerMode').className = 'status info';
      return;
    }

    throw new Error('読み取り方式を初期化できませんでした。ZXing WASMが動かない環境の場合は「互換フォールバックを許可」にチェックを入れてください');
  }

  function updateDistanceGuide() {}

  function handleWorkerDecodeResult(msg) {
    rxWorkerBusy = false;
    // カメラ停止中、受信完了後、またはセッション世代が不一致（停止後の遅延結果）なら完全に破棄
    if (!stream || receivedDone || (msg.sessionId !== undefined && msg.sessionId !== rxScanSessionId)) {
      return;
    }
    var raw = msg.raw;
    var decodeElapsed = msg.elapsedMs || 0;

    var isHit = !!raw;
    var isNovel = false;
    if (transferTiming && transferTiming.startedAt === null) {
      updateDistanceGuide(isHit, msg.qrRatio, decodeElapsed);
    }
    if (raw) {
      scanHits++;
      scanConsecutiveNoQrCount = 0;
      if (!scanFirstHitAt) scanFirstHitAt = performance.now();
      var clean = raw.replace(/^[\r\n]+|[\r\n]+$/g, '');

      if (clean !== scanLastIngestedRawText) {
        isNovel = true;
        scanLastIngestedRawText = clean;
        enqueueIngest(clean);
      }
    } else {
      scanConsecutiveNoQrCount++;
      if (scanConsecutiveNoQrCount >= 5) {
        scanLastIngestedRawText = '';
      }
    }

    scanAttempts++;
    sampleBenchmarkMemory();
    scanDecodeSamples.push(decodeElapsed);
    if (scanDecodeSamples.length > 256) scanDecodeSamples.shift();
    scanDecodeTotalMs += decodeElapsed;
    updateRxStats();

    if (rxRateAdvisor) {
      rxRateAdvisor.recordScanAttempt(isHit, isNovel, decodeElapsed);
      rxRateAdvisor.recordQueueLength(scanIngestQueue.length);
      rxRateAdvisor.evaluate(performance.now());
    }

    // デコード完了後、もし解析中に新しい映像フレームが届いていれば直ちに最新フレームを処理
    if (stream && !receivedDone) {
      if (scanLatestPresentedFrames !== null &&
          scanLatestPresentedFrames !== scanLastAnalyzedPresentedFrames) {
        triggerScanIfIdle();
      }
    }
  }

  function initQrWorker() {
    if (rxWorker && rxWorkerReady) return Promise.resolve(true);
    if (typeof window === 'undefined' || typeof window.Worker !== 'function') {
      rxWorkerFailed = true;
      return Promise.resolve(false);
    }
    if (rxWorker) {
      try { rxWorker.terminate(); } catch (_) {}
      rxWorker = null;
    }
    return new Promise(function (resolve) {
      try {
        rxWorker = new Worker('airgap-link-qr-worker-v13.js');
        var initTimer = setTimeout(function () {
          rxWorkerFailed = true;
          rxWorkerReady = false;
          resolve(false);
        }, 3000);

        rxWorker.onmessage = function (e) {
          var msg = e.data;
          if (!msg) return;
          if (msg.type === 'init-ready') {
            clearTimeout(initTimer);
            if (msg.success) {
              rxWorkerReady = true;
              rxWorkerFailed = false;
              if (scannerType === 'zxing-wasm' || scannerType === 'jsqr') {
                $('scannerMode').textContent = '読み取り方式: ' + scannerName + ' (Web Worker非同期)';
              }
              resolve(true);
            } else {
              rxWorkerFailed = true;
              rxWorkerReady = false;
              resolve(false);
            }
          } else if (msg.type === 'decode-result') {
            handleWorkerDecodeResult(msg);
          }
        };

        rxWorker.onerror = function () {
          clearTimeout(initTimer);
          rxWorkerBusy = false;
          rxWorkerFailed = true;
          rxWorkerReady = false;
          try { rxWorker.terminate(); } catch (_) {}
          rxWorker = null;
          resolve(false);
        };

        rxWorker.postMessage({
          type: 'init',
          scannerType: scannerType
        });
      } catch (_) {
        rxWorkerFailed = true;
        rxWorkerReady = false;
        resolve(false);
      }
    });
  }

  async function startCamera() {
    if (stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status('rxStatus', 'カメラにはHTTPSまたはlocalhostが必要です。手動フレーム入力を利用してください。', 'error');
      return;
    }
    $('startCamera').disabled = true;
    if ($('rxScanner')) $('rxScanner').disabled = true;
    rxScanSessionId++;
    status('rxStatus', '読み取り方式を初期化しています…', 'info');
    try {
      await initScanner();
      await initQrWorker();
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
      updateDistanceGuide(false, null, 0);
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
      scanVideoFrameCallback = video.requestVideoFrameCallback(onScanVideoFrame);
      return;
    }
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      onScanTimerFallback();
    }, Math.max(0, Number(delay) || 0));
  }

  function onScanVideoFrame(now, metadata) {
    scanVideoFrameCallback = null;
    if (!stream || receivedDone) return;
    var presented = metadata && Number.isFinite(metadata.presentedFrames)
      ? metadata.presentedFrames
      : null;
    scanLatestPresentedFrames = presented;

    // 解析ループがアイドルなら最新フレームの解析を開始
    triggerScanIfIdle();

    // 解析の進行状況にかかわらず、カメラ映像の監視ループを継続（最新フレームを逃さない）
    if (stream && !receivedDone) {
      scheduleScan(0);
    }
  }

  function onScanTimerFallback() {
    if (!stream || receivedDone) return;
    triggerScanIfIdle();
    if (stream && !receivedDone) {
      scheduleScan(16);
    }
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
    rxScanSessionId++;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    updateDistanceGuide(false, null, 0);
    var video = $('camera');
    if (video.srcObject) video.srcObject = null;
    scanBusy = false;
    scanLatestPresentedFrames = null;
    scanLastAnalyzedPresentedFrames = null;
    scanLastIngestedRawText = '';
    scanConsecutiveNoQrCount = 0;
    scanIngestQueue = [];
    scanIngestBusy = false;
    rxWorkerBusy = false;
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
    $('rxResolution').disabled = false;
    if ($('rxScanner')) $('rxScanner').disabled = false;
  }

  function triggerScanIfIdle() {
    if (!stream || scanBusy || rxWorkerBusy || receivedDone) return;
    var video = $('camera');
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    // rVFC でフレーム通番が取得できる場合、前回解析したフレームと同一なら重複解析をスキップ
    if (scanLatestPresentedFrames !== null &&
        scanLatestPresentedFrames === scanLastAnalyzedPresentedFrames) {
      return;
    }

    scanTick();
  }

  function enqueueIngest(rawText) {
    if (scanIngestQueue.length >= MAX_INGEST_QUEUE) {
      scanIngestQueue.shift();
    }
    scanIngestQueue.push(rawText);
    if (!scanIngestBusy) {
      drainIngestQueue();
    }
  }

  async function drainIngestQueue() {
    if (scanIngestBusy || !scanIngestQueue.length || receivedDone) return;
    scanIngestBusy = true;
    try {
      while (scanIngestQueue.length && !receivedDone) {
        var rawText = scanIngestQueue.shift();
        var ingestStarted = performance.now();
        try {
          await ingest(rawText);
        } finally {
          var ingestElapsed = performance.now() - ingestStarted;
          scanIngestTotalMs += ingestElapsed;
        }
      }
    } catch (error) {
      status('rxStatus', 'プロトコル受信エラー: ' + error.message, 'error');
    } finally {
      scanIngestBusy = false;
      if (receivedDone) recordBenchmarkRun();
      if (scanIngestQueue.length && !receivedDone) {
        drainIngestQueue();
      }
    }
  }

  async function detectQr(video) {
    // 1. Native BarcodeDetector (高速・GPU直結)
    if (detector) {
      try {
        var results = await detector.detect(video);
        var hit = results.find(function (item) { return Wire.isAirgapFrame(item.rawValue); });
        if (hit) return hit.rawValue;
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

    // 2. Canvas経由でのデコード (ZXing WASM / jsQR)
    var canvas = $('scanCanvas');
    var scale = Math.min(1, 1280 / video.videoWidth);
    var width = Math.max(1, Math.round(video.videoWidth * scale));
    var height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      scanCachedContext = null;
    }
    if (!scanCachedContext) {
      scanCachedContext = canvas.getContext('2d', { willReadFrequently: true });
    }
    var context = scanCachedContext;
    context.drawImage(video, 0, 0, width, height);

    // ROIスキャン（中央70%優先）
    // QRが中央にある場合は高速・省メモリで完了
    var roiRatio = 0.7;
    var roiW = Math.round(width * roiRatio);
    var roiH = Math.round(height * roiRatio);
    var roiX = Math.round((width - roiW) / 2);
    var roiY = Math.round((height - roiH) / 2);
    var roiImage = context.getImageData(roiX, roiY, roiW, roiH);

    var roiRaw = null;
    if (scannerType === 'zxing-wasm') {
      var roiZxingResults = await zxingDecoder.readBarcodes(roiImage, {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
        tryHarder: false
      });
      var roiHit = roiZxingResults.find(function (item) {
        return item && Wire.isAirgapFrame(item.text);
      });
      if (roiHit) roiRaw = roiHit.text;
    } else {
      var roiDecoded = window.jsQR(roiImage.data, roiImage.width, roiImage.height, { inversionAttempts: 'dontInvert' });
      if (roiDecoded && Wire.isAirgapFrame(roiDecoded.data)) roiRaw = roiDecoded.data;
    }

    if (roiRaw) return roiRaw;

    // ROIで見つからなければ全画面スキャンへフォールバック
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
      if (zxingHit) return zxingHit.text;
    } else {
      var decoded = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (decoded && Wire.isAirgapFrame(decoded.data)) return decoded.data;
    }

    return null;
  }

  async function scanTick() {
    if (!stream || scanBusy || rxWorkerBusy || receivedDone) return;
    var video = $('camera');
    if (video.readyState < 2 || !video.videoWidth) {
      scheduleScan(30);
      return;
    }

    // 1. Web Worker による非同期デコード（Native Detector を使わない場合）
    if (rxWorkerReady && !rxWorkerFailed && !detector) {
      rxWorkerBusy = true;
      scanLastAnalyzedPresentedFrames = scanLatestPresentedFrames;

      var canvas = $('scanCanvas');
      var scale = Math.min(1, 1280 / video.videoWidth);
      var width = Math.max(1, Math.round(video.videoWidth * scale));
      var height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        scanCachedContext = null;
      }
      if (!scanCachedContext) {
        scanCachedContext = canvas.getContext('2d', { willReadFrequently: true });
      }
      scanCachedContext.drawImage(video, 0, 0, width, height);
      var image = scanCachedContext.getImageData(0, 0, width, height);

      try {
        rxWorker.postMessage({
          type: 'decode',
          id: ++rxWorkerRequestId,
          sessionId: rxScanSessionId,
          buffer: image.data.buffer,
          width: width,
          height: height,
          scannerType: scannerType
        }, [image.data.buffer]);
      } catch (err) {
        rxWorkerBusy = false;
        rxWorkerFailed = true;
      }
      return;
    }

    // 2. メインスレッドでの解析（Native BarcodeDetector、または Worker フォールバック）
    scanBusy = true;
    scanLastAnalyzedPresentedFrames = scanLatestPresentedFrames;

    var raw = null;
    var decodeElapsed = 0;
    try {
      var decodeStarted = performance.now();
      try {
        raw = await detectQr(video);
      } finally {
        decodeElapsed = performance.now() - decodeStarted;
      }

      var isHit = !!raw;
      var isNovel = false;
      if (raw) {
        scanHits++;
        scanConsecutiveNoQrCount = 0;
        if (!scanFirstHitAt) scanFirstHitAt = performance.now();
        var clean = raw.replace(/^[\r\n]+|[\r\n]+$/g, '');

        // 重複フレーム抑制: 直前と同一のQRコードが連続している間はプロトコル処理への重複投入をスキップ
        if (clean !== scanLastIngestedRawText) {
          isNovel = true;
          scanLastIngestedRawText = clean;
          enqueueIngest(clean);
        }
      } else {
        // QRが検出されなかった場合、5フレーム以上未検出が続けば直前QR記憶をクリア
        scanConsecutiveNoQrCount++;
        if (scanConsecutiveNoQrCount >= 5) {
          scanLastIngestedRawText = '';
        }
      }
    } catch (error) {
      status('rxStatus', '解析エラー: ' + error.message, 'error');
    } finally {
      scanAttempts++;
      sampleBenchmarkMemory();
      scanDecodeSamples.push(decodeElapsed);
      if (scanDecodeSamples.length > 256) scanDecodeSamples.shift();
      scanDecodeTotalMs += decodeElapsed;
      updateRxStats();
      if (transferTiming && transferTiming.startedAt === null) {
        updateDistanceGuide(isHit, null, decodeElapsed);
      }

      if (rxRateAdvisor) {
        rxRateAdvisor.recordScanAttempt(isHit, isNovel, decodeElapsed);
        rxRateAdvisor.recordQueueLength(scanIngestQueue.length);
        rxRateAdvisor.evaluate(performance.now());
      }
      scanBusy = false;

      // 解析完了時点で、もし解析中に新しい映像フレームが届いていれば直ちに最新フレームの解析を開始
      if (stream && !receivedDone) {
        if (scanLatestPresentedFrames !== null &&
            scanLatestPresentedFrames !== scanLastAnalyzedPresentedFrames) {
          triggerScanIfIdle();
        }
      }
    }
  }

  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('resetRx').addEventListener('click', resetRx);
  $('rxGaussianEnabled').addEventListener('change', function () {
    fountainRx.gaussianEnabled = $('rxGaussianEnabled').checked;
    $('runRxGaussian').disabled = !fountainRx.gaussianEnabled;
    $('rxGaussianStatus').textContent = fountainRx.gaussianEnabled
      ? 'GF(2)実験: 使用可能。カメラ停止後に手動実行してください。受信中はpeelingのみです。'
      : '通常受信中はpeelingのみ。ガウス消去は無効です。';
  });
  $('runRxGaussian').addEventListener('click', function () {
    if (!fountainRx.gaussianEnabled) return;
    var video = $('camera');
    var stream = video && video.srcObject;
    var cameraLive = !!(stream && stream.getTracks().some(function (track) { return track.readyState === 'live'; }));
    if (cameraLive || scanBusy || rxWorkerBusy || scanIngestBusy) {
      $('rxGaussianStatus').textContent = '実行中止: QR取りこぼし防止のため、カメラを停止して受信処理が終わってから実行してください。';
      return;
    }
    try {
      var gs = fountainRx.runGaussianElimination();
      $('rxGaussianStatus').textContent = gs.skipped
        ? 'GF(2): 安全上限でスキップ · 式 ' + gs.equationCount + ' · 非ゼロ係数 ' + gs.nonZeros
        : 'GF(2): rank ' + gs.rank + '/' + gs.variables + ' · 新規復元 ' +
          gs.recoveredBlocks + '片 · ' + gs.durationMs.toFixed(2) + ' ms';
      updateRxStats();
      if (fountainRx.isComplete()) {
        status('rxStatus', 'GF(2)ガウス消去で復元完了。データ全体のCRC32も検証済みです。', 'ok');
      }
    } catch (error) {
      $('rxGaussianStatus').textContent = 'GF(2)実験エラー: ' + (error && error.message ? error.message : String(error));
    }
  });
  $('ingestManual').addEventListener('click', function () {
    ingest($('manualFrame').value.replace(/^[\r\n]+|[\r\n]+$/g, ''));
  });

  if ($('runSelfTest')) {
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
  }

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
  txAutoRateController.reset();
  rxRateAdvisor.reset();
  if ($('rxResolution')) $('rxResolution').value = '640x480';
  $('transferMode').value = 'hybrid-data';
  updateModeControls();
  resetRx();
  updateTxBlockMap();

  if (typeof window !== 'undefined') {
    window.__airgapTestHooks = {
      detectQr: detectQr,
      triggerScanIfIdle: triggerScanIfIdle,
      enqueueIngest: enqueueIngest,
      getScanState: function () {
        return {
          scanBusy: scanBusy,
          scanLatestPresentedFrames: scanLatestPresentedFrames,
          scanLastAnalyzedPresentedFrames: scanLastAnalyzedPresentedFrames,
          scanLastIngestedRawText: scanLastIngestedRawText,
          scanIngestQueueLength: scanIngestQueue.length,
          scanIngestBusy: scanIngestBusy,
          rxWorkerReady: rxWorkerReady,
          rxWorkerBusy: rxWorkerBusy,
          rxWorkerFailed: rxWorkerFailed,
          rxScanSessionId: rxScanSessionId
        };
      },
      initQrWorker: initQrWorker,
      setScanLatestPresentedFrames: function (val) { scanLatestPresentedFrames = val; },
      onScanVideoFrame: onScanVideoFrame,
      rateController: rxRateAdvisor
    };
    window.airgapLinkTest = window.__airgapTestHooks;
    window.airgapRateController = rxRateAdvisor;
  }
})();
