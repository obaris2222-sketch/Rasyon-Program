/**
 * Kalibrasyon Teşhis Merkezi Modalı (FAZ 4)
 */

import { showToast, escHtml } from '../utils.js';
import { animalProfilePut, animalProfileGetById } from '../../data/db.js';

let modalRoot = null;

function getModalRoot() {
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'calibration-modal-root';
    document.body.appendChild(modalRoot);
  }
  return modalRoot;
}

export function showCalibrationModal(diagnosticsResult, profileId, onApplyCallback) {
  const root = getModalRoot();
  
  const { diagnostics, overrides, R2, RMSE, Bias } = diagnosticsResult;
  
  let contentHtml = '';

  if (diagnostics.length === 0) {
    contentHtml = '<p class="text-muted">Teşhis verisi bulunamadı.</p>';
  } else {
    // İstatistikler Paneli
    if (R2 !== null) {
      contentHtml += `
        <div class="info-box" style="margin-bottom:1rem; display:flex; gap:1rem; justify-content:space-around;">
          <div><b>R² (Tutarlılık):</b> ${R2}</div>
          <div><b>RMSE (Hata Payı):</b> ${RMSE} kg</div>
          <div><b>Ort. Sapma:</b> ${Bias > 0 ? '+' : ''}${Bias} kg</div>
        </div>
      `;
    }

    // Teşhis Kartları
    for (const diag of diagnostics) {
      const colorMap = {
        'error': 'var(--danger)',
        'danger': 'var(--danger)',
        'warning': 'var(--warning)',
        'info': 'var(--primary)',
        'success': 'var(--primary)'
      };
      
      const iconMap = {
        'error': 'ti-alert-octagon',
        'danger': 'ti-alert-triangle',
        'warning': 'ti-alert-circle',
        'info': 'ti-info-circle',
        'success': 'ti-check'
      };

      const color = colorMap[diag.type] || 'var(--text-muted)';
      const icon = iconMap[diag.type] || 'ti-point';

      contentHtml += `
        <div style="border-left: 4px solid ${color}; padding: 1rem; background: var(--bg-tertiary); margin-bottom: 1rem; border-radius: 4px;">
          <div style="font-weight:600; font-size:1.1rem; color: ${color}; display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
            <i class="ti ${icon}"></i> ${escHtml(diag.cause || 'Bilgi')}
          </div>
          <div style="font-size:0.95rem; line-height:1.5;">${escHtml(diag.message)}</div>
        </div>
      `;
    }
  }

  root.innerHTML = `
    <div class="feed-modal-overlay active" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="feed-modal" style="max-width: 600px; width: 90%; background: var(--bg-primary); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="padding: 1rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary);">
          <div class="modal-title" style="font-weight: 600; font-size: 1.1rem;"><i class="ti ti-stethoscope"></i> Kalibrasyon Teşhis Merkezi</div>
          <button class="btn-close" id="calib-btn-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <div class="modal-body" style="padding: 1.5rem; overflow-y: auto; max-height: 70vh;">
          ${contentHtml}
        </div>
        <div class="modal-footer" style="padding: 1rem; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 0.5rem; background: var(--bg-secondary);">
          <button class="btn btn-secondary" id="calib-btn-cancel">Kapat</button>
          ${diagnostics.some(d => d.action) 
            ? `<button class="btn btn-primary" id="calib-btn-apply"><i class="ti ti-check"></i> Önerilen Kalibrasyonu Uygula</button>` 
            : ''}
        </div>
      </div>
    </div>
  `;

  // Olay Dinleyicileri
  const closeModal = () => {
    root.innerHTML = '';
  };

  root.querySelector('#calib-btn-close').addEventListener('click', closeModal);
  root.querySelector('#calib-btn-cancel').addEventListener('click', closeModal);
  
  const applyBtn = root.querySelector('#calib-btn-apply');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      try {
        const profile = await animalProfileGetById(profileId);
        if (!profile) throw new Error("Profil bulunamadı.");
        
        if (!profile.calibrationOverrides) {
          profile.calibrationOverrides = {};
        }

        // Action'ları uygula
        for (const diag of diagnostics) {
          if (diag.action === 'dmiMultiplier') {
            profile.calibrationOverrides.dmiMultiplier = diag.value;
          } else if (diag.action === 'peNdfAndNfcOffset') {
            profile.calibrationOverrides.peNdfOffset = (profile.calibrationOverrides.peNdfOffset || 0) + diag.peNdfOffset;
            profile.calibrationOverrides.maxNfcOffset = (profile.calibrationOverrides.maxNfcOffset || 0) + diag.maxNfcOffset;
          } else if (diag.action === 'maxNfcOffset') {
            profile.calibrationOverrides.maxNfcOffset = (profile.calibrationOverrides.maxNfcOffset || 0) + diag.maxNfcOffset;
          }
        }

        await animalProfilePut(profile);
        showToast('Kalibrasyon başarıyla profile uygulandı.', 'success');
        closeModal();
        if (onApplyCallback) onApplyCallback();
      } catch (err) {
        console.error(err);
        showToast('Kalibrasyon uygulanırken hata oluştu.', 'error');
      }
    });
  }
}
