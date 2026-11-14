'use strict';
/*
* かんたんモード表示（cq-status）の「カード番号：」表記の回帰テスト。
*
* 背景: この表示は数値化した appliedSeed（parseSeedValue の戻り値）を出して
* いたため、英数字シードでは FNV-1a ハッシュの数字（例: MySeed2026 →
* 2192372244）がカード番号として表示されていた。盤面生成に使ったシード
* 文字列そのものが表示されなければ、利用者がその数字を控えて入力し直した
* ときに別の盤面になってしまう。
*
* 期待動作:
* - 英数字シード: 入力した文字列がそのまま表示される（ハッシュ値は出ない）
* - 数字シード: 従来どおり数値表記（"007" は "7" と表示され、従来と変わらない）
* 検証は実際のUI操作（「このモードを使う」ボタンのクリック）で行う。
*/
const fs = require('fs');
const path = require('path');
const { loadApp} = require(path.join(__dirname, '..', 'compatibility', 'load-app.js'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const indexJs = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
console.log((ok? 'PASS': 'FAIL') + ': ' + name + (ok? '': (detail? ' => ' + detail: '')));
if (ok) pass++; else fail++;
}

(async () => {
// ===== 静的ガード（対象が存在することの確認） =====
check('status template no longer prints the numeric appliedSeed',
!indexJs.includes('カード番号：${appliedSeed} ／'));
check('wrapper records the applied seed label',
indexJs.includes('appliedSeedText=seedLabelOf(seed)'));
check('status template prints the applied seed label',
indexJs.includes('カード番号：${appliedSeedText} ／'));

const w = await loadApp(CONTENTS);
const $ = id => w.document.getElementById(id);
check('cq-status exists',!!$('cq-status'));
check('cq-symbol-apply exists',!!$('cq-symbol-apply'));
check('cq-pin-apply exists',!!$('cq-pin-apply'));
check('updateMainMatrix is available', typeof w.updateMainMatrix === 'function');

function applyQuick(seed, mode) {
$('input-seed-number').value = seed;
$('sim-site').value = 'rakuten.co.jp';
$('sim-secret').value = 'keepass';
if (mode === 'symbol') {
$('cq-symbol-length').value = '24';
$('cq-symbol-apply').click();
} else {
$('cq-pin-length').value = '6';
$('cq-pin-apply').click();
}
return $('cq-status').textContent || '';
}

// ===== 英数字シード（パスワードモード）: 文字列がそのまま出る =====
const s1 = applyQuick('MySeed2026', 'symbol');
check('[letter] status shows the seed text', s1.includes('カード番号：MySeed2026 ／'), s1.split('\n')[1] || s1);
check('[letter] status does not show the FNV-1a hash',!s1.includes('2192372244'), s1.split('\n')[1] || s1);
check('[letter] status keeps the search text line', s1.includes('探索文字：rakuten.co.jp ＋ keepass（交互）'));
check('[letter] status keeps the output line', s1.includes('出力：24文字'));

// ===== 数字シード（パスワードモード）: 従来どおり =====
const s2 = applyQuick('424242', 'symbol');
check('[numeric] status shows the number', s2.includes('カード番号：424242 ／'), s2.split('\n')[1] || s2);

// ===== 数字シードのゼロ埋め（暗証番号モード）: 従来どおり数値表記 =====
const s3 = applyQuick('007', 'pin');
check('[007] status shows the numeric value', s3.includes('カード番号：7 ／'), s3.split('\n')[1] || s3);
check('[007] status does not show the raw zero-padded text',!s3.includes('カード番号：007'), s3.split('\n')[1] || s3);

// ===== 英数字シード（暗証番号モード）: こちらでも文字列が出る =====
const s4 = applyQuick('MySeed2026', 'pin');
check('[letter/pin] status shows the seed text', s4.includes('カード番号：MySeed2026 ／'), s4.split('\n')[1] || s4);
check('[letter/pin] status does not show the FNV-1a hash',!s4.includes('2192372244'), s4.split('\n')[1] || s4);

// ===== 適用後に入力欄だけ変更: 表示は適用済みシードのまま（入力欄の値ではない） =====
applyQuick('MySeed2026', 'symbol');
$('input-seed-number').value = 'OtherSeed999';
w.updateSimulationUI();
const s5 = $('cq-status').textContent || '';
check('[input-only] status still shows the applied seed', s5.includes('カード番号：MySeed2026 ／'), s5.split('\n')[1] || s5);
check('[input-only] status does not show the unapplied input', !s5.includes('OtherSeed999'), s5.split('\n')[1] || s5);

// ===== 復元相当の再適用（再読み込み時の復元もこの経路を通る）: 表示が追随する =====
$('input-seed-number').value = '777';
w.updateMainMatrix('777');
w.updateSimulationUI();
const s6 = $('cq-status').textContent || '';
check('[reapply] status follows the reapplied numeric seed', s6.includes('カード番号：777 ／'), s6.split('\n')[1] || s6);
$('input-seed-number').value = 'MySeed2026';
w.updateMainMatrix('MySeed2026');
w.updateSimulationUI();
const s7 = $('cq-status').textContent || '';
check('[reapply] status follows the reapplied letter seed', s7.includes('カード番号：MySeed2026 ／'), s7.split('\n')[1] || s7);
check('[reapply] status does not show the FNV-1a hash', !s7.includes('2192372244'), s7.split('\n')[1] || s7);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail? 1: 0);
})().catch(e => { console.error('ERROR', e); process.exit(1);});
