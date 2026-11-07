'use strict';
/**
 * 動的生成DOMのフィクスチャ集。
 *
 * 静的HTMLに現れない要素（JavaScriptが実行時に生成する警告・通知・状態表示）は
 * 静的DOMのコントラスト監査の母集団に入らない。過去に .cm-note-warn /
 * .cm-note-err のダークテーマ未達（2.51 / 2.75）がこの経路ですり抜けたため、
 * 実物の生成フラグメントを再現したフィクスチャを実カスケードへ注入して監査する。
 *
 * メンテナンス規則:
 * - JSからテキスト要素を生成するUI（警告・通知・バッジ・処理結果など）を
 *   追加・変更したら、対応するフィクスチャをここへ追加・更新すること。
 * - フィクスチャは生成側コードのクラス名・インラインスタイルをそのまま写す。
 *   ここだけを良く見せても監査の意味がない。
 */
module.exports = `
<div id="audit-root">
  <div class="bv-no-print cm-note-warn" style="font-size:0.74rem;padding:6px;max-width:260px;">⚠️ データ長が大きいため、一部のQRコードを省略しました。</div>
  <div class="bv-size-warning cm-note-err" style="font-size:0.74rem; padding:6px; margin-top:6px;">⚠️ サイズが大きいため、転送に時間がかかる場合があります。</div>
  <span class="cm-prot-init" style="display:inline-block; padding:4px 10px; border-radius:999px; border:1px solid; font-size:0.72rem; font-weight:700;">🛡️ 保護: なし</span>
  <span class="cm-prot-warn" style="display:inline-block; padding:4px 10px; border-radius:999px; border:1px solid; font-size:0.72rem; font-weight:700;">⚠️ 保護: パスワードのみ</span>
  <span class="cm-prot-err" style="display:inline-block; padding:4px 10px; border-radius:999px; border:1px solid; font-size:0.72rem; font-weight:700;">🚫 保護: なし（平文）</span>
  <span class="cm-prot-ok" style="display:inline-block; padding:4px 10px; border-radius:999px; border:1px solid; font-size:0.72rem; font-weight:700;">🛡️ 保護: 暗号化あり</span>
  <div class="cm-kdf-warn" style="font-size:0.78rem; padding:8px 10px; border-radius:6px;">⚠️ KDFコストが高く、処理に時間がかかります。</div>
  <div class="cm-kdf-err" style="font-size:0.78rem; padding:8px 10px; border-radius:6px;">⚠️ KDFコストが上限を超えています。</div>
  <span class="cm-strength-weak" style="font-size:0.78rem; font-weight:700;">弱い</span>
  <span class="cm-strength-mid" style="font-size:0.78rem; font-weight:700;">普通</span>
  <span class="cm-strength-strong" style="font-size:0.78rem; font-weight:700;">強い</span>
  <span style="font-size:0.78rem;padding:4px 10px;border-radius:999px;border:1px solid #f59e0b; color:#fbbf24; background:#292119;">転送済み</span>
  <span style="font-size:0.78rem;padding:4px 10px;border-radius:999px;border:1px solid #0284c7; color:#38bdf8; background:#192329;">受信済み</span>
  <span style="font-size:0.78rem;color:#92400e;background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;padding:6px 8px;">⚠️ 共有時の注意テキスト</span>
  <span class="cm-seed-chip" style="font-family:monospace; font-weight:700; padding:2px 8px; border-radius:4px; border-width:1px; border-style:solid;">#0</span>
  <div style="display:flex;align-items:center;gap:8px;background:#eef8f2;padding:6px 10px;"><span style="font-size:0.78rem; color:#1b2027;">生成結果のサマリー表示</span></div>
</div>`;
