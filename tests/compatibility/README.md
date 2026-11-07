# 後方互換性監査（tests/compatibility/）

アプリの更新で、既存ユーザーが作成した暗号化バックアップが復元できなくなる
事故を防ぐための回帰監査です。

## 仕組み

- `fixtures.json`: 過去の版の本番コードで作成したバックアップデータと、
  復号後に得られるはずの平文の対応表。すべてテスト専用のダミー値で作成され、
  実在のユーザー資産は含まれません。
- `compat-audit.js`: 現在の `contents/` の本番コードでフィクスチャを復号し、
  平文が完全に一致するか確認します。1件でも失敗すれば終了コード1です。
- `load-app.js`: 実ページを jsdom で読み込み、本番コードをそのまま実行する
  ためのローダーです。
- `generate-fixtures.js`: フィクスチャ生成用（手動実行専用）。

## 現在の対象

- BIP39 拡張バックアップ（サイト名・合言葉入り）
- BIP39 設定のみバックアップ
- BIP39 Shamir 分散バックアップ（2-of-3、シェア2つで復元）
- CME3 本文: KDFプロファイル 0/1/2（PBKDF2系）・3（Argon2id）
- CME3 本文: パスワード＋キーファイル
- CME3 おとり二重暗号（本命／おとり双方の復号）
- CMV1（無暗号パック形式）

## Compatibility Test Scope

This compatibility suite verifies backward compatibility using historical
test fixtures and validates successful decryption against expected plaintext.

The automated suite covers the compatibility cases supported by the current
test environment.

Environment-dependent features and legacy formats requiring separate
validation procedures are outside the scope of this automated CI check.

Passing this suite does not imply that every application feature or
execution environment has been independently verified.

## フィクスチャの再生成について

フィクスチャは「既知の良好な版」で一度だけ生成し、以後は変更しないのが
原則です。再生成すると、互換性を壊す変更に合わせて期待値も変わり、
監査の意味が失われます。やむを得ず再生成する場合は、生成に使った版と
理由をこのファイルに追記してください。

生成履歴:
- 初版（2026-11-07）: 基準コミット 7ea2dee68ee29961e6de4b723244ca677c2b8984
  （SW cm-v3.4.1-note-dark 時点の main）のコードで生成。全10件。
  通常の監査・開発では再生成しません。再生成は互換性検証の前提を変える
  作業なので、実施する場合は基準コミットと理由をここへ必ず追記してください。
