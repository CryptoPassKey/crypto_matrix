'use strict';
/*
 * 版6（recipe-v6）の実アプリ統合検証。設計: crypto_matrix_board_v2_design.md §13・§14
 *
 * - 適格な v2 シードは設定フレーズが 24単語（版6コア）になり、元の文字列を完全復元する。
 * - 非適格（17文字以上・記号9種以上のレシピ等）は 48単語（旧形式コア＋シードブロック）
 *   へフォールバックし、24単語形式と復元結果（シード文字列）が完全一致する。
 * - 数字シードの旧形式フレーズは従来どおり（版6に誤認されない）。
 * - 拡張バックアップ（full）でも版6コアが使われ、復元で生成値まで一致する。
 * - 自動生成シードは12文字（現行仕様の維持）。
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }

(async () => {
  const w = await loadApp(CONTENTS);
  const $ = id => w.document.getElementById(id);
  const P = w.MatrixCardPreset;

  check('CMRecipeV6 is loaded', !!w.CMRecipeV6);
  check('CMSeedKey is loaded', !!w.CMSeedKey);

  // ===== 自動生成は12文字（現行仕様の維持） =====
  {
    let bad = 0;
    for (let i = 0; i < 200; i++) {
      const s = w.CMSeedKey.generateSeed();
      if (s.length !== 12 || w.CMSeedKey.classify(s) !== 'v2' || !w.CMRecipeV6.canPack(w.getRecipeConfig(), s)) bad++;
    }
    eq('generateSeed: 200 samples all 12-char v2 and v6-storable', bad, 0);
  }

  async function setup(seed, symList) {
    $('input-seed-number').value = seed;
    w.updateMainMatrix(seed); // UIでシードを入力したのと同じく盤面を同期する
    $('chk-include-card-seed').checked = true;
    $('sim-site').value = 'example.com';
    $('sim-secret').value = 'test-pass';
    $('rc-sym-list').value = symList;
    $('backup-kind').value = 'settings';
  }
  async function generateWords() {
    await w.generateAndRenderSeedPhrase();
    return w.eval('currentMnemonicWords.slice()');
  }
  async function restore(words) {
    $('input-seed-number').value = '999';
    $('input-restore-seed').value = words.join(' ');
    await w.restoreRecipeFromSeedInput();
    return $('input-seed-number').value;
  }
  function boardDigestViaEval() {
    return w.eval('JSON.stringify(currentMatrixData)');
  }

  // ===== 適格シード: 24単語（版6）で完全復元 =====
  {
    const seed = 'aB3-xY9zQwEr';
    await setup(seed, '-_!#');
    const words = await generateWords();
    eq('eligible v2 seed produces 24 words', words.length, 24);
    const restored = await restore(words);
    eq('v6 24-word restore returns exact seed string', restored, seed);
    const digestAfterRestore = boardDigestViaEval();
    w.eval("updateMainMatrix('aB3-xY9zQwEr')");
    eq('restored board matches direct v2 board', boardDigestViaEval(), digestAfterRestore);
    // decodeBip39Blocks 経由でも seedText が取れる（復元経路の共通フック）
    const decoded = await P.decodeBip39Blocks(words, '', true, null);
    eq('decodeBip39Blocks exposes v6 seedText', decoded.seedText, seed);
    eq('decodeBip39Blocks marks v6 format', decoded.format, 'v6');
  }

  // ===== 非適格シード: 48単語フォールバックと結果の一致 =====
  {
    const seed = 'aB3-xY9zQwErT7uI9oP2'; // 20文字: 版6には入らない
    await setup(seed, '-_!#');
    const words = await generateWords();
    eq('20-char seed falls back to 48 words', words.length, 48);
    const restored = await restore(words);
    eq('48-word restore returns exact seed string', restored, seed);
  }
  {
    const seed = 'aB3-xY9zQwEr';
    await setup(seed, '!#$%&()*+-'); // 記号10種: レシピが版6に入らない
    const words = await generateWords();
    eq('9+ symbol recipe falls back to 48 words', words.length, 48);
    const restored = await restore(words);
    eq('48-word (symbol fallback) restore returns exact seed', restored, seed);
    // 24単語形式（適格レシピ）で復元したシードと完全一致すること（条件4）
    await setup(seed, '-_!#');
    const words24 = await generateWords();
    eq('same seed via v6 is 24 words', words24.length, 24);
    const restored24 = await restore(words24);
    eq('24-word and 48-word restores agree on seed string', restored24, restored);
  }

  // ===== 数字シード: 旧形式のまま =====
  {
    await setup('424242', '-_!#');
    const words = await generateWords();
    eq('numeric seed still produces 24 words', words.length, 24);
    const decoded = await P.decodeBip39Blocks(words, '', true, null);
    eq('numeric seed decodes as legacy (no seedText)', decoded.seedText, undefined);
    eq('numeric seed value preserved', decoded.seedNumber, 424242);
    const ent = await w.bip39WordsToEntropy(words.join(' '));
    check('numeric core is not mistaken for v6', !w.CMRecipeV6.isV6(ent));
    const restored = await restore(words);
    eq('numeric restore returns numeric seed', restored, '424242');
  }

  // ===== 拡張バックアップ（full）: 版6コア入りでも完全復元 =====
  {
    const seed = 'aB3-xY9zQwEr';
    await setup(seed, '-_!#');
    $('backup-kind').value = 'full';
    const words = await generateWords();
    check('full backup produced blocks', words.length > 24 && words.length % 24 === 0, 'words=' + words.length);
    const restored = await restore(words);
    eq('full backup restore returns exact seed', restored, seed);
    check('full backup restore status ok', $('restore-status').textContent.includes('✅'), $('restore-status').textContent);
  }

  console.log('---');
  console.log('recipe-v6-integration: pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('ERROR:', e && e.stack || e);
  process.exitCode = 1;
});
