const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const bq = fs.readFileSync(path.join(ROOT, 'contents', 'backup-qr.js'), 'utf8');

// initHelpTooltips を実物どおり抽出する
const start = bq.indexOf('function initHelpTooltips(){');
if (start < 0) { console.error('FAIL: initHelpTooltips not found'); process.exit(1); }
const endMark = bq.indexOf('/* ===', start);
const segment = bq.slice(start, endMark).trimEnd();

const html = `<!DOCTYPE html><html><body>
<label>項目A<button type="button" class="help-btn" id="hb-a" aria-label="説明を表示" data-help="Aの説明文">?</button></label>
<label>項目B<button type="button" class="help-btn" id="hb-b" aria-label="説明を表示" data-help="Bの説明文">?</button></label>
<div id="outside">外側</div>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.$ = (id) => w.document.getElementById(id);
w.eval(segment + '\ninitHelpTooltips();');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + ' => ' + JSON.stringify(actual) + (ok ? '' : ' expected ' + JSON.stringify(expected)));
  if (ok) pass++; else fail++;
}
const doc = w.document;
const pop = () => doc.getElementById('help-popover');
const visible = () => pop().classList.contains('visible');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // 初期状態: ポップオーバーが生成され、閉じている／a11y属性が付く
  check('popover created', !!pop(), true);
  check('popover role', pop().getAttribute('role'), 'dialog');
  check('popover aria-hidden initial', pop().getAttribute('aria-hidden'), 'true');
  check('initially hidden', visible(), false);
  check('btn A aria-expanded initial', doc.getElementById('hb-a').getAttribute('aria-expanded'), 'false');

  // クリックで開く（本文が差し替わる）
  click(doc.getElementById('hb-a'));
  check('click A opens', visible(), true);
  check('body shows A text', doc.getElementById('help-popover-body').textContent, 'Aの説明文');
  check('btn A aria-expanded open', doc.getElementById('hb-a').getAttribute('aria-expanded'), 'true');
  check('popover aria-hidden open', pop().getAttribute('aria-hidden'), 'false');
  check('btn A active class', doc.getElementById('hb-a').classList.contains('active'), true);

  // もう一度クリックで閉じる（トグル）
  click(doc.getElementById('hb-a'));
  check('second click closes', visible(), false);
  check('btn A aria-expanded closed', doc.getElementById('hb-a').getAttribute('aria-expanded'), 'false');

  // 別のボタンを開くと本文と状態が切り替わる
  click(doc.getElementById('hb-a'));
  click(doc.getElementById('hb-b'));
  check('switch keeps open', visible(), true);
  check('body shows B text', doc.getElementById('help-popover-body').textContent, 'Bの説明文');
  check('btn A expanded reset on switch', doc.getElementById('hb-a').getAttribute('aria-expanded'), 'false');
  check('btn B expanded on switch', doc.getElementById('hb-b').getAttribute('aria-expanded'), 'true');

  // 外側クリックで閉じる
  click(doc.getElementById('outside'));
  check('outside click closes', visible(), false);

  // Escで閉じる
  click(doc.getElementById('hb-a'));
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes', visible(), false);

  // ✕ボタンで閉じる
  click(doc.getElementById('hb-a'));
  click(doc.querySelector('.help-popover-close'));
  check('close button closes', visible(), false);

  // ホバーで開き、離れると少し置いて閉じる（PC向け挙動の回帰確認）
  doc.getElementById('hb-a').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  check('hover opens', visible(), true);
  doc.getElementById('hb-a').dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true }));
  await sleep(300);
  check('hover out closes after grace', visible(), false);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
