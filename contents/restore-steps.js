// Crypto Matrix — Unit D3-1: backup restore step indicator (display only).
// Observes existing DOM signals of the restore flow and mirrors them into
// the step indicator. It never writes to existing elements, never calls
// restore logic, and its observation flags are display-only (they are NOT
// a substitute for the pending result or the review token in backup-qr.js).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function init() {
    var stepsEl = $('bq-restore-steps');
    var statusEl = $('bq-scan-status');
    var previewEl = $('bq-preview');
    var applyBtn = $('bq-apply');
    var reviewBtn = $('bq-review');
    var verifiedBlock = $('bq-verified-block');
    if (!stepsEl || !statusEl || !previewEl || !applyBtn) return;

    var stepEls = Array.prototype.slice.call(stepsEl.querySelectorAll('.cm-step'));
    var badges = stepEls.map(function (el) { return el.querySelector('.cm-step-badge'); });

    // Display-only observation flags (see conditions 1-2 of the D3-1 spec).
    var validationAttempted = false;
    var executeAttempted = false;
    var latchedDone = false;

    var VERIFYING_TEXT = '検証しています…';
    var SUCCESS_PREFIX = '✅ 復元完了';
    // Status texts that mean "inputs were replaced/reset" in the existing
    // flow; when one appears, observation flags are cleared (condition 2).
    var RESET_PATTERNS = ['入力が変更されました', 'リセットしました', '読み取りました', '自動入力しました', '検出したため'];

    var STATE_CLASSES = ['is-current', 'is-done', 'is-processing', 'is-error'];
    var MAP = {
      idle:        [['is-current', '1'], [], []],
      verifying:   [['is-done', '✓'], ['is-processing', '2'], []],
      verified:    [['is-done', '✓'], ['is-done', '✓'], ['is-current', '3']],
      verifyError: [['is-done', '✓'], ['is-error', '!'], []],
      applying:    [['is-done', '✓'], ['is-done', '✓'], ['is-processing', '3']],
      applyError:  [['is-done', '✓'], ['is-done', '✓'], ['is-error', '!']],
      done:        [['is-done', '✓'], ['is-done', '✓'], ['is-done', '✓']]
    };

    function setState(state) {
      var def = MAP[state] || MAP.idle;
      stepEls.forEach(function (el, i) {
        STATE_CLASSES.forEach(function (c) { el.classList.remove(c); });
        el.removeAttribute('aria-current');
        var d = def[i] || [];
        if (d[0]) el.classList.add(d[0]);
        if (badges[i]) badges[i].textContent = d[1] || String(i + 1);
        if (d[0] === 'is-current' || d[0] === 'is-processing') el.setAttribute('aria-current', 'step');
      });
    }

    function recompute() {
      var text = statusEl.textContent || '';
      var isError = statusEl.dataset.error === 'true';
      // Condition 3: completion requires the explicit success status
      // observed after an execute attempt.
      if (executeAttempted && text.indexOf(SUCCESS_PREFIX) === 0) {
        latchedDone = true;
        executeAttempted = false;
      }
      if (latchedDone) return setState('done');
      if (executeAttempted && !isError) return setState('applying');
      if (executeAttempted && isError && !applyBtn.disabled) return setState('applyError');
      if (!previewEl.hidden && !applyBtn.disabled) return setState('verified');
      if (validationAttempted && text === VERIFYING_TEXT) return setState('verifying');
      if (validationAttempted && isError && previewEl.hidden) return setState('verifyError');
      return setState('idle');
    }

    function update() {
      if (verifiedBlock) verifiedBlock.hidden = previewEl.hidden;
      recompute();
    }

    function resetObservation() {
      validationAttempted = false;
      executeAttempted = false;
      latchedDone = false;
      update();
    }

    if (reviewBtn) reviewBtn.addEventListener('click', function () {
      validationAttempted = true;
      executeAttempted = false;
      latchedDone = false;
      update();
    });
    applyBtn.addEventListener('click', function () {
      if (!applyBtn.disabled) { executeAttempted = true; update(); }
    });

    // Condition 2: reset observation when the user edits inputs, picks
    // files, resets the read blocks, or emergency-wipes. These listeners
    // only observe the existing events; they change no existing behavior.
    ['bq-import', 'bq-restore-password', 'bq-restore-seed-number'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', resetObservation);
    });
    var keyfile = $('bq-restore-keyfile');
    if (keyfile) keyfile.addEventListener('change', resetObservation);
    var image = $('bq-image');
    if (image) image.addEventListener('change', resetObservation);
    // Entering the read phase (camera start) also resets observation:
    // a scan-stage error after a failed verification must not be shown
    // as a step-2 verification failure (PR #94 review point).
    var camera = $('bq-camera');
    if (camera) camera.addEventListener('click', resetObservation);
    var resetParts = $('bq-reset-parts');
    if (resetParts) resetParts.addEventListener('click', resetObservation);
    var zeroize = $('btn-zeroize');
    if (zeroize) zeroize.addEventListener('click', resetObservation);

    // Condition 4: the observer watches only the status element (text and
    // data-error), the preview (hidden), and the apply button (disabled).
    // It writes only to the D3-1 elements (steps and the verified block).
    var mo = new MutationObserver(function () {
      var text = statusEl.textContent || '';
      if ((validationAttempted || executeAttempted || latchedDone) && previewEl.hidden &&
          RESET_PATTERNS.some(function (p) { return text.indexOf(p) >= 0; })) {
        validationAttempted = false;
        executeAttempted = false;
        latchedDone = false;
      }
      update();
    });
    mo.observe(statusEl, { childList: true, characterData: true, attributes: true, attributeFilter: ['data-error'] });
    mo.observe(previewEl, { attributes: true, attributeFilter: ['hidden'] });
    mo.observe(applyBtn, { attributes: true, attributeFilter: ['disabled'] });

    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
