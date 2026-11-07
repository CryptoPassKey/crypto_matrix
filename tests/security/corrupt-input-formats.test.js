// 回帰テスト: 破損・改ざんされた入力の安全な拒否（監査 V1 の残領域 1〜5）。
// 既存の corrupt-input.test.js（CME2 本体・QR フレーム）に含まれない形式を対象に、
// 本番コードの公開関数と実際の UI 経路で次を確認する:
//   1) Time Capsule（CMTL1）: ヘッダー改ざん・ラウンド/Chain Hash 不一致・
//      暗号文改ざん・偽ビーコンを拒否する。復元ツール（別実行経路）でも確認する
//   2) 保管庫（bv）: UI で作成した暗号化テキストの切り詰め・改ざん・
//      パスワード不一致を復号 UI が拒否し、平文を表示しない
//   3) TimeSecret: IndexedDB レコードの改ざん（暗号文・IV・ハッシュ・
//      コミット値）・必須フィールド欠落を復号が拒否し、原本は復元できる
//   4) CMV1 / MCBK1（旧形式）: 破損・切り詰め・不正ヘッダー・検証値不一致を拒否する
//   5) BIP39: チェックサム不一致・語数違い・リスト外単語を拒否する
// 各グループとも「正常データは復号・読み込みできる」対照を先に確認する。
// タイムカプセルのフィクスチャは本番コードで実チェーン（quicknet）向けに
// 作成した実物（A: 時間解禁のみ / B: パスワード付き）で、ビーコンは
// drand の公開済みラウンド値。復号はネットワーク取得を使わない。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { loadApp } = require('../compatibility/load-app');

const CONTENTS = path.join(__dirname, '..', '..', 'contents');
const MANUAL_SCRIPTS = [
  'seed-vault.js', 'passkey-store.js', 'index.js', 'app.js', 'backup-qr.js',
  'data-transfer-protocol.js', 'data-transfer-zxing-loader.js',
  'data-transfer.js', 'timelock.js', 'timesecret.js'
];
const BV_SECRET = 'BV-CORRUPT-SECRET-2026';
const BV_PW = 'bv-corrupt-password-2026';
const TS_SECRET = 'TS-CORRUPT-SECRET-2026';
const TS_PW = 'ts-corrupt-password-2026';

