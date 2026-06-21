/**
 * Hesap & Bulut Modal'ı (FAZ 16.10 — Aşama 1).
 *
 * Giriş yapılmamışsa: Giriş / Kayıt (e-posta + şifre) + şifre sıfırlama.
 * Giriş yapılmışsa: hesap bilgisi + senkron durumu + "Şimdi senkronize et" + Çıkış.
 *
 * Mevcut `.feed-modal-*` stilleri yeniden kullanılır (koyu tema + mobil uyumlu).
 */

import {
  signIn, signUp, signOut, resetPassword, getCurrentUser, isCloudConfigured, deleteAccount,
} from '../../data/auth.js';
import { syncNow, getSyncState, onSyncStatus } from '../../data/sync/syncManager.js';
import { showToast, escHtml } from '../utils.js';
import { t } from '../i18n.js';

let _unsub = null;

function closeAuthModal() {
  document.getElementById('auth-modal-overlay')?.remove();
  document.removeEventListener('keydown', _escHandler);
  if (_unsub) { _unsub(); _unsub = null; }
}

function _escHandler(e) { if (e.key === 'Escape') closeAuthModal(); }

const STATUS_ICON = {
  idle: 'ti-cloud', syncing: 'ti-refresh', synced: 'ti-cloud-check', pending: 'ti-clock', offline: 'ti-cloud-off', error: 'ti-alert-triangle',
};

function statusLabel(state) {
  const base = t(`cloud.status_${state.status}`);
  if (state.status === 'pending' && state.pending > 0) {
    return `${base} (${state.pending})`;
  }
  return base;
}

/**
 * Hesap & Bulut modal'ını aç. Oturum durumuna göre uyarlanır.
 */
