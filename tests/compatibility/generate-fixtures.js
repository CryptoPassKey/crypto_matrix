'use strict';
/**
* 互換性フィクスチャの生成スクリプト（手動実行専用・CIでは実行しない）。
*
* フィクスチャは「既知の良好なリリース」の本番コードで一度だけ生成し、
* 以後は変更しないことが前提です。フィクスチャを安易に再生成すると、
* 互換性が壊れた変更に合わせて期待値も書き換わってしまい、回帰検査の意味が
* 失われます。再生成が必要な場合は、生成に使うコードの版と理由を
* tests/compatibility/README.md に記録してください。
*
* 使い方: node tests/compatibility/generate-fixtures.js
* 現在の contents/ を読み込み、fixtures.json を上書きします。
*
* フィクスチャに使う認証情報・合言葉・キーファイルはすべてテスト専用の
* ダミー値です。実在のユーザー資産は一切含まれません。
*/
const fs = require('fs');
const path = require('path');
const { loadApp} = require('./load-app');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const OUT = path.join(__dirname, 'fixtures.json');
const PW = 'compat-test-pw-01';
const DURESS_PW = 'compat-duress-pw-01';
const SITE = 'example.com';
const SECRET = '<MASKED_SECRET_001>';
const KEYFILE_TEXT = 'compat-test-keyfile-contents';

const b64 = u8 => Buffer.from(u8).toString('base64');
const creds = extra => Object.assign({ usePassword: true, useKeyfile: false, usePasskey: false}, extra || {});

(async () => {
const win = await loadApp(CONTENTS);
const M = win.MatrixCardPreset;
const enc = new win.TextEncoder();
const fixtures = [];

// CMV1（無暗号のパック形式）
const payload = enc.encode('compat-fixture-payload');
const packed = win.packCMV1('text', 'fixture.txt', payload);
fixtures.push({
id: 'cmv1-text',
kind: 'cmv1',
packedB64: b64(packed),
expect: { type: 'text', name: 'fixture.txt', payload: 'compat-fixture-payload'},
});

// CME3 本文（KDFプロファイル 0/1/2 = PBKDF2系、3 = Argon2id）
for (const prof of [0, 1, 2, 3]) {
const body = await M.encryptBodyCME2(packed, PW, prof, creds());
fixtures.push({
id: `cme3-profile-${prof}`,
kind: 'cme',
bodyB64: b64(body),
pw: PW,
plainB64: b64(packed),
});
}

// CME3（パスワード＋キーファイル）
const keyfileBytes = enc.encode(KEYFILE_TEXT);
{
const body = await M.encryptBodyCME2(packed, PW, 1, creds({ useKeyfile: true, keyfileBytes}));
fixtures.push({
id: 'cme3-keyfile',
kind: 'cme',
bodyB64: b64(body),
pw: PW,
keyfileText: KEYFILE_TEXT,
plainB64: b64(packed),
});
}

// CME3 おとり二重暗号（本命／おとりで別々に開く）
{
const decoyPacked = win.packCMV1('text', 'decoy.txt', enc.encode('compat-decoy-payload'));
const body = await M.encryptDuressDualCME(packed, PW, decoyPacked, DURESS_PW, 1, creds());
fixtures.push({
id: 'cme3-duress-dual',
kind: 'cme-duress',
bodyB64: b64(body),
realPw: PW,
realPlainB64: b64(packed),
duressPw: DURESS_PW,
duressPlainB64: b64(decoyPacked),
});
}

// BIP39 拡張バックアップ（サイト名・合言葉入り、プロファイル1）
win.document.getElementById('sim-site').value = SITE;
win.document.getElementById('sim-secret').value = SECRET;
{
const res = await M.createEncryptedBip39Backup(true, PW, 1, { usePassword: true});
fixtures.push({
id: 'bip39-extended-p1',
kind: 'bip39-extended',
words: res.groups.flat(),
pw: PW,
expect: { site: SITE, secret: SECRET, full: true},
});
}

// BIP39 設定のみバックアップ（プロファイル1）
{
const res = await M.createEncryptedBip39Backup(false, PW, 1, { usePassword: true});
fixtures.push({
id: 'bip39-config-p1',
kind: 'bip39-config',
words: res.groups.flat(),
pw: PW,
expect: { full: false},
});
}

// BIP39 Shamir 2-of-3（シェア1と3で復元）
{
const res = await M.createEncryptedBip39Backup(true, PW, 1, {
usePassword: true,
shamirM: 2,
shamirN: 3,
});
fixtures.push({
id: 'bip39-shamir-2of3',
kind: 'bip39-extended',
words: [res.shares[0], res.shares[2]].flatMap(s => s.groups.flat()),
pw: PW,
expect: { site: SITE, secret: SECRET},
});
}

fs.writeFileSync(OUT, JSON.stringify({ fixtures}, null, 1) + '\n');
console.log(`fixtures.json を書き出しました（${fixtures.length} 件）: ${fixtures.map(f => f.id).join(', ')}`);
console.log('自己確認は compat-audit.js を続けて実行してください。');
process.exit(0);
})().catch(e => {
console.error('生成に失敗しました:', e);
process.exit(1);
});