const CAPSULE_A = "-----BEGIN CRYPTOMATRIX TIMELOCK-----\nQ01UTAEAAAFAeyJ2IjoxLCJtb2RlIjoiQSIsIm5ldCI6InF1aWNrbmV0IiwiY2hh\naW5IYXNoIjoiNTJkYjliYTcwZTBjYzBmNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3Nzcz\nNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3MSIsInJvdW5kIjozMzc0NTAwMSwidGFy\nZ2V0VGltZU1zIjoxNzk0MDM4MzY3MDAwLCJ1bmxvY2tUaW1lTXMiOjE3OTQwMzgz\nNjcwMDAsImNyZWF0ZWRBdE1zIjoxNzk0MDQ1NTY4MDc2LCJpbm5lclR5cGUiOiJj\nbWExIiwia2RmUHJvZmlsZSI6bnVsbCwiY29tYm8iOm51bGwsImhhc0R1cmVzcyI6\nZmFsc2UsInBheWxvYWRLaW5kIjoidGV4dCIsInNoYW1pciI6bnVsbH1hZ2UtZW5j\ncnlwdGlvbi5vcmcvdjEKLT4gdGxvY2sgMzM3NDUwMDEgNTJkYjliYTcwZTBjYzBm\nNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3NzczNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3\nMQpndjU0czZvVjdReG1QR3VaZzNLNW1BWVNnMXVFKzNEQWc5T1FZTWdMcnFYelNH\ncVRqRnRhTE02M3YzVmlFRVNXCkZVVThBY0xKTzFuL1FJTlIrU0ZFRkVteXFyVE1k\nMkJscXREVm5sdkJoVng0UURGZ3VmbXdwbUFJekNiRk9SRDEKZll6VERVdmlIeEZ4\nYXpBN1lRUU91QUR0aUsxMjBGZVVSUHk3Y3R1RzIxYwotLS0gZ3ZKdmgwU1R6V2xh\nbnRwVHFzU3Q5enBydWtXUEMxZ2ZMdUVFWXJJWGtKOApQBJY4gPpC9AGe3x8Y71hp\nv8EL6I/vUf0lY30/OPYMikScAfBm53VrnEcA9mYOh/VmZMNcNHX+QYsc+SW6WwiS\n8FOTnWag0B3n/Y2kOIyap8c2TxYvlrf+EeqdNo0HfFoGsTJAieEry9ekDzqwgyFH\nJlYX8Amc/mJVu0vc9sG0NUy6o1hMaZ4l93MT5uH8kfkUpFHVZ82uK6K7pfHhjE6B\nrItxfcvU5ze4f1pTFUIEhzR46y9/+Eoc3Er8oK4JfZVVjhVHLXxTIwDFYgQB3CbD\ng0scl7hUyTj4lDTKDGrTUxM5tU+ufFBmVcBabisaxH4VwwUwp1Kc7+pu00w=\n-----END CRYPTOMATRIX TIMELOCK-----";
const BEACON_A = {"round":33745001,"randomness":"75d7ac02c4c6023f8dc04d81841a296f8d89a65e81b695e81afb78a4ad8a2e1d","signature":"ad326501df063193ae3e28f2fb2741334d18b813ce48f787f06b6ee8c0702948b4c763719897708b8caac5a34106274e"};
const CAPSULE_B = "-----BEGIN CRYPTOMATRIX TIMELOCK-----\nQ01UTAEAAAE6eyJ2IjoxLCJtb2RlIjoiQiIsIm5ldCI6InF1aWNrbmV0IiwiY2hh\naW5IYXNoIjoiNTJkYjliYTcwZTBjYzBmNmVhZjc4MDNkZDA3NDQ3YTFmNTQ3Nzcz\nNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3MSIsInJvdW5kIjozMzc0NTAxOCwidGFy\nZ2V0VGltZU1zIjoxNzk0MDM4NDE4MDAwLCJ1bmxvY2tUaW1lTXMiOjE3OTQwMzg0\nMTgwMDAsImNyZWF0ZWRBdE1zIjoxNzk0MDQ1NjE4NjE5LCJpbm5lclR5cGUiOiJj\nbWUzIiwia2RmUHJvZmlsZSI6MywiY29tYm8iOjAsImhhc0R1cmVzcyI6ZmFsc2Us\nInBheWxvYWRLaW5kIjoidGV4dCIsInNoYW1pciI6bnVsbH1hZ2UtZW5jcnlwdGlv\nbi5vcmcvdjEKLT4gdGxvY2sgMzM3NDUwMTggNTJkYjliYTcwZTBjYzBmNmVhZjc4\nMDNkZDA3NDQ3YTFmNTQ3NzczNWZkM2Y2NjE3OTJiYTk0NjAwYzg0ZTk3MQpxa2wv\nQjlGejNqd2U1K0ZITXhFVVZZQko4anRjL25SUHpPSlZ3VUxyVEtaZ3NwWXlNRk9v\nWEx1L2YzaWM5UnFOCkF0MVFaM0pRMUxnd2R1ZExibFhHSnJVc3VZejFWdzdybGpU\nZHI5TmVmUE5WUWhvb1ZzdzJHOVI4eGExTFREcHEKcjU1SUYreHI1UTNzWk1hNHhn\nZkdEQlAvYVo2SEFhMHRoOHBvdUdSVGdERQotLS0gc1g1ekJmYlJDMkNkblNZeldY\ndExwdWxnbW9VRVQ0VnRzcXIzS3RlUnZJWQp33vwTsHt13Lv9CVoMIHz4QgPGfiKX\nwcbE+uJNniUTYmWG9JWsGTGM4meycpo8GffB4w0z1amiArW2AYBiLj6z6b9uSN7l\nLiSpjyD0AFKjDSFS5qaVEWSBqJEvAsskKSSHhBOFhjZr4dLOcpGyePVuvz234tRz\nwmihBgG9XKloSu9sny/+0obJt8bnUka7HdhRLBO84mdJCeJNFaopahoATGq0cQXE\nHKaKR2nel2J/ZLW4KJxKrDXJx4tsaf7v0ICob40KYCD+SUasOg82oT7BRAf7NV0V\njC9QgMXfbZh+DwyuvbSrubkfXM5YWkpyFUIrUhzKDN6i6EU5nrfXbQYUPag391ew\nplsBVPuGlStf01pCjv++h9FkqYvOoNcLRFBWV2+M8a11YTFsET9nIIPgbjJuEmvg\nhQ0VAQZd6A6jiMWKbad2kmJkU/VFUUKm8NzGLMe9rcJ3UGn90YKK5q9hbQXBokMz\nMT2d\n-----END CRYPTOMATRIX TIMELOCK-----";
const BEACON_B = {"round":33745018,"randomness":"bc7e8e11e3dc34d6d797933dd819c960ada5dff3d171c38f81a7055ef17b22de","signature":"8b0e7b36b504cedf95594dcef84c00284e35f490bd703399dc7ba299a289c03bad8bb98995035b0217e0636b7672afc0"};
const CAPSULE_B_PW = 'a2-verify-password-2026';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v;
    try { v = await fn(); } catch (_) { v = undefined; }
    if (v) return v;
    await sleep(50);
  }
  throw new Error('waitFor timeout: ' + label);
}

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}
async function expectReject(name, fn) {
  try {
    await fn();
    check(name, false);
  } catch (_) {
    check(name, true);
  }
}


