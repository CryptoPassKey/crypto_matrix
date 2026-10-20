# Crypto Matrix

[![Open Crypto Matrix](https://img.shields.io/badge/Open-Crypto%20Matrix-0284c7?style=for-the-badge&logo=github)](https://cryptopasskey.github.io/crypto_matrix/contents/index.html)

**Crypto Matrix** は、ブラウザ上で動作するパスワード生成・暗号化バックアップツールです。

👉 **[Crypto Matrix を開く](https://cryptopasskey.github.io/crypto_matrix/contents/index.html)**

## 主な機能

- マトリックスカードとシードからパスワードを生成
- Argon2id / PBKDF2 による鍵導出
- AES-256-GCM と ChaCha20-Poly1305 による多層暗号化
- Key-Committing HMAC-SHA-256
- キーファイル・Passkey（WebAuthn PRF）による多要素保護
- BIP39形式のバックアップとShamir Secret Sharing
- KeePass / KeeWeb連携

## 使い方

1. 上のボタンまたはリンクから **Crypto Matrix** を開きます。
2. マトリックスカードの設定、サイト名、秘密のフレーズを入力します。
3. 生成されたパスワードを確認します。
4. 必要に応じて、暗号化バックアップやKeePass用キーファイルを作成します。

## セキュリティ

- Argon2id選択時は、64MBメモリ・3反復のArgon2idで鍵素材を導出します。
- HKDF-SHA-512により、AES-GCM用・ChaCha20-Poly1305用・HMAC用の鍵を分離します。
- 内層をChaCha20-Poly1305、外層をAES-256-GCMで暗号化する二重カスケード構成です。
- 鍵コミットメント用のHMAC-SHA-256タグを付与します。

## 注意

- 生成したパスワード、シード、バックアップは安全な場所に保管してください。
- ブラウザの履歴、同期、共有端末の利用状況にも注意してください。
- 本ツールはローカル処理を基本としていますが、重要な情報を扱う際は信頼できる環境で利用してください。
