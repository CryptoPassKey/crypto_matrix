const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;
const sec = doc.getElementById('card-quick');
if (!sec) { console.error('FAIL: card-quick not found'); process.exit(1); }
const secText = sec.textContent;
const helps = [...sec.querySelectorAll('.help-btn')].map(b => b.dataset.help || '');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// 冒頭説明は短縮され、完全再現の表現が消えた
check('intro shortened', secText.includes('カード単体でも手作業で再現できます'));
check('complete-reproduction claim removed', !secText.includes('完全再現できる'));

// ヘルプの誇張表現が是正された
check('strength hype removed (symbol help)', !helps.some(h => h.includes('非常に強いパスワード')));
check('strength hype removed (length help)', !helps.some(h => h.includes('飛躍的に高まります')));
check('length help still guides 16+', helps.some(h => h.includes('16文字以上に設定すると、総当たり解析への耐性が高まります')));

// 生成条件・安全性に関わる表示は維持
// 運用中の記号設定を変更しない旨の注意は現行UI（2026-11-11統合）で削除され、入力形式のヒントのみが残る
check('symbol rule input hint kept', (doc.getElementById('cq-symbol-help') || {}).textContent?.includes('区切りなしで入力') === true);
check('generation-stop warning kept', secText.includes('安全のため生成を停止します'));
check('secret management caution kept', secText.includes('合言葉や設定はカードとは別の場所で管理してください'));
check('reading rules still in details', secText.includes('英字A〜Zは小文字として中央のマスを探す'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
