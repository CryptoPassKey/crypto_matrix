const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;
const sec = doc.getElementById('bonus-vault');
if (!sec) { console.error('FAIL: bonus-vault not found'); process.exit(1); }
const secText = sec.textContent;
const helps = [...sec.querySelectorAll('.help-btn')].map(b => b.dataset.help || '');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// 冒頭: 技術説明は「？」へ、常時表示は短い仕様表現（外部送信ゼロ）に
check('tech combo not always-on', !secText.includes('PBKDF2-SHA512 ＋ AES-256-GCM ＋ 二段階認証'));
check('short spec line kept', secText.includes('外部送信ゼロ') && secText.includes('暗号化・分割保存・復元できます'));
check('tech detail moved to title help', helps.some(h => h.includes('暗号化には PBKDF2-SHA512 と AES-256-GCM を使用します')));

// 保存形式ガイド: 短縮と絶対・確実表現の是正
check('save format line shortened', secText.includes('保存する形式は1つで大丈夫です'));
check('shamir help fixed', helps.some(h => h.includes('元のデータを復元できない数学的暗号技術（秘密分散）')));

// ヘルプ含め、復元・安全性の絶対保証パターンがないこと
const guaranteePattern = /100%|絶対に復元できない|絶対に解読|完全復元|完全に復元|確実に復元/;
check('no absolute guarantee in any help text', !helps.some(h => guaranteePattern.test(h)));
check('no absolute guarantee in visible text', !guaranteePattern.test(secText));

// 警告・仕様として残すもの
check('file no-upload note kept', (doc.getElementById('bv-file-info') || {}).textContent?.includes('外部サーバーに送信されず') === true);
check('seed linkage note kept', secText.includes('現在のカード配列シード番号（seed）と連動して暗号鍵が導出されます'));
check('seed match note kept', secText.includes('作成時と同じカードシード番号（デフォルト: 0）と一致する場合のみ復号されます'));
check('keyfile loss caution in help kept', helps.some(h => h.includes('ファイルを失うと復元できなくなります')));
check('password loss caution in help kept', helps.some(h => h.includes('このパスワードを忘れると復元できなくなります')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
