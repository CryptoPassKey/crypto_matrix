const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'contents', 'sw.js'), 'utf8');
const backupQr = fs.readFileSync(path.join(ROOT, 'contents', 'backup-qr.js'), 'utf8');
const timesecret = fs.readFileSync(path.join(ROOT, 'contents', 'timesecret.js'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'contents', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// 機能イラスト10点: 実ファイルの存在と SW プリキャッシュ登録
const EXPECTED = [
  'feature-backup.webp',
  'feature-bip39.webp',
  'feature-erase.webp',
  'feature-keepass.webp',
  'feature-keyfile.webp',
  'feature-passkey.webp',
  'feature-password-gen.webp',
  'feature-shamir.webp',
  'feature-timesecret.webp',
  'feature-vault.webp',
];
for (const f of EXPECTED) {
  check('file exists contents/' + f, fs.existsSync(path.join(ROOT, 'contents', f)));
  check('sw precaches ' + f, sw.includes('"' + f + '"'));
}

// index.html から参照される feature-*.webp は全てプリキャッシュ済みで実在すること
const refs = new Set();
for (const m of html.matchAll(/(?:src|data-help-img)="(feature-[a-z0-9-]+\.webp)"/g)) refs.add(m[1]);
check('index.html references feature illustrations (>=10 unique, got ' + refs.size + ')', refs.size >= 10);
for (const f of refs) {
  check('referenced ' + f + ' is precached', sw.includes('"' + f + '"'));
  check('referenced ' + f + ' exists', fs.existsSync(path.join(ROOT, 'contents', f)));
}

// ヘルプ画像（data-help-img）は秘密分散／キーファイル／パスキーの3点
for (const f of ['feature-shamir.webp', 'feature-keyfile.webp', 'feature-passkey.webp']) {
  check('data-help-img uses ' + f, html.includes('data-help-img="' + f + '"'));
}

// タイムシークレット削除モーダルのイラストと表示切替
check('ts-modal-delete-img present with feature-erase.webp',
  html.includes('id="ts-modal-delete-img"') && html.includes('src="feature-erase.webp"'));
check('timesecret.js toggles ts-modal-delete-img', timesecret.includes('ts-modal-delete-img'));

// ヘルプポップオーバー: 画像対応・画面内クランプ・読み込み失敗時の処理
check('backup-qr.js renders help-popover-img', backupQr.includes('help-popover-img'));
check('backup-qr.js has positionPopover', backupQr.includes('function positionPopover'));
check('popover clamps top within viewport', backupQr.includes('maxTop') && backupQr.includes('window.innerHeight-popHeight-8'));
check('popover img has onerror fallback', backupQr.includes('helpImg.onerror='));

// 静的イラストの読み込み失敗時フォールバック（app.js）
check('app.js has feature image error fallback', appJs.includes('読み込み失敗時のフォールバック'));
check('app.js sweeps broken images via naturalWidth', appJs.includes('naturalWidth'));

// レビュー指摘: フォールバックは静的イラスト専用（再利用されるポップオーバー画像を除外）
check('app.js fallback excludes help-popover-img',
  appJs.includes("el.id !== 'help-popover-img'") && appJs.includes("!el.classList.contains('help-popover-img')"));
check('backup-qr.js clears inline display when reshowing help img',
  backupQr.includes("helpImg.style.display=''"));

// レビュー指摘: ポップオーバーの高さ制限と内部スクロール
const legacyCss = fs.readFileSync(path.join(ROOT, 'contents', 'legacy.css'), 'utf8');
const popoverRule = (legacyCss.match(/\.help-popover \{[^}]*\}/) || [''])[0];
check('help-popover rule found in legacy.css', popoverRule.length > 0);
check('help-popover has max-height', popoverRule.includes('max-height'));
check('help-popover has overflow-y auto', popoverRule.includes('overflow-y: auto'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
