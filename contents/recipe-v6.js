'use strict';

/*
 * レシピコア新形式（版6）— BIP39 256bit コアへの v2 シード文字列の完全格納。
 *
 * 設計: ~/workspace/crypto_matrix_board_v2_design.md §13（監査）・§14（ビット配置・確定）
 * - 24単語（256bit）のまま、レシピ設定＋記号マスク＋文字列シードを1コアに収める。
 * - 旧形式（版2/4/5）の pack/unpack には一切触れない。本モジュールは v2 シードの
 *   保存時にだけ使われ、復元時は署名（マジック＋版6）で判別してから全項目を
 *   検証する（try-and-validate）。検証を通過しないデータは版6として確定しない。
 * - 格納できないシード・レシピ（文字種外・17文字以上・記号9種以上・値域外）は
 *   canPack が false を返し、呼び出し側が従来経路（追加ブロック等の fallback）
 *   へ回す。ここで切り捨てや暗黙の変換は行わない。
 *
 * ビット配置（MSB 側から固定順、合計 256bit）:
 *   マジック 'C''M' 16 / 版 4 (=6) / シード含有フラグ 1 / 予備 3 (=0)
 *   レシピ設定 23項目 107（§14 の最小幅、項目順は現行 pack と同じ）
 *   記号マスク 24（ALL_ASCII_SYMBOLS 32種から8種以下の組合せ順位）
 *   シード文字列 101（格納文字種76種の base-76 数値化、長さは先行桁で回復）
 */
