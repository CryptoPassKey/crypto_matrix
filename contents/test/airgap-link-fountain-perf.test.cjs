// airgap-link-fountain-perf.test.cjs
// Benchmark comparison between Baseline and Optimized Fountain Receiver
'use strict';

const nodeCrypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

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

const Fountain = globalThis.AirgapLinkFountain;
const Core = globalThis.AirgapLinkCore;
const BaselineReceiver = Fountain.Receiver;

// Fast 32-bit XOR
function fastXor(dst, src, len) {
  var words = len >>> 2;
  if ((dst.byteOffset & 3) === 0 && (src.byteOffset & 3) === 0) {
    var d32 = new Uint32Array(dst.buffer, dst.byteOffset, words);
    var s32 = new Uint32Array(src.buffer, src.byteOffset, words);
    for (var i = 0; i < words; i++) d32[i] ^= s32[i];
    for (var pos = words << 2; pos < len; pos++) dst[pos] ^= src[pos];
  } else {
    for (var pos = 0; pos < len; pos++) dst[pos] ^= src[pos];
  }
}

// Optimized Receiver Implementation
function OptimizedReceiver() {
  this.reset();
}

OptimizedReceiver.prototype.reset = function () {
  this.id = null;
  this.seqLen = 0;
  this.wireFormat = null;
  this.messageLen = 0;
  this.checksum = 0;
  this.fragmentLen = 0;
  this.chooser = null;
  this.simpleParts = new Map();
  this.mixedParts = new Map();
  this.indexToEquations = new Map(); // Inverted index: blockIndex -> Set of equationKeys
  this.queue = [];
  this.seenEquations = new Set();
  this.seenSeqNums = new Set();
  this.directIndexes = new Set();
  this.recoveredIndexes = new Set();
  this.lastIndexes = [];
  this.receivedPartCount = 0;
  this.error = '';
  this.result = null;
};

OptimizedReceiver.prototype._key = function (indexes) {
  return indexes.join(',');
};

OptimizedReceiver.prototype._addMixed = function (key, equation) {
  this.mixedParts.set(key, equation);
  for (var i = 0; i < equation.indexes.length; i++) {
    var idx = equation.indexes[i];
    var eqSet = this.indexToEquations.get(idx);
    if (!eqSet) {
      eqSet = new Set();
      this.indexToEquations.set(idx, eqSet);
    }
    eqSet.add(key);
  }
};

OptimizedReceiver.prototype._deleteMixed = function (key) {
  var equation = this.mixedParts.get(key);
  if (!equation) return null;
  this.mixedParts.delete(key);
  for (var i = 0; i < equation.indexes.length; i++) {
    var idx = equation.indexes[i];
    var eqSet = this.indexToEquations.get(idx);
    if (eqSet) {
      eqSet.delete(key);
      if (eqSet.size === 0) this.indexToEquations.delete(idx);
    }
  }
  return equation;
};

OptimizedReceiver.prototype._finishIfComplete = function () {
  if (this.simpleParts.size !== this.seqLen) return false;
  var padded = new Uint8Array(this.seqLen * this.fragmentLen);
  for (var i = 0; i < this.seqLen; i++) {
    var block = this.simpleParts.get(i);
    if (!block || block.length !== this.fragmentLen) throw new Error('復元ブロックの長さが一致しません');
    padded.set(block, i * this.fragmentLen);
  }
  for (var p = this.messageLen; p < padded.length; p++) {
    if (padded[p] !== 0) throw new Error('最終ブロックのパディングが不正です');
  }
  var message = padded.slice(0, this.messageLen);
  if (Core.crc32(message) !== this.checksum) {
    this.error = '復元データ全体のCRC32が一致しません';
    throw new Error(this.error);
  }
  this.result = message;
  return true;
};

OptimizedReceiver.prototype._processQueue = function () {
  var iterations = 0;
  var MAX_FRAGMENT_COUNT = 100000;
  while (this.queue.length) {
    if (++iterations > MAX_FRAGMENT_COUNT * 4) throw new Error('Fountainデコーダーの処理上限を超えました');
    var item = this.queue.pop();
    var index = item.index;
    var knownData = item.data;

    var eqSet = this.indexToEquations.get(index);
    if (!eqSet || eqSet.size === 0) continue;
    var affectedKeys = Array.from(eqSet);

    for (var i = 0; i < affectedKeys.length; i++) {
      var key = affectedKeys[i];
      var equation = this._deleteMixed(key);
      if (!equation) continue;

      var remaining = equation.indexes;
      var removeIndex = remaining.indexOf(index);
      if (removeIndex === -1) continue;
      remaining.splice(removeIndex, 1);

      fastXor(equation.data, knownData, equation.data.length);

      if (remaining.length === 1) {
        var newIndex = remaining[0];
        if (this.simpleParts.has(newIndex)) {
          var knownBlock = this.simpleParts.get(newIndex);
          for (var check = 0; check < equation.data.length; check++) {
            if (knownBlock[check] !== equation.data[check]) {
              throw new Error('異なるファウンテン式から矛盾するブロック値を検出しました');
            }
          }
        } else {
          this.simpleParts.set(newIndex, equation.data);
          this.recoveredIndexes.add(newIndex);
          this.queue.push({ index: newIndex, data: equation.data });
        }
      } else if (remaining.length > 1) {
        var reducedKey = this._key(remaining);
        if (!this.mixedParts.has(reducedKey)) {
          this._addMixed(reducedKey, equation);
        }
      }
    }
  }
  this._finishIfComplete();
};

