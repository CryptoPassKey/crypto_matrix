'use strict';
/*
 * 版6 導入時の互換性監査（PR レビュー項目への対応）。設計: §13・§14
 *
 * 1. 旧形式の実物による復元試験: フィクスチャは現行本番コード（main@85c0cc4、
 *    版6 導入前）で実際に生成したバックアップと、その本番コードでの復元結果。
 *    新コードで同じ実物を復元し、レシピ・シード・生成パスワード・盤面が
 *    完全一致することを確認する。英字シードの旧フレーズ（数値化されて保存
 *    されたもの）が従来どおり数値シードとして復元されることも含む。
 * 2. 版6の異常系: 署名一致後の不正データ・予備ビット異常・範囲外の値・
 *    切り詰めフレーズがすべて拒否されること。
 * 3. バックアップ経路の整合性: 24単語（版6）・48単語（フォールバック）・
 *    full・アーマードテキスト（QR／PGP が運ぶ形式）で、元の12文字シードが
 *    完全一致すること。
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipe-v6-restore-compat.fixtures.json'), 'utf8'));

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
    eq('[' + c.name + '] generated password matches production', $('sim-output-pw').textContent, c.expected.passwordAfterRestore);
    eq('[' + c.name + '] board matches production', w.eval('JSON.stringify(currentMatrixData)'), c.expected.boardAfterRestore);
  }

  // ===== 2. 版6の異常系 =====
  {
    const cfg = w.getRecipeConfig();
    const seed = 'aB3-xY9zQwEr';
    const good = w.CMRecipeV6.pack(cfg, true, seed);
    const goodWords = await P.entropyToBip39Words(good);
    const okDecoded = await P.decodeBip39Blocks(goodWords, '', true, null);
    eq('control: valid v6 phrase decodes', okDecoded.seedText, seed);

    async function rejects(name, words) {
      let threw = false;
      try { await P.decodeBip39Blocks(words, '', true, null); } catch (_) { threw = true; }
      check(name, threw);
    }
    // 切り詰め（23単語）
    await rejects('truncated phrase (23 words) rejected', goodWords.slice(0, 23));
    // 予備ビット異常: バイト2の下位ビットを立てる（版・フラグは不変）
    {
      const t = new Uint8Array(good); t[2] |= 0x02;
      await rejects('reserved-bit corruption rejected', await P.entropyToBip39Words(t));
    }
    // 署名一致後のシード部破損（構造的に無効な値域）: 有効区間の外の値と、
    // 数字のみシードの符号化（数値経路の担当なので版6では不正）を差し込む。
    // なお別の有効な版6値への化けは形式上区別できない（旧形式も同じ性質）ため、
    // 転記ミスは BIP39 チェックサム側で検出する（次項）。
    {
      let acc = 0n;
      for (const b of good) acc = (acc << 8n) | BigInt(b);
      const mask = (1n << 101n) - 1n;
      const splice = (v) => {
        let a = (acc & ~mask) | v;
        const t = new Uint8Array(32);
        for (let i = 31; i >= 0; i--) { t[i] = Number(a & 0xFFn); a >>= 8n; }
        return t;
      };
      await rejects('seed value in gap zone rejected', await P.entropyToBip39Words(splice(2n * 76n ** 5n)));
      await rejects('all-digit seed encoding rejected in v6', await P.entropyToBip39Words(splice(w.CMRecipeV6._internal.encodeSeedValue('123456'))));
    }
    // 転記ミス（単語の置換）は BIP39 チェックサムで拒否される
    {
      const t = goodWords.slice();
      t[3] = t[3] === 'abandon' ? 'ability' : 'abandon';
      await rejects('single-word substitution rejected (checksum)', t);
    }
    // 範囲外の値: kwNum の格納値を最大超え（63）にする
    {
      let acc = 0n;
      for (const b of good) acc = (acc << 8n) | BigInt(b);
      const shift = 219n; // マジック16+版4+フラグ1+予備3+kwOrder4+kwFilter3 の次が kwNum(6bit)
      acc = (acc & ~(0x3Fn << shift)) | (0x3Fn << shift);
      const t = new Uint8Array(32);
      for (let i = 31; i >= 0; i--) { t[i] = Number(acc & 0xFFn); acc >>= 8n; }
      await rejects('out-of-range field value rejected', await P.entropyToBip39Words(t));
    }
    // 旧形式コアは版6に誤認されない（構造的識別: 本番形式はマスク済みで生の署名を持たない）
    {
      const legacy = w.packRecipeTo256Bit(cfg, true, '424242');
      check('legacy core has no v6 signature', !w.CMRecipeV6.isV6(legacy));
      const legacyWords = await P.entropyToBip39Words(legacy);
      const d = await P.decodeBip39Blocks(legacyWords, '', true, null);
      eq('legacy numeric phrase still decodes as numeric', d.seedNumber, 424242);
      eq('legacy numeric phrase has no seedText', d.seedText, undefined);
    }
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
    // 24単語（版6）
    await setup('-_!#', 'settings');
    await w.generateAndRenderSeedPhrase();
    const words24 = w.eval('currentMnemonicWords.slice()');
    eq('path 24-word: word count', words24.length, 24);
    eq('path 24-word: seed identical', await restoreSeed(words24), seed);
    // 48単語（フォールバック: 記号10種レシピ）
    await setup('!#$%&()*+-', 'settings');
    await w.generateAndRenderSeedPhrase();
    const words48 = w.eval('currentMnemonicWords.slice()');
    eq('path 48-word: word count', words48.length, 48);
    eq('path 48-word: seed identical', await restoreSeed(words48), seed);
    // full（版6コア入りフレーム形式）
    await setup('-_!#', 'full');
    await w.generateAndRenderSeedPhrase();
    const wordsFull = w.eval('currentMnemonicWords.slice()');
    check('path full: multiple blocks', wordsFull.length > 24 && wordsFull.length % 24 === 0, 'words=' + wordsFull.length);
    eq('path full: seed identical', await restoreSeed(wordsFull), seed);
    // アーマードテキスト（QR／PGP が運ぶ形式）: 生成時にアプリ自身が作る
    // PGP アーマードをそのまま復元欄へ入れる（復元側は dearmorBlocks 経由）。
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
