// 元のマークアップ（#cm-board 内）を、エンジン起動前にタブへ振り分ける。
// エンジンは DOM の id で動くので、要素を移動するだけで計算ロジックには一切触れない。
(function () {
  var board = document.getElementById('cm-board');
  var slots = {
    'card-quick': 'tab-quick',
    'section-recipe-detail': 'tab-recipe',
    'section-bip39-plain': 'tab-backup',
    'backup-qr': 'tab-backup',
    'bonus-vault': 'tab-vault',
    'page-footer': 'cm-footer-slot'
  };
  Object.keys(slots).forEach(function (id) {
    var el = board.querySelector('#' + id);
    var target = document.getElementById(slots[id]);
    if (el && target) target.appendChild(el);
  });
  // モーダル・ポップアップは body 直下へ（親の重なり順に閉じ込められないように）
  board.querySelectorAll('.duress-modal-backdrop, .help-popover').forEach(function (el) {
    document.body.appendChild(el);
  });
})();
