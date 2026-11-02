(function (root) {
  'use strict';

  var MAGIC = 'CMAL1';
  var GROUP_SIZE = 8;
  var GF_POLY = 0x11d;
  var crcTable = new Uint32Array(256);

  for (var c = 0; c < 256; c++) {
    var value = c;
    for (var bit = 0; bit < 8; bit++) {
      value = (value & 1) ? ((value >>> 1) ^ 0xedb88320) : (value >>> 1);
    }
    crcTable[c] = value >>> 0;
  }

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Uint8Array または ArrayBuffer が必要です');
  }

  function crc32(bytes) {
    bytes = asBytes(bytes);
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function hex32(value) {
    return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function bytesToBase64Url(bytes) {
    bytes = asBytes(bytes);
    var binary = '';
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Base64URL形式が不正です');
    var base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    var binary = atob(base64);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function randomTransferId() {
    var bytes = new Uint8Array(4);
    if (!root.crypto || !root.crypto.getRandomValues) throw new Error('安全な乱数生成が利用できません');
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }

  function makeFrame(token, total, id, payload) {
    var checksum = hex32(crc32(payload));
    return MAGIC + ':' + token + '/' + total + ':' + id + ':' + checksum + ':' + bytesToBase64Url(payload);
  }

  function gfMul(a, b) {
    var result = 0;
    while (b) {
      if (b & 1) result ^= a;
      var high = a & 0x80;
      a = (a << 1) & 0xff;
      if (high) a ^= 0x1d;
      b >>>= 1;
    }
    return result;
  }

  function gfPow(a, n) {
    var result = 1;
    while (n > 0) {
      if (n & 1) result = gfMul(result, a);
      a = gfMul(a, a);
      n >>>= 1;
    }
    return result;
  }

  function gfDiv(a, b) {
    if (!b) throw new Error('GF(256) のゼロ除算です');
    return a ? gfMul(a, gfPow(b, 254)) : 0;
  }

  function parityPayload(chunks, parityType) {
    var count = chunks.length;
    var maxLength = chunks.reduce(function (m, chunk) { return Math.max(m, chunk.length); }, 0);
    var headerLength = 2 + count * 2;
    var out = new Uint8Array(headerLength + maxLength);
    out[0] = 1;
    out[1] = count;
    var offset = 2;
    for (var i = 0; i < count; i++) {
      out[offset++] = (chunks[i].length >>> 8) & 0xff;
      out[offset++] = chunks[i].length & 0xff;
    }
    for (var pos = 0; pos < maxLength; pos++) {
      var acc = 0;
      for (var j = 0; j < count; j++) {
        var byte = pos < chunks[j].length ? chunks[j][pos] : 0;
        acc ^= parityType === 0 ? byte : gfMul(gfPow(2, j), byte);
      }
      out[headerLength + pos] = acc;
    }
    return out;
  }

  function buildFrames(input, options) {
    var bytes = asBytes(input).slice();
    options = options || {};
    var chunkSize = Math.max(80, Math.min(800, Math.floor(Number(options.chunkSize) || 180)));
    var parity = options.parity !== false;
    var total = Math.max(1, Math.ceil(bytes.length / chunkSize));
    if (total > 100000) throw new Error('フレーム数が上限を超えています');
    var id = options.id || randomTransferId();
    if (!/^[0-9A-F]{8}$/i.test(id)) throw new Error('転送IDが不正です');
    id = id.toUpperCase();
    var chunks = [];
    for (var i = 0; i < total; i++) {
      var start = i * chunkSize;
      chunks.push(bytes.slice(start, Math.min(start + chunkSize, bytes.length)));
    }

    var dataFrames = chunks.map(function (chunk, index) {
      return makeFrame(String(index + 1), total, id, chunk);
    });
    var frames = [];
    for (var groupStart = 0; groupStart < total; groupStart += GROUP_SIZE) {
      var group = chunks.slice(groupStart, Math.min(groupStart + GROUP_SIZE, total));
      for (var j = 0; j < group.length; j++) frames.push(dataFrames[groupStart + j]);
      if (parity && group.length >= 2) {
        var groupNumber = Math.floor(groupStart / GROUP_SIZE);
        frames.push(makeFrame('P0-' + groupNumber, total, id, parityPayload(group, 0)));
        frames.push(makeFrame('P1-' + groupNumber, total, id, parityPayload(group, 1)));
      }
    }
    return {
      id: id,
      total: total,
      chunkSize: chunkSize,
      payloadBytes: bytes.length,
      dataFrames: dataFrames,
      frames: frames,
      parityFrames: frames.length - dataFrames.length,
      groupSize: GROUP_SIZE
    };
  }

  function parseFrame(text) {
    if (typeof text !== 'string') throw new Error('フレームが文字列ではありません');
    var parts = text.trim().split(':');
    if (parts.length !== 5 || parts[0] !== MAGIC) throw new Error('CMAL1フレームではありません');
    var token = parts[1];
    var total = Number(parts[1].slice(parts[1].lastIndexOf('/') + 1));
    if (!Number.isSafeInteger(total) || total < 1 || total > 100000) throw new Error('総フレーム数が不正です');
    var id = parts[2];
    if (!/^[0-9A-F]{8}$/i.test(id)) throw new Error('転送IDが不正です');
    var crcText = parts[3];
    if (!/^[0-9A-F]{8}$/i.test(crcText)) throw new Error('CRC32ヘッダーが不正です');
    var payload = base64UrlToBytes(parts[4]);
    if (hex32(crc32(payload)) !== crcText.toUpperCase()) throw new Error('CRC32不一致：フレームが破損しています');

    var dataMatch = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(token);
    if (dataMatch) {
      var index = Number(dataMatch[1]);
      if (Number(dataMatch[2]) !== total || index > total) throw new Error('データフレーム番号が不正です');
      return { type: 'data', index: index - 1, total: total, id: id.toUpperCase(), payload: payload };
    }
    var parityMatch = /^P([01])-([0-9]+)\/([1-9][0-9]*)$/.exec(token);
    if (parityMatch) {
      var parityGroup = Number(parityMatch[2]);
      if (Number(parityMatch[3]) !== total || parityGroup * GROUP_SIZE >= total) throw new Error('パリティフレーム番号が不正です');
      return { type: 'parity', parityType: Number(parityMatch[1]), group: parityGroup, total: total, id: id.toUpperCase(), payload: payload };
    }
    throw new Error('フレーム番号形式が不正です');
  }

  function decodeParityPayload(payload, expectedCount) {
    if (payload.length < 2 || payload[0] !== 1) throw new Error('未対応のパリティ形式です');
    var count = payload[1];
    if (count !== expectedCount || count < 2 || count > GROUP_SIZE) throw new Error('パリティグループ数が一致しません');
    var headerLength = 2 + count * 2;
    if (payload.length < headerLength) throw new Error('パリティヘッダーが途中で切れています');
    var lengths = [];
    var maxLength = 0;
    for (var i = 0; i < count; i++) {
      var len = (payload[2 + i * 2] << 8) | payload[3 + i * 2];
      lengths.push(len);
      maxLength = Math.max(maxLength, len);
    }
    if (payload.length !== headerLength + maxLength) throw new Error('パリティデータ長が一致しません');
    return { lengths: lengths, bytes: payload.subarray(headerLength), maxLength: maxLength };
  }

  function xorInto(target, source) {
    for (var i = 0; i < source.length; i++) target[i] ^= source[i];
  }

  function Receiver() {
    this.reset();
  }

  Receiver.prototype.reset = function () {
    this.id = null;
    this.total = 0;
    this.shards = new Map();
    this.parities = new Map();
    this.recoveredCount = 0;
    this.receivedCount = 0;
    this.lastError = '';
  };

  Receiver.prototype._recoverGroup = function (groupNumber) {
    var start = groupNumber * GROUP_SIZE;
    var count = Math.min(GROUP_SIZE, this.total - start);
    if (count < 2) return 0;
    var paritySet = this.parities.get(groupNumber);
    if (!paritySet) return 0;
    var p0 = paritySet[0] ? decodeParityPayload(paritySet[0], count) : null;
    var p1 = paritySet[1] ? decodeParityPayload(paritySet[1], count) : null;
    if (p0 && p1 && (p0.maxLength !== p1.maxLength || p0.lengths.some(function (len, i) { return len !== p1.lengths[i]; }))) {
      throw new Error('パリティ間のデータ長が一致しません');
    }
    var meta = p0 || p1;
    if (!meta) return 0;
    var missing = [];
    for (var i = 0; i < count; i++) {
      if (!this.shards.has(start + i)) missing.push(i);
    }
    if (!missing.length || missing.length > 2) return 0;
    if (missing.length === 2 && !(p0 && p1)) return 0;
    if (missing.length === 1 && !p0 && !p1) return 0;

    var maxLength = meta.maxLength;
    var recovered = [];
    var knownXor = new Uint8Array(maxLength);
    var knownWeighted = new Uint8Array(maxLength);

    for (var local = 0; local < count; local++) {
      if (missing.indexOf(local) !== -1) continue;
      var known = this.shards.get(start + local);
      var coefficient = gfPow(2, local);
      for (var pos = 0; pos < known.length; pos++) {
        knownXor[pos] ^= known[pos];
        knownWeighted[pos] ^= gfMul(coefficient, known[pos]);
      }
    }

    if (missing.length === 1) {
      var m = missing[0];
      var restored = new Uint8Array(maxLength);
      if (p0) {
        for (var x = 0; x < maxLength; x++) restored[x] = p0.bytes[x] ^ knownXor[x];
      } else {
        var coeff = gfPow(2, m);
        for (var y = 0; y < maxLength; y++) restored[y] = gfDiv(p1.bytes[y] ^ knownWeighted[y], coeff);
      }
      recovered.push({ index: start + m, bytes: restored.slice(0, meta.lengths[m]) });
    } else {
      var a = missing[0];
      var b = missing[1];
      var ca = gfPow(2, a);
      var cb = gfPow(2, b);
      var xBytes = new Uint8Array(maxLength);
      var yBytes = new Uint8Array(maxLength);
      for (var z = 0; z < maxLength; z++) {
        var r0 = p0.bytes[z] ^ knownXor[z];
        var r1 = p1.bytes[z] ^ knownWeighted[z];
        var xValue = gfDiv(r1 ^ gfMul(cb, r0), ca ^ cb);
        xBytes[z] = xValue;
        yBytes[z] = r0 ^ xValue;
      }
      recovered.push({ index: start + a, bytes: xBytes.slice(0, meta.lengths[a]) });
      recovered.push({ index: start + b, bytes: yBytes.slice(0, meta.lengths[b]) });
    }

    for (var r = 0; r < recovered.length; r++) {
      this.shards.set(recovered[r].index, recovered[r].bytes);
      this.recoveredCount++;
    }
    return recovered.length;
  };

  Receiver.prototype._recoverAll = function () {
    var self = this;
    var recovered = 0;
    this.parities.forEach(function (_value, group) {
      recovered += self._recoverGroup(group);
    });
    return recovered;
  };

  Receiver.prototype.feed = function (text) {
    var packet = parseFrame(text);
    if (this.id === null) {
      this.id = packet.id;
      this.total = packet.total;
    } else if (this.id !== packet.id || this.total !== packet.total) {
      throw new Error('別の転送IDのフレームです。受信をリセットしてください');
    }

    if (packet.type === 'data') {
      if (this.shards.has(packet.index)) return { duplicate: true, recovered: this.recoveredCount, progress: this.shards.size / this.total, complete: this.isComplete() };
      this.shards.set(packet.index, packet.payload);
      this.receivedCount++;
    } else {
      var group = this.parities.get(packet.group);
      if (!group) { group = {}; this.parities.set(packet.group, group); }
      if (group[packet.parityType]) return { duplicate: true, recovered: this.recoveredCount, progress: this.shards.size / this.total, complete: this.isComplete() };
      group[packet.parityType] = packet.payload;
      this._recoverGroup(packet.group);
    }
    this._recoverAll();
    var complete = this.isComplete();
    return {
      duplicate: false,
      recovered: this.recoveredCount,
      received: this.receivedCount,
      have: this.shards.size,
      total: this.total,
      progress: this.shards.size / this.total,
      complete: complete,
      bytes: complete ? this.bytes() : null
    };
  };

  Receiver.prototype.isComplete = function () {
    return this.total > 0 && this.shards.size === this.total;
  };

  Receiver.prototype.bytes = function () {
    if (!this.isComplete()) throw new Error('まだ全データが揃っていません');
    var length = 0;
    for (var i = 0; i < this.total; i++) length += this.shards.get(i).length;
    var output = new Uint8Array(length);
    var offset = 0;
    for (var j = 0; j < this.total; j++) {
      var shard = this.shards.get(j);
      output.set(shard, offset);
      offset += shard.length;
    }
    return output;
  };

  function concatBytes(parts) {
    var total = parts.reduce(function (sum, part) { return sum + part.length; }, 0);
    var output = new Uint8Array(total);
    var offset = 0;
    parts.forEach(function (part) { output.set(part, offset); offset += part.length; });
    return output;
  }

  async function compressIfSmaller(bytes) {
    bytes = asBytes(bytes);
    if (typeof root.CompressionStream !== 'function') return { bytes: bytes.slice(), compressed: false, reason: 'CompressionStream非対応' };
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new root.CompressionStream('deflate'));
      var compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      var header = new Uint8Array(8);
      header.set([0x43, 0x4d, 0x5a, 0x31], 0); // CMZ1
      new DataView(header.buffer).setUint32(4, bytes.length, false);
      var wrapped = concatBytes([header, compressed]);
      if (wrapped.length >= bytes.length) return { bytes: bytes.slice(), compressed: false, reason: '圧縮しても小さくならないため省略' };
      return { bytes: wrapped, compressed: true, originalBytes: bytes.length, packedBytes: wrapped.length, reason: 'Deflate適用' };
    } catch (error) {
      return { bytes: bytes.slice(), compressed: false, reason: '圧縮できないため省略: ' + error.message };
    }
  }

  async function decompressIfWrapped(bytes) {
    bytes = asBytes(bytes);
    if (bytes.length < 8 || bytes[0] !== 0x43 || bytes[1] !== 0x4d || bytes[2] !== 0x5a || bytes[3] !== 0x31) {
      return { bytes: bytes.slice(), decompressed: false };
    }
    if (typeof root.DecompressionStream !== 'function') throw new Error('CMZ1圧縮データですが、このブラウザはDeflate復号に対応していません');
    var expected = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, false);
    var compressed = bytes.subarray(8);
    var stream = new Blob([compressed]).stream().pipeThrough(new root.DecompressionStream('deflate'));
    var result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (result.length !== expected) throw new Error('圧縮データの展開後サイズが一致しません');
    return { bytes: result, decompressed: true };
  }

  function selfTest() {
    var check = new TextEncoder().encode('123456789');
    if (hex32(crc32(check)) !== 'CBF43926') throw new Error('CRC32既知テストに失敗しました');
    var source = new Uint8Array(1733);
    for (var i = 0; i < source.length; i++) source[i] = (i * 31 + 7) & 0xff;
    var built = buildFrames(source, { chunkSize: 180, parity: true, id: 'A1B2C3D4' });
    var receiver = new Receiver();
    var skipped = { 1: true, 4: true };
    var completion = null;
    for (var f = 0; f < built.frames.length; f++) {
      var parsed = parseFrame(built.frames[f]);
      if (parsed.type === 'data' && skipped[parsed.index]) continue;
      var result = receiver.feed(built.frames[f]);
      if (result.complete) completion = result.bytes;
    }
    if (!completion || completion.length !== source.length) throw new Error('パリティ復元テストに失敗しました');
    for (var j = 0; j < source.length; j++) if (completion[j] !== source[j]) throw new Error('復元データが元データと一致しません');
    var legacy = buildFrames(source.subarray(0, 100), { chunkSize: 180, parity: false, id: '11223344' });
    if (legacy.frames.length !== 1 || parseFrame(legacy.frames[0]).type !== 'data') throw new Error('CMAL1互換フレームテストに失敗しました');
    return {
      crc32: 'CBF43926',
      simulatedBytes: source.length,
      droppedFrames: 2,
      recoveredFrames: receiver.recoveredCount,
      packetFrames: built.frames.length,
      legacyFrames: legacy.frames.length
    };
  }

  root.AirgapLinkCore = {
    MAGIC: MAGIC,
    GROUP_SIZE: GROUP_SIZE,
    crc32: crc32,
    hex32: hex32,
    bytesToBase64Url: bytesToBase64Url,
    base64UrlToBytes: base64UrlToBytes,
    buildFrames: buildFrames,
    parseFrame: parseFrame,
    Receiver: Receiver,
    compressIfSmaller: compressIfSmaller,
    decompressIfWrapped: decompressIfWrapped,
    selfTest: selfTest
  };
})(typeof window !== 'undefined' ? window : globalThis);
