// Apply the saved preference before the page paints. No account data is stored here.
(() => {
  let theme = 'dark';
  try { if (localStorage.getItem('u7-theme') === 'light') theme = 'light'; } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f5fa' : '#111217');
})();
