// 回帰テスト: KeeWeb 連携グルーコードの ID 生成を Web Crypto に統一する。
// 対象は contents/keeweb/index.html 内の CryptoMatrix 追加コード2箇所:
//   1) エントリー転送ID の乱数サフィックス (entry_gen_...)
//   2) KeeWeb タブ間排他制御ID (kwtab_...)
// どちらも衝突・予測を避けるため crypto.getRandomValues() 由来の
// 128bit 乱数を使うこと。Math.random() へのフォールバックは禁止し、
// Web Crypto が使えない環境ではエラーにする。
// KeeWeb 本体は jsdom で起動できないため、KeeWeb 側は
// keeweb-transfer-deletion.test.js と同じ「ソース契約の静的検査」+
// ヘルパー関数を抽出しての実動確認で検証する。
// なおベンダーバンドル内（Pikaday 等）の Math.random は対象外。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const html = fs.readFileSync(path.join(CONTENTS, 'keeweb', 'index.html'), 'utf8');

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

// --- ヘルパーの抽出（存在しない場合は以降の検証が意味を持たないので即失敗） ---
const helperStart = html.indexOf('function generateSecureRandomId()');
check('helper generateSecureRandomId is defined', helperStart >= 0);
if (helperStart < 0) { console.log('\nFAILED (helper not found)'); process.exit(1); }
const helperEnd = html.indexOf('\n  }\n', helperStart);
check('helper body extractable', helperEnd > helperStart);
const helperSrc = html.slice(helperStart, helperEnd + 4);

// --- 静的契約 ---
check('helper uses crypto.getRandomValues', helperSrc.includes('crypto.getRandomValues'));
check('helper generates 128bit (Uint8Array(16))', helperSrc.includes('new Uint8Array(16)'));
check('helper throws when Web Crypto is unavailable',
  helperSrc.includes("typeof crypto === 'undefined'") && helperSrc.includes('throw new Error'));
check('helper itself does not use Math.random', !helperSrc.includes('Math.random'));
check('entry transfer suffix uses helper',
  html.includes('var randSuffix = generateSecureRandomId();'));
check('entry transfer id format preserved (entry_gen_ + Date.now + suffix)',
  html.includes("_transferId: 'entry_gen_' + Date.now() + '_' + randSuffix"));
check('tab id uses helper',
  html.includes("var CM_KW_TAB_ID = 'kwtab_' + Date.now() + '_' + generateSecureRandomId();"));
check('glue Math.random().toString(36).slice is gone',
  !html.includes('Math.random().toString(36).slice'));
check('tab claim comparisons still use CM_KW_TAB_ID',
  html.includes('parsed.tabId !== CM_KW_TAB_ID') && html.includes('check.tabId === CM_KW_TAB_ID'));

// --- ヘルパーの実動確認 ---
function loadHelper(cryptoImpl) {
  const sandbox = {};
  if (cryptoImpl) sandbox.crypto = cryptoImpl;
  vm.createContext(sandbox);
  vm.runInContext(helperSrc + '\nthis.__gen = generateSecureRandomId;', sandbox);
  return sandbox.__gen;
}

const gen = loadHelper(webcrypto);
check('loaded helper is a function', typeof gen === 'function');

const id1 = gen();
check('id format is 32 lowercase hex chars', /^[0-9a-f]{32}$/.test(id1));

const seen = new Set();
for (let i = 0; i < 2000; i++) seen.add(gen());
check('2000 generated ids are all unique', seen.size === 2000);

check('entry transfer id composes as before',
  /^entry_gen_\d+_[0-9a-f]{32}$/.test('entry_gen_' + 1700000000000 + '_' + gen()));
check('tab id composes as before',
  /^kwtab_\d+_[0-9a-f]{32}$/.test('kwtab_' + 1700000000000 + '_' + gen()));

let threw = false;
try {
  const genNoCrypto = loadHelper(null);
  genNoCrypto();
} catch (e) {
  threw = /Web Crypto/.test(String(e && e.message));
}
check('throws (no Math.random fallback) when Web Crypto is unavailable', threw);

console.log(failures === 0 ? '\nALL PASS' : '\nFAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