OptimizedReceiver.prototype._processSimple = function (index, data, direct) {
  if (this.simpleParts.has(index)) {
    var existing = this.simpleParts.get(index);
    for (var i = 0; i < data.length; i++) {
      if (existing[i] !== data[i]) throw new Error('同じ元ブロックから異なる復元値を検出しました');
    }
    if (direct) {
      this.directIndexes.add(index);
      this.recoveredIndexes.delete(index);
    }
    return;
  }
  this.simpleParts.set(index, data.slice());
  if (direct) this.directIndexes.add(index);
  else this.recoveredIndexes.add(index);
  this.queue.push({ index: index, data: data.slice() });
  this._processQueue();
};

OptimizedReceiver.prototype._processComplex = function (indexes, data) {
  var remaining = indexes.slice();
  var toRemove = remaining.filter(function (index) { return this.simpleParts.has(index); }, this);
  if (remaining.length === toRemove.length) return;

  var mixed = data.slice();
  for (var i = 0; i < toRemove.length; i++) {
    var remove = toRemove[i];
    var removeIndex = remaining.indexOf(remove);
    if (removeIndex === -1) continue;
    remaining.splice(removeIndex, 1);
    var known = this.simpleParts.get(remove);
    if (!known) throw new Error('既知ブロックが見つかりません');
    fastXor(mixed, known, mixed.length);
  }

  if (remaining.length === 1) {
    this._processSimple(remaining[0], mixed, false);
  } else if (remaining.length > 1) {
    var key = this._key(remaining);
    if (!this.mixedParts.has(key)) {
      this._addMixed(key, { indexes: remaining, data: mixed });
    }
  }
};

OptimizedReceiver.prototype._validate = BaselineReceiver.prototype._validate;
OptimizedReceiver.prototype.addKnownBlock = function (metadata, index, data, direct) {
  if (!metadata || typeof metadata !== 'object') throw new TypeError('Fountain転送メタデータが必要です');
  this._validate(metadata);
  if (!Number.isSafeInteger(index) || index < 0 || index >= this.seqLen) {
    throw new RangeError('既知ブロック番号が範囲外です');
  }
  var source = data instanceof Uint8Array ? data : new Uint8Array(data);
  var expectedLength = Math.max(0, Math.min(this.fragmentLen, this.messageLen - index * this.fragmentLen));
  if (source.length !== expectedLength) throw new Error('従来ブロックとLTブロックの境界が一致しません');
  var padded = new Uint8Array(this.fragmentLen);
  padded.set(source);
  var duplicate = this.simpleParts.has(index);
  this.lastIndexes = [index];
  this._processSimple(index, padded, direct === true);
  return {
    duplicate: duplicate,
    complete: !!this.result,
    bytes: this.result,
    decoded: this.simpleParts.size,
    total: this.seqLen,
    directCount: this.directIndexes.size,
    recoveredCount: this.recoveredIndexes.size,
    lastIndexes: this.lastIndexes
  };
};

