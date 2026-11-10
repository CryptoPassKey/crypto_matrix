'use strict';

/*
 * 盤面生成 第2世代 (Board V2) — 新規ユーザー向けシードの盤面ドライバ。
 *
 * 設計: crypto_matrix_board_v2_design.md（設計判断は 2026-11-10 凍結）
 * - 対象は CMSeedKey.classify が 'v2' のシードだけ。数字のみのシード（v1）は
 *   従来の LCG 経路をそのまま使い、ここでは一切扱わない。
 * - キーストリーム: block0 = SHA-256( UTF8("CM-BOARD-V2") || 0x00 || UTF8(seed) )、
 *   以降 block(k) = SHA-256( block(k-1) || uint32BE(k) ) を連結して順に消費する。
 *   反復（ストレッチング）は行わない（確定事項①）。
 * - 乱数は 32bit ワードの棄却サンプリングで一様化し、シャッフルは
 *   Fisher-Yates（後方から）。消費順序は呼び出し側（updateMainMatrix）が決める。
 * - SHA-256 は vendor/js-sha256.js（emn178 / MIT / v0.11.1）の同期実装を使う。
 *   読み込まれていない場合は誤った盤面を静かに出さず、例外で止める。
 */
window.CMBoardV2 = (() => {
  const DOMAIN = 'CM-BOARD-V2';

  function sha256Bytes(input) {
    const lib = (typeof window !== 'undefined') ? window.sha256 : null;
    if (!lib || typeof lib.array !== 'function') {
      throw new Error('CMBoardV2: sha256 library is not loaded');
    }
    return new Uint8Array(lib.array(input));
  }

  // seedText は trim 済みの v2 シード文字列を渡すこと。
  function createRandom(seedText) {
    const enc = new TextEncoder();
    const domainBytes = enc.encode(DOMAIN);
    const seedBytes = enc.encode(String(seedText));
    const first = new Uint8Array(domainBytes.length + 1 + seedBytes.length);
    first.set(domainBytes, 0);
    first[domainBytes.length] = 0;
    first.set(seedBytes, domainBytes.length + 1);

    let block = sha256Bytes(first);
    let blockIndex = 0; // 生成済みブロック番号（次は +1 から）
    let pos = 0;        // 現在ブロック内の消費位置

    function nextByte() {
      if (pos >= block.length) {
        blockIndex += 1;
        const next = new Uint8Array(block.length + 4);
        next.set(block, 0);
        next[block.length] = (blockIndex >>> 24) & 0xff;
        next[block.length + 1] = (blockIndex >>> 16) & 0xff;
        next[block.length + 2] = (blockIndex >>> 8) & 0xff;
        next[block.length + 3] = blockIndex & 0xff;
        block = sha256Bytes(next);
        pos = 0;
      }
      return block[pos++];
    }

    function nextWord32() {
      return ((nextByte() << 24) | (nextByte() << 16) | (nextByte() << 8) | nextByte()) >>> 0;
    }

    // [0, n) の一様乱数（棄却サンプリングで剰余バイアスを排除）
    function nextInt(n) {
      if (!Number.isInteger(n) || n <= 0) throw new Error('CMBoardV2: invalid range');
      const limit = 4294967296 - (4294967296 % n);
      let w = nextWord32();
      while (w >= limit) w = nextWord32();
      return w % n;
    }

    // Number1D.shuffle と同じ向き（後方 Fisher-Yates）のコピーシャッフル
    function shuffle(array) {
      const res = array.slice();
      for (let i = res.length - 1; i > 0; i--) {
        const j = nextInt(i + 1);
        const tmp = res[i];
        res[i] = res[j];
        res[j] = tmp;
      }
      return res;
    }

    return { nextInt, shuffle };
  }

  return { createRandom, DOMAIN };
})();