// =====================================================================
// 1) Time Capsule（CMTL1）— 本体アプリ経路
// =====================================================================
async function groupTimelock(win) {
  const TL = win.TimeLockApp;
  check('1: TimeLockApp が利用できる', !!TL);
  const bytesA = TL.dearmorTimelock(CAPSULE_A)[0];
  check('1: フィクスチャAをデアーマーできる', !!bytesA && bytesA.length > 100);
  const meta = TL.unpackCMTL1(bytesA).meta;
  check('1: 正常なカプセルのメタデータを読み取れる', meta.round === BEACON_A.round && meta.mode === 'A');

  const decA = await TL.decryptTimelockCapsule({
    packets: [bytesA], beacon: BEACON_A, allowNetworkFetch: false, seedNum: '0'
  });
  check('1: 正常なカプセルA（時間解禁のみ）を復号できる',
    typeof decA.text === 'string' && decA.text.startsWith('CM-A2-VERIFY ::'));

  const bytesB = TL.dearmorTimelock(CAPSULE_B)[0];
  const decB = await TL.decryptTimelockCapsule({
    packets: [bytesB], beacon: BEACON_B, allowNetworkFetch: false, seedNum: '0', password: CAPSULE_B_PW
  });
  check('1: 正常なカプセルB（パスワード付き）を復号できる',
    typeof decB.text === 'string' && decB.text.startsWith('CM-A2-VERIFY-B ::'));
  await expectReject('1: カプセルBのパスワード不一致を拒否する', () =>
    TL.decryptTimelockCapsule({
      packets: [bytesB], beacon: BEACON_B, allowNetworkFetch: false, seedNum: '0', password: 'wrong-password-0000'
    }));

  // ヘッダー改ざん: ラウンド番号を書き換える（長さは変えない）
  const hdrLen = new DataView(bytesA.buffer, bytesA.byteOffset, bytesA.byteLength).getUint32(5, false);
  const hdrJson = new TextDecoder().decode(bytesA.subarray(9, 9 + hdrLen));
  check('1: フィクスチャのヘッダーJSONにラウンドが含まれる', hdrJson.includes('"round":' + BEACON_A.round));
  const tamperHeader = (json) => {
    const out = new Uint8Array(bytesA);
    out.set(new TextEncoder().encode(json), 9);
    return out;
  };
  await expectReject('1: ヘッダーのラウンド改ざんを拒否する', () =>
    TL.unpackCMTL1(tamperHeader(hdrJson.replace('"round":' + BEACON_A.round, '"round":' + (BEACON_A.round + 1)))));
  const hashTampered = hdrJson.replace('"chainHash":"' + hdrJson.split('"chainHash":"')[1][0],
    '"chainHash":"' + (hdrJson.split('"chainHash":"')[1][0] === 'a' ? 'b' : 'a'));
  await expectReject('1: ヘッダーのChain Hash改ざんを拒否する', () =>
    TL.unpackCMTL1(tamperHeader(hashTampered)));

  await expectReject('1: 切り詰めたカプセルを拒否する', () =>
    TL.unpackCMTL1(bytesA.slice(0, Math.floor(bytesA.length / 2))));
  const badMagic = new Uint8Array(bytesA); badMagic[0] ^= 0xff;
  await expectReject('1: マジック破損カプセルを拒否する', () => TL.unpackCMTL1(badMagic));
  const badVer = new Uint8Array(bytesA); badVer[4] = 9;
  await expectReject('1: 未対応バージョンのカプセルを拒否する', () => TL.unpackCMTL1(badVer));

  // 暗号文改ざん: 末尾バイトを反転して復号を試みる
  const tamperedCipher = new Uint8Array(bytesA);
  tamperedCipher[tamperedCipher.length - 1] ^= 0xff;
  await expectReject('1: 暗号文を改ざんしたカプセルの復号を拒否する', () =>
    TL.decryptTimelockCapsule({
      packets: [tamperedCipher], beacon: BEACON_A, allowNetworkFetch: false, seedNum: '0'
    }));

  // ビーコン検証: ラウンド違い・偽署名
  await expectReject('1: ラウンド違いのビーコンを拒否する', () =>
    TL.decryptTimelockCapsule({
      packets: [bytesA],
      beacon: { round: BEACON_A.round + 1, signature: BEACON_A.signature, randomness: BEACON_A.randomness },
      allowNetworkFetch: false, seedNum: '0'
    }));
  await expectReject('1: 偽署名のビーコンを拒否する', () =>
    TL.decryptTimelockCapsule({
      packets: [bytesA],
      beacon: { round: BEACON_A.round, signature: '00'.repeat(96), randomness: '00'.repeat(32) },
      allowNetworkFetch: false, seedNum: '0'
    }));

  check('1: ゴミ文字列はデアーマーで空になる', TL.dearmorTimelock('これはカプセルではありません').length === 0);
  await expectReject('1: ランダムなバイト列をパケットとして拒否する', () =>
    TL.parseAnyTimelockPacket(new Uint8Array(64).fill(7)));
}

