// Crypto Matrix — 画面まわりの追加機能（素の JavaScript、ビルド不要）
// エンジン（index.js / backup-qr.js ほか）の計算には一切手を触れず、DOM の上に重ねるだけ。
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var html = document.documentElement;
  var isLight = function () { return html.classList.contains('light'); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- テーマ（KeePass とも連動） ---------- */
  function syncKeeWebTheme(light) {
    try {
      var cfg = {};
      try { cfg = JSON.parse(localStorage.getItem('appSettings') || '{}') || {}; } catch (e) {}
      cfg.theme = light ? 'light' : 'dark';
      localStorage.setItem('appSettings', JSON.stringify(cfg));
    } catch (e) {}
  }
  var SUN = '<svg class="cm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>';
  var MOON = '<svg class="cm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  function paintTheme() {
    var t = $('cm-theme-toggle');
    t.innerHTML = isLight() ? MOON : SUN;
    t.setAttribute('aria-label', isLight() ? 'ダークモードに切替' : 'ライトモードに切替');
  }
  $('cm-theme-toggle').addEventListener('click', function () {
    var next = !isLight();
    html.classList.toggle('light', next);
    store('cm-theme', next ? 'light' : 'dark');
    syncKeeWebTheme(next);
    paintTheme();
  });
  paintTheme();
  syncKeeWebTheme(isLight());

  /* ---------- バッジ説明（マウスを乗せる / タップ） ---------- */
  var info = $('cm-badge-info');
  document.querySelectorAll('.cm-badge').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!info.hidden && info.dataset.from === b.id) { info.hidden = true; return; }
      info.dataset.from = b.id;
      $('cm-badge-info-text').textContent = b.title;
      info.hidden = false;
    });
  });
  $('cm-badge-info-close').addEventListener('click', function () { info.hidden = true; });

  /* ---------- オンライン / オフライン表示 ---------- */
  var WIFI = '<img src="on-icon.png" class="cm-badge-img" alt="" width="18" height="18">';
  var WIFI_OFF = '<img src="off-icon.png" class="cm-badge-img" alt="" width="18" height="18">';
  function paintNet() {
    var on = navigator.onLine, b = $('cm-net');
    b.className = 'cm-badge ' + (on ? 'cm-b-amber' : 'cm-b-green');
    b.title = on
      ? '現在ネットワークに接続されています。パスワード算出・バックアップ・データ暗号化・タイムカプセル暗号化は外部通信ゼロで動作します（タイムカプセル復号時のdrand自動取得のみ公開乱数ビーコンを参照します）。機密操作はオフライン環境での利用がより安全です。'
      : 'ネットワーク切断環境で動作中です。シード・合言葉・パスワードが外部に漏れる経路が物理的に存在しない最も安全な状態です（タイムカプセル復号も手動ビーコン入力で完全オフライン実行可能です）。';
    b.innerHTML = (on ? WIFI : WIFI_OFF) + '<span class="cm-hide-sm">' + (on ? 'オンライン' : 'オフライン動作中 · 推奨環境') + '</span>';
  }
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();

  /* ---------- タブ ---------- */
  var tabs = document.querySelectorAll('.cm-tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        $(x.getAttribute('aria-controls')).hidden = !on;
      });
      // Unit D4-1: notify features which tab became active so each can
      // stop its own camera / pause its own playback when its panel is
      // hidden. Features subscribe individually; nothing is stopped from
      // here, so unrelated features are never affected.
      document.dispatchEvent(new CustomEvent('cm-tab-changed', { detail: { active: t.getAttribute('aria-controls') } }));
    });
  });

  /* ---------- ホーム画面に追加（PWA） ---------- */
  var deferred = null;
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function paintInstall() {
    $('cm-install').title = standalone ? 'アプリとして起動中' : 'ホーム画面に追加';
    $('cm-install-label').textContent = standalone ? 'アプリ起動中' : 'アプリ追加';
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', function () { deferred = null; standalone = true; paintInstall(); });
  paintInstall();
  $('cm-install').addEventListener('click', function () {
    var o = document.createElement('div');
    o.className = 'cm-overlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    var body = standalone ? '' :
      (deferred ? '<button type="button" class="cm-primary" data-act="install">アプリをインストール</button>' : '') +
      '<div class="cm-box"><p>' + (ios ? 'iPhone / iPad（Safari）' : 'iPhone / iPad（Safari）の場合') + '</p><ol><li>画面下の共有ボタン（<svg style="display:inline-block;vertical-align:-2px;margin:0 2px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="共有アイコン"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>四角から上矢印）をタップ</li><li>「ホーム画面に追加」を選ぶ</li><li>右上の「追加」をタップ</li></ol></div>' +
      (ios ? '' : '<div class="cm-box"><p>Android / パソコン（Chrome・Edge）</p><ol><li>右上のメニュー（⋮）を開く</li><li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li></ol></div>') +
      '<p class="cm-note">※ 一度オンラインで開いて追加しておくと、以後はオフラインでも起動できます。</p>';
    o.innerHTML = '<div class="cm-dialog"><button type="button" class="cm-close" aria-label="閉じる">✕</button>' +
      '<h2>' + (standalone ? '✅ アプリとして起動中' : '📲 ホーム画面に追加') + '</h2><p class="cm-sub">' +
      (standalone ? 'ホーム画面から起動しています。機内モードやWi-Fiオフでも、通信ゼロでそのまま使えます。'
        : '追加すると、次回からアイコンひとつで起動でき、機内モードやWi-Fiオフ（エアギャップ）でも通信ゼロで動作します。') +
      '</p>' + body + '</div>';
    var close = function () { o.remove(); };
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    o.querySelector('.cm-close').addEventListener('click', close);
    var ib = o.querySelector('[data-act="install"]');
    if (ib) ib.addEventListener('click', function () {
      deferred.prompt();
      deferred.userChoice.catch(function () {}).then(function () { deferred = null; close(); });
    });
    document.body.appendChild(o);
  });

  /* ---------- パスワード強度 ---------- */
  function estimateBits(pw) {
    if (!pw) return 0;
    var pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    return Math.round(pw.length * Math.log2(Math.max(pool, 1)));
  }
  function strength(bits) {
    if (bits < 40) return { label: '弱い', level: 0 };
    if (bits < 60) return { label: '普通', level: 1 };
    if (bits < 80) return { label: '強い', level: 2 };
    return { label: '非常に強い', level: 3 };
  }
  function makeMeter(extraClass) {
    var m = document.createElement('div');
    m.className = 'cm-meter' + (extraClass ? ' ' + extraClass : '');
    m.innerHTML = '<div class="cm-meter-bar"><span></span></div><div class="cm-meter-text"></div>';
    return m;
  }
  function paintMeter(m, pw) {
    var bits = estimateBits(pw), s = strength(bits);
    m.dataset.level = String(s.level);
    m.querySelector('span').style.width = Math.min(100, bits) + '%';
    m.querySelector('.cm-meter-text').textContent = pw ? pw.length + '文字 · 約' + bits + 'bit · ' + s.label : '';
  }

  var PEEK_TARGETS = ['#input-seed-number', '#sim-site', '#sim-secret', '#sim-output-pw', '#sticky-output-pw',
    '#seed-words-container', '#bq-words-container', '#bq-output', '#seed-armored-text', '#seed-qr-list', '#bq-qr-list',
    '#tl-output-text', '#tl-qr-container', '#tl-decrypted-content', '#tl-shares-container',
    '#bv-decrypted-content', '#ts-decrypted-view'];
  // 合言葉(#sim-secret)には付けない：弱い合言葉でもカード盤面経由で強力なパスワードになるため
  var METER_TARGETS = ['#bq-password', '#bq-restore-password', '#bv-password', '#bv-restore-password',
    '#duress-modal-pw', '#duress-vault-pw', '#km-password', '#tl-password', '#tl-restore-password', '#tl-duress-pw',
    '#ts-password', '#ts-ci-password', '#ts-mgmt-password', '#ts-edit-ci-password', '#ts-edit-mgmt-password'];


  /* ---------- パスキー状態スロット（ボタンなし・認証結果と厳密同期） ---------- */
  function renderPasskeyStatusSlots() {
    var saved = window.MatrixCardPreset ? window.MatrixCardPreset.getSavedPasskeyCredential() : null;
    var hasSaved = Boolean(saved && saved.credentialId && saved.credentialId.length > 0);
    var slots = document.querySelectorAll('.cm-passkey-manager-slot');

    slots.forEach(function (slot) {
      slot.innerHTML =
        '<div class="cm-passkey-status-box ' + (hasSaved ? 'is-saved' : 'is-empty') + '">' +
        '<span class="cm-passkey-status-ico">' + (hasSaved ? '🔑' : 'ℹ️') + '</span>' +
        '<div class="cm-passkey-status-body">' +
        '<div class="cm-passkey-status-title">' +
        (hasSaved ? '登録済みパスキーを使用中（同じパスキーで再利用）' : 'このブラウザに登録情報なし（既存パスキーを検索）') +
        '</div>' +
        '<div class="cm-passkey-status-desc">' +
        (hasSaved
          ? '暗号化時に同じパスキー（生体認証）で認証します。毎回新しいパスキーは作成されず、このパスキーが再利用されます。'
          : '暗号化時に端末・クラウドに同期された既存パスキーで認証します。既存パスキーが見つからない場合、自動で新規登録されることはありません。') +
        '</div></div></div>';
    });
  }

  window.addEventListener('cm-passkey-changed', renderPasskeyStatusSlots);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPasskeyStatusSlots);
  } else {
    renderPasskeyStatusSlots();
  }

  function initAddons() {
    var out = $('sim-output-pw');
    if (!out || out.dataset.cmAddons) return;
    out.dataset.cmAddons = '1';

    // 生成パスワードの強度
    var meter = makeMeter();
    out.insertAdjacentElement('afterend', meter);
    var upd = function () { paintMeter(meter, (out.textContent || '').replace(/\s+/g, '')); };
    new MutationObserver(upd).observe(out, { childList: true, subtree: true, characterData: true });
    upd();

    // 覗き見防止
    var guardControl = document.createElement('div');
    guardControl.className = 'cm-peek-control';
    guardControl.setAttribute('aria-label', '覗き見防止設定');
    var guardBtn = document.createElement('button');
    guardBtn.type = 'button';
    guardBtn.className = 'btn cm-peek-toggle';
    guardBtn.setAttribute('aria-pressed', 'false');
    guardControl.appendChild(guardBtn);
    var peekSlot = document.getElementById('peek-control-slot');
    if (peekSlot) peekSlot.replaceWith(guardControl);
    else meter.insertAdjacentElement('afterend', guardControl);
    // 初回は OFF。ユーザーが明示的に ON にした設定だけを次回以降も引き継ぐ。
    var guard = store('cm-peek-guard') === 'on';
    // Bonus Vaultでは秘密のテキストとQRだけを対象にし、説明文や操作ボタンはぼかさない。
  var peekEls = function () {
    var els = PEEK_TARGETS.map(function (s) { return document.querySelector(s); }).filter(Boolean);
    document.querySelectorAll('#bv-result-shares-container textarea[id^="bv-share-ta-"], #bv-result-shares-container textarea#bv-single-ta, #bv-result-shares-container .bv-qr-figure svg')
      .forEach(function (el) { els.push(el); });
    return Array.from(new Set(els));
  };
    var applyGuard = function () {
      peekEls().forEach(function (el) {
        el.classList.toggle('cm-peek', guard);
        if (!el.dataset.cmPeekWired) {
          el.dataset.cmPeekWired = '1';
          var reveal = function (on) { el.classList.toggle('cm-reveal', on); };
          el.addEventListener('touchstart', function () { reveal(true); }, { passive: true });
          el.addEventListener('touchend', function () { reveal(false); });
          el.addEventListener('touchcancel', function () { reveal(false); });
          el.addEventListener('contextmenu', function (e) { if (guard) e.preventDefault(); });
        }
      });
      guardControl.classList.toggle('is-on', guard);
      guardControl.classList.toggle('is-off', !guard);
      guardBtn.textContent = guard ? '🔒 覗き見防止：ON' : '👁 覗き見防止：OFF';
      guardBtn.setAttribute('aria-pressed', guard ? 'true' : 'false');
      guardBtn.title = guard ? '覗き見防止は有効です。PCはマウスを乗せる／スマホは長押しで一時表示' : '覗き見防止は無効です。クリックして秘密情報をぼかします。';
    };
    guardBtn.addEventListener('click', function () { guard = !guard; store('cm-peek-guard', guard ? 'on' : 'off'); applyGuard(); });
    applyGuard();
    window.cmApplyPeekGuard = applyGuard;
    window.cmIsPeekGuardOn = function () { return guard; };

    // クリップボード自動消去バッジ（消去そのものは共通ヘルパーが行い、
    // ここは結果イベントを表示するだけ。個別の通知先があるコピーは対象外）
    var badge = document.createElement('div');
    badge.className = 'cm-clip-badge';
    badge.hidden = true;
    document.body.appendChild(badge);
    var timer = null;
    var hideTimer = null;
    function showBadge(text, hideMs) {
      badge.hidden = false;
      badge.textContent = text;
      if (hideTimer) clearTimeout(hideTimer);
      if (hideMs) hideTimer = setTimeout(function () { badge.hidden = true; }, hideMs);
    }
    window.addEventListener('cm-clipboard-copied', function (e) {
      if (e.detail && e.detail.claimed) return;
      var left = 30;
      showBadge('📋 コピーしました · ' + left + '秒後にクリップボードを消去', 0);
      if (timer) clearInterval(timer);
      timer = setInterval(function () {
        left--;
        if (left > 0) { badge.textContent = '📋 コピーしました · ' + left + '秒後にクリップボードを消去'; return; }
        clearInterval(timer);
      }, 1000);
    });
    window.addEventListener('cm-clipboard-result', function (e) {
      if (e.detail && e.detail.claimed) return;
      if (timer) clearInterval(timer);
      var status = e.detail && e.detail.status;
      if (status === 'protected') showBadge('🛡️ クリップボードの内容が変わっていたため消去しませんでした', 3500);
      else if (status === 'failed') showBadge('⚠ 自動消去できませんでした（画面を開いた状態で再度お試しください）', 3500);
      else showBadge('🧹 クリップボードを消去しました', 2500);
    });

    // 各パスワード欄の強度
    METER_TARGETS.forEach(function (sel) {
      var input = document.querySelector(sel);
      if (!input || input.dataset.cmMeter) return;
      input.dataset.cmMeter = '1';
      var m = makeMeter('cm-meter-input');
      input.insertAdjacentElement('afterend', m);
      var u = function () { paintMeter(m, input.value || ''); m.style.display = input.value ? '' : 'none'; };
      input.addEventListener('input', u);
      u();
    });

    initInputGuidance();
    renderPasskeyStatusSlots();
    initMaskedPasswordPrompt();
  }

  /* ---------- 「どこに入力？」案内 ---------- */
  function markNeedInput(el, hint) {
    el.classList.remove('cm-need-input');
    void el.offsetWidth;
    el.classList.add('cm-need-input');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var tag = document.createElement('div');
    tag.className = 'cm-need-tag';
    tag.textContent = hint;
    el.insertAdjacentElement(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? 'beforebegin' : 'afterbegin', tag);
    var clear = function () { el.classList.remove('cm-need-input'); tag.remove(); };
    el.addEventListener('input', clear, { once: true });
    el.addEventListener('change', clear, { once: true });
    setTimeout(clear, 6000);
  }
  function on(id, fn) { var el = $(id); if (el) el.addEventListener('click', fn, true); }
  function initInputGuidance() {
    on('bv-btn-encrypt', function () {
      var isText = $('bv-type-text') && $('bv-type-text').checked;
      var text = $('bv-text-content'), file = $('bv-file-input'), pw = $('bv-password');
      var usePw = $('bv-opt-password') && $('bv-opt-password').checked;
      if (isText && text && !text.value.trim()) markNeedInput(text, '👆 暗号化したい文章・パスワードをここに入力してください');
      else if (!isText && file && !(file.files && file.files.length)) { var a = $('bv-input-file-area'); if (a) markNeedInput(a, '👆 暗号化したいファイルをここで選択してください'); }
      if (usePw && pw && !pw.value) markNeedInput(pw, '👆 暗号化パスワードをここに入力してください（12文字以上）');
    });
    on('bv-btn-decrypt', function () {
      var text = $('bv-restore-text'), file = $('bv-restore-file');
      if (text && !text.value.trim() && !(file && file.files && file.files.length))
        markNeedInput(text, '👆 暗号化データ（-----BEGIN CRYPTOMATRIX VAULT...）をここに貼り付けるか、上のQRスキャン／ファイル選択を使ってください');
    });
    on('bq-create', function () {
      var pw = $('bq-password');
      if (pw && !pw.value) markNeedInput(pw, '👆 復元用パスワードをここに入力してください（12文字以上）');
    });
  }

  /* ---------- KeePass 保存時のパスワード入力を伏せ字に ---------- */
  function askMaskedPassword(message) {
    return new Promise(function (resolve) {
      var w = document.createElement('div');
      w.className = 'cm-overlay cm-pw';
      w.setAttribute('role', 'dialog');
      w.setAttribute('aria-modal', 'true');
      w.innerHTML = '<form class="cm-dialog"><p style="margin:0;line-height:1.6"></p>' +
        '<div class="cm-row"><input type="password" autocomplete="new-password" class="cm-input"><button type="button" data-act="show" class="cm-sbtn" title="押している間だけ表示">👁</button></div>' +
        '<div class="cm-row end"><button type="button" data-act="cancel" class="cm-sbtn">キャンセル</button><button type="submit" class="cm-sbtn pri">OK</button></div></form>';
      w.querySelector('p').textContent = message;
      var input = w.querySelector('input'), show = w.querySelector('[data-act="show"]');
      show.addEventListener('pointerdown', function () { input.type = 'text'; });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { show.addEventListener(ev, function () { input.type = 'password'; }); });
      var done = function (v) { input.value = ''; w.remove(); resolve(v); };
      w.querySelector('[data-act="cancel"]').addEventListener('click', function () { done(null); });
      w.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); done(input.value); });
      w.addEventListener('keydown', function (e) { if (e.key === 'Escape') done(null); });
      document.body.appendChild(w);
      input.focus();
    });
  }
  function initMaskedPasswordPrompt() {
    // 拡張バックアップのKeePass保存では追加のパスワード入力ポップアップを出さない。
    // インポート用XML保存の確認プロンプトだけを維持する。
    var targets = {
      'bq-save-xml': 'KeePassインポート用の保護されたパスワード欄へ保存する復元用パスワードを入力してください（メモ欄には保存しません）。'
    };
    Object.keys(targets).forEach(function (id) {
      var btn = $(id);
      if (!btn || btn.dataset.cmMasked) return;
      btn.dataset.cmMasked = '1';
      btn.addEventListener('click', function (e) {
        if (btn.dataset.cmGo) { delete btn.dataset.cmGo; return; }
        var pwEl = $('bq-password'), opt = $('bq-opt-password');
        var usePass = opt ? opt.checked : true;
        if (!pwEl || pwEl.value.trim() || !usePass) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        askMaskedPassword(targets[id]).then(function (pw) {
          if (!pw) return;
          pwEl.value = pw;
          btn.dataset.cmGo = '1';
          btn.click(); // エンジンは処理の最初で #bq-password を同期的に読む
          pwEl.value = '';
        });
      }, true);
    });
  }

  /* ---------- ルート再生前のプレビュー発光 ---------- */
  function initRoutePreview() {
    var board = $('div-encrypto-matrix-main'), log = $('sim-trace-log');
    if (!board || !log || board.dataset.cmRoutePreview) return;
    board.dataset.cmRoutePreview = '1';
    var wrap = board.closest('.cm-board') || board;
    var pending = null;
    var steps = function () { return window.currentEvalSteps || []; };
    var playing = function () { return document.body.classList.contains('trace-playing'); };
    var paint = function () {
      var sq = board.querySelectorAll('.square');
      steps().forEach(function (st, i) {
        var s = sq[st.tileIdx];
        if (!s) return;
        if (!s.classList.contains('stroke-start-tile')) s.classList.add(i === 0 ? 'stroke-start-tile' : 'stroke-preview-tile');
        var spot = s.querySelector('[data-spot="' + st.corner + '"]');
        if (spot) spot.classList.add(i === 0 ? 'start-char-spot' : 'preview-char-spot');
      });
    };
    var idle = function () { if (playing() || pending !== null) return; wrap.classList.add('cm-idle-preview'); paint(); };
    var schedule = function () { requestAnimationFrame(function () { requestAnimationFrame(idle); }); };
    new MutationObserver(schedule).observe(log, { childList: true });
    new MutationObserver(schedule).observe(board, { childList: true });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    schedule();
    var intercept = function (e) {
      var btn = e.currentTarget;
      if (btn.dataset.cmGo) { delete btn.dataset.cmGo; return; }
      if (playing() || pending !== null || btn.disabled || !steps().length) return;
      e.stopImmediatePropagation();
      wrap.classList.remove('cm-idle-preview');
      paint();
      var banner = $('sim-step-banner');
      if (banner) banner.textContent = '👀 ルートプレビュー（全' + steps().length + '文字）… 光っているマスと文字を手元のカードで確認してください。まもなく再生します';
      pending = setTimeout(function () { pending = null; btn.dataset.cmGo = '1'; btn.click(); }, 2000);
    };
    ['btn-play-trace', 'btn-sticky-play'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', intercept, { capture: true }); });
  }

  /* ---------- チュートリアル ---------- */
  var STEPS = [
    { sel: '#input-seed-number', title: '① カードのシード番号', body: 'お手元のカードと同じ盤面が表示されています。カード裏のシード番号と一致しているか確認しましょう。普段は変更しなくてOKです。' },
    { sel: '#sim-site', title: '② サイト名を入れる', body: 'パスワードを作りたいサイトやサービスの名前を入力します（例: Google, Amazon）。サイトごとに違うパスワードになります。' },
    { sel: '#sim-secret', title: '③ 合言葉を設定', body: 'あなただけが知っている合言葉です。誰にも見せず、どこにも書かないでください。サイト名と合言葉とカードから毎回同じパスワードが再現されます。' },
    { sel: '#btn-play-trace', title: '④ ルート再生', body: '押すと盤面上で1文字ずつ光ります。カードを見ながら同じ順に文字を拾えば、端末がなくてもパスワードを再現できます。' },
    { sel: '.cm-peek-toggle', title: '⑤ 覗き見防止', body: 'シード・合言葉・パスワード・QRはぼかしたまま使えます。見たい時だけ、PCはマウスを乗せる／スマホは長押しで一時表示。このボタンでON/OFFできます。' },
    { sel: '#cm-theme-toggle', title: '⑥ 表示モード', body: '今は見やすいライトモードです。暗い場所での作業や目の疲れを抑えたい場合は、ダークモードもお使いいただけます。このボタンでいつでも切り替えられます。' }
  ];
  var tourEl = null, tourI = 0, tourTimer;
  function closeTour() {
    store('cm-tour-done', '1');
    html.classList.remove('cm-tour-active');
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    if (tourEl) tourEl.remove();
    tourEl = null;
  }
  function place() {
    if (!tourEl) return;
    var el = document.querySelector(STEPS[tourI].sel);
    var r = el ? el.getBoundingClientRect() : null;
    var ring = tourEl.querySelector('.cm-tour-ring'), dim = tourEl.querySelector('.cm-tour-dim'), card = tourEl.querySelector('.cm-tour-card');
    ring.hidden = !r; dim.hidden = !!r;
    if (r) {
      ring.style.top = (r.top - 6) + 'px'; ring.style.left = (r.left - 6) + 'px';
      ring.style.width = (r.width + 12) + 'px'; ring.style.height = (r.height + 12) + 'px';
      var below = r.bottom + 200 < innerHeight;
      card.style.top = (below ? r.bottom + 14 : Math.max(12, r.top - 214)) + 'px';
    } else card.style.top = '80px';
  }
  function renderTour() {
    var s = STEPS[tourI], last = tourI === STEPS.length - 1;
    // 入力欄の説明中は覗き見防止のぼかしを一時解除、最後の2ステップで戻す
    html.classList.toggle('cm-tour-active', tourI < 4);
    tourEl.querySelector('.cm-tour-card').innerHTML =
      '<div class="st">STEP ' + (tourI + 1) + ' / ' + STEPS.length + '</div><h2></h2><p></p>' +
      '<div class="cm-tour-act"><button type="button" class="skip" data-a="skip">スキップ</button><div class="sp">' +
      (last ? '<button type="button" class="cm-sbtn out" data-a="dark">ダークで使う</button>' : '') +
      (tourI > 0 ? '<button type="button" class="cm-sbtn" data-a="back">戻る</button>' : '') +
      '<button type="button" class="cm-sbtn pri" data-a="next">' + (last ? 'はじめる' : '次へ') + '</button></div></div>';
    tourEl.querySelector('h2').textContent = s.title;
    tourEl.querySelector('p').textContent = s.body;
    var el = document.querySelector(s.sel);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearTimeout(tourTimer);
    tourTimer = setTimeout(place, 350);
  }
  function openTour() {
    if (tourEl) return;
    tourI = 0;
    tourEl = document.createElement('div');
    tourEl.className = 'cm-tour';
    tourEl.setAttribute('role', 'dialog');
    tourEl.setAttribute('aria-modal', 'true');
    tourEl.setAttribute('aria-label', 'チュートリアル');
    tourEl.innerHTML = '<div class="cm-tour-ring" hidden></div><div class="cm-tour-dim"></div><div class="cm-tour-card"></div>';
    tourEl.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-a]');
      if (!a) return;
      var act = a.dataset.a;
      if (act === 'skip') closeTour();
      else if (act === 'back') { tourI--; renderTour(); }
      else if (act === 'next') { if (tourI < STEPS.length - 1) { tourI++; renderTour(); } else closeTour(); }
      else if (act === 'dark') { if (isLight()) $('cm-theme-toggle').click(); closeTour(); }
    });
    document.body.appendChild(tourEl);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    renderTour();
  }
  $('cm-help').addEventListener('click', openTour);

  /* ---------- 起動 ---------- */
  window.addEventListener('load', function () {
    // かんたんモードは最初から開いておく
    var cq = $('card-quick');
    if (cq && cq.classList.contains('is-collapsed')) { var t = $('btn-toggle-cq'); if (t) t.click(); }
    setTimeout(function () {
      initAddons();
      initRoutePreview();
      $('cm-help').disabled = false;
      if (!store('cm-tour-done')) openTour();
    }, 300);
  });

  /* ---------- PWA 手動更新（ロゴタップ／プルダウン） ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top) {
    var cmSwRegistration = null;
    var cmUpdateRunning = false;
    var cmReloadAfterControllerChange = false;
    var cmControllerChangedSinceLoad = false;
    var cmHadControllerAtLoad = !!navigator.serviceWorker.controller;
    var cmUpdateToast = null;
    var cmUpdateToastTimer = 0;

    function cmGetUpdateToast() {
      if (cmUpdateToast) return cmUpdateToast;
      cmUpdateToast = document.createElement('div');
      cmUpdateToast.className = 'cm-update-status';
      cmUpdateToast.setAttribute('role', 'status');
      cmUpdateToast.setAttribute('aria-live', 'polite');
      document.body.appendChild(cmUpdateToast);
      return cmUpdateToast;
    }

    function cmShowUpdateStatus(message, state, duration) {
      var el = cmGetUpdateToast();
      if (cmUpdateToastTimer) clearTimeout(cmUpdateToastTimer);
      el.textContent = message;
      el.dataset.state = state || 'info';
      el.classList.add('is-visible');
      if (duration > 0) {
        cmUpdateToastTimer = setTimeout(function () {
          el.classList.remove('is-visible');
          cmUpdateToastTimer = 0;
        }, duration);
      }
    }

    function cmHideUpdateStatus() {
      if (cmUpdateToastTimer) clearTimeout(cmUpdateToastTimer);
      cmUpdateToastTimer = 0;
      if (cmUpdateToast) cmUpdateToast.classList.remove('is-visible');
    }

    var cmUpdatePrompt = null;
    var cmUpdatePromptText = null;
    var cmUpdatePromptWorker = null;

    function cmGetUpdatePrompt() {
      if (cmUpdatePrompt) return cmUpdatePrompt;
      var el = document.createElement('div');
      el.className = 'cm-update-prompt';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      var text = document.createElement('span');
      text.className = 'cm-update-prompt-text';
      cmUpdatePromptText = text;
      var apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'cm-update-prompt-apply';
      apply.textContent = 'アップデート';
      apply.addEventListener('click', function () {
        var worker = cmUpdatePromptWorker;
        cmHideUpdatePrompt();
        cmActivateWaitingWorker(worker);
      });
      var later = document.createElement('button');
      later.type = 'button';
      later.className = 'cm-update-prompt-later';
      later.textContent = 'あとで';
      later.addEventListener('click', function () {
        cmHideUpdatePrompt();
      });
      el.appendChild(text);
      el.appendChild(apply);
      el.appendChild(later);
      document.body.appendChild(el);
      cmUpdatePrompt = el;
      return el;
    }

    function cmShowUpdatePrompt(worker) {
      // Guard per worker, not per session: dismissing one update must not
      // suppress the prompt for the next version discovered later.
      if (!worker || worker === cmUpdatePromptWorker) return;
      cmUpdatePromptWorker = worker;
      var el = cmGetUpdatePrompt();
      // Set the message at show time so the live region announces it.
      cmUpdatePromptText.textContent = '新しいバージョンがあります';
      el.classList.add('is-visible');
    }

    function cmHideUpdatePrompt() {
      if (cmUpdatePrompt) cmUpdatePrompt.classList.remove('is-visible');
    }

    function cmUpdateBlockReason() {
      var blocked = document.querySelectorAll('dialog[open], [aria-modal="true"], [aria-busy="true"], [data-cm-busy="true"]');
      for (var b = 0; b < blocked.length; b++) {
        if (!blocked[b].hidden && blocked[b].getClientRects().length > 0) {
          return 'ダイアログまたは処理中の画面を閉じてから更新してください';
        }
      }
      var videos = document.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) {
        var media = videos[i].srcObject;
        if (media && typeof media.getVideoTracks === 'function' &&
            media.getVideoTracks().some(function (track) { return track.readyState === 'live'; })) {
          return 'カメラを停止してから更新してください';
        }
      }
      return '';
    }

    function cmWaitForInstalled(reg, worker) {
      return new Promise(function (resolve, reject) {
        if (!worker) { resolve(null); return; }
        if (worker.state === 'installed') {
          resolve(reg.waiting || (worker !== reg.active ? worker : null));
          return;
        }
        if (worker.state === 'redundant') {
          reject(new Error('アップデートのインストールに失敗しました'));
          return;
        }
        var timer = setTimeout(function () {
          finish(null, new Error('アップデートの準備がタイムアウトしました'));
        }, 90000);
        function finish(value, error) {
          clearTimeout(timer);
          worker.removeEventListener('statechange', onStateChange);
          if (error) reject(error);
          else resolve(value);
        }
        function onStateChange() {
          if (worker.state === 'installed') {
            finish(reg.waiting || (worker !== reg.active ? worker : null));
          } else if (worker.state === 'redundant') {
            finish(null, new Error('アップデートのインストールに失敗しました'));
          }
        }
        worker.addEventListener('statechange', onStateChange);
        onStateChange();
      });
    }

    function cmActivateWaitingWorker(worker) {
      if (!worker) {
        cmShowUpdateStatus('最新版です', 'success', 2200);
        return;
      }
      var blockReason = cmUpdateBlockReason();
      if (blockReason) {
        cmShowUpdateStatus('更新を準備しました。' + blockReason, 'info', 5000);
        return;
      }
      cmReloadAfterControllerChange = true;
      cmShowUpdateStatus('アップデートを適用しています…', 'checking', 0);
      worker.postMessage({ type: 'CM_SKIP_WAITING' });
      // A few browsers may not dispatch controllerchange to an already-controlled page.
      setTimeout(function () {
        if (cmReloadAfterControllerChange) {
          cmReloadAfterControllerChange = false;
          window.location.reload();
        }
      }, 10000);
    }

    async function cmCheckForUpdate() {
      if (cmUpdateRunning) return;
      var blockReason = cmUpdateBlockReason();
      if (blockReason) {
        cmShowUpdateStatus(blockReason, 'error', 3500);
        return;
      }
      if (cmControllerChangedSinceLoad) {
        cmShowUpdateStatus('最新版に切り替えています…', 'checking', 0);
        window.location.reload();
        return;
      }
      if (!navigator.onLine) {
        cmShowUpdateStatus('オフラインのため更新を確認できません', 'error', 3500);
        return;
      }

      cmUpdateRunning = true;
      cmShowUpdateStatus('最新版を確認しています…', 'checking', 0);
      try {
        if (!cmSwRegistration) {
          try {
            cmSwRegistration = await navigator.serviceWorker.getRegistration();
          } catch (registrationError) {
            throw new Error('Service Worker登録情報の取得に失敗しました: ' +
              (registrationError && registrationError.message ? registrationError.message : String(registrationError)));
          }
        }
        if (!cmSwRegistration) {
          cmShowUpdateStatus('更新機能を利用できません。ページを再読み込みしてください', 'error', 4500);
          return;
        }

        // update() can reject for transient network/CDN errors. Keep the reason visible
        // and do not treat an unchanged registration as proof of a new release.
        try {
          await cmSwRegistration.update();
        } catch (updateError) {
          throw new Error('最新版の取得に失敗しました: ' +
            (updateError && updateError.message ? updateError.message : String(updateError)));
        }

        var worker = null;
        if (cmSwRegistration.installing) {
          worker = await cmWaitForInstalled(cmSwRegistration, cmSwRegistration.installing);
        }
        if (cmSwRegistration.waiting && cmSwRegistration.waiting !== cmSwRegistration.active) {
          worker = cmSwRegistration.waiting;
        }

        if (worker && worker !== cmSwRegistration.active) {
          cmActivateWaitingWorker(worker);
        } else {
          cmShowUpdateStatus('最新版です', 'success', 2200);
        }
      } catch (error) {
        cmShowUpdateStatus('更新確認に失敗しました：' +
          (error && error.message ? error.message : String(error)), 'error', 6500);
      } finally {
        cmUpdateRunning = false;
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (cmReloadAfterControllerChange) {
        cmReloadAfterControllerChange = false;
        window.location.reload();
        return;
      }
      // Other open tabs are not forcibly reloaded; their next manual refresh switches them.
      if (cmHadControllerAtLoad) cmControllerChangedSinceLoad = true;
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        cmSwRegistration = reg;

        // Offer an update discovered by this launch's background check as soon as
        // it finishes installing, instead of leaving it unnoticed until the next
        // launch. A worker installed without an existing controller is the first
        // install, not an update, so it never triggers the prompt.
        reg.addEventListener('updatefound', function () {
          var installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', function () {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              cmShowUpdatePrompt(reg.waiting || installing);
            }
          });
        });

        // An update downloaded during a previous session is activated on this launch.
        // Updates discovered by this registration check remain waiting until the next launch
        // (or an explicit logo/pull-down action).
        if (reg.waiting && reg.waiting !== reg.active) {
          cmShowUpdateStatus('前回取得したアップデートを適用しています…', 'checking', 0);
          cmActivateWaitingWorker(reg.waiting);
          return;
        }
        // Check for a newer release in the background. A newly installed worker is
        // intentionally left waiting; it will be applied on the next launch.
        reg.update().catch(function () {});
      }).catch(function () {
        cmShowUpdateStatus('アプリの更新機能を初期化できませんでした', 'error', 4500);
      });
    });

    var cmUpdateTrigger = document.getElementById('cm-update-trigger');
    if (cmUpdateTrigger) {
      cmUpdateTrigger.addEventListener('click', cmCheckForUpdate);
    }

    // Pull down only from the top-level page. Inputs, dialogs, horizontal gestures,
    // and nested scroll panels are excluded so existing controls remain unaffected.
    var cmPullStartX = 0;
    var cmPullStartY = 0;
    var cmPullArmed = false;
    var cmPullTracking = false;
    var cmPullDistance = 0;
    var cmPullThreshold = 82;

    function cmIsPageAtTop() {
      var scrolling = document.scrollingElement || document.documentElement;
      return window.scrollY <= 1 && scrolling.scrollTop <= 1;
    }

    function cmIsExcludedPullTarget(target) {
      var el = target && target.nodeType === 1 ? target : target && target.parentElement;
      if (!el) return true;
      if (el.closest('input, textarea, select, button, [contenteditable="true"], dialog, [role="dialog"], .cm-dialog, .ts-modal-dialog')) return true;
      while (el && el !== document.body && el !== document.documentElement) {
        var style = window.getComputedStyle(el);
        var overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return true;
        el = el.parentElement;
      }
      return false;
    }

    document.addEventListener('touchstart', function (event) {
      cmPullArmed = false;
      cmPullTracking = false;
      cmPullDistance = 0;
      if (event.touches.length !== 1 || !cmIsPageAtTop() || cmIsExcludedPullTarget(event.target)) return;
      cmPullArmed = true;
      cmPullStartX = event.touches[0].clientX;
      cmPullStartY = event.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchmove', function (event) {
      if (!cmPullArmed || event.touches.length !== 1 || !cmIsPageAtTop()) return;
      var touch = event.touches[0];
      var dx = touch.clientX - cmPullStartX;
      var dy = touch.clientY - cmPullStartY;
      if (dy <= 10 || Math.abs(dx) > dy * 0.9) return;
      cmPullTracking = true;
      cmPullDistance = dy;
      if (event.cancelable) event.preventDefault();
      cmShowUpdateStatus(dy >= cmPullThreshold ? '離すと最新版を確認' : '下に引っ張って更新…', 'pull', 0);
    }, { passive: false });

    function cmFinishPull() {
      if (!cmPullTracking) return;
      var shouldUpdate = cmPullDistance >= cmPullThreshold;
      cmPullArmed = false;
      cmPullTracking = false;
      cmPullDistance = 0;
      if (shouldUpdate) cmCheckForUpdate();
      else cmHideUpdateStatus();
    }
    document.addEventListener('touchend', cmFinishPull, { passive: true });
    document.addEventListener('touchcancel', function () {
      cmPullArmed = false;
      cmPullTracking = false;
      cmPullDistance = 0;
      cmHideUpdateStatus();
    }, { passive: true });
  }
})();

/* Unit 1 (2026-11-07): feature map chips delegate to the real tab buttons
   (tab switching and URL hash behaviour stay entirely in the existing code). */
