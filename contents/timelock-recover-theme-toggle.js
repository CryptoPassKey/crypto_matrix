
    // テーマ切替（本体アプリと cm-theme を共有し、別タブの変更にも追随する）
    (function () {
      var btn = document.getElementById('rec-theme-toggle');
      if (!btn) return;
      function render() {
        var dark = document.documentElement.dataset.theme === 'dark';
        btn.textContent = dark ? '☀️ ライト表示' : '🌙 ダーク表示';
      }
      btn.addEventListener('click', function () {
        var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        if (next === 'dark') document.documentElement.dataset.theme = 'dark';
        else delete document.documentElement.dataset.theme;
        try { localStorage.setItem('cm-theme', next); } catch (e) { /* 保存できない環境では表示だけ切り替える */ }
        render();
      });
      window.addEventListener('storage', function (ev) {
        if (ev.key !== 'cm-theme') return;
        if (ev.newValue === 'dark') document.documentElement.dataset.theme = 'dark';
        else delete document.documentElement.dataset.theme;
        render();
      });
      render();
    })();
  