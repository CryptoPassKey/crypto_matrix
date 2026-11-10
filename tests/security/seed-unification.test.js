'use strict';
/*
 * 段階③④テスト: 正規シードキーへの統一（必須条件1・2）と互換性ベクタ。
 * 設計: crypto_matrix_board_v2_design.md（2026-11-10 凍結）
 *
 * - 作成→復元の往復: Backup / Vault / TimeSecret の3ドメイン ×
 *   数字・英数字・記号入りの3シード分類で、作成と復元が同じ解釈になること。
 * - v1 互換: 旧形式（数値シード=String(appliedSeed)／Vault等=trim済み生文字列）で
 *   固定IVで作った既知解ベクタが、新実装でも復元できること。
 * - キーファイル: 正規シードキーで導出される既知解（SHA-256 チェーン）を固定。
 * - BIP39: シード文字列ブロック（48単語）と本体バージョン3の往復。
 * - 契約スキャン: 個別変換の再混入を検出する（対象ファイル・構文を限定）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));
const fakeIndexedDB = require(path.join(__dirname, '..', 'node_modules', 'fake-indexeddb'));

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const enc = new TextEncoder();

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : (detail ? ' => ' + detail : '')));
  if (ok) pass++; else fail++;
}
function eq(name, a, b) { check(name, a === b, 'got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }

async function waitFor(fn, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (_) {}
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

// 旧形式の鍵導出（v1 仕様の参照実装。固定IVベクタ生成用）
const PEPPERS = {
  Backup: 'CryptoMatrix:Backup:AppDomainSecret:v1:2026',
  Vault: 'CryptoMatrix:Vault:AppDomainSecret:v1:2026',
  TimeSecret: 'CryptoMatrix:TimeSecret:AppDomainSecret:v1:2026',
  App: 'CryptoMatrix:App:AppDomainSecret:v1:2026',
};
async function legacyKey(domain, iv, cleanSeed) {
  const ivHash = await crypto.webcrypto.subtle.digest('SHA-256', iv);
  const seedBytes = enc.encode(`${PEPPERS[domain]}:seed=${cleanSeed}:${Buffer.from(ivHash).toString('hex')}`);
  const keyHash = await crypto.webcrypto.subtle.digest('SHA-256', seedBytes);
  return crypto.webcrypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function legacyPack(domain, plain, cleanSeed, iv) {
  const key = await legacyKey(domain, iv, cleanSeed);
  const aad = enc.encode(`CryptoMatrix:CMA1:${domain}:v1`);
  const ct = new Uint8Array(await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set([0x43, 0x4d, 0x41, 0x31], 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

(async () => {
  const htmlPath = path.join(CONTENTS, 'index.html');
  const dom = await JSDOM.fromFile(htmlPath, {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      const store = new Map();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: k => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => { store.set(k, String(v)); },
          removeItem: k => { store.delete(k); },
          clear: () => store.clear(),
          key: i => [...store.keys()][i] ?? null,
          get length() { return store.size; },
        },
      });
      window.indexedDB = fakeIndexedDB.indexedDB;
      window.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
      Object.defineProperty(window, 'crypto', { value: crypto.webcrypto });
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
      window.confirm = () => true;
      window.alert = () => {};
      if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    },
  });
  const w = dom.window;
  await waitFor(() => w.MatrixCardPreset && typeof w.MatrixCardPreset.packAppBound === 'function' && typeof w.packSeedTextBlock === 'function');
  const P = w.MatrixCardPreset;
  const plain = enc.encode('CM-SEED-UNIFY::payload-1234567890');

  // ===== A. アプリ束縛暗号の往復（3ドメイン × 3シード分類） =====
  const seeds = { numeric: '424242', alnum: 'abc123', symbols: 'Xk9$mQ2!vR7/pL4.wZ8-nT' };
  for (const domain of ['Backup', 'Vault', 'TimeSecret']) {
    for (const [cls, seed] of Object.entries(seeds)) {
      const packed = await P.packAppBound(domain, plain, seed);
      const opened = await P.unpackAppBound(domain, packed, seed);
      eq(`roundtrip ${domain}/${cls}`, Buffer.from(opened).toString('utf8'), Buffer.from(plain).toString('utf8'));
    }
  }
  // 作成側と復元側の不一致（旧バグ）の再発防止: Backup を数値化した解釈では開けない
  {
    const packed = await P.packAppBound('Backup', plain, 'abc123');
    let failed = false;
    try { await P.unpackAppBound('Backup', packed, String(w.parseSeedValue('abc123'))); } catch (_) { failed = true; }
    check('v2 Backup does not open with numeric-collapsed seed', failed);
    const opened = await P.unpackAppBound('Backup', packed, ' abc123 ');
    eq('v2 Backup opens with padded input (trim-normalized)', Buffer.from(opened).toString('utf8'), Buffer.from(plain).toString('utf8'));
  }
  // 数値シードの表記ゆれ: 作成 '0123' → 復元 '123' でも一致する（正規化の統一）
  {
    const packed = await P.packAppBound('Backup', plain, '0123');
    const opened = await P.unpackAppBound('Backup', packed, '123');
    eq('Backup numeric spelling unified (0123 -> 123)', Buffer.from(opened).toString('utf8'), Buffer.from(plain).toString('utf8'));
  }

  // ===== B. v1 既知解ベクタ（固定IV・旧形式で作成したデータの復元） =====
  const fixedIv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  {
    // Backup の旧作成形式は String(appliedSeed) = '42'
    const blob = await legacyPack('Backup', plain, '42', fixedIv);
    const opened = await P.unpackAppBound('Backup', w.Uint8Array.from(blob), '42');
    eq('v1 vector Backup seed 42', Buffer.from(opened).toString('utf8'), Buffer.from(plain).toString('utf8'));
    const opened2 = await P.unpackAppBound('Backup', w.Uint8Array.from(blob), '042');
    eq('v1 vector Backup seed 042 (canonical)', Buffer.from(opened2).toString('utf8'), Buffer.from(plain).toString('utf8'));
  }
  {
    // Vault の旧作成形式は trim 済み生文字列 '042' そのまま → フォールバックで開ける
    const blob = await legacyPack('Vault', plain, '042', fixedIv);
    const opened = await P.unpackAppBound('Vault', w.Uint8Array.from(blob), '042');
    eq('v1 vector Vault legacy raw 042', Buffer.from(opened).toString('utf8'), Buffer.from(plain).toString('utf8'));
  }
  {
    const blob = await legacyPack('TimeSecret', plain, '42', fixedIv);
    const opened = await P.unpackAppBound('TimeSecret', w.Uint8Array.from(blob), '42');
    eq('v1 vector TimeSecret seed 42', Buffer.from(opened).toString('utf8'), Buffer.from(plain).toString('utf8'));
  }
  {
    // 違うシードでは開けない（フォールバックが無条件に開けないこと）
    const blob = await legacyPack('Vault', plain, '042', fixedIv);
    let failed = false;
    try { await P.unpackAppBound('Vault', w.Uint8Array.from(blob), '43'); } catch (_) { failed = true; }
    check('wrong seed still rejected', failed);
  }

  // ===== C. キーファイル既知解（正規シードキーで導出） =====
  function expectedKeyfileHex(seedKey) {
    const ikm = enc.encode(`CRYPTOMATRIX-CARD-SEED-V3:${seedKey}`);
    const combined = crypto.createHash('sha256').update(ikm).digest();
    return combined.toString('hex').toUpperCase();
  }
  async function keyfileHex(seedNum) {
    const { xml } = await P.generateKeePassXmlKeyfile({ seedNum });
    const m = xml.match(/<Data Hash="[0-9A-F]+">\s*([0-9A-F ]+)\s*([0-9A-F ]+)\s*<\/Data>/);
    if (!m) throw new Error('keyfile xml shape');
    return (m[1] + m[2]).replace(/ /g, '');
  }
  eq('keyfile v2 seed uses raw string', await keyfileHex('abc123'), expectedKeyfileHex('abc123'));
  eq('keyfile numeric 0123 canonicalizes to 123', await keyfileHex('0123'), expectedKeyfileHex('123'));
  eq('keyfile numeric number input', await keyfileHex(424242), expectedKeyfileHex('424242'));
  eq('keyfile symbols seed', await keyfileHex('Xk9$mQ2!vR7/pL4.wZ8-nT'), expectedKeyfileHex('Xk9$mQ2!vR7/pL4.wZ8-nT'));

  // ===== D. BIP39 シードブロックとフレーズ往復 =====
  {
    const cfg = w.getRecipeConfig();
    const coreV2 = w.packRecipeTo256Bit(cfg, true, 'abc123');
    const unpackedV2 = w.unpack256BitToRecipe(coreV2);
    eq('core flag set for v2 seed', unpackedV2.seedTextFollows, true);
    const coreV1 = w.packRecipeTo256Bit(cfg, true, '42');
    eq('core flag unset for numeric seed', w.unpack256BitToRecipe(coreV1).seedTextFollows, false);
    eq('core numeric seed value preserved', w.unpack256BitToRecipe(coreV1).seedNumber, 42);

    const block = w.packSeedTextBlock('abc123', coreV2);
    eq('seed block roundtrip', w.unpackSeedTextBlock(block, coreV2), 'abc123');
    let bindingFailed = false;
    try { w.unpackSeedTextBlock(block, coreV1); } catch (_) { bindingFailed = true; }
    check('seed block binding rejects other core', bindingFailed);
    let longFailed = false;
    try { w.packSeedTextBlock('a'.repeat(24), coreV2); } catch (_) { longFailed = true; }
    check('seed block rejects >23 bytes', longFailed);

    const words24 = await P.entropyToBip39Words(coreV2);
    const wordsBlock = await P.entropyToBip39Words(block);
    const decoded = await P.decodeBip39Blocks(words24.concat(wordsBlock), '', true, null);
    eq('decodeBip39Blocks 48 words seedText', decoded.seedText, 'abc123');
    const decodedNum = await P.decodeBip39Blocks(await P.entropyToBip39Words(coreV1), '', true, null);
    eq('decodeBip39Blocks 24 words numeric', decodedNum.seedNumber, 42);
    eq('decodeBip39Blocks 24 words no seedText', decodedNum.seedText, undefined);
  }

  // ===== E. 本体バージョン3（buildPlainBody / parsePlainBody の抽出実行） =====
  {
    const src = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');
    function extract(name, endMarker) {
      const i = src.indexOf('function ' + name);
      if (i < 0) throw new Error(name + ' not found');
      const j = src.indexOf(endMarker, i);
      if (j < 0) throw new Error(name + ' end not found');
      return src.slice(i, j);
    }
    const harness = `
      const enc = new TextEncoder();
      const sha = async (b) => new Uint8Array(await window.crypto.subtle.digest('SHA-256', b));
      function concat(...arr){const out=new Uint8Array(arr.reduce((n,a)=>n+a.length,0));let pos=0;for(const a of arr){out.set(a,pos);pos+=a.length;}return out;}
      async ${extract('buildPlainBody', '\n async function frameBodyToBlocks')}
      ${extract('parsePlainBody', '\n async function reassembleStreamGroup')}
      window.__buildPlainBody = buildPlainBody;
      window.__parsePlainBody = parsePlainBody;
    `;
    w.eval(harness);
    const cfg = w.getRecipeConfig();
    const core = w.packRecipeTo256Bit(cfg, true, 'abc123');
    const sV2 = { cfg, includeSeed: true, seedText: 'abc123', full: true, site: 'example.jp', secret: 'ひみつ', value: 'P@ssw0rd!' };
    const bodyV2 = await w.__buildPlainBody(sV2, core);
    eq('plain body version is 3 for v2 seed', bodyV2[3], 3);
    const parsed = w.__parsePlainBody(bodyV2);
    eq('plain body v3 seedText', parsed.seedText, 'abc123');
    eq('plain body v3 site', parsed.site, 'example.jp');
    const sV1 = { cfg, includeSeed: true, seedText: '42', full: true, site: 'example.jp', secret: 'ひみつ', value: 'P@ssw0rd!' };
    const coreV1 = w.packRecipeTo256Bit(cfg, true, '42');
    const bodyV1 = await w.__buildPlainBody(sV1, coreV1);
    eq('plain body version stays 2 for numeric seed', bodyV1[3], 2);
    eq('plain body v2-parse seedText undefined', w.__parsePlainBody(bodyV1).seedText, undefined);
    const sC = { cfg, includeSeed: true, seedText: 'abc123', full: false };
    const bodyC = await w.__buildPlainBody(sC, core);
    eq('compact body version is 3 for v2 seed', bodyC[3], 3);
    eq('compact body v3 seedText', w.__parsePlainBody(bodyC).seedText, 'abc123');
  }

  // ===== F. 契約スキャン（対象ファイル・構文を限定） =====
  {
    const idx = fs.readFileSync(path.join(CONTENTS, 'index.js'), 'utf8');
    const bq = fs.readFileSync(path.join(CONTENTS, 'backup-qr.js'), 'utf8');
    const ts = fs.readFileSync(path.join(CONTENTS, 'timesecret.js'), 'utf8');
    check('contract: keyfile call in index.js does not collapse seed via parseSeedValue',
      !idx.includes('generateKeePassXmlKeyfile({seedNum:parseSeedValue'), true);
    check('contract: backup-qr keyfile calls do not collapse seed via parseSeedValue',
      !bq.includes('parseSeedValue(curSeed)') && !/generateKeePassXmlKeyfile\(\{\s*seedNum:\(typeof parseSeedValue/.test(bq), true);
    check('contract: deriveAppDomainKey canonicalizes via CMSeedKey',
      /async function deriveAppDomainKey\(domain, iv, seedNum = '0'\) \{[^}]*canonicalSeedKey/.test(idx), true);
    check('contract: Backup creation passes seed text (not appliedSeed number) to packAppBound path',
      idx.includes("const activeSeed = options?.seedNum !== undefined ? String(options.seedNum) : String(($('input-seed-number')?.value || '')"), true);
    check('contract: timesecret keyfile flow reassigns to current seed text',
      ts.includes('seedNum = getCurrentCardSeed();'), true);
    check('contract: seed-key.js is the single canonical implementation',
      fs.readFileSync(path.join(CONTENTS, 'seed-key.js'), 'utf8').includes('canonicalSeedKey'), true);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
