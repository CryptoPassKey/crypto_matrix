// 初回はライトモード。ダークを選んだ人または ?theme=dark / #theme=dark のみダークで開く（描画前に適用してちらつき防止）
try {
  var urlTheme = null;
  try {
    var sp = new URLSearchParams(window.location.search);
    urlTheme = sp.get('theme');
    if (!urlTheme && window.location.hash.indexOf('theme=') >= 0) {
      urlTheme = window.location.hash.split('theme=')[1].split('&')[0];
    }
  } catch (err) {}
  if (urlTheme === 'dark' || (!urlTheme && localStorage.getItem('cm-theme') === 'dark')) {
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.add('light');
  }
} catch (e) {
  document.documentElement.classList.add('light');
}
