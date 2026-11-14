'use strict';
/*
 * モバイル下部 UI の重なり防止の回帰テスト。
 *
 * 構造: 画面下部に固定タブ（.cm-mobile-dock、z-index 95）があり、その上に
 * パスワード表示バー（#sticky-pw-bar、z-index 90）が浮く。ドックは
 * Safe Area（env(safe-area-inset-bottom)）分だけ高くなるため、バーの下端も
 * 同じ inset を加えて持ち上げないと、ホームインジケーターのある iPhone で
 * バーの下部（操作ボタン列）がドックの裏に隠れてタップできなくなる。
 *
 * このテストは CSS の実値を読んで次を検証する:
 * - バーの bottom が「46px + inset」で、ドック高（44px + inset）より常に上にある
 * - body の下部余白がドック高以上を確保し、inset 分も加算される
 * - バー自身の内側パディングには inset を足さない（ドック側が Safe Area を担う）
 */
const fs = require('fs');
const path = require('path');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? ':: ' + extra : ''); }
}
function eq(name, actual, expected) { check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

const appCss = fs.readFileSync(path.join(CONTENTS, 'app.css'), 'utf8');
const themeCss = fs.readFileSync(path.join(CONTENTS, 'theme-cyber.css'), 'utf8');

// app.css のモバイルドック節（@media max-width:1024px）を切り出す
const dockStart = appCss.indexOf('/* Mobile Bottom Fixed Quick Dock */');
const dockEnd = appCss.indexOf('.cm-mob-chip.is-active', dockStart);
check('mobile dock section found in app.css', dockStart >= 0 && dockEnd > dockStart);
const dockSection = appCss.slice(dockStart, dockEnd).replace(/\/\*[\s\S]*?\*\//g, '');

// ドック: 下パディングに Safe Area を含む（既存仕様）
const dockRule = (dockSection.match(/\.cm-mobile-dock \{[^}]*position: fixed;[^}]*\}/) || [''])[0];
check('dock padding includes safe-area inset', /padding:\s*3px 6px calc\(3px \+ env\(safe-area-inset-bottom/.test(dockRule), dockRule.trim().slice(0, 120));

// チップ高（ドックの内容高）
const chipRule = (dockSection.match(/\.cm-mob-chip \{([^}]*)\}/) || [])[1] || '';
const chipHeight = parseInt((chipRule.match(/height:\s*(\d+)px/) || [])[1], 10);
eq('dock chip height is 38px', chipHeight, 38);
const dockBaseHeight = 3 + chipHeight + 3; // 上パディング3 + 内容 + 下パディング3（inset除く）

// パスワード表示バー: bottom は 46px + inset
const barRule = (dockSection.match(/#sticky-pw-bar \{([^}]*)\}/) || [])[1] || '';
const barBottom = barRule.match(/bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom, 0px\)\)/);
check('sticky bar bottom adds the safe-area inset', !!barBottom, barRule.trim().slice(0, 120));
const barBottomBase = barBottom ? parseInt(barBottom[1], 10) : NaN;
eq('sticky bar bottom base is 46px', barBottomBase, 46);

// 形状検証: inset が 0 でも 34 でも、バーの下端はドックの上端より上にある
for (const inset of [0, 20, 34]) {
  const dockTop = dockBaseHeight + inset;      // 画面下端からドック上端までの距離
  const barBottomEdge = barBottomBase + inset; // 画面下端からバー下端までの距離
  check(`sticky bar clears the dock (inset=${inset})`, barBottomEdge >= dockTop + 2, `bar=${barBottomEdge} dock=${dockTop}`);
}

// body の下部余白: ドック高 + 余裕を確保し、inset も加算される。
// theme-cyber.css の body { padding: 0 !important } に詳細度で勝つため body.cm-body で指定する。
const bodyRule = (dockSection.match(/body\.cm-body \{([^}]*)\}/) || [])[1] || '';
check('body padding uses the body.cm-body selector (beats the theme reset)', bodyRule.length > 0);
const bodyPad = bodyRule.match(/padding-bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom, 0px\)\)/);
check('body bottom padding adds the safe-area inset', !!bodyPad, bodyRule.trim().slice(0, 120));
const bodyPadBase = bodyPad ? parseInt(bodyPad[1], 10) : NaN;
check('body bottom padding covers the dock height with slack', bodyPadBase >= dockBaseHeight + 8, `body=${bodyPadBase} dock=${dockBaseHeight}`);

// バー自身のパディングには inset を足さない（theme-cyber のモバイル節）
const twStart = themeCss.indexOf('@media (max-width: 640px)');
const twBar = (themeCss.slice(twStart, twStart + 4000).match(/#sticky-pw-bar \{([^}]*)\}/) || [])[1] || '';
check('theme mobile sticky bar rule found', twBar.length > 0);
check('sticky bar inner padding has no safe-area inset', !twBar.includes('safe-area-inset-bottom'), twBar.trim().slice(0, 160));
check('sticky bar inner padding stays 8px 10px', /padding:\s*8px 10px !important/.test(twBar));

// ドックはモバイル節の外では非表示（PC 表示に影響しない）
check('dock is display:none outside the mobile media query', /\.cm-mobile-dock \{\s*display: none;\s*\}/.test(appCss));

console.log('---');
console.log(`mobile-dock-overlap: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
