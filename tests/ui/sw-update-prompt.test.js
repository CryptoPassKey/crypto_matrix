'use strict';
/*
 * 起動時アップデート通知ポップのテスト（UI）。
 * 本番 app.js の Service Worker 更新ブロックをそのまま抽出し、偽の
 * ServiceWorker 登録オブジェクトで駆動して実挙動を検証する。
 * - 起動時の背景チェックで新版が入ると、ポップが出る（ライブリージョン付き）
 * - 「あとで」でポップが消え、適用はされない（次回起動時の自動適用に委ねる）
 * - 「あとで」の後でも、別の新版が来ればポップは再び出る
 * - 「アップデート」で CM_SKIP_WAITING が送られ、待機中ワーカーが適用される
 * - 初回インストール（controller なし）ではポップは出ない
 * 待機は固定時間スリープではなく、登録オブジェクト側の Promise で同期する。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'contents', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'contents', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(ROOT, 'contents', 'app.css'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'contents', 'sw.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : ' => ' + detail));
  if (ok) pass++; else fail++;
}

// app.js から SW 更新ブロック（if ('serviceWorker' ... { ... }）を抽出する
function extractSwBlock(src) {
  const start = src.indexOf("if ('serviceWorker' in navigator");
  if (start < 0) throw new Error('SW block not found');
  const endMarker = '\n})();';
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error('SW block end not found');
  return src.slice(start, end);
}

function makeWorker(state) {
  return {
    state, messages: [], _sc: [],
    addEventListener(t, f) { if (t === 'statechange') this._sc.push(f); },
    postMessage(m) { this.messages.push(m); },
    setState(s2) { this.state = s2; this._sc.slice().forEach(f => f()); },
  };
}

async function bootScenario(withController) {
  const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const active = makeWorker('activated');
  let resolveUpdateCalled;
  const updateCalled = new Promise(r => { resolveUpdateCalled = r; });
  const reg = {
    active, waiting: null, installing: null, _uf: [],
    addEventListener(t, f) { if (t === 'updatefound') this._uf.push(f); },
    update() {
      const worker = makeWorker('installing');
      this.installing = worker;
      this._uf.slice().forEach(f => f());
      resolveUpdateCalled();
      return Promise.resolve();
    },
    // テスト側が次の更新サイクルを駆動するための疑似エントリ
    discoverUpdate() {
      const worker = makeWorker('installing');
      this.installing = worker;
      this._uf.slice().forEach(f => f());
      return worker;
    },
  };
  const sw = {
    controller: withController ? active : null,
    register: async () => reg,
    getRegistration: async () => reg,
    addEventListener() {},
  };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: sw, configurable: true });
  w.eval(extractSwBlock(appJs));
  w.dispatchEvent(new w.Event('load'));
  // アプリが登録後の背景チェック（reg.update()）を呼ぶまで Promise で待つ
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('registration.update() was not called by the app')), 5000);
  });
  try {
    await Promise.race([updateCalled, timeout]);
  } finally {
    clearTimeout(timer);
  }
  return { w, reg };
}

function completeInstall(reg) {
  reg.waiting = reg.installing;
  reg.installing.setState('installed');
  return reg.installing;
}

(async () => {
  // ===== 静的チェック =====
  check('app.js wires updatefound to the prompt', appJs.includes("addEventListener('updatefound'") && appJs.includes('cmShowUpdatePrompt(reg.waiting || installing)'));
  check('app.js guards first install via controller', appJs.includes("installing.state === 'installed' && navigator.serviceWorker.controller"));
  check('app.css defines the prompt styles', appCss.includes('.cm-update-prompt') && appCss.includes('.cm-update-prompt.is-visible'));
  check('sw.js version bumped for this change', swJs.includes('cm-v3.29.3-mobile-side-img'));

  // ===== シナリオA: 「あとで」→ 別の新版では再び出る =====
  {
    const { w, reg } = await bootScenario(true);
    check('A: no prompt before install completes', !w.document.querySelector('.cm-update-prompt'));
    const first = completeInstall(reg);
    const prompt = w.document.querySelector('.cm-update-prompt');
    check('A: prompt appears when update is waiting', !!prompt && prompt.classList.contains('is-visible'));
    check('A: prompt is a polite live region', !!prompt && prompt.getAttribute('aria-live') === 'polite',
      prompt && prompt.getAttribute('aria-live'));
    check('A: prompt announces the update text', !!prompt && prompt.textContent.includes('新しいバージョンがあります'));
    const buttons = prompt ? Array.from(prompt.querySelectorAll('button')) : [];
    check('A: prompt has apply and later buttons', buttons.length === 2 && buttons[0].textContent === 'アップデート' && buttons[1].textContent === 'あとで',
      buttons.map(b => b.textContent).join(','));
    buttons[1].click();
    check('A: later hides the prompt', !prompt.classList.contains('is-visible'));
    check('A: later does not activate the worker', first.messages.length === 0);

    // 同じセッションで次の新版が来たら、ポップは再び出なければならない
    const second = reg.discoverUpdate();
    reg.waiting = second;
    second.setState('installed');
    check('A: prompt reappears for the next update', prompt.classList.contains('is-visible'));
    const apply2 = prompt.querySelectorAll('button')[0];
    apply2.click();
    check('A: applying the second update targets the second worker',
      second.messages.some(m => m && m.type === 'CM_SKIP_WAITING'),
      JSON.stringify(second.messages));
    check('A: first worker was never activated', first.messages.length === 0);
  }

  // ===== シナリオB: 「アップデート」 =====
  {
    const { w, reg } = await bootScenario(true);
    const worker = completeInstall(reg);
    const prompt = w.document.querySelector('.cm-update-prompt');
    check('B: prompt appears', !!prompt && prompt.classList.contains('is-visible'));
    prompt.querySelectorAll('button')[0].click();
    check('B: apply sends CM_SKIP_WAITING to the waiting worker',
      worker.messages.some(m => m && m.type === 'CM_SKIP_WAITING'),
      JSON.stringify(worker.messages));
    check('B: prompt hides after apply', !prompt.classList.contains('is-visible'));
  }

  // ===== シナリオC: 初回インストールでは出ない =====
  {
    const { w, reg } = await bootScenario(false);
    completeInstall(reg);
    const prompt = w.document.querySelector('.cm-update-prompt');
    check('C: no prompt on first install', !prompt || !prompt.classList.contains('is-visible'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
