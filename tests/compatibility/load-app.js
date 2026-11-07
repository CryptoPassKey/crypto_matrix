'use strict';
/**
 * 実ページ（contents/index.html とそのスクリプト一式）を jsdom で読み込み、
 * 本番コードそのものを Node から実行するためのローダー。
 *
 * jsdom に不足するブラウザAPI（WebCrypto の subtle、matchMedia、Canvas 等）は
 * 最小限のスタブで補う。暗号処理はすべて本番コードと WebCrypto が行う。
 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('crypto');

async function loadApp(contentsDir) {
  // jsdom 環境では Canvas・IndexedDB 等が使えず、対象外機能の初期化エラーが
  // ページ側から出力される。監査対象の初期化成否は MatrixCardPreset の有無で
  // 判定するため、ページ側コンソールはここでは転送しない。
  const virtualConsole = new VirtualConsole();
  const dom = await JSDOM.fromFile(path.join(contentsDir, 'index.html'), {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'crypto', {
        value: webcrypto,
        configurable: true,
      });
      window.matchMedia =
        window.matchMedia ||
        (q => ({
          matches: false,
          media: q,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
        }));
      window.scrollTo = () => {};
      if (window.Element) window.Element.prototype.scrollIntoView = () => {};
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = () => 'blob:stub';
        window.URL.revokeObjectURL = () => {};
      }
    },
  });
  const win = dom.window;
  await new Promise(r => {
    if (win.document.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  // 初期化（マトリクス構築・モード適用など）の完了を待つ
  await new Promise(r => setTimeout(r, 2500));
  if (!win.MatrixCardPreset) {
    throw new Error('MatrixCardPreset が初期化されませんでした。');
  }
  return win;
}

module.exports = { loadApp };
