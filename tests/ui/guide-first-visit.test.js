const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'contents', 'app.js'), 'utf8');

// app.js からガイド開閉 IIFE を実物どおり抽出する
const start = appJs.indexOf('「現在のパスワード作成手順」開閉トグル');
if (start < 0) { console.error('FAIL: guide IIFE not found'); process.exit(1); }
const iifeStart = appJs.indexOf('(() => {', start);
const iifeEnd = appJs.indexOf('})();', iifeStart) + '})();'.length;
const segment = appJs.slice(iifeStart, iifeEnd);

function makePage(seed) {
  const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(seed || {})) w.localStorage.setItem(k, v);
  w.eval(segment);
  return w;
}
function dumpStorage(w) {
  const o = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); }
  return o;
}
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + ' => ' + JSON.stringify(actual) + (ok ? '' : ' expected ' + JSON.stringify(expected)));
  if (ok) pass++; else fail++;
}
const collapsed = (w) => w.document.querySelector('.verbal-guide-card').classList.contains('guide-collapsed');

// 1. 初回: 開いて表示され、確認済みフラグが立つ
let w = makePage();
check('first visit opens guide', collapsed(w), false);
check('first visit sets seen flag', w.localStorage.getItem('cm_guide_seen'), '1');
check('aria-expanded true when open', w.document.getElementById('btn-guide-toggle').getAttribute('aria-expanded'), 'true');

// 2. 次回（再読み込み相当）: 自動で開かない
w = makePage(dumpStorage(w));
check('second visit keeps guide closed', collapsed(w), true);
check('aria-expanded false when closed', w.document.getElementById('btn-guide-toggle').getAttribute('aria-expanded'), 'false');

// 3. 手動で開ける（再確認できる）
w.document.getElementById('btn-guide-toggle').click();
check('manual toggle reopens', collapsed(w), false);
// 4. 手動で開いたまま再読み込みしても、次回は自動で開かない
w = makePage(dumpStorage(w));
check('after manual open, next visit closed again', collapsed(w), true);

// 5. 既存ユーザー移行: cm_guide_collapsed の記録があれば確認済み扱い
w = makePage({ cm_guide_collapsed: '0' });
check('legacy user (left open) starts closed', collapsed(w), true);
w = makePage({ cm_guide_collapsed: '1' });
check('legacy user (closed) starts closed', collapsed(w), true);

// 6. 初回に手動で閉じた場合も、次回は自動で開かない
w = makePage();
w.document.getElementById('btn-guide-toggle').click();
check('first visit manual close collapses', collapsed(w), true);
w = makePage(dumpStorage(w));
check('after first-visit close, next visit closed', collapsed(w), true);

// 7. 見出し行（タイトル文字）のタップでも開閉できる。ボタン経由は二重発火しない
w = makePage(dumpStorage(w));
check('header case starts closed', collapsed(w), true);
w.document.querySelector('.verbal-guide-title').click();
check('header title click opens', collapsed(w), false);
w.document.querySelector('.verbal-guide-title').click();
check('header title click closes again', collapsed(w), true);
w.document.getElementById('btn-guide-toggle').click();
check('button click toggles exactly once', collapsed(w), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
