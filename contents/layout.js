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
    'timelock-section': 'tab-timelock',
    'timesecret-section': 'tab-timesecret',
    'datatransfer-section': 'tab-datatransfer',
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

  // === バックアップタブのサブページ化 ===
  // 第1階層: バックアップ（BIP39） / 暗号化（拡張バックアップ）
  // 第2階層: 暗号化ページ内を 暗号化（作成） / 復号化（復元） に分割。
  // 保管庫タブの bv-tab-btn と同じ方式（btn / btn-outline の切替＋hidden）。
  // 復元ブロックは #bq-qr-list の直後の要素から節の末尾までを範囲で包む。
  var panel = document.getElementById('tab-backup');
  var bip39 = document.getElementById('section-bip39-plain');
  var bq = document.getElementById('backup-qr');
  if (panel && bip39 && bq) {
    var qrList = document.getElementById('bq-qr-list');
    var restoreStart = qrList ? qrList.nextElementSibling : null;
    var encWrap = document.createElement('div'); encWrap.id = 'bq-page-encrypt';
    var decWrap = document.createElement('div'); decWrap.id = 'bq-page-decrypt';
    var seenRestore = false;
    Array.prototype.slice.call(bq.children).forEach(function (el) {
      if (el === restoreStart) seenRestore = true;
      if (el.classList && el.classList.contains('section-title')) return; // 見出しは常時表示
      (seenRestore ? decWrap : encWrap).appendChild(el);
    });
    var subNav = document.createElement('div');
    subNav.style.cssText = 'display:flex; gap:8px; margin-bottom:14px; border-bottom:1px solid #304257; padding-bottom:8px; flex-wrap:wrap;';
    subNav.innerHTML =
      '<button type="button" class="btn" id="bq-nav-sub-encrypt" style="font-size:0.82rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>暗号化バックアップを作成</button>' +
      '<button type="button" class="btn btn-outline" id="bq-nav-sub-decrypt" style="font-size:0.82rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>復元・復号する</button>';
    var title = bq.querySelector('.section-title');
    if (title && title.nextSibling) bq.insertBefore(subNav, title.nextSibling); else bq.insertBefore(subNav, bq.firstChild);
    bq.insertBefore(encWrap, subNav.nextSibling);
    bq.insertBefore(decWrap, encWrap.nextSibling);

    var pageNav = document.createElement('div');
    pageNav.style.cssText = 'display:flex; gap:8px; margin-bottom:14px; border-bottom:1px solid #304257; padding-bottom:8px; flex-wrap:wrap;';
    pageNav.innerHTML =
      '<button type="button" class="btn" id="bq-nav-page-backup" style="font-size:0.85rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>バックアップ</button>' +
      '<button type="button" class="btn btn-outline" id="bq-nav-page-crypto" style="font-size:0.85rem;"><svg class="cm-btn-ico" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>暗号化</button>';
    panel.insertBefore(pageNav, panel.firstChild);

    var page = 'backup', sub = 'encrypt';
    var btnPageBackup = document.getElementById('bq-nav-page-backup');
    var btnPageCrypto = document.getElementById('bq-nav-page-crypto');
    var btnSubEncrypt = document.getElementById('bq-nav-sub-encrypt');
    var btnSubDecrypt = document.getElementById('bq-nav-sub-decrypt');
    function render() {
      bip39.hidden = page !== 'backup';
      bq.hidden = page !== 'crypto';
      btnPageBackup.className = 'btn' + (page === 'backup' ? '' : ' btn-outline');
      btnPageCrypto.className = 'btn' + (page === 'crypto' ? '' : ' btn-outline');
      encWrap.hidden = sub !== 'encrypt';
      decWrap.hidden = sub !== 'decrypt';
      btnSubEncrypt.className = 'btn' + (sub === 'encrypt' ? '' : ' btn-outline');
      btnSubDecrypt.className = 'btn' + (sub === 'decrypt' ? '' : ' btn-outline');
    }
    btnPageBackup.addEventListener('click', function () { page = 'backup'; render(); });
    btnPageCrypto.addEventListener('click', function () { page = 'crypto'; render(); });
    btnSubEncrypt.addEventListener('click', function () { sub = 'encrypt'; render(); });
    btnSubDecrypt.addEventListener('click', function () { sub = 'decrypt'; render(); });
    render();
    // 他機能から復元欄へデータを送るときの受け口（backup-qr.js が呼ぶ）
    window.CMBackupNav = {
      openRestore: function () { page = 'crypto'; sub = 'decrypt'; render(); },
      showPage: function (p) { page = p; render(); },
      showSub: function (s) { sub = s; render(); }
    };
  }
})();
