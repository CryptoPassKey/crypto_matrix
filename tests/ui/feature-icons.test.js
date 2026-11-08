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

// SW プリキャッシュと実ファイルの存在（アップロード漏れ検出）
for (const f of ['shamir-icon.png', 'test-icon.png', 'passkey-icon.png']) {
  check('sw precaches ' + f, sw.includes('"' + f + '"'));
  check('file exists contents/' + f, fs.existsSync(path.join(ROOT, 'contents', f)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