OptimizedReceiver.prototype.feed = async function (text) {
  var packet = Fountain.parseFrame(text);
  this._validate(packet);
  if (this.result) return { duplicate: true, complete: true, bytes: this.result };

  // Early duplicate check for systematic frames
  if (packet.seqNum <= packet.seqLen && this.simpleParts.has(packet.seqNum - 1)) {
    this.lastIndexes = [packet.seqNum - 1];
    return {
      duplicate: true,
      complete: !!this.result,
      decoded: this.simpleParts.size,
      total: this.seqLen,
      receivedParts: this.receivedPartCount,
      lastIndexes: this.lastIndexes
    };
  }

  var indexes = await this.chooser.choose(packet.seqNum);
  this.lastIndexes = indexes.slice();
  var equationKey = this._key(indexes);
  if (this.seenEquations.has(equationKey)) {
    return {
      duplicate: true,
      complete: false,
      decoded: this.simpleParts.size,
      total: this.seqLen,
      receivedParts: this.receivedPartCount,
      lastIndexes: this.lastIndexes
    };
  }
  var maxUniqueEquations = Math.min(250000, Math.max(1024, this.seqLen * 8));
  if (this.seenEquations.size >= maxUniqueEquations) {
    throw new Error('受信式数の安全上限に達しました。転送をリセットしてください');
  }
  this.seenEquations.add(equationKey);
  this.receivedPartCount++;

  if (indexes.length === 1) {
    this._processSimple(indexes[0], packet.data, packet.seqNum <= packet.seqLen);
  } else {
    this._processComplex(indexes, packet.data);
  }

  return {
    duplicate: false,
    complete: !!this.result,
    bytes: this.result,
    decoded: this.simpleParts.size,
    total: this.seqLen,
    receivedParts: this.receivedPartCount,
    equationCount: this.seenEquations.size,
    directCount: this.directIndexes.size,
    recoveredCount: this.recoveredIndexes.size,
    lastIndexes: this.lastIndexes
  };
};

OptimizedReceiver.prototype.isComplete = function () {
  return !!this.result;
};

OptimizedReceiver.prototype.bytes = function () {
  if (!this.result) throw new Error('まだすべてのブロックを復元できていません');
  return this.result.slice();
};

function generateData(size) {
  const buf = new Uint8Array(size);
  let seed = 0x12345678;
  for (let i = 0; i < size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

const scenarios = [
  { name: '10 KB (chunk 180B)', size: 10 * 1024, chunkSize: 180 },
  { name: '50 KB (chunk 180B)', size: 50 * 1024, chunkSize: 180 },
  { name: '100 KB (chunk 180B)', size: 100 * 1024, chunkSize: 180 },
  { name: '200 KB (chunk 300B)', size: 200 * 1024, chunkSize: 300 },
  { name: '500 KB (chunk 500B)', size: 500 * 1024, chunkSize: 500 },
  { name: '100 KB (chunk 94B, high K)', size: 100 * 1024, chunkSize: 94 }
];

async function runBenchmark() {
  console.log('=== Performance Comparison: Baseline vs Optimized ===\n');

  for (const sc of scenarios) {
    const data = generateData(sc.size);
    const K = Math.max(1, Math.ceil(data.length / sc.chunkSize));

    console.log('Scenario: ' + sc.name + ' -> K=' + K + ' chunks');

    // Prepare packets (same packets for both)
    const enc = new Fountain.Encoder(data, { chunkSize: sc.chunkSize });
    const systematicParts = [];
    for (let i = 0; i < K; i++) {
      systematicParts.push(await enc.nextPart());
    }
    const dropped = new Set();
    const dropCount = Math.floor(K * 0.2);
    let step = Math.floor(K / dropCount);
    for (let d = 0; d < dropCount; d++) dropped.add(d * step);

    enc.startRepairPhase();
    const repairParts = [];
    for (let r = 0; r < Math.max(K * 3, 500); r++) {
      repairParts.push(await enc.nextPart());
    }

    // 1. Run Baseline
    let baselineTime = 0;
    let baselineRepairs = 0;
    {
      const rx = new BaselineReceiver();
      const t0 = performance.now();
      for (let i = 0; i < K; i++) {
        if (!dropped.has(i)) await rx.feed(systematicParts[i].frame);
      }
      for (let r = 0; r < repairParts.length && !rx.isComplete(); r++) {
        await rx.feed(repairParts[r].frame);
        baselineRepairs++;
      }
      baselineTime = performance.now() - t0;
      if (!rx.isComplete()) throw new Error('Baseline failed');
    }

    // 2. Run Optimized
    let optTime = 0;
    let optRepairs = 0;
    {
      const rx = new OptimizedReceiver();
      const t0 = performance.now();
      for (let i = 0; i < K; i++) {
        if (!dropped.has(i)) await rx.feed(systematicParts[i].frame);
      }
      for (let r = 0; r < repairParts.length && !rx.isComplete(); r++) {
        await rx.feed(repairParts[r].frame);
        optRepairs++;
      }
      optTime = performance.now() - t0;
      if (!rx.isComplete()) throw new Error('Optimized failed');
      const crcOk = Core.crc32(rx.bytes()) === Core.crc32(data);
      if (!crcOk) throw new Error('Optimized CRC mismatch');
    }

    const speedup = (baselineTime / optTime).toFixed(2);
    console.log('  Baseline:  ' + baselineTime.toFixed(2) + ' ms (repairs: ' + baselineRepairs + ')');
    console.log('  Optimized: ' + optTime.toFixed(2) + ' ms (repairs: ' + optRepairs + ')');
    console.log('  -> Speedup: ' + speedup + 'x faster!\n');
  }
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
