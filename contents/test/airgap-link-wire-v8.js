(function (root) {
  'use strict';

  var ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Uint8Array または ArrayBuffer が必要です');
  }

  function encodeBase45(value) {
    var data = asBytes(value);
    var output = '';
    for (var i = 0; i < data.length; i += 2) {
      if (i + 1 < data.length) {
        var number = data[i] * 256 + data[i + 1];
        var c1 = number % 45;
        var c2 = Math.floor(number / 45) % 45;
        var c3 = Math.floor(number / 2025);
        output += ALPHABET[c1] + ALPHABET[c2] + ALPHABET[c3];
      } else {
        var last = data[i];
        output += ALPHABET[last % 45] + ALPHABET[Math.floor(last / 45)];
      }
    }
    return output;
  }

  function decodeBase45(text) {
    if (typeof text !== 'string') throw new TypeError('Base45文字列が必要です');
    if (text.length % 3 === 1) throw new Error('Base45の文字数が不正です');
    var outputLength = Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0);
    var output = new Uint8Array(outputLength);
    var source = 0;
    var target = 0;
    while (source + 2 < text.length) {
      var a = ALPHABET.indexOf(text[source]);
      var b = ALPHABET.indexOf(text[source + 1]);
      var c = ALPHABET.indexOf(text[source + 2]);
      if (a < 0 || b < 0 || c < 0) throw new Error('Base45に未対応文字があります');
      var number = a + b * 45 + c * 2025;
      if (number > 65535) throw new Error('Base45の3文字値が範囲外です');
      output[target++] = number >>> 8;
      output[target++] = number & 0xff;
      source += 3;
    }
    if (source < text.length) {
      var first = ALPHABET.indexOf(text[source]);
      var second = ALPHABET.indexOf(text[source + 1]);
      if (first < 0 || second < 0) throw new Error('Base45に未対応文字があります');
      var last = first + second * 45;
      if (last > 255) throw new Error('Base45の2文字値が範囲外です');
      output[target] = last;
    }
    return output;
  }

  // Split only the four structural separators. The Base45 payload itself may contain ':'.
  // Do not trim ordinary spaces: space is part of the Base45 alphabet.
  function splitFrame(text) {
    if (typeof text !== 'string') throw new TypeError('フレームが文字列ではありません');
    var value = text.replace(/^[\\r\\n]+|[\\r\\n]+$/g, '');
    var parts = [];
    var start = 0;
    for (var i = 0; i < 4; i++) {
      var separator = value.indexOf(':', start);
      if (separator < 0) throw new Error('フレームヘッダーが途中で切れています');
      parts.push(value.slice(start, separator));
      start = separator + 1;
    }
    parts.push(value.slice(start));
    if (parts.length !== 5) throw new Error('フレームのフィールド数が不正です');
    if (parts[0] !== 'CMAL1' && parts[0] !== 'CMAL2') {
      throw new Error('未対応のAirgap Link形式です');
    }
    return {
      magic: parts[0],
      wireFormat: parts[0] === 'CMAL2' ? 'base45' : 'base64url',
      token: parts[1],
      id: parts[2],
      crc: parts[3],
      payload: parts[4]
    };
  }

  function isAirgapFrame(text) {
    return typeof text === 'string' &&
      (text.indexOf('CMAL1:') === 0 || text.indexOf('CMAL2:') === 0);
  }

  function isFountainFrame(text) {
    return typeof text === 'string' &&
      (text.indexOf('CMAL1:F') === 0 || text.indexOf('CMAL2:F') === 0);
  }

  root.AirgapLinkWire = {
    ALPHABET: ALPHABET,
    encodeBase45: encodeBase45,
    decodeBase45: decodeBase45,
    splitFrame: splitFrame,
    isAirgapFrame: isAirgapFrame,
    isFountainFrame: isFountainFrame
  };
})(typeof window !== 'undefined' ? window : globalThis);
