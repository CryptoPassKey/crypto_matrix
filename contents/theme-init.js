// 初回はライトモード。ダークを選んだ人だけダークで開く（描画前に適用してちらつき防止）
try { if (localStorage.getItem('cm-theme') !== 'dark') document.documentElement.classList.add('light'); }
catch (e) { document.documentElement.classList.add('light'); }
