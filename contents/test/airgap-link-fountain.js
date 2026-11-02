(function (root) {
  'use strict';

  var Core = root.AirgapLinkCore;
  var MAGIC = 'CMAL1';
  var VERSION = 1;
  var MAX_MESSAGE_BYTES = 8000000;
  var MAX_FRAGMENT_COUNT = 100000;
  var U64_MASK = (1n << 64n) - 1n;
  var U64_RANGE = 18446744073709551616;

  function bytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Uint8Array または ArrayBuffer が必要です');
  }

  function readU32(data, offset) {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
  }

  function writeU32(data, offset, value) {
    new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value >>> 0, false);
  }

  function rotl64(value, shift) {
    var s = BigInt(shift);
    return ((value << s) | (value >> (64n - s))) & U64_MASK;
  }

  function Xoshiro256(state) {
    this.state = state;
  }

  Xoshiro256.fromSeed = async function (seed) {
    if (!root.crypto || !root.crypto.subtle) throw new Error('Web Crypto SHA-256 が必要です（HTTPS または localhost）');
    var digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes(seed)));
    var state = [];
    for (var i = 0; i < 4; i++) {
      var word = 0n;
      for (var j = 0; j < 8; j++) word = (word << 8n) | BigInt(digest[i * 8 + j]);
      state.push(word);
    }
    return new Xoshiro256(state);
  };

  Xoshiro256.prototype.next = function () {
    var s = this.state;
    var result = rotl64((s[1] * 5n) & U64_MASK, 7) * 9n & U64_MASK;
    var t = (s[1] << 17n) & U64_MASK;
    s[2] = (s[2] ^ s[0]) & U64_MASK;
    s[3] = (s[3] ^ s[1]) & U64_MASK;
    s[1] = (s[1] ^ s[2]) & U64_MASK;
    s[0] = (s[0] ^ s[3]) & U64_MASK;
    s[2] = (s[2] ^ t) & U64_MASK;
    s[3] = rotl64(s[3], 45);
    return result;
  };

  Xoshiro256.prototype.nextDouble = function () {
    return Number(this.next()) / U64_RANGE;
  };

  Xoshiro256.prototype.nextInt = function (count) {
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('乱数範囲が不正です');
    return Math.floor(this.nextDouble() * count);
  };

  Xoshiro256.prototype.nextByte = function () {
    return this.nextInt(256);
  };

  Xoshiro256.prototype.nextData = function (count) {
    var out = new Uint8Array(count);
    for (var i = 0; i < count; i++) out[i] = this.nextByte();
    return out;
  };

  function RandomSampler(probabilities) {
    var n = probabilities.length;
    var sum = probabilities.reduce(function (total, value) { return total + value; }, 0);
    if (!n || !(sum > 0)) throw new Error('乱数分布が空です');
    var scaled = probabilities.map(function (value) { return value * (n / sum); });
    var small = [];
    var large = [];
    for (var i = n - 1; i >= 0; i--) {
      if (scaled[i] < 1) small.push(i);
      else large.push(i);
    }
    this.probabilities = new Array(n).fill(0);
    this.aliases = new Array(n).fill(0);
    while (small.length && large.length) {
      var a = small.pop();
      var g = large.pop();
      this.probabilities[a] = scaled[a];
      this.aliases[a] = g;
      scaled[g] += scaled[a] - 1;
      if (scaled[g] < 1) small.push(g);
      else large.push(g);
    }
    while (large.length) this.probabilities[large.pop()] = 1;
    while (small.length) this.probabilities[small.pop()] = 1;
  }

  RandomSampler.prototype.next = function (rng) {
    var r1 = rng.nextDouble();
    var r2 = rng.nextDouble();
    var index = Math.floor(this.probabilities.length * r1);
    return r2 < this.probabilities[index] ? index : this.aliases[index];
  };

  function FragmentChooser(seqLen, checksum) {
    if (!Number.isSafeInteger(seqLen) || seqLen < 1 || seqLen > MAX_FRAGMENT_COUNT) throw new RangeError('元データ片数が上限外です');
    this.seqLen = seqLen;
    this.checksum = checksum >>> 0;
    this.sampler = new RandomSampler(Array.from({ length: seqLen }, function (_, index) { return 1 / (index + 1); }));
  }

  FragmentChooser.prototype.choose = async function (seqNum) {
    if (!Number.isSafeInteger(seqNum) || seqNum < 1 || seqNum > 0xffffffff) throw new RangeError('シーケンス番号が上限外です');
    if (seqNum <= this.seqLen) return [seqNum - 1];

    var seed = new Uint8Array(8);
    writeU32(seed, 0, seqNum);
    writeU32(seed, 4, this.checksum);
    var rng = await Xoshiro256.fromSeed(seed);
    var degree = this.sampler.next(rng) + 1;
    var remaining = Array.from({ length: this.seqLen }, function (_, index) { return index; });
    var result = [];
    for (var i = 0; i < degree; i++) {
      var selected = rng.nextInt(remaining.length);
      result.push(remaining.splice(selected, 1)[0]);
    }
    result.sort(function (a, b) { return a - b; });
    return result;
  };

  function randomTransferId() {
    if (!root.crypto || !root.crypto.getRandomValues) throw new Error('安全な乱数生成が利用できません');
    var value = new Uint8Array(4);
    root.crypto.getRandomValues(value);
    return Array.from(value).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }

  function joinFragments(fragments, messageLen) {
    var output = new Uint8Array(messageLen);
    var offset = 0;
    for (var i = 0; i < fragments.length && offset < messageLen; i++) {
      var take = Math.min(fragments[i].length, messageLen - offset);
      output.set(fragments[i].subarray(0, take), offset);
      offset += take;
    }
    if (offset !== messageLen) throw new Error('復元ブロックの合計長が一致しません');
    return output;
  }

  function makeFrame(seqNum, seqLen, id, messageLen, checksum, fragment) {
    var payload = new Uint8Array(9 + fragment.length);
    payload[0] = VERSION;
    writeU32(payload, 1, messageLen);
    writeU32(payload, 5, checksum);
    payload.set(fragment, 9);
    return MAGIC + ':F' + seqNum + '/' + seqLen + ':' + id + ':' +
      Core.hex32(Core.crc32(payload)) + ':' + Core.bytesToBase64Url(payload);
  }

  function parseFrame(text) {
    if (typeof text !== 'string') throw new Error('フレームが文字列ではありません');
    var fields = text.trim().split(':');
    if (fields.length !== 5 || fields[0] !== MAGIC) throw new Error('CMAL1 Fountainフレームではありません');
    var match = /^F([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(fields[1]);
    if (!match) throw new Error('Fountainシーケンス番号が不正です');
    var seqNum = Number(match[1]);
    var seqLen = Number(match[2]);
    if (!Number.isSafeInteger(seqNum) || seqNum > 0xffffffff) throw new Error('シーケンス番号が上限外です');
    if (!Number.isSafeInteger(seqLen) || seqLen > MAX_FRAGMENT_COUNT) throw new Error('元データ片数が上限外です');
    var id = fields[2];
    if (!/^[0-9A-F]{8}$/i.test(id)) throw new Error('転送IDが不正です');
    if (!/^[0-9A-F]{8}$/i.test(fields[3])) throw new Error('フレームCRC32が不正です');
    var payload = Core.base64UrlToBytes(fields[4]);
    if (Core.hex32(Core.crc32(payload)) !== fields[3].toUpperCase()) throw new Error('フレームCRC32不一致');
    if (payload.length < 10 || payload[0] !== VERSION) throw new Error('Fountainペイロード形式が不正です');
    var messageLen = readU32(payload, 1);
    var checksum = readU32(payload, 5);
    var fragment = payload.slice(9);
    if (messageLen > MAX_MESSAGE_BYTES) throw new Error('転送サイズが試験上限8 MBを超えています');
    if (fragment.length < 1 || fragment.length > 800) throw new Error('Fountain片の長さが不正です');
    var expectedCount = Math.max(1, Math.ceil(messageLen / fragment.length));
    if (expectedCount !== seqLen) throw new Error('メッセージ長と元データ片数が一致しません');
    return {
      seqNum: seqNum,
      seqLen: seqLen,
      id: id.toUpperCase(),
      messageLen: messageLen,
      checksum: checksum,
      fragmentLen: fragment.length,
      data: fragment
    };
  }

  function FountainEncoder(input, options) {
    var source = bytes(input).slice();
    options = options || {};
    if (source.length > MAX_MESSAGE_BYTES) throw new Error('試験ページの上限は8 MBです');
    var maxFragmentLen = Math.max(80, Math.min(800, Math.floor(Number(options.chunkSize) || 180)));
    var fragmentCount = Math.max(1, Math.ceil(source.length / maxFragmentLen));
    var fragmentLen = source.length ? Math.ceil(source.length / fragmentCount) : maxFragmentLen;
    this.messageLen = source.length;
    this.fragmentLen = fragmentLen;
    this.checksum = Core.crc32(source);
    this.id = options.id || randomTransferId();
    if (!/^[0-9A-F]{8}$/i.test(this.id)) throw new Error('転送IDが不正です');
    this.id = this.id.toUpperCase();
    this.fragments = [];
    if (!source.length) this.fragments.push(new Uint8Array(fragmentLen));
    else {
      for (var offset = 0; offset < source.length; offset += fragmentLen) {
        var piece = new Uint8Array(fragmentLen);
        piece.set(source.subarray(offset, Math.min(offset + fragmentLen, source.length)));
        this.fragments.push(piece);
      }
    }
    this.seqLen = this.fragments.length;
    if (this.seqLen > MAX_FRAGMENT_COUNT) throw new Error('元データ片数が上限を超えています');
    this.seqNum = 0;
    this.chooser = new FragmentChooser(this.seqLen, this.checksum);
  }

  FountainEncoder.prototype.seekToBlock = function (blockIndex) {
    if (!Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= this.seqLen) {
      throw new RangeError('指定ブロック番号が範囲外です');
    }
    // The next call to nextPart() emits this source block as systematic seq=blockIndex+1.
    this.seqNum = blockIndex;
    return this.seqNum + 1;
  };

  FountainEncoder.prototype.nextPart = async function () {
    if (this.seqNum >= 0xffffffff) throw new Error('シーケンス番号が上限に達しました');
    this.seqNum++;
    var indexes = await this.chooser.choose(this.seqNum);
    var mixed = new Uint8Array(this.fragmentLen);
    for (var i = 0; i < indexes.length; i++) {
      var shard = this.fragments[indexes[i]];
      for (var j = 0; j < mixed.length; j++) mixed[j] ^= shard[j];
    }
    var frame = makeFrame(this.seqNum, this.seqLen, this.id, this.messageLen, this.checksum, mixed);
    return {
      frame: frame,
      seqNum: this.seqNum,
      seqLen: this.seqLen,
      indexes: indexes,
      data: mixed,
      direct: this.seqNum <= this.seqLen,
      id: this.id
    };
  };

  function subset(a, b) {
    if (b.length >= a.length) return false;
    var set = new Set(a);
    for (var i = 0; i < b.length; i++) if (!set.has(b[i])) return false;
    return true;
  }

  function reducePart(a, b) {
    if (!subset(a.indexes, b.indexes)) return a;
    var reduced = new Uint8Array(a.data.length);
    for (var i = 0; i < reduced.length; i++) reduced[i] = a.data[i] ^ b.data[i];
    var remove = new Set(b.indexes);
    return {
      indexes: a.indexes.filter(function (index) { return !remove.has(index); }),
      data: reduced,
      direct: false
    };
  }

  function partKey(indexes) {
    return indexes.join(',');
  }

  function FountainReceiver() {
    this.reset();
  }

  FountainReceiver.prototype.reset = function () {
    this.id = null;
    this.seqLen = 0;
    this.messageLen = 0;
    this.checksum = 0;
    this.fragmentLen = 0;
    this.chooser = null;
    this.simpleParts = new Map();
    this.mixedParts = new Map();
    this.queue = [];
    this.seenEquations = new Set();
    this.directIndexes = new Set();
    this.recoveredIndexes = new Set();
    this.lastIndexes = [];
    this.receivedPartCount = 0;
    this.error = '';
    this.result = null;
  };

  FountainReceiver.prototype._key = function (indexes) {
    return indexes.join(',');
  };

  FountainReceiver.prototype._finishIfComplete = function () {
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

  FountainReceiver.prototype._processQueue = function () {
    var iterations = 0;
    while (this.queue.length) {
      if (++iterations > MAX_FRAGMENT_COUNT * 4) throw new Error('Fountainデコーダーの処理上限を超えました');
      var item = this.queue.pop();
      var index = item.index;
      var knownData = item.data;
      var affected = [];
      this.mixedParts.forEach(function (equation, key) {
        if (equation.indexes.indexOf(index) !== -1) affected.push(key);
      });
      affected.sort(function (leftKey, rightKey) {
        var left = this.mixedParts.get(leftKey);
        var right = this.mixedParts.get(rightKey);
        var a = left ? left.indexes : [];
        var b = right ? right.indexes : [];
        for (var i = 0; i < Math.min(a.length, b.length); i++) {
          if (a[i] !== b[i]) return a[i] - b[i];
        }
        return a.length - b.length;
      }.bind(this));

      for (var i = 0; i < affected.length; i++) {
        var key = affected[i];
        var equation = this.mixedParts.get(key);
        if (!equation) continue;
        this.mixedParts.delete(key);
        var remaining = equation.indexes.slice();
        var removeIndex = remaining.indexOf(index);
        if (removeIndex === -1) continue;
        remaining.splice(removeIndex, 1);

        var reduced = equation.data.slice();
        for (var pos = 0; pos < reduced.length; pos++) reduced[pos] ^= knownData[pos];

        if (remaining.length === 1) {
          var newIndex = remaining[0];
          if (this.simpleParts.has(newIndex)) {
            var knownBlock = this.simpleParts.get(newIndex);
            for (var check = 0; check < reduced.length; check++) {
              if (knownBlock[check] !== reduced[check]) {
                throw new Error('異なるファウンテン式から矛盾するブロック値を検出しました');
              }
            }
          } else {
            this.simpleParts.set(newIndex, reduced);
            this.recoveredIndexes.add(newIndex);
            this.queue.push({ index: newIndex, data: reduced });
          }
        } else if (remaining.length > 1) {
          var reducedKey = this._key(remaining);
          if (!this.mixedParts.has(reducedKey)) {
            this.mixedParts.set(reducedKey, { indexes: remaining, data: reduced });
          }
        }
      }
    }
    this._finishIfComplete();
  };

  FountainReceiver.prototype._processSimple = function (index, data, direct) {
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

  FountainReceiver.prototype._processComplex = function (indexes, data) {
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
      for (var p = 0; p < mixed.length; p++) mixed[p] ^= known[p];
    }

    if (remaining.length === 1) {
      this._processSimple(remaining[0], mixed, false);
    } else if (remaining.length > 1) {
      var key = this._key(remaining);
      if (!this.mixedParts.has(key)) {
        this.mixedParts.set(key, { indexes: remaining, data: mixed });
      }
    }
  };

  FountainReceiver.prototype._validate = function (packet) {
    if (this.id === null) {
      this.id = packet.id;
      this.seqLen = packet.seqLen;
      this.messageLen = packet.messageLen;
      this.checksum = packet.checksum;
      this.fragmentLen = packet.fragmentLen;
      this.chooser = new FragmentChooser(packet.seqLen, packet.checksum);
      return;
    }
    if (this.id !== packet.id) throw new Error('別の転送IDです。受信をリセットしてください');
    if (this.seqLen !== packet.seqLen || this.messageLen !== packet.messageLen ||
        this.checksum !== packet.checksum || this.fragmentLen !== packet.fragmentLen) {
      throw new Error('同一転送内でメタデータが一致しません');
    }
  };

  FountainReceiver.prototype.feed = async function (text) {
    var packet = parseFrame(text);
    this._validate(packet);
    if (this.result) return { duplicate: true, complete: true, bytes: this.result };

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

  FountainReceiver.prototype.isComplete = function () {
    return !!this.result;
  };

  FountainReceiver.prototype.bytes = function () {
    if (!this.result) throw new Error('まだすべてのブロックを復元できていません');
    return this.result.slice();
  };

  async function selfTest() {
    var testRng = await Xoshiro256.fromSeed(new TextEncoder().encode('Wolf'));
    var message = testRng.nextData(1024);
    var chooser = new FragmentChooser(11, Core.crc32(message));
    var seq12 = await chooser.choose(12);
    var seq13 = await chooser.choose(13);
    if (seq12.join(',') !== '9') throw new Error('MUR公式ベクトル seqNum=12 が一致しません: ' + seq12.join(','));
    if (seq13.join(',') !== '2,5,6,8,9,10') throw new Error('MUR公式ベクトル seqNum=13 が一致しません: ' + seq13.join(','));

    var encoder = new FountainEncoder(message, { chunkSize: 94, id: 'A1B2C3D4' });
    if (encoder.seqLen !== 11) throw new Error('フラグメント数テストに失敗しました');
    var seekEncoder = new FountainEncoder(message, { chunkSize: 94, id: 'A1B2C3D4' });
    if (seekEncoder.seekToBlock(7) !== 8) throw new Error('ブロック位置からのシーケンス計算に失敗しました');
    var seekPart = await seekEncoder.nextPart();
    if (seekPart.seqNum !== 8 || !seekPart.direct || seekPart.indexes.join(',') !== '7') {
      throw new Error('指定ブロックからのsystematic Data再生に失敗しました');
    }
    var invalidSeekRejected = false;
    try { seekEncoder.seekToBlock(seekEncoder.seqLen); } catch (_) { invalidSeekRejected = true; }
    if (!invalidSeekRejected) throw new Error('範囲外ブロックへのseekを拒否できませんでした');
    var receiver = new FountainReceiver();
    var direct = [];
    for (var i = 0; i < encoder.seqLen; i++) {
      var part = await encoder.nextPart();
      if (i !== 2 && i !== 8) direct.push(part.frame);
    }
    for (var d = direct.length - 1; d >= 0; d--) await receiver.feed(direct[d]);

    var fountainFrames = [];
    for (var f = 0; f < 240; f++) fountainFrames.push((await encoder.nextPart()).frame);
    for (var x = fountainFrames.length - 1; x >= 0 && !receiver.isComplete(); x--) {
      await receiver.feed(fountainFrames[x]);
    }
    if (!receiver.isComplete()) throw new Error('2片欠落後のLT復元が完了しませんでした');
    var restored = receiver.bytes();
    if (restored.length !== message.length) throw new Error('復元サイズが一致しません');
    for (var y = 0; y < message.length; y++) if (restored[y] !== message[y]) throw new Error('復元内容が一致しません');

    var duplicate = await receiver.feed(fountainFrames[fountainFrames.length - 1]);
    if (!duplicate.duplicate && !duplicate.complete) throw new Error('重複フレームの処理テストに失敗しました');

    var corrupt = fountainFrames[0].split(':');
    corrupt[3] = '00000000';
    var crcRejected = false;
    try { parseFrame(corrupt.join(':')); } catch (_) { crcRejected = true; }
    if (!crcRejected) throw new Error('フレームCRC32の改ざん検出に失敗しました');

    var other = new FountainEncoder(message, { chunkSize: 94, id: '01020304' });
    var mismatchRejected = false;
    try { await receiver.feed((await other.nextPart()).frame); } catch (_) { mismatchRejected = true; }
    if (!mismatchRejected) throw new Error('転送ID混在の拒否テストに失敗しました');

    return {
      officialChooserVectors: 'PASS',
      sequence12: seq12.join(','),
      sequence13: seq13.join(','),
      decodedBlocks: receiver.simpleParts.size,
      receivedParts: receiver.receivedPartCount,
      recoveredBlocks: receiver.recoveredIndexes.size,
      outOfOrder: true,
      duplicate: true,
      crcTamperRejected: true,
      mixedTransferRejected: true,
      randomAccessSeek: true
    };
  }

  root.AirgapLinkFountain = {
    VERSION: VERSION,
    Encoder: FountainEncoder,
    Receiver: FountainReceiver,
    FragmentChooser: FragmentChooser,
    parseFrame: parseFrame,
    selfTest: selfTest
  };
})(typeof window !== 'undefined' ? window : globalThis);