// =====================================================================
// 1b) Time Capsule — 復元ツール（timelock-recover.html、別実行経路）
// =====================================================================
async function groupRecoverTool() {
  const { webcrypto } = require('crypto');
  const virtualConsole = new VirtualConsole();
  const dom = await JSDOM.fromFile(path.join(CONTENTS, 'timelock-recover.html'), {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
      window.scrollTo = () => {};
      if (window.Element) window.Element.prototype.scrollIntoView = () => {};
    }
  });
  const win = dom.window;
  await new Promise((r) => {
    if (win.document.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  await sleep(1200);
  const $ = (id) => win.document.getElementById(id);
  check('1b: 復元ツールの要素が揃っている', !!$('rec-text') && !!$('rec-btn-decrypt') && !!$('rec-manual-beacon'));

  async function runDecrypt(capsuleText, beaconObj) {
    $('rec-btn-clear').click();
    await sleep(150);
    $('rec-text').value = capsuleText;
    $('rec-beacon-manual').click();
    await sleep(150);
    $('rec-manual-beacon').value = JSON.stringify(beaconObj);
    $('rec-btn-decrypt').click();
    await waitFor(() => {
      const s = $('rec-status').textContent || '';
      return (s.includes('✅') || s.includes('❌')) ? s : null;
    }, '復元ツールの復号結果', 30000);
    await sleep(200);
    const r = {
      status: $('rec-status').textContent || '',
      resultHidden: $('rec-result-card').hidden,
      text: $('rec-result-text').value || '',
      meta: $('rec-result-meta').textContent || ''
    };
    if (process.env.DEBUG_TEST) console.log('  [rec]', JSON.stringify(r).slice(0, 220));
    return r;
  }

  const ok = await runDecrypt(CAPSULE_A, BEACON_A);
  check('1b: 復元ツールで正常なカプセルを復号できる',
    ok.resultHidden === false && ok.text.startsWith('CM-A2-VERIFY ::'));
  check('1b: 復元ツールの結果に使用ビーコン番号が出る', ok.meta.includes('#' + BEACON_A.round));

  const tam = CAPSULE_A.split('');
  const mid = Math.floor(tam.length / 2);
  tam[mid] = tam[mid] === 'A' ? 'B' : 'A';
  const bad = await runDecrypt(tam.join(''), BEACON_A);
  // 失敗時は結果カードが隠れる（前回成功時の平文が DOM に残っても表示はされない）
  check('1b: 復元ツールは改ざんカプセルを拒否し結果を表示しない',
    bad.status.includes('❌') && bad.resultHidden === true);

  const wrongRound = await runDecrypt(CAPSULE_A, {
    round: BEACON_A.round + 1, signature: BEACON_A.signature
  });
  check('1b: 復元ツールはラウンド違いのビーコンを拒否する',
    wrongRound.status.includes('❌') && wrongRound.resultHidden === true);
}

// =====================================================================
// 2) 保管庫（bv）— 本体 UI 経路
// =====================================================================
async function groupVault(win) {
  const $ = (id) => win.document.getElementById(id);
  // file:// 相当の jsdom では localStorage が SecurityError になるため差し替える
  const store = new Map([
    ['cm_skip_duress_popup', 'true'],
    ['cm_consent_section4_v1', 'v1']
  ]);
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size; }
    }
  });
  win.__SKIP_DURESS_MODAL__ = true;

  $('bv-text-content').value = BV_SECRET;
  $('bv-password').value = BV_PW;
  $('bv-password-confirm').value = BV_PW;
  if ($('bv-kdf')) $('bv-kdf').value = '1';
  $('bv-btn-encrypt').click();
  await waitFor(() => !$('bv-encrypt-result').hidden, 'bv暗号化の完了', 30000);
  const armor = $('bv-single-ta') ? $('bv-single-ta').value : '';
  check('2: UIで保管庫の暗号化テキストを作成できる',
    armor.includes('-----BEGIN CRYPTOMATRIX VAULT') && armor.length > 200);

  async function runVaultDecrypt(text, pw) {
    $('bv-decrypt-status').textContent = '';
    $('bv-restore-text').value = text;
    $('bv-restore-password').value = pw;
    $('bv-btn-decrypt').click();
    await waitFor(() => {
      const s = $('bv-decrypt-status').textContent || '';
      return s.length > 0 && !s.includes('処理しています') ? s : null;
    }, 'bv復号の結果', 30000);
    await sleep(200);
    const r = {
      status: $('bv-decrypt-status').textContent || '',
      resultHidden: $('bv-decrypt-result').hidden,
      content: $('bv-decrypted-content').textContent || ''
    };
    if (process.env.DEBUG_TEST) console.log('  [bv]', JSON.stringify(r).slice(0, 220));
    return r;
  }

  const ok = await runVaultDecrypt(armor, BV_PW);
  check('2: 正常な保管庫データを復号できる',
    ok.resultHidden === false && ok.content.includes(BV_SECRET));

  const truncated = await runVaultDecrypt(armor.slice(0, armor.length - 60), BV_PW);
  check('2: 切り詰めた暗号化テキストを拒否する',
    truncated.resultHidden === true && !truncated.status.includes('✅') && truncated.status.length > 0);

  const chars = armor.split('');
  const mid = Math.floor(chars.length / 2);
  chars[mid] = chars[mid] === 'A' ? 'B' : 'A';
  const tampered = await runVaultDecrypt(chars.join(''), BV_PW);
  check('2: 改ざんした暗号化テキストを拒否する',
    tampered.resultHidden === true && tampered.status.includes('破損しています'));

  const wrongPw = await runVaultDecrypt(armor, 'bv-wrong-password-000');
  check('2: パスワード不一致を拒否する',
    wrongPw.resultHidden === true && wrongPw.status.includes('破損しています'));

  const garbage = await runVaultDecrypt('-----BEGIN CRYPTOMATRIX VAULT-----\nAAAA\n-----END CRYPTOMATRIX VAULT-----', BV_PW);
  check('2: 形式だけ似せたゴミを拒否する',
    garbage.resultHidden === true && !garbage.status.includes('✅'));
}