(function () {
  var MODULE_META = {
    'tab-quick': { code: '1', name: 'かんたんモード', desc: 'すぐ生成' },
    'tab-recipe': { code: '2', name: 'マイレシピ詳細', desc: '細かく設定' },
    'tab-backup': { code: '3', name: 'バックアップ', desc: '設定の保存・復元' },
    'tab-vault': { code: '4', name: 'データ暗号化', desc: 'テキスト・ファイル' },
    'tab-timelock': { code: '5', name: 'タイムカプセル', desc: '時間で開錠' },
    'tab-timesecret': { code: '6', name: 'タイムシークレット', desc: 'チェックイン型' },
    'tab-datatransfer': { code: '7', name: 'データ転送', desc: 'QRで送受信' }
  };
  function syncMap() {
    var sel = document.querySelector('.cm-tab[aria-selected="true"]');
    var target = sel ? sel.getAttribute('aria-controls') : null;
    document.querySelectorAll('.cm-map-chip, .cm-footer-chip, .cm-mob-chip:not(.cm-mob-top)').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-target') === target);
    });
    var bay = document.getElementById('cm-module-bay');
    if (bay && target) bay.setAttribute('data-active-tab', target);
    var fdock = document.querySelector('.cm-footer-dock');
    if (fdock && target) fdock.setAttribute('data-active-tab', target);
    var meta = target && MODULE_META[target];
    if (meta) {
      var codeEl = document.getElementById('cm-active-module-code');
      var nameEl = document.getElementById('cm-active-module-name');
      var descEl = document.getElementById('cm-active-module-desc');
      if (codeEl) codeEl.textContent = meta.code;
      if (nameEl) nameEl.textContent = meta.name;
      if (descEl) descEl.textContent = meta.desc;
    }
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.cm-map-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var tab = document.querySelector('.cm-tab[aria-controls="' + chip.getAttribute('data-target') + '"]');
        if (!tab) return;
        tab.click();
        syncMap();
        if (window.innerWidth < 1024) {
          var bay = document.getElementById('cm-module-bay') || document.querySelector('.cm-tablist');
          if (bay) bay.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
    document.querySelectorAll('.cm-footer-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var tab = document.querySelector('.cm-tab[aria-controls="' + chip.getAttribute('data-target') + '"]');
        if (!tab) return;
        tab.click();
        syncMap();
        var bay = document.getElementById('cm-module-bay') || document.querySelector('.cm-tablist');
        if (bay) bay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    document.querySelectorAll('.cm-mob-chip:not(.cm-mob-top)').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var tab = document.querySelector('.cm-tab[aria-controls="' + chip.getAttribute('data-target') + '"]');
        if (!tab) return;
        tab.click();
        syncMap();
        var bay = document.getElementById('cm-module-bay') || document.querySelector('.cm-tablist');
        if (bay) bay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    var btnMobTop = document.getElementById('btn-mob-jump-top');
    if (btnMobTop) {
      btnMobTop.addEventListener('click', function () {
        var st = document.getElementById('matrix-stage-box') || document.querySelector('.matrix-stage');
        if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    document.querySelectorAll('.cm-tab').forEach(function (tab) { tab.addEventListener('click', syncMap); });
    document.addEventListener('cm-tab-changed', syncMap);
    window.addEventListener('hashchange', function () { setTimeout(syncMap, 50); });
    try {
      var sp = new URLSearchParams(window.location.search);
      var reqTab = sp.get('tab');
      if (reqTab) {
        var t = document.querySelector('.cm-tab[aria-controls="' + reqTab + '"]') || document.querySelector('[data-target="' + reqTab + '"]');
        if (t) {
          t.click();
          syncMap();
          setTimeout(syncMap, 50);
        }
      }
    } catch (e) {}
    syncMap();
  });
})();

/* ===== 「現在のパスワード作成手順」開閉トグル（初回のみ自動で開く） =====
   方針: 初回アクセス時は自動で開く。一度確認した後は次回以降自動で開かない。
   手動トグルではいつでも再確認できる。既存の cm_guide_collapsed 記録がある
   利用者は確認済みとして扱い、移行で突然また開くことがないようにする。 */
(() => {
  const KEY = 'cm_guide_collapsed';
  const SEEN_KEY = 'cm_guide_seen';
  const card = document.querySelector('.verbal-guide-card');
  const btn = document.getElementById('btn-guide-toggle');
  if (!card || !btn) return;
  const label = btn.querySelector('.guide-toggle-label');
  const apply = (collapsed) => {
    card.classList.toggle('guide-collapsed', collapsed);
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (label) label.textContent = collapsed ? '開く' : '閉じる';
  };
  let seen = false;
  try {
    var sp = new URLSearchParams(window.location.search);
    if (sp.has('guide')) {
      seen = sp.get('guide') === '0' || sp.get('guide') === 'collapsed';
    } else {
      seen = localStorage.getItem(SEEN_KEY) === '1' || localStorage.getItem(KEY) !== null;
    }
  } catch (e) { seen = false; }
  let collapsed = seen;
  apply(collapsed);
  if (!seen) {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 保存できなくても今回の表示は開いたままにする */ }
  }
  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed);
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
      localStorage.setItem(SEEN_KEY, '1');
    } catch (e) { /* 保存できなくても開閉は動作させる */ }
  });
})();

