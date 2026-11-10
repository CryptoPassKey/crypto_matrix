'use strict';
/*
 * 版6 導入時の互換性監査（PR-1: BIP39 版6 のみ。盤面生成は現行仕様のまま）。
 *
 * 注意: BIP39 のチェックサムは転記ミスの検出用であり、改ざんに対する認証
 * 機構ではない。本テストでも「チェックサム層」と「構造検証層」を分けて
 * 検証し、完全性・真正性の保証と混同しない。暗号化バックアップ（CME2）の
 * 完全性は暗号層の担当であり、本テストの範囲外。
 *
 * テストの合格範囲（正確な記録）:
 *  - full: 生成（ボタンの処理）から復元までを通しで確認する。
 *  - アーマード: アプリ自身が生成・描画したアーマード文字列を復元欄へ
 *    投入し、復元までを確認する（利用者のコピー＆ペースト経路と同一）。
 *  - QR カメラ読み取り: 未検証（jsdom では再現できない）。QR の後段は
 *    テキスト経路と同じ復元入口に合流する共通処理であり、版6では未変更。
 *
 * 検証内容:
 *  1. 旧形式の実物による復元試験: フィクスチャは版6導入前の本番コード
 *     （main@85c0cc4）で生成した実バックアップと、その復元結果。生成
 *     パスワードは原文ではなく SHA-256 ダイジェストで保持し、照合する。
 *  2. 異常系を層別に検証する。
 *     - チェックサム層: 単語置換・切り詰めは BIP39 チェックサムで拒否。
 *     - 版6構造層: チェックサムを付け直した（=チェックサムでは検出
 *       できない）データでも、予備ビット・範囲外の値・シード値域の
 *       不正が構造検証で拒否されること。
 *     - マーカー／ブロック層: 「文字列シード続きあり」マーカーと追加
 *       ブロックの整合（欠落・破損・余分はすべて拒否）。
 *  3. 経路整合性: 24単語（版6）・48単語（フォールバック）・full・
 *     アーマードで、元の12文字シードが完全一致すること。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipe-v6-restore-compat.fixtures.json'), 'utf8'));
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }
function cfgEq(a, b) {
  const ka = Object.keys(b || {});
  return ka.length === Object.keys(a || {}).length && ka.every(k => a[k] === b[k]);
}

(async () => {
  const w = await loadApp(CONTENTS);
  const $ = id => w.document.getElementById(id);
  const P = w.MatrixCardPreset;
  check('fixtures are from pre-v6 production code', /pre-v6/.test(FIXTURES.generatedFrom));
  eq('fixture case count', FIXTURES.cases.length, 5);

  // ===== 1. 旧形式の実物による復元試験 =====
  for (const c of FIXTURES.cases) {
    $('input-seed-number').value = '999';
    w.updateMainMatrix('999');
    $('input-restore-seed').value = c.words.join(' ');
    await w.restoreRecipeFromSeedInput();
    const status = $('restore-status').textContent;
    check('[' + c.name + '] restore accepted', status.includes('✅'), status);
    eq('[' + c.name + '] restored seed matches production', $('input-seed-number').value, c.expected.restoredSeedInput);
    check('[' + c.name + '] restored recipe matches production', cfgEq(w.getRecipeConfig(), c.expected.restoredCfg),
      JSON.stringify(w.getRecipeConfig()) + ' vs ' + JSON.stringify(c.expected.restoredCfg));
    $('sim-site').value = c.site;
    $('sim-secret').value = c.secret;
    w.updateSimulationUI();
    eq('[' + c.name + '] generated password matches production (digest)', sha256($('sim-output-pw').textContent), c.expected.passwordAfterRestoreSha256);
    eq('[' + c.name + '] board matches production', w.eval('JSON.stringify(currentMatrixData)'), c.expected.boardAfterRestore);
  }

  // ===== 2a. 異常系: チェックサム層 =====
  {
    const cfg = w.getRecipeConfig();
    const good = w.CMRecipeV6.pack(cfg, true, 'aB3-xY9zQwEr');
    const goodWords = await P.entropyToBip39Words(good);
    const okDecoded = await P.decodeBip39Blocks(goodWords, '', true, null);
    eq('control: valid v6 phrase decodes', okDecoded.seedText, 'aB3-xY9zQwEr');
    async function rejects(name, words) {
      let threw = false;
      try { await P.decodeBip39Blocks(words, '', true, null); } catch (_) { threw = true; }
      check(name, threw);
    }
    await rejects('[checksum] truncated phrase (23 words) rejected', goodWords.slice(0, 23));
    const sub = goodWords.slice();
    sub[3] = sub[3] === 'abandon' ? 'ability' : 'abandon';
    await rejects('[checksum] single-word substitution rejected', sub);
  }

  // ===== 2b. 異常系: 版6構造層（チェックサムは付け直す） =====
  {
    const cfg = w.getRecipeConfig();
    const good = w.CMRecipeV6.pack(cfg, true, 'aB3-xY9zQwEr');
    async function rejects(name, bytes) {
      let threw = false;
      try { await P.decodeBip39Blocks(await P.entropyToBip39Words(bytes), '', true, null); } catch (_) { threw = true; }
      check(name, threw);
    }
    const t1 = new Uint8Array(good); t1[2] |= 0x02; // 予備ビット
    await rejects('[v6-structure] reserved-bit corruption rejected', t1);
    let acc = 0n;
    for (const b of good) acc = (acc << 8n) | BigInt(b);
    const shift = 219n; // kwNum フィールド
    const t2 = (acc & ~(0x3Fn << shift)) | (0x3Fn << shift);
    const t2b = new Uint8Array(32);
    let v = t2;
    for (let i = 31; i >= 0; i--) { t2b[i] = Number(v & 0xFFn); v >>= 8n; }
    await rejects('[v6-structure] out-of-range field value rejected', t2b);
    const mask = (1n << 101n) - 1n;
    const splice = (sv) => {
      let a = (acc & ~mask) | sv;
      const t = new Uint8Array(32);
      for (let i = 31; i >= 0; i--) { t[i] = Number(a & 0xFFn); a >>= 8n; }
      return t;
    };
    await rejects('[v6-structure] seed value in gap zone rejected', splice(2n * 76n ** 5n));
    await rejects('[v6-structure] all-digit seed encoding rejected in v6', splice(w.CMRecipeV6._internal.encodeSeedValue('123456')));
    // 旧形式コアは版6に誤認されない（マスク済みで生の署名を持たない）
    const legacy = w.packRecipeTo256Bit(cfg, true, '424242');
    check('[v6-structure] legacy core has no v6 signature', !w.CMRecipeV6.isV6(legacy));
    const d = await P.decodeBip39Blocks(await P.entropyToBip39Words(legacy), '', true, null);
    eq('[v6-structure] legacy numeric phrase decodes as numeric', d.seedNumber, 424242);
    eq('[v6-structure] legacy numeric phrase has no seedText', d.seedText, undefined);
    eq('[v6-structure] legacy numeric phrase has no marker', d.seedTextFollows, false);
  }

  // ===== 2c. 異常系: マーカー／ブロック層 =====
  {
    // 実アプリで48単語（フォールバック）を生成し、その構造に対して検証する
    const seed = 'aB3-xY9zQwErT7uI9oP2'; // 20文字: 版6非適格 → 48単語
    $('input-seed-number').value = seed;
    w.updateMainMatrix(seed);
    $('chk-include-card-seed').checked = true;
    $('sim-site').value = 'example.com';
    $('sim-secret').value = 'test-pass';
    $('rc-sym-list').value = '-_!#';
    $('backup-kind').value = 'settings';
    await w.generateAndRenderSeedPhrase();
    const words48 = w.eval('currentMnemonicWords.slice()');
    eq('[marker] ineligible seed produced 48 words', words48.length, 48);
    const okDecoded = await P.decodeBip39Blocks(words48, '', true, null);
    eq('[marker] control: 48-word phrase returns exact seed', okDecoded.seedText, seed);

    async function rejectsViaDecode(name, words) {
      let threw = false;
      try { await P.decodeBip39Blocks(words, '', true, null); } catch (_) { threw = true; }
      check(name, threw);
    }
    // マーカーあり＋ブロック欠落（先頭24単語だけ）: 数値シードとして静かに
    // 復元されることなく、拒否されなければならない
    await rejectsViaDecode('[marker] missing seed block rejected (decode)', words48.slice(0, 24));
    // 同じ入力を復元欄（バックアップタブの復元入口）へ入れても拒否される
    $('input-seed-number').value = '999';
    w.updateMainMatrix('999');
    $('input-restore-seed').value = words48.slice(0, 24).join(' ');
    await w.restoreRecipeFromSeedInput();
    check('[marker] missing seed block rejected (restore UI)', $('restore-status').textContent.includes('❌'), $('restore-status').textContent);
    eq('[marker] seed input untouched after rejection', $('input-seed-number').value, '999');
    // マーカーあり＋ブロック破損: 第2ブロックのシード領域を書き換え、
    // チェックサムを付け直しても bind 検証で拒否される
    const block2 = await w.bip39WordsToEntropy(words48.slice(24).join(' '));
    const tampered = new Uint8Array(block2);
    tampered[10] ^= 0xFF;
    const wordsTampered = [...words48.slice(0, 24), ...(await P.entropyToBip39Words(tampered))];
    await rejectsViaDecode('[marker] corrupted seed block rejected (bind)', wordsTampered);
    // マーカーなし＋余分なブロック: 数字シードの24単語にブロックを足すと拒否
    const cfgN = w.getRecipeConfig();
    const legacyCore = w.packRecipeTo256Bit(cfgN, true, '424242');
    const wordsLegacy = await P.entropyToBip39Words(legacyCore);
    const wordsExtra = [...wordsLegacy, ...words48.slice(24)];
    await rejectsViaDecode('[marker] unmarked core with extra block rejected', wordsExtra);
  }

  // ===== 3. バックアップ経路の整合性（12文字シード） =====
  {
    const seed = w.CMSeedKey.generateSeed();
    eq('generated seed is 12 chars', seed.length, 12);
    async function setup(symList, kind) {
      $('input-seed-number').value = seed;
      w.updateMainMatrix(seed);
      $('chk-include-card-seed').checked = true;
      $('sim-site').value = 'example.com';
      $('sim-secret').value = 'test-pass';
      $('rc-sym-list').value = symList;
      $('backup-kind').value = kind;
    }
    async function restoreSeed(words) {
      $('input-seed-number').value = '999';
      w.updateMainMatrix('999');
      $('input-restore-seed').value = words.join(' ');
      await w.restoreRecipeFromSeedInput();
      return $('input-seed-number').value;
    }
    await setup('-_!#', 'settings');
    await w.generateAndRenderSeedPhrase();
    const words24 = w.eval('currentMnemonicWords.slice()');
    eq('path 24-word: word count', words24.length, 24);
    eq('path 24-word: seed identical', await restoreSeed(words24), seed);
    await setup('!#$%&()*+-', 'settings');
    await w.generateAndRenderSeedPhrase();
    const words48 = w.eval('currentMnemonicWords.slice()');
    eq('path 48-word: word count', words48.length, 48);
    eq('path 48-word: seed identical', await restoreSeed(words48), seed);
    await setup('-_!#', 'full');
    await w.generateAndRenderSeedPhrase();
    const wordsFull = w.eval('currentMnemonicWords.slice()');
    check('path full: multiple blocks', wordsFull.length > 24 && wordsFull.length % 24 === 0, 'words=' + wordsFull.length);
    eq('path full: seed identical', await restoreSeed(wordsFull), seed);
    const armored = $('seed-armored-text') ? $('seed-armored-text').value : '';
    check('armored text produced by app', /BEGIN CRYPTOMATRIX BACKUP/.test(armored), String(armored).slice(0, 60));
    $('input-seed-number').value = '999';
    w.updateMainMatrix('999');
    $('input-restore-seed').value = armored;
    await w.restoreRecipeFromSeedInput();
    eq('path armored: seed identical', $('input-seed-number').value, seed);
  }

  console.log('---');
  console.log('recipe-v6-restore-compat: pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('ERROR:', e && e.stack || e);
  process.exitCode = 1;
});