window.CMRecipeV6 = (() => {
  // 格納文字種76種: 自動生成プール74種（seed-key.js の GENERATE_POOL と同じ並び）
  // ＋ 手動入力で許容される '#' '&'。重複・順序の変更は形式の互換性を壊す。
  const STORAGE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_!$%^*()+/.#&';
  // 記号マスクの母集団。index.js の ALL_ASCII_SYMBOLS と同一でなければならない
  // （契約テストで一致を検証する）。
  const SYMBOL_UNIVERSE = '!#$%&()*+-/:;=?@^_"`,.<>[\\]{|}~\'';
  const MAX_SEED_LEN = 16;
  const MAX_SYMBOLS = 8;

  // レシピ項目: [cfgキー, ビット幅, 最小値, 最大値]（格納値は 実値−最小値）
  const RECIPE_FIELDS = [
    ['kwOrder', 4, 0, 9], ['kwFilter', 3, 0, 6], ['kwNum', 6, 1, 63],
    ['shiftDir', 4, 0, 13], ['baseCorner', 4, 0, 9], ['shiftN', 6, 0, 63],
    ['shiftM', 6, 0, 63], ['pickPattern', 5, 0, 17], ['symMode', 2, 0, 3],
    ['symFbCorner', 3, 0, 4], ['postMode', 3, 0, 4], ['symFbDir', 4, 0, 10],
    ['symFbDist', 6, 1, 39], ['preTarget', 3, 0, 7], ['prePattern', 4, 0, 13],
    ['preOffset', 6, 0, 63], ['sufTarget', 3, 0, 7], ['sufPattern', 4, 0, 13],
    ['sufOffset', 6, 0, 63], ['ancTile', 6, 0, 39], ['ancMode', 3, 0, 6],
    ['lenMode', 3, 0, 5], ['ancPos', 6, 0, 63], ['lenVal', 7, 1, 128]
  ];

  // 組合せ数 C(n, k)（n<=32, k<=8 は Number で正確）
  function comb(n, k) {
    if (k < 0 || n < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
  }
  // 集合サイズ k の符号化値域オフセットと総数
  const MASK_OFFSETS = [];
  {
    let acc = 0;
    for (let k = 0; k <= MAX_SYMBOLS; k++) { MASK_OFFSETS.push(acc); acc += comb(32, k); }
    MASK_OFFSETS.push(acc); // MASK_OFFSETS[9] = 総数 15,033,173
  }
  const MASK_TOTAL = MASK_OFFSETS[MAX_SYMBOLS + 1];

  const POW76 = [];
  {
    let p = 1n;
    for (let i = 0; i <= MAX_SEED_LEN + 1; i++) { POW76.push(p); p *= 76n; }
  }

  // symList の実効集合（現行 encodeSymListTo32Bit と同じく母集団との積集合・重複除去）
  function effectiveSymbols(symList) {
    const s = String(symList == null ? '' : symList);
    const out = [];
    for (let i = 0; i < 32; i++) if (s.includes(SYMBOL_UNIVERSE[i])) out.push(i);
    return out; // 母集団順の添字配列
  }

  function maskRank(indices) {
    const k = indices.length;
    let rank = MASK_OFFSETS[k];
    for (let j = 0; j < k; j++) rank += comb(indices[j], j + 1);
    return rank;
  }

  function maskUnrank(value) {
    let k = 0;
    while (k <= MAX_SYMBOLS && value >= MASK_OFFSETS[k + 1]) k++;
    if (k > MAX_SYMBOLS) return null;
    let rest = value - MASK_OFFSETS[k];
    const indices = new Array(k);
    for (let j = k; j >= 1; j--) {
      let c = j - 1;
      while (comb(c + 1, j) <= rest) c++;
      indices[j - 1] = c;
      rest -= comb(c, j);
    }
    if (rest !== 0) return null;
    return indices;
  }

  function encodeSeedValue(seedText) {
    const L = seedText.length;
    let v = POW76[L];
    for (let i = 0; i < L; i++) {
      const idx = STORAGE_CHARS.indexOf(seedText[i]);
      v += BigInt(idx) * POW76[L - 1 - i];
    }
    return v;
  }

  function decodeSeedValue(v) {
    let L = 0;
    while (L <= MAX_SEED_LEN && POW76[L + 1] <= v) L++;
    if (L > MAX_SEED_LEN) return null;
    if (v < POW76[L] || v >= 2n * POW76[L]) return null; // 有効区間 [76^L, 2*76^L) の外
    let rest = v - POW76[L];
    const chars = new Array(L);
    for (let i = L - 1; i >= 0; i--) {
      chars[i] = STORAGE_CHARS[Number(rest % 76n)];
      rest /= 76n;
    }
    if (rest !== 0n) return null;
    return chars.join('');
  }

  function seedStorable(seedText) {
    if (typeof seedText !== 'string') return false;
    if (seedText.length < 1 || seedText.length > MAX_SEED_LEN) return false;
    if (/^[0-9]+$/.test(seedText)) return false; // 数字のみは数値経路（旧形式）の担当
    for (const ch of seedText) if (!STORAGE_CHARS.includes(ch)) return false;
    return true;
  }

  function cfgStorable(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    for (const [key, , min, max] of RECIPE_FIELDS) {
      const v = cfg[key];
      if (!Number.isInteger(v) || v < min || v > max) return false;
    }
    return effectiveSymbols(cfg.symList).length <= MAX_SYMBOLS;
  }

  function canPack(cfg, seedText) {
    return cfgStorable(cfg) && seedStorable(seedText);
  }

  function pack(cfg, includeSeed, seedText) {
    if (!cfgStorable(cfg)) throw new Error('このレシピ設定は新形式（版6）に格納できません。');
    let acc = 0n;
    const push = (value, width) => { acc = (acc << BigInt(width)) | BigInt(value); };
    push(0x43, 8); push(0x4D, 8); // 'C' 'M'
    push(6, 4); // 版
    push(includeSeed ? 1 : 0, 1);
    push(0, 3); // 予備
    for (const [key, width, min] of RECIPE_FIELDS) push(cfg[key] - min, width);
    push(maskRank(effectiveSymbols(cfg.symList)), 24);
    if (includeSeed) {
      if (!seedStorable(seedText)) throw new Error('このシードは新形式（版6）に格納できません。');
      const v = encodeSeedValue(seedText);
      acc = (acc << 101n) | v;
    } else {
      acc <<= 101n;
    }
    if (acc >> 256n) throw new Error('新形式（版6）の容量を超えました。');
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) { out[i] = Number(acc & 0xFFn); acc >>= 8n; }
    return out;
  }

  function isV6(bytes) {
    return bytes instanceof Uint8Array && bytes.length === 32 &&
      bytes[0] === 0x43 && bytes[1] === 0x4D && (bytes[2] >>> 4) === 6;
  }

  // 署名が版6でも、検証を全て通過しなければ null を返す（誤認防止）。
  function tryUnpack(bytes) {
    if (!isV6(bytes)) return null;
    let acc = 0n;
    for (let i = 0; i < 32; i++) acc = (acc << 8n) | BigInt(bytes[i]);
    let rest = 256;
    const take = (width) => {
      rest -= width;
      return Number((acc >> BigInt(rest)) & ((1n << BigInt(width)) - 1n));
    };
    if (take(8) !== 0x43 || take(8) !== 0x4D) return null;
    if (take(4) !== 6) return null;
    const includeSeed = take(1) === 1;
    if (take(3) !== 0) return null; // 予備ビットは 0 でなければ版6として確定しない
    const cfg = {};
    for (const [key, width, min, max] of RECIPE_FIELDS) {
      const stored = take(width);
      if (stored > max - min) return null; // 値域外は不正データ
      cfg[key] = stored + min;
    }
    const maskValue = take(24);
    if (maskValue >= MASK_TOTAL) return null;
    const indices = maskUnrank(maskValue);
    if (!indices || maskRank(indices) !== maskValue) return null; // 正準形の確認
    cfg.symList = indices.map(i => SYMBOL_UNIVERSE[i]).join('');
    const seedField = (() => {
      rest -= 101;
      return (acc >> BigInt(rest)) & ((1n << 101n) - 1n);
    })();
    if (rest !== 0) return null;
    if (!includeSeed) {
      if (seedField !== 0n) return null;
      return { cfg, includeCardSeed: false, seedText: null };
    }
    const seedText = decodeSeedValue(seedField);
    if (seedText === null || !seedStorable(seedText)) return null;
    if (encodeSeedValue(seedText) !== seedField) return null; // 正準形の確認
    return { cfg, includeCardSeed: true, seedText };
  }

  return {
    STORAGE_CHARS, SYMBOL_UNIVERSE, MAX_SEED_LEN, MAX_SYMBOLS,
    canPack, pack, isV6, tryUnpack,
    // テスト用に内部関数も公開する
    _internal: { effectiveSymbols, maskRank, maskUnrank, encodeSeedValue, decodeSeedValue, comb, MASK_TOTAL }
  };
})();
