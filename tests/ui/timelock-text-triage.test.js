const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;
const sec = doc.getElementById('timelock-section');
if (!sec) { console.error('FAIL: timelock-section not found'); process.exit(1); }
const secText = sec.textContent;
const helps = [...sec.querySelectorAll('.help-btn')].map(b => b.dataset.help || '');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// 削除・移設された常時表示テキスト
check('intro paragraph removed', !secText.includes('数学的に復号不可能なタイムカプセルを作成します'));
check('card A use-case note not always-on', !secText.includes('セルフコントロール用途に最適です'));
check('card B absolute claim removed everywhere', !html.includes('絶対に解読できません'));

// 「？」へ移設された内容
check('card A use-case moved to help', helps.some(h => h.includes('セルフコントロール用途に適しています')));
check('card B leak scenario moved to help', helps.some(h => h.includes('解禁時刻の到来だけでは開封できません')));

// 警告・必要情報は常時表示のまま残る
check('passkey domain warning kept', secText.includes('このドメインでしか開けない可能性があり'));
check('seed match note (create) kept', secText.includes('現在のカード配列シード番号（seed）と連動して暗号鍵が導出されます'));
check('seed match note (restore) kept', secText.includes('作成時と同じカードシード番号'));
check('passkey restore notice kept', (doc.getElementById('tl-restore-pk-notice') || {}).textContent?.includes('WebAuthn PRFパスキー保護が含まれています') === true);
check('beacon box verification note kept', secText.includes('取得したJSONはこの端末で署名検証するため'));

// 手動ビーコン欄: 手順は残し、重複する検証説明は削除
check('manual beacon instruction kept', secText.includes('取得URLへアクセスし、取得したJSONを貼り付けてください'));
check('duplicated BLS sentence removed', !secText.includes('偽造署名はすべて拒否します'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