/* ===== マスの文字配置（セル構造）図解カードの開閉トグル ===== */
(() => {
  const btnOpen = document.getElementById('btn-cell-layout-info');
  const btnClose = document.getElementById('btn-close-cell-layout');
  const card = document.getElementById('cm-cell-layout-card');
  if (!card) return;
  const toggle = (show) => {
    const isVisible = show !== undefined ? show : card.style.display === 'none';
    card.style.display = isVisible ? 'block' : 'none';
    card.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    if (btnOpen) btnOpen.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
  };
  if (btnOpen) {
    btnOpen.addEventListener('click', (e) => {
      e.preventDefault();
      toggle();
      if (card.style.display !== 'none') {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.preventDefault();
      toggle(false);
      if (btnOpen) btnOpen.focus();
    });
  }
  try {
    var sp = new URLSearchParams(window.location.search);
    if (sp.get('cellinfo') === '1') toggle(true);
  } catch (e) {}
})();

/* ---------- Backup / Encryption nested page switches ---------- */
(function () {
  'use strict';
  function activate(buttons, panels, activeButton, activePanel) {
    buttons.forEach(function (button) {
      var active = button === activeButton;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(function (panel) {
      panel.hidden = panel !== activePanel;
    });
  }

  var backupButtons = [
    document.getElementById('backup-subtab-btn-backup'),
    document.getElementById('backup-subtab-btn-encrypt')
  ].filter(Boolean);
  var backupPanels = [
    document.getElementById('tab-backup-page-backup'),
    document.getElementById('tab-backup-page-encrypt')
  ].filter(Boolean);
  var encryptButtons = [
    document.getElementById('bq-tab-btn-encrypt'),
    document.getElementById('bq-tab-btn-decrypt')
  ].filter(Boolean);
  var encryptPanels = [
    document.getElementById('bq-panel-encrypt'),
    document.getElementById('bq-panel-decrypt')
  ].filter(Boolean);

  function showBackupPage(page) {
    var index = page === 'encrypt' ? 1 : 0;
    if (backupButtons[index] && backupPanels[index]) {
      activate(backupButtons, backupPanels, backupButtons[index], backupPanels[index]);
    }
  }
  function showEncryptionMode(mode) {
    var index = mode === 'decrypt' ? 1 : 0;
    if (encryptButtons[index] && encryptPanels[index]) {
      activate(encryptButtons, encryptPanels, encryptButtons[index], encryptPanels[index]);
    }
  }

  backupButtons.forEach(function (button, index) {
    button.addEventListener('click', function () {
      activate(backupButtons, backupPanels, backupButtons[index], backupPanels[index]);
    });
  });
  encryptButtons.forEach(function (button, index) {
    button.addEventListener('click', function () {
      activate(encryptButtons, encryptPanels, encryptButtons[index], encryptPanels[index]);
    });
  });

  // Other modules can route decrypted backup data directly to the correct input page.
  document.addEventListener('cm-route-backup-text', function () {
    showBackupPage('encrypt');
    showEncryptionMode('decrypt');
  }, true);
  document.addEventListener('cm-route-backup-files', function () {
    showBackupPage('encrypt');
    showEncryptionMode('decrypt');
  }, true);

  window.cmShowBackupPage = showBackupPage;
  window.cmShowBackupEncryptionMode = showEncryptionMode;
})();


/* Keyboard shortcuts & HUD (v3.28.4):
   1-7      : モジュール切替（上部チップクリック相当）
   Space    : 盤面ルート再生 / 一時停止
   ← / →    : 一時停止中に1文字戻る / 進む
   M        : 盤面へジャンプ（スクロール）
   T        : 表示モード切替（ライト ⇄ ダーク）
   V        : 覗き見防止切替（ぼかし ON ⇄ OFF）
   ?        : ショートカット一覧モーダルの表示 / 非表示
   Esc      : モーダルを閉じる / 再生停止
   Esc × 3  : 🚨 緊急消去（全入力・メモリ・クリップボード消去）
   ※ 入力中・変換中・修飾キー押下中は誤爆防止のため無効化 */
(function () {
  function isTyping(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }
  function visible(el) {
    return !!el && el.style.display !== 'none' && el.offsetParent !== null;
  }

  // Toast HUD notification
  var toastTimer = null;
  function showToast(msg, type, duration) {
    var hub = document.getElementById('cm-toast-hub');
    if (!hub) return;
    hub.innerHTML = '';
    var toast = document.createElement('div');
    toast.className = 'cm-toast' + (type ? ' is-' + type : '');
    toast.textContent = msg;
    hub.appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }, duration || 2000);
  }
  window.cmShowToast = showToast;

  // Shortcuts modal toggle
  function toggleShortcutsModal(force) {
    var modal = document.getElementById('cm-shortcuts-modal');
    if (!modal) return;
    var show = typeof force === 'boolean' ? force : modal.hasAttribute('hidden');
    if (show) {
      modal.removeAttribute('hidden');
      var closeBtn = document.getElementById('btn-shortcuts-close');
      if (closeBtn) closeBtn.focus();
    } else {
      modal.setAttribute('hidden', '');
    }
  }
  window.cmToggleShortcutsModal = toggleShortcutsModal;

  // Wire up modal close & help button
  document.addEventListener('DOMContentLoaded', function () {
    var helpBtn = document.getElementById('cm-help');
    if (helpBtn) {
      helpBtn.removeAttribute('disabled');
      helpBtn.addEventListener('click', function () { toggleShortcutsModal(true); });
    }
    var closeBtn = document.getElementById('btn-shortcuts-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { toggleShortcutsModal(false); });
    }
    var modal = document.getElementById('cm-shortcuts-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) toggleShortcutsModal(false);
      });
    }
  });

  // Esc 3-strike emergency wipe counter
  var escCount = 0;
  var escTimer = null;

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

    // Esc handling (works even while typing if user wants to cancel)
    if (e.key === 'Escape' || e.key === 'Esc') {
      // 長押しの自動リピートと、他のハンドラが処理済み（preventDefault 済み）の Esc は数えない
      if (e.repeat || e.defaultPrevented) return;
      var modal = document.getElementById('cm-shortcuts-modal');
      if (modal && !modal.hasAttribute('hidden')) {
        e.preventDefault();
        toggleShortcutsModal(false);
        escCount = 0;
        return;
      }
      if (isTyping(e.target)) return;

      e.preventDefault();
      escCount++;
      clearTimeout(escTimer);
      escTimer = setTimeout(function () { escCount = 0; }, 1500);

      if (escCount === 1) {
        if (typeof window.stopMatrixTrace === 'function') {
          window.stopMatrixTrace();
        }
      } else if (escCount === 2) {
        showToast('⚠️ Esc あと1回で【緊急消去】を実行します', 'warning', 2500);
      } else if (escCount >= 3) {
        escCount = 0;
        var zBtn = document.getElementById('btn-zeroize');
        if (zBtn) {
          zBtn.click();
          showToast('🚨 緊急消去を実行しました（全入力・メモリ・クリップボード消去）', 'danger', 3500);
        }
      }
      return;
    }

    if (isTyping(e.target)) return;

    // 1-7: Module Jump
    if (/^[1-7]$/.test(e.key) && !e.shiftKey) {
      var chips = document.querySelectorAll('.cm-map-chip');
      var chip = chips[Number(e.key) - 1];
      if (chip) {
        e.preventDefault();
        chip.click();
        var name = chip.querySelector('.cm-map-txt span')?.textContent || ('モジュール ' + e.key);
        showToast('▶ ' + e.key + '. ' + name, '', 1500);
      }
      return;
    }

    // Space: Board Playback Pause / Resume
    if (e.key === ' ' || e.code === 'Space') {
      var tag = e.target && e.target.tagName;
      if (tag === 'BUTTON' || tag === 'A') return;
      var btn = document.getElementById('btn-pause-trace');
      if (!visible(btn)) btn = document.getElementById('btn-sticky-pause');
      if (visible(btn)) {
        e.preventDefault();
        btn.click();
      }
      return;
    }

    // ← / → : Step backward / forward during pause
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (typeof window.isMatrixTracePaused === 'function' && window.isMatrixTracePaused()) {
        e.preventDefault();
        var delta = e.key === 'ArrowLeft' ? -1 : 1;
        if (typeof window.stepMatrixTrace === 'function') {
          window.stepMatrixTrace(delta);
        }
      }
      return;
    }

    // M: Jump to Board
    if (!e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      var st = document.getElementById('matrix-stage-box') || document.querySelector('.matrix-stage') || document.getElementById('cm-board');
      if (st) {
        e.preventDefault();
        st.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('▲ 盤面へ移動しました', '', 1400);
      }
      return;
    }

    // T: Toggle Theme (Light / Dark)
    if (!e.shiftKey && (e.key === 't' || e.key === 'T')) {
      var tBtn = document.getElementById('cm-theme-toggle');
      if (tBtn) {
        e.preventDefault();
        tBtn.click();
        var isL = document.documentElement.classList.contains('light');
        showToast(isL ? '☀️ ライトモード（ホワイトハッカー）' : '🌙 ダークモード（ブラックハッカー）', '', 1600);
      }
      return;
    }

    // V: Toggle Peek Guard (覗き見防止)
    if (!e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      var pBtn = document.querySelector('.cm-peek-toggle');
      if (pBtn) {
        e.preventDefault();
        pBtn.click();
        var isGuard = typeof window.cmIsPeekGuardOn === 'function' ? window.cmIsPeekGuardOn() : false;
        showToast(isGuard ? '🔒 覗き見防止：ON（秘密情報ぼかし）' : '👁 覗き見防止：OFF（通常表示）', '', 1800);
      }
      return;
    }

    // ?: Toggle Shortcuts Modal
    if (e.key === '?') {
      e.preventDefault();
      toggleShortcutsModal();
      return;
    }
  });
})();
