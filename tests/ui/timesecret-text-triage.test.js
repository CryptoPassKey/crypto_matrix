const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;
const sec = doc.getElementById('tab-timesecret');
if (!sec) { console.error('FAIL: tab-timesecret not found'); process.exit(1); }
const secText = sec.textContent;
const lead = sec.querySelector('.ts-lead');
const modal = doc.getElementById('ts-help-modal');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// リード文は1行に短縮され、詳細は常時表示から消えた
check('lead shortened to one line', lead && lead.textContent.replace(/\s+/g, '').length <= 40);
check('policy detail not in lead', !lead.textContent.includes('3つの認証ポリシー'));
check('title help still explains concept', (doc.getElementById('btn-ts-help')?.dataset.help || '').includes('3系統独立認証に対応'));

// 解説モーダル（「？」先）の表現是正
check('modal absolute wording removed', modal && !modal.textContent.includes('安全に復号不能化されます'));
check('modal crypto claim softened', modal && !modal.textContent.includes('暗号論的にできません'));
check('modal still explains expiry deletion', modal && modal.textContent.includes('復号不能化されます'));

// 削除・喪失に関する警告は常時表示のまま
check('device key loss consent kept', secText.includes('デバイス鍵を失った場合は復号不能になること'));
check('device key loss warning kept', secText.includes('デバイス鍵を失うと、パスワード・キーファイル・パスキーが残っていても復号できません'));
check('physical storage limitation kept', secText.includes('全データ完全消去を保証するものではありません'));
check('clock anomaly box kept', secText.includes('端末時計の巻き戻し（5分以上の逆行）を検知したため'));
check('deletion verified box kept', secText.includes('期限切れ金庫のチェックイン復活はできません'));
check('test duration warning kept', secText.includes('期限切れ処理の動作テスト専用です'));
check('seed linkage notes kept', secText.includes('現在のカード配列シード番号（seed）と連動して暗号鍵が導出されます') && secText.includes('作成時と同じカードシード番号（デフォルト: 0）と一致する場合のみ復号されます'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
