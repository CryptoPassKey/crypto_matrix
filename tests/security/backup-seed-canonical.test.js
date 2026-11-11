'use strict';
/*
 * Backup ドメインのシード解釈の正規化（範囲A）の回帰テスト。
 *
 * 背景: 暗号化 BIP39 バックアップの作成側は appliedSeed 由来の数値文字列
 * （英数字シードでは FNV-1a ハッシュの数値）を CMA1 の鍵入力にし、復元側は
 * 入力された生文字列を渡していたため、英数字シードで作成したバックアップが
 * 復元できなかった。修正後は作成・復元とも CMSeedKey.canonicalSeedKey に統一し
 * （数字シードは従来の数値解釈を維持）、復元側は正規キーの認証失敗時に限り
 * 旧形式（数値化シード）へフォールバックする。
 *
 * フィクスチャ（backup-seed-canonical.fixtures.json）は修正前の本番コードで
 * 生成した実バックアップで、以後変更しない。生成元コミットはフィクスチャ内に
 * 記録し、さらに本テスト内で「旧キー（数値化シード）では開け、正規キーでは
 * 開けない」ことを暗号学的に検証する（自己申告に依存しない）。
 * CMA1 を持たない旧形式ボディがフォールバックなしで通ることも明示的に検証する。
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup-seed-canonical.fixtures.json'), 'utf8'));
const PW = 'backup-seed-fix-test-pw';

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
  check('fixtures are from pre-fix production code', /pre-fix/.test(FIXTURES.generatedFrom));
  eq('fixture case count', FIXTURES.cases.length, 2);
  check('unpackBackupBody exported', typeof P.unpackBackupBody, 'function');

  $('sim-site').value = 'example.com';
  $('sim-secret').value = '<MASKED_SECRET_001>';

  async function createWith(seed) {
    $('input-seed-number').value = seed;
    w.updateMainMatrix(seed);
    const res = await P.createEncryptedBip39Backup(true, PW, 0, { usePassword: true });
    return res.groups.flat();
  }
  async function restoreWith(words, seed) {
    return P.decodeExtendedBip39(words, PW, { seedNum: seed });
  }
  async function rejects(name, promise) {
    let threw = false;
    try { await promise; } catch (_) { threw = true; }
    check(name, threw);
  }

  // ===== 1. 新規バックアップ（修正後の作成→復元） =====
  const letterWords = await createWith('MySeed2026');
  const r1 = await restoreWith(letterWords, 'MySeed2026');
  eq('[new letter] site restored', r1.site, 'example.com');
  eq('[new letter] secret restored', r1.secret, '<MASKED_SECRET_001>');
  eq('[new letter] seed text restored', r1.seedText, 'MySeed2026');
  check('[new letter] no legacy fallback', !r1.legacySeedFallback);

  const numericWords = await createWith('424242');
  const r2 = await restoreWith(numericWords, '424242');
  eq('[new numeric] seed number restored', r2.seedNumber, 424242);
  check('[new numeric] no legacy fallback', !r2.legacySeedFallback);

  const zeroPadWords = await createWith('007');
  const r3a = await restoreWith(zeroPadWords, '007');
  eq('[007] restore with 007 succeeds (seed)', r3a.seedNumber, 7);
  const r3b = await restoreWith(zeroPadWords, '7');
  eq('[007] restore with 7 succeeds (seed)', r3b.seedNumber, 7);

  // ===== 2. 旧形式フィクスチャ（修正前の本番コードで作成） =====
  const legacyLetter = FIXTURES.cases.find(c => c.name === 'legacy-letter');
  const r4 = await restoreWith(legacyLetter.words, 'MySeed2026');
  eq('[legacy letter] seed text restored via fallback', r4.seedText, 'MySeed2026');
  eq('[legacy letter] fallback flagged', r4.legacySeedFallback, true);
  eq('[legacy letter] site restored', r4.site, 'example.com');

  const legacyNumeric = FIXTURES.cases.find(c => c.name === 'legacy-numeric');
  const r5 = await restoreWith(legacyNumeric.words, '424242');
  eq('[legacy numeric] seed number restored', r5.seedNumber, 424242);
  check('[legacy numeric] no legacy fallback', !r5.legacySeedFallback);

  // ===== 2b. フィクスチャの生成元を暗号学的に検証する =====
  // 旧形式フィクスチャの内層は、旧キー（String(parseSeedValue(seed))）でのみ
  // 開き、正規キーでは開けないはずである。これが成り立つことが、フィクスチャが
  // 修正前の鍵形式で作られたことの独立検証になる。
  check('fixture provenance commit recorded', /^[0-9a-f]{40}$/.test(FIXTURES.generatedFromCommit || ''));
  async function fixtureInnerBody(fx) {
    const blocks = [];
    for (let i = 0; i < fx.words.length; i += 24) blocks.push(await P.bip39WordsToEntropy(fx.words.slice(i, i + 24).join(' ')));
    const { body } = await P.reassembleStreamGroup(blocks, true);
    const dec = await P.decryptBodyCME2(body, fx.pw, null);
    return dec.innerBody;
  }
  for (const fx of FIXTURES.cases) {
    const inner = await fixtureInnerBody(fx);
    check('[' + fx.name + '] inner body is CMA1', inner[0] === 0x43 && inner[1] === 0x4d && inner[2] === 0x41 && inner[3] === 0x31);
    const legacyKey = String(w.parseSeedValue(fx.seed));
    const viaLegacy = await P.unpackAppBound('Backup', inner, legacyKey);
    const viaHelper = await P.unpackBackupBody(inner, fx.seed);
    check('[' + fx.name + '] opens with the legacy (numeric-form) key', viaLegacy[0] === 0x43 && viaLegacy[1] === 0x4d && viaLegacy[2] === 0x58 && Buffer.from(viaLegacy).equals(Buffer.from(viaHelper.plain)));
    eq('[' + fx.name + '] production restore path fallback usage', viaHelper.legacySeedFallback, fx.name === 'legacy-letter');
    const canonicalKey = w.CMSeedKey.canonicalSeedKey(fx.seed);
    if (canonicalKey !== legacyKey) {
      await rejects('[' + fx.name + '] does NOT open with the canonical key (proves pre-fix key form)', P.unpackAppBound('Backup', inner, canonicalKey));
    } else {
      eq('[' + fx.name + '] numeric seed: canonical key equals legacy key', canonicalKey, legacyKey);
    }
  }

  // ===== 2c. CMA1 を持たない旧形式ボディ（フォールバックなしで通る） =====
  {
    const goodWords = await createWith('424242');
    const blocks0 = [];
    for (let i = 0; i < goodWords.length; i += 24) blocks0.push(await P.bip39WordsToEntropy(goodWords.slice(i, i + 24).join(' ')));
    const { body } = await P.reassembleStreamGroup(blocks0, true);
    const dec = await P.decryptBodyCME2(body, PW, null);
    const unb = await P.unpackBackupBody(dec.innerBody, '424242');
    // 取り出した平文本体を、CMA1 を挟まずに CME2 で包み直した旧形式バックアップ
    const cme = await P.encryptBodyCME2(unb.plain, PW, 0, { usePassword: true });
    const blocks = await P.frameBodyToBlocks(cme);
    const words = [];
    for (const b of blocks) words.push(...await P.entropyToBip39Words(b));
    const r6 = await restoreWith(words, '424242');
    eq('[no-CMA1 legacy] restores without app-bound layer', r6.seedNumber, 424242);
    check('[no-CMA1 legacy] no legacy fallback involved', !r6.legacySeedFallback);
    const probe = new TextEncoder().encode('plain-body-without-cma1');
    const u0 = await P.unpackBackupBody(probe, '424242');
    check('[no-CMA1 legacy] unpackBackupBody passes body through untouched', u0.legacySeedFallback === false && Buffer.from(u0.plain).equals(Buffer.from(probe)));
  }

  // ===== 3. 異常系 =====
  await rejects('[wrong seed] numeric fixture rejected', restoreWith(legacyNumeric.words, '111111'));
  await rejects('[wrong seed] letter backup rejected', restoreWith(letterWords, 'WrongSeed999'));

  // 暗号文改ざん（ブロック層）: バイトを反転すると復元は拒否される
  {
    const blocks = [];
    for (let i = 0; i < legacyNumeric.words.length; i += 24) {
      blocks.push(await P.bip39WordsToEntropy(legacyNumeric.words.slice(i, i + 24).join(' ')));
    }
    const tampered = blocks.map(b => new Uint8Array(b));
    tampered[1][20] ^= 0xFF;
    const words2 = [];
    for (const b of tampered) words2.push(...await P.entropyToBip39Words(b));
    await rejects('[tamper] modified backup rejected', restoreWith(words2, '424242'));
  }

  // CMA1 層の単体確認: 正規キー／旧キー／改ざん／誤シード
  {
    const plain = new TextEncoder().encode('cma1-layer-probe');
    const canonical = w.CMSeedKey.canonicalSeedKey('MySeed2026');
    const legacy = String(w.parseSeedValue('MySeed2026'));
    const packedCanonical = await P.packAppBound('Backup', plain, canonical);
    const u1 = await P.unpackBackupBody(packedCanonical, 'MySeed2026');
    check('[cma1] canonical-packed restores without fallback', u1.legacySeedFallback === false && Buffer.from(u1.plain).equals(Buffer.from(plain)));
    const packedLegacy = await P.packAppBound('Backup', plain, legacy);
    const u2 = await P.unpackBackupBody(packedLegacy, 'MySeed2026');
    check('[cma1] legacy-packed restores with fallback flag', u2.legacySeedFallback === true && Buffer.from(u2.plain).equals(Buffer.from(plain)));
    // 改ざんコピーはアプリ側の realm の Uint8Array で作ること。Node 側の
    // Uint8Array はアプリ内の instanceof 判定を通過せず、検証が素通りする。
    const tamperCopy = src => { const t = new w.Uint8Array(src.length); t.set(src); t[t.length - 1] ^= 0xFF; return t; };
    await rejects('[cma1] tampered canonical-packed rejected', P.unpackBackupBody(tamperCopy(packedCanonical), 'MySeed2026'));
    await rejects('[cma1] tampered legacy-packed rejected (fallback does not rescue tampering)', P.unpackBackupBody(tamperCopy(packedLegacy), 'MySeed2026'));
    await rejects('[cma1] wrong seed rejected', P.unpackBackupBody(packedCanonical, 'OtherSeed42'));
  }

  console.log('---');
  console.log(`backup-seed-canonical: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