export async function openAuthModal() {
  closeAuthModal();

  const overlay = document.createElement('div');
  overlay.className = 'feed-modal-overlay';
  overlay.id = 'auth-modal-overlay';
  overlay.innerHTML = `
    <div class="feed-modal auth-modal" role="dialog" aria-modal="true" aria-label="${t('cloud.aria')}">
      <div class="feed-modal-header">
        <h2><i class="ti ti-cloud"></i> ${t('cloud.account_title')}</h2>
        <button class="modal-close-btn" type="button" aria-label="${t('cloud.close')}"><i class="ti ti-x"></i></button>
      </div>
      <div class="feed-modal-body" id="auth-modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close-btn').addEventListener('click', closeAuthModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAuthModal(); });
  document.addEventListener('keydown', _escHandler);

  const body = overlay.querySelector('#auth-modal-body');

  if (!isCloudConfigured()) {
    body.innerHTML = `<div class="box-warn">${t('cloud.not_configured')}</div>`;
    return;
  }

  const user = await getCurrentUser();
  if (user) renderAccountView(body, user);
  else renderAuthForms(body);
}

// ─── Giriş yapılmış: hesap görünümü ───────────────────────────────────────────

function renderAccountView(body, user) {
  const render = (state) => {
    body.innerHTML = `
      <div class="auth-account">
        <div class="box-ok">${t('cloud.signed_in_as')}: <b>${escHtml(user.email || '')}</b></div>
        <div class="auth-status-row">
          <span class="auth-status-icon"><i class="ti ${STATUS_ICON[state.status] || 'ti-cloud'}"></i></span>
          <span>${escHtml(statusLabel(state))}</span>
        </div>
        ${state.lastSyncAt ? `<div class="text-small text-muted">${t('cloud.last_sync')}: ${new Date(state.lastSyncAt).toLocaleString()}</div>` : ''}
        <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
          <button class="btn btn-primary" id="auth-sync-now" ${state.status === 'syncing' ? 'disabled' : ''}>${t('cloud.sync_now')}</button>
          <button class="btn btn-danger" id="auth-logout">${t('cloud.logout')}</button>
        </div>
        <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
          <button class="btn btn-danger btn-sm" id="auth-delete-account" style="opacity: 0.8;">${t('cloud.delete_account')}</button>
        </div>
        <div class="text-small text-muted mt-1">${t('cloud.account_hint')}</div>
      </div>
    `;
    body.querySelector('#auth-sync-now').addEventListener('click', () => syncNow());
    body.querySelector('#auth-logout').addEventListener('click', async () => {
      try {
        await signOut();
        showToast(t('cloud.logout_done'), 'info');
        closeAuthModal();
      } catch (err) {
        showToast(t('cloud.err_generic') + err.message, 'error');
      }
    });
    body.querySelector('#auth-delete-account').addEventListener('click', async () => {
      if (!confirm(t('cloud.delete_account_confirm'))) return;
      try {
        await deleteAccount();
        showToast(t('cloud.logout_done'), 'info'); // Sign out successful
        closeAuthModal();
      } catch (err) {
        showToast(t('cloud.err_generic') + err.message, 'error');
      }
    });
  };

  render(getSyncState());
  // Senkron durumu değiştikçe görünümü tazele
  _unsub = onSyncStatus((state) => {
    if (document.getElementById('auth-modal-overlay')) render(state);
  });
}

// ─── Giriş yapılmamış: Giriş / Kayıt formları ─────────────────────────────────

function renderAuthForms(body) {
  let mode = 'login';   // 'login' | 'signup'

  const render = () => {
    const isLogin = mode === 'login';
    body.innerHTML = `
      <div class="auth-tabs">
        <button class="auth-tab ${isLogin ? 'active' : ''}" data-mode="login">${t('cloud.login_tab')}</button>
        <button class="auth-tab ${!isLogin ? 'active' : ''}" data-mode="signup">${t('cloud.signup_tab')}</button>
      </div>
      <div class="text-small text-muted mb-1">${t('cloud.cloud_intro')}</div>
      <form class="auth-form" id="auth-form" novalidate>
        <div class="form-group">
          <label>${t('cloud.email')}</label>
          <input type="email" id="auth-email" autocomplete="email" required />
        </div>
        <div class="form-group">
          <label>${t('cloud.password')}</label>
          <input type="password" id="auth-password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required />
        </div>
        <div id="auth-msg" class="text-small" style="min-height:1.2em"></div>
        <button type="submit" class="btn btn-primary" id="auth-submit" style="width:100%">
          ${isLogin ? t('cloud.login_btn') : t('cloud.signup_btn')}
        </button>
      </form>
      ${isLogin ? `<button class="btn-link" id="auth-forgot" type="button">${t('cloud.forgot')}</button>` : ''}
    `;

    body.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => { mode = tab.dataset.mode; render(); });
    });

    const form = body.querySelector('#auth-form');
    const msg = body.querySelector('#auth-msg');
    const submitBtn = body.querySelector('#auth-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = body.querySelector('#auth-email').value.trim();
      const password = body.querySelector('#auth-password').value;
      if (!email || !password) { msg.innerHTML = `<span style="color:var(--danger)">${t('cloud.fill_fields')}</span>`; return; }
      if (password.length < 6) { msg.innerHTML = `<span style="color:var(--danger)">${t('cloud.password_min')}</span>`; return; }

      submitBtn.disabled = true;
      msg.innerHTML = `<span class="text-muted"><i class="ti ti-loader-2 ti-spin"></i> …</span>`;
      try {
        if (mode === 'login') {
          await signIn(email, password);
          showToast(t('cloud.login_success'), 'success');
          closeAuthModal();   // app onAuthChange → startSync
        } else {
          const { needsConfirmation } = await signUp(email, password);
          if (needsConfirmation) {
            msg.innerHTML = `<span style="color:var(--primary)">${t('cloud.signup_confirm')}</span>`;
          } else {
            showToast(t('cloud.signup_success'), 'success');
            closeAuthModal();
          }
        }
      } catch (err) {
        msg.innerHTML = `<span style="color:var(--danger)">${escHtml(translateAuthError(err))}</span>`;
      } finally {
        submitBtn.disabled = false;
      }
    });

    const forgot = body.querySelector('#auth-forgot');
    if (forgot) forgot.addEventListener('click', async () => {
      const email = body.querySelector('#auth-email').value.trim();
      if (!email) { msg.innerHTML = `<span style="color:var(--danger)">${t('cloud.forgot_need_email')}</span>`; return; }
      try {
        await resetPassword(email);
        msg.innerHTML = `<span style="color:var(--primary)">${t('cloud.reset_sent')}</span>`;
      } catch (err) {
        msg.innerHTML = `<span style="color:var(--danger)">${escHtml(err.message)}</span>`;
      }
    });
  };

  render();
}

/** Supabase'in yaygın İngilizce hata mesajlarını anlaşılır metne çevirir. */
function translateAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('invalid login')) return t('cloud.err_invalid_login');
  if (m.includes('already registered') || m.includes('already been registered')) return t('cloud.err_already');
  if (m.includes('email') && m.includes('confirm')) return t('cloud.signup_confirm');
  return err?.message || t('cloud.err_generic');
}
