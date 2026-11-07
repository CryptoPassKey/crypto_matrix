const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/' });
const doc = dom.window.document;
const sec = doc.getElementById('backup-qr');
if (!sec) { console.error('FAIL: backup-qr not found'); process.exit(1); }
const secText = sec.textContent;
const helps = [...sec.querySelectorAll('.help-btn')].map(b => b.dataset.help || '');

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) pass++; else fail++;
}

// 冒頭説明はタイトル「？」へ集約され、常時表示から消えた
check('intro paragraph removed', !secText.includes('暗号化なしの24単語・拡張バックアップとQRコードは'));
check('intro content in title help', helps.some(h => h.includes('秘密分散（M-of-N）を自由に組み合わせて暗号化し')));
check('single-protection note in title help', helps.some(h => h.includes('保護は単独でも作成できます')));

// パスキー: 対応認証器リストは「？」へ、PRF警告は常時表示のまま
check('authenticator list not always-on', !secText.includes('【動作対応認証器】'));
check('authenticator list in passkey help', helps.some(h => h.includes('【動作対応認証器】') && h.includes('YubiKey 5シリーズ')));
check('PRF warning kept visible', secText.includes('WebAuthn PRFに対応している必要があります'));
check('YubiKey iPhone caution kept', secText.includes('iPhoneで外付けYubiKeyを使用する場合'));

// 中核の警告は維持
check('key loss warning kept', secText.includes('紛失・削除すると復元できなくなるため'));
check('seed linkage note kept', secText.includes('現在のカード配列シード番号（seed）と連動して暗号鍵が導出されます'));
check('seed match note (restore) kept', secText.includes('作成時と同じカードシード番号（デフォルト: 0）と一致する場合のみ復号されます'));

// 保存形式ガイド: 短縮され「100%」表現がこのエリアから消えた
check('save format line shortened', secText.includes('保存する形式は1つで大丈夫です'));
check('no 100% claim in this section', !secText.includes('100%復元可能') && !helps.some(h => h.includes('100%復元可能')));

// 復号パネル: 冒頭は1行化、末尾は安全指示のみ
check('decrypt intro shortened', secText.includes('統合QRコードの読み取り、または24単語フレーズの貼り付けで復元します'));
check('mechanism sentence removed', !secText.includes('復元処理は自動実行されず'));
check('restore-test instruction kept', secText.includes('印刷後は必ず復元テストを実施してから元データを破棄してください'));

// 見出しを含む全ヘルプ文も検査対象: 復元可能性の絶対保証表現がないこと
const guaranteePattern = /100%|絶対に解読|完全復元|完全に復元/;
check('no absolute guarantee in any help text', !helps.some(h => guaranteePattern.test(h)));
check('no absolute guarantee in visible text', !guaranteePattern.test(secText));
check('decrypt heading help fixed', helps.some(h => h.includes('作成時と同じ設定を復元できます')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