// =====================================================================
// 4a) CMV1（旧形式コンテナ）
// =====================================================================
async function groupCmv1(win) {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'compatibility', 'fixtures.json'), 'utf8'));
  const f = fx.fixtures.find((x) => x.kind === 'cmv1');
  check('4: CMV1フィクスチャが存在する', !!f);
  const fixtureBytes = new Uint8Array(Buffer.from(f.packedB64, 'base64'));
  const un = win.unpackCMV1(fixtureBytes);
  check('4: 正常なCMV1フィクスチャを読み取れる',
    un.type === f.expect.type && un.name === f.expect.name &&
    new win.TextDecoder().decode(un.payload) === f.expect.payload);

  const packed = win.packCMV1('text', 'note.txt', new win.TextEncoder().encode('cmv1-roundtrip'));
  const rt = win.unpackCMV1(packed);
  check('4: packCMV1→unpackCMV1 の往復ができる',
    rt.type === 'text' && rt.name === 'note.txt' && new win.TextDecoder().decode(rt.payload) === 'cmv1-roundtrip');

  await expectReject('4: 切り詰めたCMV1を拒否する', () =>
    win.unpackCMV1(fixtureBytes.slice(0, fixtureBytes.length - 4)));
  const badMagic = new Uint8Array(fixtureBytes); badMagic[1] ^= 0xff;
  await expectReject('4: マジック破損CMV1を拒否する', () => win.unpackCMV1(badMagic));
  // ペイロード長フィールドを実際より大きく詐称する
  const nameLen = new DataView(fixtureBytes.buffer, fixtureBytes.byteOffset, fixtureBytes.byteLength).getUint16(46, false);
  const lenForged = new Uint8Array(fixtureBytes);
  new DataView(lenForged.buffer, lenForged.byteOffset, lenForged.byteLength)
    .setUint32(48 + nameLen, 999999, false);
  await expectReject('4: ペイロード長を詐称したCMV1を拒否する', () => win.unpackCMV1(lenForged));
  const nameForged = new Uint8Array(fixtureBytes);
  new DataView(nameForged.buffer, nameForged.byteOffset, nameForged.byteLength)
    .setUint16(46, 60000, false);
  await expectReject('4: 名前長を詐称したCMV1を拒否する', () => win.unpackCMV1(nameForged));
  await expectReject('4: 空入力を拒否する', () => win.unpackCMV1(new Uint8Array(0)));
  await expectReject('4: 短すぎる入力を拒否する', () => win.unpackCMV1(new Uint8Array(20)));
}

