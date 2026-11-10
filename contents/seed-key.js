'use strict';

/*
 * 正規シードキー (CM Seed Key) — シード解釈の単一実装。
 *
 * 設計: ~/workspace/crypto_matrix_board_v2_design.md（設計判断は 2026-11-10 凍結）
 * - シードの解釈はこのモジュールだけが行う。各機能が独自に trim や数値化を
 *   行うことは禁止（契約テストで検出する）。
 * - 数値シードの判定（符号付き含む /^[+-]?[0-9]+$/）は parseSeedValue の
 *   数値分岐と一致させる。ここがずれると v1/v2 の分類が機能ごとに食い違う。
 * - 数字のみのシード（v1、既存ユーザー・物理カード）については、従来の
 *   数値解釈 String(parseSeedValue(...)) をそのまま返す。parseSeedValue の
 *   実装自体は index.js 側の既存のものを呼び出し時に参照し、v1 の処理を
 *   ここへ複製しない（計算順序・型変換を変えないため）。
 * - それ以外のシード（v2: 英数字・記号入り）は trim 済みの文字列そのものが
 *   正規シードキーになる。
 */
window.CMSeedKey = (() => {
  function trimSeed(seedText) {
    return String(seedText == null ? '' : seedText).trim();
  }

  function isNumericSeed(seedText) {
    return /^[+-]?[0-9]+$/.test(trimSeed(seedText));
  }

  function isV2Seed(seedText) {
    const t = trimSeed(seedText);
    return t !== '' && !/^[+-]?[0-9]+$/.test(t);
  }

  // 'v1'（数字のみ）/ 'v2'（それ以外）/ 'empty'
  function classify(seedText) {
    const t = trimSeed(seedText);
    if (t === '') return 'empty';
    return /^[+-]?[0-9]+$/.test(t) ? 'v1' : 'v2';
  }

  function canonicalSeedKey(seedText) {
    const t = trimSeed(seedText);
    if (t === '') return '';
    if (/^[+-]?[0-9]+$/.test(t)) {
      // v1 の数値解釈は index.js の parseSeedValue が唯一の実装。
      // 読み込み順に依存しないよう、呼び出し時点で参照する。
      const parseSeedValueFn =
        (typeof window !== 'undefined' && typeof window.parseSeedValue === 'function')
          ? window.parseSeedValue
          : (typeof parseSeedValue === 'function' ? parseSeedValue : null);
      if (!parseSeedValueFn) {
        throw new Error('CMSeedKey: parseSeedValue is not available');
      }
      return String(parseSeedValueFn(t));
    }
    return t;
  }

  // v2 シードの自動生成（設計 §4）: 74種プール（数字＋英大小＋記号12。
  // '#' と '&' は URL 埋め込みとの相性のため自動生成から除外）から
  // 12文字を CSPRNG＋棄却サンプリングで引く（約74.5bit）。
  // 12文字は現行仕様（デザイン用HTMLの生成と同一）で、2026-11-10 に維持を確定。
  // 16文字は BIP39 版6形式の格納容量の目標であり、生成長ではない（設計 §14）。
  // 提示・保存の導線（UI）は別途設計する。ここは生成そのものの仕様。
  const GENERATE_POOL = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_!$%^*()+/.';
  function generateSeed() {
    for (;;) {
      const out = [];
      const buf = new Uint8Array(64);
      let pos = buf.length; // 未充填のゼロ埋めバッファを読まないよう、初回は必ず getRandomValues で充填する
      const limit = 256 - (256 % GENERATE_POOL.length);
      while (out.length < 12) {
        if (pos >= buf.length) { crypto.getRandomValues(buf); pos = 0; }
        const b = buf[pos++];
        if (b >= limit) continue;
        out.push(GENERATE_POOL[b % GENERATE_POOL.length]);
      }
      const seed = out.join('');
      // 万一数値パターンに一致したら引き直す（分類が v1 に倒れるのを防ぐ）
      if (classify(seed) === 'v2') return seed;
    }
  }

  return { trimSeed, isNumericSeed, isV2Seed, classify, canonicalSeedKey, generateSeed };
})();
