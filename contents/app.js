// Crypto Matrix — 画面まわりの追加機能（素の JavaScript、ビルド不要）
// エンジン（index.js / backup-qr.js ほか）の計算には一切手を触れず、DOM の上に重ねるだけ。
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var html = document.documentElement;
  var isLight = function () { return html.classList.contains('light'); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- テーマ（KeeWeb とも連動） ---------- */
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
  var WIFI = '<svg class="cm-ico-s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/></svg>';
  var WIFI_OFF = '<svg class="cm-ico-s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 12.86a10 10 0 0 1 5.17-2.69M2 2l20 20"/></svg>';
  function paintNet() {
    var on = navigator.onLine, b = $('cm-net');
    b.className = 'cm-badge ' + (on ? 'cm-b-amber' : 'cm-b-green');
    b.title = on
      ? '現在ネットワークに接続されています。パスワード算出・バックアップ・保管庫・タイムロック暗号化は外部通信ゼロで動作します（タイムロック復号時のdrand自動取得のみ公開乱数ビーコンを参照します）。機密操作はオフライン環境での利用がより安全です。'
      : 'ネットワーク切断環境で動作中です。シード・合言葉・パスワードが外部に漏れる経路が物理的に存在しない最も安全な状態です（タイムロック復号も手動ビーコン入力で完全オフライン実行可能です）。';
    b.innerHTML = (on ? WIFI : WIFI_OFF) + '<span class="cm-hide-sm">' + (on ? 'オンライン — 機密操作はオフライン推奨' : 'オフライン動作中 · 推奨環境') + '</span>';
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
    });
  });

  /* ---------- ホーム画面に追加（PWA） ---------- */
  var deferred = null;
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function paintInstall() {
    $('cm-install').title = standalone ? 'アプリとして起動中' : 'ホーム画面に追加';
    $('cm-install-label').textContent = standalone ? 'アプリ起動中' : 'ホーム追加';
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
    '#tl-output-text', '#tl-qr-container', '#tl-decrypted-content', '#tl-shares-container'];
  // 合言葉(#sim-secret)には付けない：弱い合言葉でもカード盤面経由で強力なパスワードになるため
  var METER_TARGETS = ['#bq-password', '#bq-restore-password', '#bv-password', '#bv-restore-password',
    '#duress-modal-pw', '#duress-vault-pw', '#km-password', '#tl-password', '#tl-restore-password', '#tl-duress-pw'];


  /* ---------- パスキー再利用・管理スロット ---------- */
  function renderPasskeyStatusSlots() {
    var saved = window.MatrixCardPreset ? window.MatrixCardPreset.getSavedPasskeyCredential() : null;
    var hasSaved = Boolean(saved && saved.credentialId && saved.credentialId.length > 0);
    var slots = document.querySelectorAll('.cm-passkey-manager-slot');

    slots.forEach(function (slot) {
      slot.innerHTML =
        '<div style="margin-top:8px; padding:8px 12px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid ' + (hasSaved ? '#0284c7' : '#475569') + '; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
        '<span style="font-size:1.1rem;">' + (hasSaved ? '🔑' : 'ℹ️') + '</span>' +
        '<div>' +
        '<div style="font-weight:700; font-size:0.82rem; color:' + (hasSaved ? '#38bdf8' : '#e2e8f0') + ';">' +
        (hasSaved ? '登録済みパスキーを使用中（同じパスキーで再利用）' : 'パスキー未登録（初回暗号化時に自動登録）') +
        '</div>' +
        '<div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">' +
        (hasSaved
          ? '暗号化時に同じパスキー（生体認証）で認証します。毎回新しいパスキーは作成されず、このパスキーが再利用されます。'
          : '暗号化を実行するとパスキーが自動登録され、次回から同じパスキーが再利用されます（事前登録も可能）。') +
        '</div></div></div>' +
        '<div style="display:flex; gap:6px; align-items:center;">' +
        '<button type="button" class="btn btn-outline btn-reregister-pk" style="font-size:0.74rem; padding:4px 9px; font-weight:600; color:#38bdf8; border-color:#0284c7;">' +
        '<svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>' +
        (hasSaved ? '別のパスキーを再登録' : 'パスキーを今すぐ登録') +
        '</button>' +
        (hasSaved
          ? '<button type="button" class="btn btn-outline btn-clear-pk" style="font-size:0.74rem; padding:4px 9px; color:#f87171; border-color:#ef4444;" title="ブラウザに記憶しているパスキーの紐付けを解除します">' +
            '<svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>登録解除</button>'
          : '') +
        '</div></div>';

      var reBtn = slot.querySelector('.btn-reregister-pk');
      if (reBtn) {
        reBtn.addEventListener('click', async function () {
          var orig = reBtn.innerHTML;
          try {
            reBtn.disabled = true;
            reBtn.textContent = '認証器を起動中...';
            await window.MatrixCardPreset.registerNewPasskey();
            renderPasskeyStatusSlots();
            alert('✅ パスキーを登録しました。セクション3・4・5の暗号化でこのパスキーが再利用されます。');
          } catch (err) {
            if (err.name !== 'AbortError' && !err.message?.includes('cancel') && !err.message?.includes('キャンセル')) {
              alert('パスキーの登録に失敗しました: ' + err.message);
            }
          } finally {
            reBtn.disabled = false;
            reBtn.innerHTML = orig;
          }
        });
      }

      var clBtn = slot.querySelector('.btn-clear-pk');
      if (clBtn) {
        clBtn.addEventListener('click', function () {
          if (confirm('登録済みパスキーの記憶を解除しますか？\n（解除すると、次回の暗号化時に新しいパスキーが作成されます。既存の暗号化データの復号には影響しません）')) {
            window.MatrixCardPreset.clearSavedPasskeyCredential();
            renderPasskeyStatusSlots();
          }
        });
      }
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
    var guardBtn = document.createElement('button');
    guardBtn.type = 'button';
    guardBtn.className = 'btn cm-peek-toggle';
    meter.appendChild(guardBtn);
    var guard = store('cm-peek-guard') !== 'off';
    var peekEls = function () { return PEEK_TARGETS.map(function (s) { return document.querySelector(s); }).filter(Boolean); };
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
      guardBtn.textContent = guard ? '🙈 覗き見防止 ON' : '👁 覗き見防止 OFF';
      guardBtn.title = guard ? 'シード・サイト・合言葉・パスワード・シードフレーズを隠しています。PCはマウスを乗せる / スマホは長押しで表示' : '常に表示中';
    };
    guardBtn.addEventListener('click', function () { guard = !guard; store('cm-peek-guard', guard ? 'on' : 'off'); applyGuard(); });
    applyGuard();
    window.cmApplyPeekGuard = applyGuard;
    window.cmIsPeekGuardOn = function () { return guard; };

    // クリップボード自動消去
    var badge = document.createElement('div');
    badge.className = 'cm-clip-badge';
    badge.hidden = true;
    document.body.appendChild(badge);
    var timer;
    var copyBtn = $('btn-copy-pw');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      clearInterval(timer);
      var left = 30;
      badge.hidden = false;
      badge.textContent = '📋 コピーしました · ' + left + '秒後にクリップボードを消去';
      timer = setInterval(function () {
        left--;
        if (left > 0) { badge.textContent = '📋 コピーしました · ' + left + '秒後にクリップボードを消去'; return; }
        clearInterval(timer);
        navigator.clipboard.writeText('').then(
          function () { badge.textContent = '🧹 クリップボードを消去しました'; },
          function () { badge.textContent = '⚠ 自動消去できませんでした（画面を開いた状態で再度お試しください）'; }
        ).then(function () { setTimeout(function () { badge.hidden = true; }, 2500); });
      }, 1000);
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
    window.addEventListener('cm-passkey-changed', renderPasskeyStatusSlots);
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
    var targets = {
      'bq-transfer-keeweb': 'KeeWebの保護された「パスワード」欄へ保存する復元用パスワードを入力してください（メモ欄には保存しません）。',
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

  /* ---------- オフライン対応（Service Worker） ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // 新しい版が入ったら次回起動から自動で切り替わる
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (nw) nw.addEventListener('statechange', function () {
            if (nw.state === 'activated' && navigator.serviceWorker.controller) console.info('Crypto Matrix: 新しい版を読み込みました（次回の再読み込みで反映）');
          });
        });
      }).catch(function () {});
    });
  }
})();