// =====================================================================
// 4b) MCBK1（旧形式バックアップ文字列）— 復元 UI 経路
// =====================================================================
async function groupMcbk(win) {
  const M = win.MatrixCardPreset;
  const $ = (id) => win.document.getElementById(id);
  const seedWords = [...win.document.querySelectorAll('#seed-words-container .seed-txt')]
    .map((e) => e.textContent.trim());
  check('4b: シードフレーズ（レシピcore源）が24語ある', seedWords.length === 24);
  const core = await M.bip39WordsToEntropy(seedWords.join(' '));
  check('4b: coreが32バイトである', core.length === 32);

  const b64u = (b) => Buffer.from(b).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sha256hex = async (bytes) => {
    const h = await win.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  // P形式（平文・検証値付き）
  const pPayload = new TextEncoder()
    .encode(JSON.stringify({ t: 'MC', v: 1, p: 'C1', s: 'B', c: b64u(core) }));
  const pPacket = 'MCBK1:P:' + b64u(pPayload) + '.' + await sha256hex(pPayload);
  // E形式（パスワード暗号化）: 本番の復号仕様（PBKDF2-SHA256 310000回 /
  // AES-256-GCM / AAD は形式固定文字列）どおりにテスト入力を組み立てる
  const LEGACY_PW = 'mcbk-legacy-password';
  const ePayload = new TextEncoder().encode(JSON.stringify({
    t: 'MC', v: 1, p: 'C1', s: 'E', c: b64u(core),
    n: 'example.com', w: 'legacy-secret', h: await sha256hex(new TextEncoder().encode('expected'))
  }));
  async function buildE(cipherMutator) {
    const salt = win.crypto.getRandomValues(new Uint8Array(16));
    const iv = win.crypto.getRandomValues(new Uint8Array(12));
    const base = await win.crypto.subtle.importKey('raw', new TextEncoder().encode(LEGACY_PW), 'PBKDF2', false, ['deriveKey']);
    const key = await win.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    let cipher = new Uint8Array(await win.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('MCBK1:E:PBKDF2-SHA256:310000:AES-256-GCM'), tagLength: 128 },
      key, ePayload));
    if (cipherMutator) cipher = cipherMutator(cipher);
    return 'MCBK1:E:' + b64u(salt) + '.' + b64u(iv) + '.' + b64u(cipher);
  }
  const ePacket = await buildE(null);

  async function runReview(packet, pw) {
    $('bq-import').value = packet;
    $('bq-restore-password').value = pw || '';
    $('bq-review').click();
    await waitFor(() => {
      const s = $('bq-scan-status').textContent || '';
      return s.length > 0 && !s.includes('検証しています') ? s : null;
    }, 'MCBK検証の結果', 30000);
    await sleep(200);
    return {
      status: $('bq-scan-status').textContent || '',
      applyDisabled: $('bq-apply').disabled,
      previewHidden: $('bq-preview').hidden
    };
  }

  const okP = await runReview(pPacket, '');
  check('4b: 正常なMCBK1:Pを受け入れる',
    okP.applyDisabled === false && okP.previewHidden === false && okP.status.includes('検証が完了'));

  const badHash = pPacket.slice(0, -1) + (pPacket.endsWith('0') ? '1' : '0');
  const ngHash = await runReview(badHash, '');
  check('4b: 検証値が一致しないMCBK1:Pを拒否する',
    ngHash.applyDisabled === true && ngHash.status.includes('破損'));

  const ngTrunc = await runReview(pPacket.slice(0, Math.floor(pPacket.length / 2)), '');
  check('4b: 切り詰めたMCBK1:Pを拒否する', ngTrunc.applyDisabled === true);

  const ngHead = await runReview('MCBK1:X:' + pPacket.slice(8), '');
  check('4b: 不正なヘッダーのMCBK1を拒否する', ngHead.applyDisabled === true);

  const okE = await runReview(ePacket, LEGACY_PW);
  check('4b: 正常なMCBK1:Eを受け入れる',
    okE.applyDisabled === false && okE.previewHidden === false);

  const eTampered = await buildE((c) => { const t = new Uint8Array(c); t[t.length - 1] ^= 0xff; return t; });
  const ngE = await runReview(eTampered, LEGACY_PW);
  check('4b: 暗号文を改ざんしたMCBK1:Eを拒否する', ngE.applyDisabled === true);

  const ngPw = await runReview(ePacket, 'mcbk-wrong-password');
  check('4b: パスワード違いのMCBK1:Eを拒否する', ngPw.applyDisabled === true);
}

