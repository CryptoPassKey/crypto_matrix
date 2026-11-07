# 監査テスト（tests/）

CryptoMatrix の品質監査を、変更のたびに再実行できる形でリポジトリに
保持するための置き場です。配布物（contents/）には影響しません。

## 実行方法

```sh
cd tests
npm ci
node accessibility/contrast-audit.js
node compatibility/compat-audit.js
```

Node.js 20 以上が必要です。CI では `.github/workflows/audit.yml` が
プルリクエストと main への push で同じ監査を実行します。

## 検査一覧

| 検査 | 内容 |
|---|---|
| accessibility/contrast-audit.js | 静的DOM全件＋動的生成DOMフィクスチャを両テーマで計測し、WCAG 2.2 AA（通常文字 4.5:1／大きな文字 3:1）への適合を検査 |
| compatibility/compat-audit.js | 過去の版で作成した暗号化バックアップ（フィクスチャ）が、現在のコードで復号して平文一致するか検査。詳細は compatibility/README.md |

セキュリティ関連の監査については、方針と実施状況の概要のみを本リポジトリで
管理し、詳細な検討資料は別途管理しています。

## 動的生成DOMフィクスチャの保守

JavaScript が生成するテキスト要素（警告・通知・バッジ・処理結果など）は
静的HTMLの監査では捕捉できません。生成UIを追加・変更した場合は
`accessibility/dynamic-dom-fixtures.js` へ実物どおりのフィクスチャを
追加してください。

## jsdom の限界と実ブラウザ検証

jsdom はレイアウト・メディアクエリ・一部カスケードを再現しないため、
コントラスト監査の実効色は近似です。「CIが緑＝実ブラウザでも適合」を
保証するものではありません。最終的な確認は実ブラウザ環境と実機確認を
併用してください。
