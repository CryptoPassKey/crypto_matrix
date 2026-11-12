const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'contents', 'sw.js'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// 秘密分散ラベル3箇所（bq / bv / tl）に shamir-icon
for (const id of ['bq-shamir', 'bv-shamir', 'tl-shamir']) {
  const label = doc.querySelector('label[for="' + id + '"]');
  check(id + ' label exists', !!label);
  const img = label && label.querySelector('img[src="shamir-icon.png"]');
  check(id + ' label has shamir icon', !!img);
}
check('no puzzle emoji left in index.html', !html.includes('🧩'));

// パスキー: 👤 を全箇所 passkey-icon へ（静的HTML分）
const pkImgs = doc.querySelectorAll('img[src="passkey-icon.png"]');
check('passkey icons present (>=15, got ' + pkImgs.length + ')', pkImgs.length >= 15);
check('no person emoji left in index.html', !html.includes('👤'));
const tsBtn = doc.getElementById('btn-ts-ci-reg-passkey');
check('ts passkey button has passkey icon', !!tsBtn && !!tsBtn.querySelector('img[src="passkey-icon.png"]'));

// 復元テストボタン: インラインSVGから test-icon へ
const testBtn = doc.getElementById('bq-test-restore');
check('restore test button exists', !!testBtn);
check('restore test button has test icon', !!testBtn && !!testBtn.querySelector('img[src="test-icon.png"]'));
check('restore test button svg removed', !!testBtn && !testBtn.querySelector('svg'));

// 暗号化・復号ボタンは南京錠アイコンのペア（施錠=lock-icon / 開錠=unlock-icon）で統一
const tsJs = fs.readFileSync(path.join(ROOT, 'contents', 'timesecret.js'), 'utf8');
const lockBtns = ['bq-create', 'bv-btn-encrypt', 'tl-btn-encrypt', 'tl-tab-btn-encrypt', 'btn-ts-create-seal'];
const unlockBtns = ['bq-apply', 'bv-btn-decrypt', 'tl-btn-decrypt', 'tl-tab-btn-decrypt', 'btn-ts-unlock-exec'];
for (const id of lockBtns) {
  const b = doc.getElementById(id);
  check(id + ' has lock icon', !!b && !!b.querySelector('img[src="lock-icon.png"]'));
}
for (const id of unlockBtns) {
  const b = doc.getElementById(id);
  check(id + ' has unlock icon', !!b && !!b.querySelector('img[src="unlock-icon.png"]'));
}
// サブタブはインラインSVGを廃して画像ペアへ
check('tl-tab-btn-encrypt svg removed', !doc.getElementById('tl-tab-btn-encrypt').querySelector('svg'));
check('tl-tab-btn-decrypt svg removed', !doc.getElementById('tl-tab-btn-decrypt').querySelector('svg'));
// TimeSecret復号ボタン: ラベルはspanで、JSはボタン本体ではなくspanを書き換える（画像を消さないため）
const unlockExec = doc.getElementById('btn-ts-unlock-exec');
check('unlock exec label span exists', !!unlockExec && !!unlockExec.querySelector('#ts-unlock-exec-label'));
check('timesecret.js updates label span', tsJs.includes("$('ts-unlock-exec-label')"));
check('timesecret.js does not overwrite unlock button text', !tsJs.includes("$('btn-ts-unlock-exec').textContent"));
// 単独復元ツール: 復号ボタンにも開錠アイコン（同ページCSSに .cm-btn-img が必要）
const recHtml = fs.readFileSync(path.join(ROOT, 'contents', 'timelock-recover.html'), 'utf8');
const recCss = fs.readFileSync(path.join(ROOT, 'contents', 'timelock-recover.css'), 'utf8');
const recDom = new JSDOM(recHtml, { url: 'https://localhost/' });
const recBtn = recDom.window.document.getElementById('rec-btn-decrypt');
check('recover decrypt button has unlock icon', !!recBtn && !!recBtn.querySelector('img[src="unlock-icon.png"]'));
check('recover css defines cm-btn-img', recCss.includes('.cm-btn-img'));

// SW プリキャッシュと実ファイルの存在（アップロード漏れ検出）
for (const f of ['shamir-icon.png', 'test-icon.png', 'passkey-icon.png', 'lock-icon.png', 'unlock-icon.png']) {
  check('sw precaches ' + f, sw.includes('"' + f + '"'));
  check('file exists contents/' + f, fs.existsSync(path.join(ROOT, 'contents', f)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