// =====================================================================
// 5) BIP39 フレーズ
// =====================================================================
async function groupBip39(win) {
  const M = win.MatrixCardPreset;
  const entropy = new Uint8Array(32);
  for (let i = 0; i < 32; i++) entropy[i] = (i * 7 + 3) & 0xff;
  const words = await M.entropyToBip39Words(entropy);
  const wordArr = Array.isArray(words) ? words : String(words).split(' ');
  check('5: 正常な24語を生成できる', wordArr.length === 24);
  const back = await M.bip39WordsToEntropy(wordArr.join(' '));
  check('5: 正常な24語は受理され entropy が往復する',
    Buffer.from(back).equals(Buffer.from(entropy)));

  const csBad = [...wordArr];
  csBad[23] = csBad[23] === 'abandon' ? 'ability' : 'abandon';
  await expectReject('5: チェックサム不一致のフレーズを拒否する', () =>
    M.bip39WordsToEntropy(csBad.join(' ')));
  await expectReject('5: 23語のフレーズを拒否する', () =>
    M.bip39WordsToEntropy(wordArr.slice(0, 23).join(' ')));
  await expectReject('5: 25語のフレーズを拒否する', () =>
    M.bip39WordsToEntropy([...wordArr, wordArr[0]].join(' ')));
  const unknown = [...wordArr];
  unknown[5] = 'zzzznotaword';
  await expectReject('5: リスト外単語を含むフレーズを拒否する', () =>
    M.bip39WordsToEntropy(unknown.join(' ')));
  await expectReject('5: 空のフレーズを拒否する', () => M.bip39WordsToEntropy(''));
}

