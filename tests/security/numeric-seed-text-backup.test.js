'use strict';
/*
 * 数値シードの原文保持（バックアップ）の回帰テスト。
 *
 * 背景: BIP39 系バックアップのコアはシードを32bit数値として格納するため、
 * "007" のような数値シードは復元時に "7" となり、入力時の原文が失われていた。
 * 修正後は、コアだけでは原文を再現できないシード（CMSeedKey.seedNeedsTextBackup）
 * に限り、既存のシード文字列ブロック（seedTextFollows フラグ＋追加ブロック）を
 * 使って原文を保持する。再現できる数値シードは従来どおり24単語のまま。
 *
 * 機能ごとのシード解釈は統一しない（設計上の原則）:
 * - 盤面生成・Backup の鍵は従来どおり（"007" と "7" は同じ数値シード／同じ鍵）。
 * - TimeLock / TimeSecret / Seed Vault は原文文字列を厳密に使う（変更しない）。
 *
 * TimeLock のカプセル往復は drand ビーコンの署名検証が必要で、このテストの
 * 範囲外とする。代わりに timelock.js が正規化を導入していないことを静的に
 * 確認し、同じ原文導出を使うアプリ束縛層（TimeSecret / Vault ドメイン）で
 * "007" と "7" が実際に別の鍵になることを振る舞いで検証する。
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const PW = 'numeric-seed-text-test-pw';

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }
async function rejects(name, promise) {
  let threw = false;
  try { await promise; } catch (_) { threw = true; }
  check(name, threw);
}

(async () => {
  const w = await loadApp(CONTENTS);
  const $ = id => w.document.getElementById(id);
  const P = w.MatrixCardPreset;
  const K = w.CMSeedKey;

  check('CMSeedKey.seedNeedsTextBackup is exported', typeof K.seedNeedsTextBackup === 'function');

  // ===== 1. 振り分け（seedNeedsTextBackup） =====
  const needsCases = [
    ['007', true], ['7', false], ['0007', true], ['0', false], ['000', true],
    ['123456789012', true],           // 32bitに収まらずコアでは再現できない
    ['424242', false], ['4294967295', false], // 32bitに正確に収まる
    ['4294967296', true],             // 2^32（コアでは 0 になる）
    ['+7', true], ['-7', true],       // 符号付きは原文を保持する
    ['MySeed2026', true],             // v2 は常に対象（従来どおり）
    ['', false],
    ['123456789012345678901234567890', false], // 23バイト超の数値は従来形式を維持
  ];
  for (const [seed, expected] of needsCases) {
    eq(`seedNeedsTextBackup(${JSON.stringify(seed)})`, K.seedNeedsTextBackup(seed), expected);
  }

  // ===== 2. 静的ガード（配線と非統一の契約） =====
  const indexJs = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');
  const backupQrJs = fs.readFileSync(path.join(CONTENTS, 'backup-qr.js'), 'utf8');
  check('pack flag uses seedNeedsTextBackup',
    indexJs.includes('window.CMSeedKey.seedNeedsTextBackup(seedNumber)'));
  check('plain body block uses seedNeedsTextBackup',
    indexJs.includes('window.CMSeedKey.seedNeedsTextBackup(s.seedText)'));
  check('phrase generator appends block via textSeed',
    indexJs.includes('packSeedTextBlock(textSeed,core)'));
  check('restore preview prefers seedText over seedNumber',
    backupQrJs.includes("(d.seedText!==undefined&&d.seedText!=='')?d.seedText:d.seedNumber"));
  // フレーズ生成は定義が二重にある（先行定義＋後段の再代入）。どちらも同じ振り分けを使うこと
  const firstGenStart = indexJs.indexOf('async function generateAndRenderSeedPhrase()');
  const firstGen = indexJs.slice(firstGenStart, indexJs.indexOf('function restoreRecipeFromSeedInput', firstGenStart));
  check('first phrase generator also uses seedNeedsTextBackup',
    firstGen.includes('window.CMSeedKey.seedNeedsTextBackup(seedVal)'));
  check('first phrase generator has no legacy v2-only block condition',
    !firstGen.includes('if (isV2 && !useV6)'));
  // スキャナー／ファイル取り込み（ingest）がコア＋シードブロックの48単語を受け付けること
  check('ingest accepts a 48-word core+seed-block pair',
    backupQrJs.includes('words.length===48&&offset===0'));
  check('ingest validates the seed block against the core',
    backupQrJs.includes('unpackSeedTextBlock(seedBlockBytes,bytes)'));
  for (const f of ['timelock.js', 'timesecret.js', 'seed-vault.js', 'timelock-recover.js']) {
    const src = fs.readFileSync(path.join(CONTENTS, f), 'utf8');
    check(`${f} does not canonicalize seeds (no cross-feature unification)`,
      !src.includes('canonicalSeedKey') && !src.includes('canonicalBackupSeed'));
  }

  // ===== 3. 設定フレーズ（BIP39）の往復 =====
  async function setup(seed, kind = 'settings') {
    $('input-seed-number').value = seed;
    w.updateMainMatrix(seed);
    $('chk-include-card-seed').checked = true;
    $('sim-site').value = 'example.com';
    $('sim-secret').value = '<MASKED_SECRET_001>';
    $('rc-sym-list').value = '-_!#';
    $('backup-kind').value = kind;
  }
  async function genWords() {
    await w.generateAndRenderSeedPhrase();
    return w.eval('currentMnemonicWords.slice()');
  }
  async function restore(words) {
    $('input-seed-number').value = '999';
    $('input-restore-seed').value = words.join(' ');
    await w.restoreRecipeFromSeedInput();
    return { input: $('input-seed-number').value, ok: $('restore-status').textContent.includes('✅'), status: $('restore-status').textContent };
  }
  const phraseCases = [
    ['007', 48], ['7', 24], ['0007', 48], ['0', 24], ['000', 48],
    ['123456789012', 48], ['+7', 48], ['424242', 24],
  ];
  for (const [seed, wordCount] of phraseCases) {
    await setup(seed);
    const words = await genWords();
    eq(`[${seed}] phrase is ${wordCount} words`, words.length, wordCount);
    const dec = await P.decodeBip39Blocks(words, '', true, null);
    if (wordCount === 48) eq(`[${seed}] decoded seedText is exact`, dec.seedText, seed);
    else eq(`[${seed}] decoded has no seedText`, dec.seedText, undefined);
    eq(`[${seed}] decoded seedNumber is the numeric value`, dec.seedNumber, w.parseSeedValue(seed) >>> 0);
    const r = await restore(words);
    check(`[${seed}] restore reports success`, r.ok, r.status);
    eq(`[${seed}] restored input is the original text`, r.input, seed);
  }
  // 盤面は従来どおり数値シードで決まる（"007" と "7" は同じ盤面）
  await setup('007');
  const board007 = w.eval('JSON.stringify(currentMatrixData)');
  w.updateMainMatrix('7');
  eq('board for 007 equals board for 7', w.eval('JSON.stringify(currentMatrixData)'), board007);
  // 48単語の前半24単語だけでは復元できない（ブロック不足はエラーにする）
  {
    await setup('007');
    const words = await genWords();
    const r = await restore(words.slice(0, 24));
    check('truncated 48-word phrase (24 only) is rejected', !r.ok, r.status);
  }
  // 旧形式（原文を持たない24単語）の復元は従来どおり成功し、数値表記になる。
  // 旧形式で "007" を保存したものは、旧コードが "7" と同じコアを作っていたため
  // この形と等価であり、原文の先頭ゼロは回復できない（仕様上の制限）。
  {
    await setup('7');
    const core = w.eval("(function(){return packRecipeTo256Bit(getRecipeConfig(), true, '7');})()");
    const words = await P.entropyToBip39Words(core);
    eq('legacy-form phrase is 24 words', words.length, 24);
    const r = await restore(words);
    check('legacy-form restore succeeds (not treated as corrupt)', r.ok, r.status);
    eq('legacy-form restores the numeric notation', r.input, '7');
  }
  // 拡張バックアップ（full）でも原文が往復する
  {
    await setup('007', 'full');
    const words = await genWords();
    check('full backup produced blocks', words.length > 24 && words.length % 24 === 0, 'words=' + words.length);
    const r = await restore(words);
    check('full backup restore reports success', r.ok, r.status);
    eq('full backup restores the original text', r.input, '007');
  }

  // ===== 4. 暗号化バックアップ =====
  async function createEnc(seed, opts = {}) {
    $('input-seed-number').value = seed;
    w.updateMainMatrix(seed);
    $('sim-site').value = 'example.com';
    $('sim-secret').value = '<MASKED_SECRET_001>';
    return P.createEncryptedBip39Backup(true, PW, 0, Object.assign({ usePassword: true }, opts));
  }
  {
    const words = (await createEnc('007')).groups.flat();
    const d1 = await P.decodeExtendedBip39(words, PW, { seedNum: '007' });
    eq('[enc 007] seedText restored', d1.seedText, '007');
    eq('[enc 007] seedNumber is numeric', d1.seedNumber, 7);
    eq('[enc 007] site restored', d1.site, 'example.com');
    // Backup の鍵は正規化仕様のまま: "7" でも開ける（"007" と "7" は同じ鍵）
    const d2 = await P.decodeExtendedBip39(words, PW, { seedNum: '7' });
    eq('[enc 007] opens with canonical seed 7 and returns the original text', d2.seedText, '007');
    await rejects('[enc 007] wrong password rejected', P.decodeExtendedBip39(words, 'wrong-password-zz', { seedNum: '007' }));
    await rejects('[enc 007] wrong seed rejected', P.decodeExtendedBip39(words, PW, { seedNum: '111111' }));
  }
  {
    const words = (await createEnc('7')).groups.flat();
    const d = await P.decodeExtendedBip39(words, PW, { seedNum: '7' });
    eq('[enc 7] no seedText carried', d.seedText, undefined);
    eq('[enc 7] seedNumber restored', d.seedNumber, 7);
  }

  // ===== 4b. ファイル／QR取り込み（ingest）経由の48単語 =====
  {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function waitFor(fn, label, timeout = 10000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { if (fn()) return; await sleep(100); }
      throw new Error('timeout: ' + label);
    }
    async function importTxt(text) {
      const file = { name: 'backup.txt', type: 'text/plain', text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
      w.document.dispatchEvent(new w.CustomEvent('cm-route-backup-files', { detail: { files: [file] } }));
      await sleep(300);
    }
    await setup('007');
    const words = await genWords();
    $('input-seed-number').value = '999'; w.updateMainMatrix('999');
    await importTxt(words.join(' '));
    await waitFor(() => $('bq-import').value.trim().split(/\s+/).filter(Boolean).length === 48, 'ingest 48');
    check('ingest takes the 48-word phrase as one backup', $('bq-scan-status').textContent.includes('48単語'), $('bq-scan-status').textContent);
    $('bq-review').click();
    await waitFor(() => !$('bq-preview').hidden, 'preview');
    check('ingest preview shows the original text 007', $('bq-preview').textContent.includes('カード配列シード番号：007'));
    check('ingest preview enables apply', !$('bq-apply').disabled);
    $('bq-apply').click();
    await waitFor(() => $('input-seed-number').value === '007', 'apply 007');
    check('ingest apply restores the original text 007', true);
    // 無関係な2コアの48単語は混在エラーで取り込まない
    await setup('424242'); const coreA = await genWords();
    await setup('555555'); const coreB = await genWords();
    $('bq-import').value = '';
    await importTxt([...coreA, ...coreB].join(' '));
    await sleep(500);
    check('ingest rejects two unrelated cores as mixed', $('bq-scan-status').textContent.includes('混在'), $('bq-scan-status').textContent);
    check('ingest imports nothing when mixed', $('bq-import').value.trim() === '');
    // 別バックアップのシードブロックは対応付け不一致で拒否
    await setup('008'); const other = await genWords();
    $('bq-import').value = '';
    await importTxt([...words.slice(0, 24), ...other.slice(24)].join(' '));
    await sleep(500);
    check('ingest rejects a seed block from another backup', $('bq-scan-status').textContent.includes('対応しません'), $('bq-scan-status').textContent);
    // 従来の24単語はそのまま取り込める
    $('bq-import').value = '';
    await importTxt(coreA.join(' '));
    await waitFor(() => $('bq-import').value.trim().split(/\s+/).length === 24, 'ingest 24');
    check('ingest still takes a plain 24-word phrase', $('bq-scan-status').textContent.includes('24単語'), $('bq-scan-status').textContent);
  }

  // ===== 5. Shamir（秘密分散） =====
  {
    const res = await createEnc('007', { shamirM: 2, shamirN: 3 });
    eq('[shamir] three shares issued', res.shares.length, 3);
    const two = [...res.shares[0].groups.flat(), ...res.shares[2].groups.flat()];
    const d = await P.decodeExtendedBip39(two, PW, { seedNum: '007' });
    eq('[shamir] 2-of-3 restore returns the original text', d.seedText, '007');
    eq('[shamir] used shares recorded', (d.shamir && d.shamir.usedShares || []).join(','), '1,3');
    await rejects('[shamir] a single share is not enough', P.decodeExtendedBip39(res.shares[0].groups.flat(), PW, { seedNum: '007' }));
  }

  // ===== 6. TimeSecret / Vault ドメインのアプリ束縛（原文厳密） =====
  for (const domain of ['TimeSecret', 'Vault']) {
    const plain = new TextEncoder().encode('seed-domain-probe');
    const packed = await P.packAppBound(domain, plain, '007');
    const opened = await P.unpackAppBound(domain, packed, '007');
    check(`[${domain}] opens with the original seed text`, Buffer.from(opened).equals(Buffer.from(plain)));
    await rejects(`[${domain}] does NOT open with 7 (007 and 7 are different keys)`, P.unpackAppBound(domain, packed, '7'));
  }

  // ===== 7. Seed Vault（原文保存） =====
  {
    const { JSDOM } = require('jsdom');
    const { IDBFactory } = require('fake-indexeddb');
    const src = fs.readFileSync(path.join(CONTENTS, 'seed-vault.js'), 'utf8');
    function makeVault(storage, idb) {
      const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://cryptomatrix.test/', runScripts: 'outside-only',
        beforeParse(win) {
          Object.defineProperty(win, 'localStorage', { configurable: true, value: {
            getItem: k => storage.has(k) ? storage.get(k) : null,
            setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k),
          }});
          win.indexedDB = idb;
          Object.defineProperty(win, 'crypto', { configurable: true, value: require('node:crypto').webcrypto });
        },
      });
      dom.window.eval(src);
      return dom;
    }
    const storage = new Map();
    const idb = new IDBFactory();
    const first = makeVault(storage, idb);
    await first.window.CMSeedVault.saveSeed('007');
    first.window.close();
    const second = makeVault(storage, idb);
    eq('[vault] saved seed reloads as the exact original text', await second.window.CMSeedVault.loadSeed(), '007');
    second.window.close();
    const legacyStorage = new Map([['cm_active_seed', '007']]);
    const migrated = makeVault(legacyStorage, new IDBFactory());
    eq('[vault] legacy plain seed migrates with the exact text', await migrated.window.CMSeedVault.loadSeed(), '007');
    migrated.window.close();
  }

  console.log('---');
  console.log(`numeric-seed-text-backup: pass=${pass} fail=${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('ERROR:', e && e.stack || e);
  process.exitCode = 1;
});
