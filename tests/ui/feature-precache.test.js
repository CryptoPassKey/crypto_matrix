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

// 配置の確定事項（2026-11-11 フィードバック反映）
check('quick card has no always-on feature img',
  !html.slice(html.indexOf('id="card-quick"'), html.indexOf('id="cq-collapsible-body"')).includes('feature-'));
check('guide hero keeps password-gen img',
  html.slice(html.indexOf('cm-guide-hero'), html.indexOf('cm-guide-hero') + 200).includes('feature-password-gen.webp'));
check('bip39 section head has no feature img',
  !html.slice(html.indexOf('id="section-bip39-plain"'), html.indexOf('id="section-bip39-plain"') + 600).includes('feature-bip39'));
const qrSideStart = html.indexOf('cm-qr-side-row');
const qrSideEnd = html.indexOf('id="seed-qr-list"', qrSideStart);
const seedQrId = 'id="seed-qr-list"';
const qrSideMarkup = qrSideStart >= 0 && qrSideEnd >= 0 ? html.slice(qrSideStart, qrSideEnd + seedQrId.length) : '';
check('bip39 img sits in QR side row beside seed-qr-list',
  qrSideMarkup.includes('feature-bip39.webp') && qrSideMarkup.indexOf('feature-bip39.webp') < qrSideMarkup.indexOf('id="seed-qr-list"'));
check('encrypted backup output label element exists',
  html.includes('id="bq-output-format-label"'));
check('encrypted backup output label updater is called by renderer',
  backupQr.includes('setBackupOutputFormatLabel(isArmored)'));
check('encrypted backup output label updater writes the selected format',
  backupQr.includes('function setBackupOutputFormatLabel(isArmored)') &&
  backupQr.includes("outputFormatLabel.textContent=(isArmored?'PGPアーマード形式':'BIP39 24単語ブロック形式')"));
const themeCss = fs.readFileSync(path.join(ROOT, 'contents', 'theme-cyber.css'), 'utf8');
const bqSideStart = html.indexOf('cm-qr-side-row', qrSideStart + 1);
check('backup img sits in QR side row beside bq-qr-list',
  bqSideStart > qrSideStart && html.indexOf('feature-backup.webp', bqSideStart) > bqSideStart && html.indexOf('feature-backup.webp', bqSideStart) < html.indexOf('id="bq-qr-list"'));
check('encrypt panel head has no feature img',
  !html.slice(html.indexOf('id="bq-panel-encrypt"'), html.indexOf('id="bq-panel-encrypt"') + 400).includes('feature-'));
check('side img size is 180px for QR balance', themeCss.includes('.cm-qr-side img { width: 180px; height: 180px;'));
check('theme has cm-qr-side-row layout', themeCss.includes('.cm-qr-side-row') && themeCss.includes('.cm-qr-side img'));
check('app.js wires guide header click', appJs.includes("querySelector('.verbal-guide-header')") && appJs.includes("closest('#btn-guide-toggle')"));

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