// =====================================================================
// 3) TimeSecret — IndexedDB レコードの破損
// =====================================================================
async function loadTsPage() {
  const html = fs.readFileSync(path.join(CONTENTS, 'index.html'), 'utf8');
  const store = new Map();
  const dom = new JSDOM(html, {
    url: 'https://localhost/contents/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
          clear: () => store.clear(),
          key: (i) => [...store.keys()][i] ?? null,
          get length() { return store.size; }
        }
      });
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {}, readText: async () => '' }
      });
      window.indexedDB = new IDBFactory();
      try {
        Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
      } catch (_) {}
      window.URL.createObjectURL = () => 'blob:fake';
      window.URL.revokeObjectURL = () => {};
      window.HTMLCanvasElement.prototype.getContext = function () {
        const target = { canvas: this };
        return new Proxy(target, {
          get: (t, k) => (k in t ? t[k] : () => ({ width: 0, height: 0, data: new Uint8ClampedArray(4) })),
          set: () => true
        });
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => '';
      if (window.Element && !window.Element.prototype.scrollIntoView) {
        window.Element.prototype.scrollIntoView = () => {};
      }
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    }
  });
  const { window } = dom;
  for (const f of MANUAL_SCRIPTS) {
    try { window.eval(fs.readFileSync(path.join(CONTENTS, f), 'utf8')); }
    catch (e) { console.log('script load note:', f, '-', e.message.slice(0, 80)); }
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  const app = await waitFor(() => window.TimeSecretApp, 'TimeSecretApp');
  await sleep(400);
  return { window, app };
}

async function groupTimeSecret() {
  const { window, app } = await loadTsPage();
  const enc = new window.TextEncoder();
  app.recordConsent();
  const v = await app.createVault({
    label: '破損入力テスト', kind: 'text', plainBytes: enc.encode(TS_SECRET),
    usePassword: true, password: TS_PW, kdfProfile: 1,
    intervalMs: 30 * 24 * 3600 * 1000,
    checkInAuth: { mode: 'none' }, managementAuth: { mode: 'none' }
  });
  const vid = v.vaultId;
  check('3: 保管庫を作成できる', typeof vid === 'string' && vid.length > 0);
  const ok = await app.decryptVault(vid, { password: TS_PW });
  check('3: 正常なレコードを復号できる', ok.text === TS_SECRET);

  const idbOpen = () => new Promise((res, rej) => {
    const r = window.indexedDB.open('CryptoMatrix_TimeSecret_v1', 3);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const idbGet = async () => {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const rq = db.transaction('vaults', 'readonly').objectStore('vaults').get(vid);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  };
  const idbPut = async (rec) => {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction('vaults', 'readwrite');
      tx.objectStore('vaults').put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  };
  const original = await idbGet();
  check('3: レコードに envelope が存在する', !!original && !!original.envelope);

  async function tamperCase(name, mutate) {
    const rec = structuredClone(original);
    mutate(rec);
    await idbPut(rec);
    await expectReject(name, () => app.decryptVault(vid, { password: TS_PW }));
  }
  await tamperCase('3: 暗号文を改ざんしたレコードを拒否する', (r) => {
    r.envelope.payloadCiphertext[0] ^= 0xff;
  });
  await tamperCase('3: IVを改ざんしたレコードを拒否する', (r) => {
    const iv = r.envelope.payloadIv;
    if (iv instanceof Uint8Array) iv[0] ^= 0xff;
    else r.envelope.payloadIv = String(iv).split('').reverse().join('');
  });
  await tamperCase('3: ペイロードハッシュを改ざんしたレコードを拒否する', (r) => {
    r.envelope.payloadHashHex = '0'.repeat(64);
  });
  await tamperCase('3: コミット値を改ざんしたレコードを拒否する', (r) => {
    r.envelope.envelopeCommitHex = 'f'.repeat(64);
  });
  await tamperCase('3: envelope欠落レコードを拒否する', (r) => {
    delete r.envelope;
  });
  await tamperCase('3: 不正なハッシュ値のレコードを拒否する', (r) => {
    r.envelope.payloadHashHex = 'not-a-hex-value';
  });

  // 改ざん拒否のあとも原本に戻せば復号できる（拒否が破壊を伴わない）
  await idbPut(structuredClone(original));
  const restored = await app.decryptVault(vid, { password: TS_PW });
  check('3: 原本に戻せば再び復号できる', restored.text === TS_SECRET);
  await expectReject('3: パスワード違いを拒否する', () =>
    app.decryptVault(vid, { password: 'ts-wrong-password-000' }));
}

(async () => {
  const win = await loadApp(CONTENTS);
  await groupTimelock(win);
  await groupRecoverTool();
  await groupVault(win);
  await groupCmv1(win);
  await groupMcbk(win);
  await groupBip39(win);
  await groupTimeSecret();
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
