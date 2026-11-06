/* Crypto Matrix — field error hints (Unit D3-4)
 *
 * Highlights the input field responsible for an error and shows a short
 * fix hint under it, using ONLY the existing error messages: this helper
 * adds no new cause detection. The tables below map distinctive
 * substrings of messages whose throwing code already identifies the
 * cause (a missing or malformed specific input). Composite failures
 * whose cause cannot be determined (e.g. a GCM tag mismatch, where
 * password / keyfile / seed / data corruption are indistinguishable)
 * intentionally match nothing, so no field is blamed by guesswork.
 *
 * Display only: no processing, crypto, or token logic is touched.
 * A mark is cleared when the field is edited, and all marks are
 * cleared when a new operation starts.
 */
(function () {
  'use strict';

  var MAPS = {
    bv: [
      {
        match: '復号する暗号化ファイルを選択するか',
        field: 'bv-restore-text',
        hint: '⚠ 暗号化データが入力されていません。テキストを貼り付けるか、上のボタンでファイル／QRを読み込んでください。'
      },
      {
        match: '不足しているシェアを追加してください',
        field: 'bv-restore-text',
        hint: '⚠ シェアが不足しています。残りのシェアを続けて貼り付けるか、QRを読み取ってください。'
      }
    ],
    tl: [
      {
        match: '復号するタイムカプセルファイル',
        field: 'tl-restore-text',
        hint: '⚠ カプセルデータが入力されていません。ファイルを読み込むか、アーマード文字列を貼り付けてください。'
      },
      {
        match: '復号するタイムカプセルデータが入力されていません',
        field: 'tl-restore-text',
        hint: '⚠ カプセルデータが入力されていません。ファイルを読み込むか、アーマード文字列を貼り付けてください。'
      },
      {
        match: '手動入力モードが選択されています',
        field: 'tl-manual-beacon-input',
        hint: '⚠ ビーコンが入力されていません。対象ラウンドのビーコンJSONまたは96文字の署名を貼り付けてください。'
      },
      {
        match: '入力されたビーコンJSONの形式が不正です',
        field: 'tl-manual-beacon-input',
        hint: '⚠ ビーコンJSONの形式を確認してください。'
      },
      {
        match: '入力された署名は192文字',
        field: 'tl-manual-beacon-input',
        hint: '⚠ 署名の長さが違います。96文字の16進数署名（48バイト）を入力してください。'
      },
      {
        match: 'ビーコン入力は JSON形式',
        field: 'tl-manual-beacon-input',
        hint: '⚠ ビーコンはJSON形式か、96文字の16進数署名で入力してください。'
      },
      {
        match: 'drandビーコンが提供されていません',
        field: 'tl-manual-beacon-input',
        hint: '⚠ ビーコンが提供されていません。オンライン取得を選ぶか、ビーコンJSON／署名を貼り付けてください。'
      },
      {
        match: 'ビーコンのラウンド番号が一致しません',
        field: 'tl-manual-beacon-input',
        hint: '⚠ ビーコンのラウンドがカプセルの要求ラウンドと一致しません。対象ラウンドのビーコンを貼り付けてください。',
        manualOnly: true
      },
      {
        match: 'BLS署名検証に失敗しました',
        field: 'tl-manual-beacon-input',
        hint: '⚠ ビーコンの署名を検証できませんでした。対象ラウンドの正しいビーコンか確認してください。',
        manualOnly: true
      },
      {
        match: '「復元用パスワード」の入力が必要です',
        field: 'tl-restore-password',
        hint: '⚠ このカプセルの復号には、作成時に設定した復元用パスワードが必要です。'
      },
      {
        match: '「キーファイル」の選択が必要です',
        field: 'tl-restore-keyfile',
        hint: '⚠ このカプセルの復号には、作成時に設定したキーファイルの選択が必要です。'
      }
    ]
  };

  function hintId(fieldId) { return 'cm-field-hint-' + fieldId; }

  function clearField(fieldId) {
    var el = document.getElementById(fieldId);
    if (el) {
      el.classList.remove('cm-field-invalid');
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    }
    var hint = document.getElementById(hintId(fieldId));
    if (hint) hint.remove();
  }

  function clearAll() {
    var hints = document.querySelectorAll('.cm-field-hint');
    for (var i = 0; i < hints.length; i++) {
      var id = hints[i].id.replace('cm-field-hint-', '');
      clearField(id);
    }
  }

  function show(fieldId, hintText) {
    var el = document.getElementById(fieldId);
    if (!el) return;
    clearField(fieldId);
    el.classList.add('cm-field-invalid');
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', hintId(fieldId));
    var hint = document.createElement('div');
    hint.className = 'cm-field-hint';
    hint.id = hintId(fieldId);
    hint.textContent = hintText;
    if (el.parentNode) el.parentNode.insertBefore(hint, el.nextSibling);
    function onEdit() { clearField(fieldId); }
    el.addEventListener('input', onEdit, { once: true });
    el.addEventListener('change', onEdit, { once: true });
    // Bring the field into view without focusing it, so mobile keyboards
    // do not pop up unasked.
    if (el.offsetParent !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Apply the first matching rule of the scope's table. `opts.manualBeacon`
  // gates rules that only identify the cause in manual beacon mode.
  function apply(scope, message, opts) {
    if (!message) return false;
    var rules = MAPS[scope] || [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (message.indexOf(rule.match) === -1) continue;
      if (rule.manualOnly && !(opts && opts.manualBeacon)) return false;
      show(rule.field, rule.hint);
      return true;
    }
    return false;
  }

  window.CMFieldHint = {
    show: show,
    clearField: clearField,
    clearAll: clearAll,
    apply: apply,
    _maps: MAPS
  };
})();
