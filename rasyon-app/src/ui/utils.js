/**
 * UI Yardımcı Fonksiyonlar
 */

export function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/**
 * Yükleme katmanını göster/gizle (FAZ 15.5: mesaj + ilerleme yüzdesi destekli).
 * @param {boolean} on
 * @param {object} [opts]
 *   @param {string} [opts.message] — ana mesaj (örn. "Sürü optimize ediliyor...")
 *   @param {number} [opts.percent] — 0-100; verilirse ilerleme çubuğu, yoksa belirsiz spinner
 *   @param {string} [opts.sub]     — alt bilgi (örn. "3/12 profil")
 */
export function showLoading(on, opts = {}) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !on);
  if (!on) return;
  const msgEl = document.getElementById('loading-message');
  if (msgEl && opts.message != null) msgEl.textContent = opts.message;
  updateLoadingProgress(opts.percent, opts.sub);
}

/**
 * Açık yükleme katmanının ilerleme çubuğunu + alt bilgisini günceller (FAZ 15.5).
 * @param {number} [percent] — 0-100; sayı değilse çubuk gizlenir (belirsiz mod)
 * @param {string} [sub]     — alt bilgi metni
 */
export function updateLoadingProgress(percent, sub) {
  const wrap = document.getElementById('loading-progress-wrap');
  const bar  = document.getElementById('loading-progress-bar');
  const subEl = document.getElementById('loading-sub');
  if (Number.isFinite(percent)) {
    wrap?.classList.remove('hidden');
    if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
  } else {
    wrap?.classList.add('hidden');
  }
  if (subEl) {
    if (sub) { subEl.textContent = sub; subEl.classList.remove('hidden'); }
    else { subEl.textContent = ''; subEl.classList.add('hidden'); }
  }
}

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmt(v, decimals = 2) {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(decimals) : '—';
}
