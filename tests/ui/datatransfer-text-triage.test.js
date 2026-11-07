const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;
const sec = doc.getElementById('tab-datatransfer');
if (!sec) { console.error('FAIL: tab-datatransfer not found'); process.exit(1); }
const secText = sec.textContent;
const helps = [...sec.querySelectorAll('.help-btn')].map(b => b.dataset.help || '');
const lead = sec.querySelector('.dt-lead');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// リード: 技術名は常時表示から消え、仕様（完全オフライン）は残る
check('lead shortened spec kept', lead && lead.textContent.includes('QRコードだけでファイル・テキストを転送します（完全オフライン）'));
check('tech terms not always-on', !secText.includes('Systematic LT Fountain'));
check('tech detail moved to title help', helps.some(h => h.includes('Systematic LT Fountain') && h.includes('CRC32')));

// 操作に必要な説明は維持
check('tx status instruction kept', (doc.getElementById('dt-tx-status') || {}).textContent?.includes('「QRコードを準備」を押してください') === true);
check('text fallback hint kept', (doc.getElementById('dt-tx-text-meta') || {}).textContent?.includes('message.txt として送信されます') === true);
check('readability hint kept', secText.includes('読み取りづらい場合は 6〜10 枚/秒 に下げて'));
check('blockmap usage kept', secText.includes('送信ブロックマップ（任意のブロックをタップすると'));
check('rx status instruction kept', (doc.getElementById('dt-rx-status') || {}).textContent?.includes('送信側でQRコードの連続表示を開始してください') === true);
check('file size label kept', secText.includes('最大64 MiB'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
