# Crypto Matrix

[![Open Crypto Matrix](https://img.shields.io/badge/Open-Crypto%20Matrix-0284c7?style=for-the-badge&logo=github)](https://cryptopasskey.github.io/crypto_matrix/contents/index.html)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10b981?style=for-the-badge)](https://cryptopasskey.github.io/crypto_matrix/contents/index.html)
[![Zero Network](https://img.shields.io/badge/Network-Zero%20Airgap-6366f1?style=for-the-badge)](#完全エアギャップ--オフライン動作)

**Crypto Matrix** は、ブラウザ上で完結して動作する次世代のパスワード生成・暗号化バックアップ・タイムロック（時間解禁暗号）セキュリティツールです。
サーバーへの通信を一切行わず、機内モード（完全エアギャップ）でも安全に動作します。

👉 **[Crypto Matrix を開く（Web版）](https://cryptopasskey.github.io/crypto_matrix/contents/index.html)**

---

## 5大コア機能

1. **🔠 暗号マトリックス ＆ パスワード生成（セクション1・2）**
   * 物理マトリックスカードとカード配列シード番号（0〜9999）から、推測不能で強固なパスワードをいつでも決定的（Deterministic）に再現。
   * サイト名・合言葉・文字種ルール（マイ・レシピ）を柔軟に設定可能。
2. **📦 BIP39暗号化バックアップ（セクション3）**
   * レシピ設定やシード番号を多層暗号化（CME3）し、BIP39 24単語ブロック形式またはPGPアーマード形式で出力・保存。
   * スマホのカメラや画像ファイルからQRコードを読み取って瞬時に復元。
3. **🏛️ セキュア保管庫 / Bonus Vault（セクション4）**
   * 任意の秘密テキストや機密ファイル（PDF・写真・ドキュメント等）をブラウザ内で直接暗号化・復号。
4. **⏳ タイムロック / Time Lock（セクション5）**
   * 分散型ランダムネスビーコン（drand quicknet / BLS12-381 IBE + AGE）を採用。
   * 指定日時（対象ラウンド）が到来するまで、**世界中の誰も（作成者本人やスーパーコンピュータでも）絶対に開封できない**数学的時間カプセル暗号。
   * サイト消滅時でも復号できる単一完結型の独立復元ツール（`timelock-recover.html`）を同梱。
5. **🧩 シャミアの秘密分散（Shamir's Secret Sharing）**
   * 全セクション共通で $M$-of-$N$ 秘密分散（例: 2-of-3, 3-of-5）に対応。
   * パスワードなしの**「秘密分散のみ（分散暗号）」**による完全秘匿・分散保管が可能。

---

## 主なセキュリティ仕様

* **二重カスケード多層暗号（CME3）**:
  * 内層を `ChaCha20-Poly1305`、外層を `AES-256-GCM` で暗号化。
  * `HKDF-SHA-512` により各アルゴリズムの暗号鍵および認証鍵を数学的に完全分離。
* **Key-Commitment（鍵コミットメント）**:
  * `HMAC-SHA-256`（128-bit truncated）による改ざん・差し替え・誤パスワード瞬時検出。
* **高強度KDF（鍵導出関数）**:
  * **PBKDF2-HMAC-SHA-512**: 推奨210万回〜超高強度500万回。
  * **Argon2id (WASM)**: メモリ64MB〜256MB / 3〜4反復（GPU・専用ASIC耐性）。
* **生体認証・Passkey連携（WebAuthn PRF）**:
  * iCloudキーチェーン、Googleパスワードマネージャー、YubiKey 5シリーズ等の生体認証・ハードウェアキーによる暗号鍵導出。
  * 暗号化ごとに独立した256bitソルトを使用し、**同一パスキーの安全な再利用**に対応（鍵マネージャーに不要なパスキーが増殖しません）。
* **物理カード連動（1Password Secret Key型二重暗号化）**:
  * タイムロック（Time Capsule）は、drand quicknetの時間暗号の内側に、アプリ固有ペッパーおよび**物理カード配列シード番号**を連動させた `CMA1` 二重暗号化を適用。外部汎用ツールでの直接開封を遮断。
* **緊急時のおとり復号（Duress Dual-Slot）**:
  * 脅迫・強要時に「おとり用パスワード」を入力すると、あらかじめ用意した無害なダミーデータを開封・表示。
* **メモリ保護（Zeroize）**:
  * 平文、パスワード、暗号鍵、中間バッファは処理完了直後にメモリ上で 0 埋め消去。

---

## 使い方

1. **[Crypto Matrix](https://cryptopasskey.github.io/crypto_matrix/contents/index.html)** を開きます。
2. **パスワード生成**:
   * カード配列シード番号（カード裏面の番号等）、サイト名、秘密の合言葉を入力し、安全なパスワードを生成します。
3. **バックアップ・保管庫**:
   * パスワード、キーファイル、パスキー、または秘密分散を自由に組み合わせてデータを暗号化します。
   * 暗号化ファイル（`.cmenc`）、テキスト（`.txt`）、QRコード画像（`.png`）、またはKeePass直接連携（`📥 KeePassに保存`）で保管します。
4. **タイムロック**:
   * 解禁日時（未来の特定日時または「◯日後」）を指定してタイムカプセルを作成します。
   * 指定時刻到来後、drand quicknetビーコンを照合して開封・復元します。

---

## 完全エアギャップ / オフライン動作

* **通信ゼロ設計**:
  * すべてのHTML、JavaScript、CSS、WebAssembly、フォント、アイコン（インラインSVG）は完全ローカル同梱されており、外部サーバーへの通信は一切発生しません。
* **PWA（ホーム画面に追加）対応**:
  * iPhone（Safari）の「ホーム画面に追加」、または Android / PC（Chrome・Edge）の「インストール」を行うことで、機内モードや完全オフライン環境でもアイコンから一瞬で起動できます。

---

## ファイル構成（contents/）

| ファイル / フォルダ | 役割 |
|---|---|
| `index.html` | メインアプリケーション画面（全5タブ構成・PWA対応） |
| `index.js` | コア暗号・計算エンジン（Matrix PRNG, BIP39, CME3, WebAuthn PRF） |
| `backup-qr.js` | セクション3（BIP39バックアップ）、セクション4（セキュア保管庫）、KeeWeb連携 |
| `timelock.js` | セクション5（タイムロック暗号化・復元・リカバリーガイド生成） |
| `timelock-recover.html` | サイト消滅時でもタイムロックを検査・復号できる単一完結型独立復元ツール |
| `vendor/tlock.bundle.js` | drand quicknet (BLS12-381 IBE + AGE) タイムロックエンジン |
| `vendor/jsQR.js` | カメラ・画像ファイルからのQRコード読取補助ライブラリ |
| `argon2.umd.min.js` | Argon2id KDF用WebAssembly |
| `qr-encoder.js` | 高速QRコード生成エンジン |
| `app.js` / `app.css` | UI制御（テーマ切替、覗き見防止、強度メーター、クリップボード消去、パスキー管理） |
| `theme-cyber.css` | サイバーテーマ（ダークモード ＆ ライトモード完全対応） |
| `manifest.json` / `sw.js` | PWAマニフェスト ＆ サービスワーカー（オフラインキャッシュ管理） |
| `keeweb/` | KeePass（KeeWeb）オフライン直接連携 |

---

## 注意事項

* **復元要素の保管**:
  * 設定した復元用パスワード、キーファイル、連動カードシード番号はバックアップデータ内に記録されません。紛失すると開発者であっても絶対に復号できませんので安全に別保管してください。
* **タイムロックの絶対性**:
  * タイムロックで指定した解禁日時より前には、数学的・理論的にいかなる手段を用いても開封できません。
* **パスキー（WebAuthn PRF）の前提**:
  * WebAuthn PRF暗号化は、同一ドメイン（Origin）およびPRF対応の認証器（iCloudキーチェーン、Googleパスワードマネージャー、YubiKey 5系）でのみ復元できます。
