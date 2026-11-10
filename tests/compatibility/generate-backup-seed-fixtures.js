'use strict';
/**
 * Backup シード正規化テスト用フィクスチャの生成スクリプト（手動実行専用・CIでは実行しない）。
 *
 * 重要: フィクスチャの意味は「修正前の本番コードで生成した実バックアップ」であること。
 * 現在の（修正後の）コードで再生成すると、英数字フィクスチャが正規キー形式に
 * なってしまい、旧形式フォールバックの検証にならない。
 *
 * 再生成が必要な場合は、フィクスチャ内に記録された生成元コミット
 * （generatedFromCommit）の contents/ をチェックアウトしたツリーで実行すること。
 * 生成元の真正性は、テスト側でも暗号学的に検証している（旧キーでのみ開き、
 * 正規キーでは開けないこと）。
 *
 * フィクスチャに使うパスワード・サイト名・合言葉はすべてテスト専用のダミー値。
 *
 * 使い方: node tests/compatibility/generate-backup-seed-fixtures.js
 * 出力: tests/security/backup-seed-canonical.fixtures.json（上書き）
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./load-app');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const OUT = path.join(__dirname, '..', 'security', 'backup-seed-canonical.fixtures.json');
const PW = 'backup-seed-fix-test-pw';

(async () => {
  const w = await loadApp(CONTENTS);
  const $ = id => w.document.getElementById(id);
  const P = w.MatrixCardPreset;
  $('sim-site').value = 'example.com';
  $('sim-secret').value = '<MASKED_SECRET_001>';
  const cases = [];
  for (const [name, seed] of [['legacy-letter', 'MySeed2026'], ['legacy-numeric', '424242']]) {
    $('input-seed-number').value = seed;
    w.updateMainMatrix(seed);
    const res = await P.createEncryptedBip39Backup(true, PW, 0, { usePassword: true });
    cases.push({ name, seed, words: res.groups.flat(), pw: PW, site: 'example.com', secret: '<MASKED_SECRET_001>' });
    console.log('generated', name, res.groups.flat().length, 'words');
  }
  const out = {
    generatedFrom: 'GENERATED FROM THE CURRENT TREE — for genuine pre-fix fixtures, run this script on a checkout of the commit recorded in the committed fixtures file (generatedFromCommit) and keep that provenance text.',
    cases,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log('fixtures written to', OUT);
  process.exit(0);
})().catch(e => { console.error('生成に失敗しました:', e); process.exit(1); });
