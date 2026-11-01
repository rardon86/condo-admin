// Aplica el tema antes de pintar (evita parpadeo). Archivo externo para cumplir la CSP (sin scripts inline).
(function () {
  var t = null;
  try { t = localStorage.getItem('theme'); } catch (e) {}
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
})();
