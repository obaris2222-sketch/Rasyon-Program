/**
 * Onboarding Wizard — FAZ 7C
 *
 * İlk ziyarette açılan 5 adımlı rehber modal.
 * localStorage'daki 'onboarding_done' flag'ı kontrol eder.
 * Kullanıcı "Başla" diyene kadar her sayfayı yüklediğinde açılmaz — sadece ilk ziyarette.
 */

import { t } from '../i18n.js';

const KEY = 'onboarding_done_v1';

// İçerik i18n'den (onboard.s{n}_title/desc/tip) — render anında çözülür
const STEP_ICONS = ['ti-clipboard-list', 'ti-leaf', 'ti-leaf', 'ti-scale', 'ti-chart-bar', 'ti-cloud'];

export function shouldShowOnboarding() {
  try {
    return !localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(KEY, '1');
  } catch { /* ignore */ }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

/**
 * Onboarding modalını oluşturur ve DOM'a ekler.
 * @param {function} [onDone] — kullanıcı tamamladığında çağrılır
 */
export function showOnboarding(onDone) {
  // Zaten açık mu?
  if (document.getElementById('onboarding-modal')) return;

  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.id = 'onboarding-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:16px
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background:var(--surface);border-radius:12px;max-width:520px;width:100%;
    box-shadow:0 8px 40px rgba(0,0,0,.25);overflow:hidden
  `;

  function render() {
    const n = currentStep + 1;
    const icon = STEP_ICONS[currentStep];
    const title = t(`onboard.s${n}_title`);
    const desc = t(`onboard.s${n}_desc`);
    const tip = t(`onboard.s${n}_tip`);
    const isLast = currentStep === STEP_ICONS.length - 1;
    const dots = STEP_ICONS.map((_, i) =>
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
       margin:0 3px;background:${i === currentStep ? 'var(--primary)' : 'var(--border)'}"></span>`
    ).join('');

    card.innerHTML = `
      <div style="background:linear-gradient(135deg,#1d4ed8,#12305a);padding:24px;color:#fff;text-align:center">
        <div style="font-size:46px;line-height:1.2"><i class="ti ${icon}"></i></div>
        <h2 style="margin:8px 0 0;font-size:20px;font-weight:700">${title}</h2>
        <div style="margin-top:8px;font-size:13px;opacity:.8">
          ${n} / ${STEP_ICONS.length}
        </div>
      </div>

      <div style="padding:24px">
        <p style="font-size:15px;line-height:1.6;color:var(--text);margin:0 0 16px">${desc}</p>
        <div style="background:var(--primary-light);border-left:3px solid var(--primary);border-radius:4px;padding:10px 14px;font-size:13px;color:var(--text)">
          <i class="ti ti-bulb"></i> <b>${t('onboard.tip')}</b> ${tip}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:24px">
          <div>${dots}</div>
          <div style="display:flex;gap:8px">
            ${currentStep > 0
              ? `<button id="ob-prev" class="btn btn-secondary btn-sm">${t('onboard.back')}</button>`
              : ''}
            <button id="ob-skip" class="btn btn-secondary btn-sm" style="color:var(--text-muted)">
              ${t('onboard.skip')}
            </button>
            <button id="ob-next" class="btn btn-primary btn-sm">
              ${isLast ? t('onboard.start') : t('onboard.next')}
            </button>
          </div>
        </div>
      </div>
    `;

    card.querySelector('#ob-next').onclick = () => {
      if (isLast) finish();
      else { currentStep++; render(); }
    };
    card.querySelector('#ob-skip').onclick = finish;
    card.querySelector('#ob-prev')?.addEventListener('click', () => {
      currentStep--;
      render();
    });
  }

  function finish() {
    markOnboardingDone();
    overlay.remove();
    onDone?.();
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  render();
}
