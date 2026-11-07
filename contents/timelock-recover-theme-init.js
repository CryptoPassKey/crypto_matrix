
    // 本体アプリとテーマを共有する（localStorage の cm-theme。本体と同じく dark のときだけダーク、それ以外はライト）
    try { if (localStorage.getItem('cm-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) { /* 既定はライト */ }
  