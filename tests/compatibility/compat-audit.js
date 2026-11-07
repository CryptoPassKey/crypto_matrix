'use strict';
/**
 * 暗号データの後方互換性 回帰監査。
 *
 * tests/compatibility/fixtures.json に保存された「過去の版で作成された
 * バックアップ」を、現在の contents/ の本番コードで復号し、平文が
 * 完全に一致することを確認します。1件でも復号できない・内容が変わって
 * いれば終了コード 1 を返します。
 *
 * 目的: アプリを更新したことで、既存ユーザーの暗号化バックアップが
 * 復元できなくなる事故を CI で防ぐこと。
 *
 * 使い方: node tests/compatibility/compat-audit.js [contentsDir]
 *   contentsDir 省略時はリポジトリ直下の contents/ を使う。
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./load-app');

const CONTENTS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'contents');
const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'),
).fixtures;

const fromB64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const eqBytes = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  const win = await loadApp(CONTENTS);
  const M = win.MatrixCardPreset;
  const enc = new win.TextEncoder();
  const dec = new win.TextDecoder();
  let failures = 0;
  const run = async (f, fn) => {
    try {
      await fn();
      console.log(`  PASS ${f.id}`);
    } catch (e) {
      failures++;
      console.log(`  FAIL ${f.id}: ${e.message}`);
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  console.log(`互換性監査: フィクスチャ ${FIXTURES.length} 件を現在のコードで復号します`);
  for (const f of FIXTURES) {
    if (f.kind === 'cmv1') {
      await run(f, async () => {
        const un = win.unpackCMV1(fromB64(f.packedB64));
        assert(un.type === f.expect.type, `type が不一致: ${un.type}`);
        assert(un.name === f.expect.name, `name が不一致: ${un.name}`);
        assert(
          dec.decode(un.payload) === f.expect.payload,
          'payload が不一致です',
        );
      });
    } else if (f.kind === 'cme') {
      await run(f, async () => {
        const opts = f.keyfileText
          ? { keyfileBytes: enc.encode(f.keyfileText) }
          : null;
        const d = await M.decryptBodyCME2(fromB64(f.bodyB64), f.pw, opts);
        assert(
          eqBytes(d.innerBody, fromB64(f.plainB64)),
          '復号した平文がフィクスチャ生成時の平文と一致しません',
        );
      });
    } else if (f.kind === 'cme-duress') {
      await run(f, async () => {
        const body = fromB64(f.bodyB64);
        const real = await M.decryptBodyCME2(body, f.realPw, null);
        assert(
          eqBytes(real.innerBody, fromB64(f.realPlainB64)),
          '本命の認証情報で本命の平文が開きません',
        );
        const decoy = await M.decryptBodyCME2(body, f.duressPw, null);
        assert(
          eqBytes(decoy.innerBody, fromB64(f.duressPlainB64)),
          'おとりの認証情報でおとりの平文が開きません',
        );
      });
    } else if (f.kind === 'bip39-extended') {
      await run(f, async () => {
        const d = await M.decodeExtendedBip39(f.words, f.pw);
        assert(d && d.site === f.expect.site, `site が不一致: ${d && d.site}`);
        assert(d.secret === f.expect.secret, 'secret が一致しません');
        if (f.expect.full !== undefined) {
          assert(d.full === f.expect.full, `full が不一致: ${d.full}`);
        }
      });
    } else if (f.kind === 'bip39-config') {
      await run(f, async () => {
        const d = await M.decodeBip39Blocks(f.words, f.pw);
        assert(d && d.full === f.expect.full, `full が不一致: ${d && d.full}`);
      });
    } else {
      failures++;
      console.log(`  FAIL ${f.id}: 未知の kind です: ${f.kind}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\n互換性監査: ${failures} 件が復号できませんでした。既存ユーザーのバックアップが壊れる変更が含まれている可能性があります。`,
    );
    process.exit(1);
  }
  console.log('\n互換性監査: 全フィクスチャが現在のコードで復号できました。');
  process.exit(0);
})().catch(e => {
  console.error('互換性監査の実行に失敗しました:', e);
  process.exit(1);
});
