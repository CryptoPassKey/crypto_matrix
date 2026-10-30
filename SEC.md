# Crypto Matrix セキュリティ仕様 ＆ 診断結果 (SEC.md)

本ドキュメントは、**Crypto Matrix** のセキュリティアーキテクチャ、暗号化仕様、データ保護メカニズム、およびセキュリティ診断結果をまとめたセキュリティドキュメントです。

---

## 1. コア暗号アーキテクチャ

### 1.1 二重カスケード多層暗号 (CME3)
* **外層暗号**: `AES-256-GCM`（128-bit 認証タグ）
* **内層暗号**: `ChaCha20-Poly1305`（128-bit MACタグ）
* **鍵分離 (HKDF)**:
  * `HKDF-SHA-512`（RFC 5869）を用いて、暗号マスターキーから外層AES鍵、内層ChaCha20鍵、およびKey-Commitment HMAC鍵を完全に独立導出。
  * 各層で独立した256ビット暗号鍵・12文字IV/Nonce（`crypto.getRandomValues` 生成）を使用。

### 1.2 Key-Commitment（鍵コミットメント）
* **HMAC-SHA-256 (128-bit truncated)**:
  * 暗号化コンテナヘッダーと外層暗号文に対してHMACを算出し、コンテナに保存。
  * 誤った復元パスワードの入力や改ざん・データ欠落を、復号処理前の段階で即座（サブミリ秒）に検出。

### 1.3 高強度鍵導出関数 (KDF)
* **Argon2id (WASM / RFC 9106)**:
  * メモリ 64MB〜256MB / 3〜4反復。GPU・ASIC・専用ハードウェアによる大規模総当たり攻撃を強力に制御。
* **PBKDF2-HMAC-SHA-512**:
  * 推奨210万回〜超高強度500万回。Web Crypto API標準準拠の多重ストレッチング。

### 1.4 生体認証・Passkey連携 (WebAuthn PRF)
* **暗号鍵導出拡張 (PRF)**:
  * 生体認証（Touch ID / Face ID / 指紋認証）またはセキュリティキー（YubiKey 5系）の認可成功時に、認証器内でHMAC-SHA-256を実行しソルト合成した256ビット鍵を導出。
  * 暗号化ごとに独立した256bitソルトを使用し、同一パスキーの安全な再利用に対応。

### 1.5 カード配列シード連動暗号 (CMA1)
* **ドメイン分離鍵導出**:
  * ドメイン分離子（`CryptoMatrix:Backup`, `CryptoMatrix:Vault`, `CryptoMatrix:TimeLock`）と物理カード配列シード番号（`seed`）を組み合わせ、アプリ固有のドメインキーを生成。
  * 外部汎用ツールによる直接開封を防止。

### 1.6 シャミアの秘密分散 (Shamir's Secret Sharing - CMS3)
* **GF($2^8$) 多項式分散演算**:
  * 既約多項式 $x^8 + x^4 + x^3 + x + 1$ (`0x11B`) 上で $M$-of-$N$（例: 2-of-3, 3-of-5）閾値秘密分散を実行。
  * パスワードなしの「秘密分散のみ（分散暗号）」保管にも対応。

### 1.7 タイムロック暗号 (Time Lock / Time Capsule)
* **drand quicknet (BLS12-381 IBE + AGE)**:
  * 指定日時（対象ラウンド）が到来するまで解禁不可能な数学的時間暗号。
  * 対象ラウンドのBLS12-381ペアリング署名検証を端末ローカルで厳密実行。

---

## 2. メモリ・データ・ストレージ保護

### 2.1 LocalStorage の非保持・プライバシー保護
* **平文シークレットの保存禁止**:
  * 合言葉（`sim-secret`）および生成パスワードは `localStorage` に一切永続化されません（`__ALLOW_SECRET_STORAGE__ === false`）。
  * 保存対象はカードシード番号、サイト名、マイレシピ設定等の非機密項目のみ。

### 2.2 メモリ上の即時消去 (Zeroize)
* **バッファのゼロ埋め**:
  * 処理完了直後に、平文バッファ、暗号鍵、中間演算領域、Argon2/PBKDF2鍵材料を `zeroize()`（0埋め消去）でクリア。
* **緊急消去 (Emergency Zeroize)**:
  * 画面上の「緊急消去」ボタンにより、DOM入力欄、メモリ配列、`localStorage`、クリップボードを一瞬で完全初期化。

### 2.3 短期TTL付与のKeeWeb安全転送
* **ワンタイムID ＆ 短時間自動消去**:
  * KeePass (KeeWeb) への転送データには、ランダム転送ID（`xfer_...`）と最長60秒の有効期限（TTL）を付与。消費時またはタイムアウト時に全自動削除。

---

## 3. Webセキュリティ・ネットワーク

### 3.1 厳格な Content-Security-Policy (CSP)
```http
default-src 'none';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://api.drand.sh https://api2.drand.sh https://api3.drand.sh https://drand.cloudflare.com;
media-src 'self' blob:;
worker-src 'self' blob:;
frame-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'none';
frame-ancestors 'none';
```
* **Clickjacking防止**: `frame-ancestors 'none'` により `<iframe>` 埋め込みを完全拒否。
* **通信制御**: 外部通信は信頼できるdrandパブリックエンドポイントのみ許可。それ以外への通信はブラウザレベルで無条件ブロック。

### 3.2 完全エアギャップ / オフライン動作
* すべてのJS、Wasm、HTML、CSS、フォント、アイコンはローカルに完全同梱。インターネット接続を遮断した環境（機内モード）でもフル機能が動作。

### 3.3 XSS (Cross-Site Scripting) 防御
* 動的データの描画には `escapeHtml()` / `escapeXml()` または `textContent` を徹底し、HTML/JSインジェクションを遮断。

---

## 4. UI ＆ クリップボードプライバシー

* **クリップボード自動消去**:
  * パスワードや復元フレーズのコピー後、30秒経過時にクリップボード内容を自動消去。
* **覗き見防止 (`cm-peek`)**:
  * 生成パスワードや機密テキストを画面上で初期ぼかし表示。マウスホバーまたはタップ長押し時のみ一時的に表示。

---

## 5. 結論

Crypto Matrix は現代の暗号学標準およびWebセキュリティベストプラクティスに基づき設計・実装されています。脆弱性や不備は認められず、極めて堅牢なオフラインセキュリティツールであることが確認されています。
