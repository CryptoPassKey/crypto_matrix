'use strict';
/**
 * コントラスト監査（WCAG 2.2 AA）。
 *
 * 2つの母集団を両テーマ（ライト/ダーク）で検査する:
 *  1. 静的DOM: contents/index.html のレガシー領域（.cm-legacy）内のテキスト要素全件
 *  2. 動的生成DOM: dynamic-dom-fixtures.js のフィクスチャを実カスケードへ注入した要素
 *
 * 判定基準: 通常サイズの文字 4.5:1 以上、大きな文字（24px以上、または
 * 18.66px以上かつ太字）3:1 以上。未達が1件でもあれば終了コード 1。
 *
 * 使い方: node tests/accessibility/contrast-audit.js [contentsDir]
 *   contentsDir 省略時はリポジトリ直下の contents/ を使う。
 *
 * 制限: jsdom はレイアウトとメディアクエリを再現しないため、実効色は近似である。
 * 最終確認は実ブラウザ（Playwright等）と実機で行うこと（tests/README.md 参照）。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const FIXTURES = require('./dynamic-dom-fixtures');

const CONTENTS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'contents');

function buildDom(light) {
  const rd = f => fs.readFileSync(path.join(CONTENTS, f), 'utf8');
  let html = rd('index.html');
  for (const css of ['app.css', 'legacy.css', 'theme-cyber.css']) {
    html = html.replace(
      `<link rel="stylesheet" href="${css}">`,
      () => `<style>\n${rd(css)}\n</style>`,
    );
  }
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  if (light) dom.window.document.documentElement.classList.add('light');
  return dom;
}

function lum(r, g, b) {
  const f = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function parseColor(s) {
  const m = String(s).match(/[\d.]+/g).map(Number);
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
}

/** 要素の実効背景色（半透明は祖先方向へ合成する） */
function effectiveBg(el, win) {
  let n = el;
  while (n && n.nodeType === 1) {
    const bg = parseColor(win.getComputedStyle(n)['background-color']);
    if (bg.a > 0) {
      if (bg.a >= 1) return bg;
      const under = n.parentElement
        ? effectiveBg(n.parentElement, win)
        : { r: 247, g: 249, b: 252 };
      return {
        r: Math.round(bg.r * bg.a + under.r * (1 - bg.a)),
        g: Math.round(bg.g * bg.a + under.g * (1 - bg.a)),
        b: Math.round(bg.b * bg.a + under.b * (1 - bg.a)),
      };
    }
    n = n.parentElement;
  }
  return { r: 247, g: 249, b: 252 };
}

function measure(el, win) {
  const cs = win.getComputedStyle(el);
  const fg = parseColor(cs.color);
  const bg = effectiveBg(el, win);
  const l1 = lum(fg.r, fg.g, fg.b);
  const l2 = lum(bg.r, bg.g, bg.b);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const sizePx = parseFloat(cs['font-size']) || 16;
  const bold = (parseInt(cs['font-weight'], 10) || 400) >= 700;
  const isLarge = sizePx >= 24 || (sizePx >= 18.66 && bold);
  return { ratio, threshold: isLarge ? 3.0 : 4.5, isLarge, sizePx, bold };
}

function hasOwnText(el) {
  return [...el.childNodes].some(
    n => n.nodeType === 3 && n.textContent.trim(),
  );
}

function describe(el) {
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).join('.');
  return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''} "${(el.textContent || '').trim().slice(0, 24)}"`;
}

let failures = 0;

for (const light of [true, false]) {
  const theme = light ? 'LIGHT' : 'DARK';

  // 1. 静的DOMセンサス
  {
    const dom = buildDom(light);
    const win = dom.window;
    let total = 0;
    const bad = [];
    for (const el of win.document.querySelectorAll('*')) {
      if (!hasOwnText(el)) continue;
      if (!el.closest('.cm-legacy')) continue; // シェル側は測定系の都合で対象外
      total++;
      const m = measure(el, win);
      if (m.ratio < m.threshold) bad.push({ el, m });
    }
    console.log(`[static] ${theme}: テキスト要素 ${total} 件 / AA未達 ${bad.length} 件`);
    for (const { el, m } of bad) {
      failures++;
      console.log(
        `  FAIL ${describe(el)} ratio=${m.ratio.toFixed(2)} < ${m.threshold} (${m.isLarge ? '大' : '通常'} ${m.sizePx}px)`,
      );
    }
  }

  // 2. 動的生成DOM（フィクスチャ注入）
  {
    const dom = buildDom(light);
    const win = dom.window;
    const board = win.document.querySelector('.cm-legacy');
    const wrap = win.document.createElement('div');
    wrap.innerHTML = FIXTURES;
    board.appendChild(wrap);
    const root = win.document.getElementById('audit-root');
    let total = 0;
    const bad = [];
    for (const el of root.querySelectorAll('*')) {
      if (!hasOwnText(el)) continue;
      total++;
      const m = measure(el, win);
      if (m.ratio < m.threshold) bad.push({ el, m });
    }
    console.log(`[dynamic] ${theme}: フィクスチャ ${total} 件 / AA未達 ${bad.length} 件`);
    for (const { el, m } of bad) {
      failures++;
      console.log(
        `  FAIL ${describe(el)} ratio=${m.ratio.toFixed(2)} < ${m.threshold} (${m.isLarge ? '大' : '通常'} ${m.sizePx}px)`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\nコントラスト監査: ${failures} 件の AA 未達があります。`);
  process.exit(1);
}
console.log('\nコントラスト監査: 全件 WCAG 2.2 AA 適合。');
