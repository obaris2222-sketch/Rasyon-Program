import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

/**
 * FAZ 16.1: INRA 2018 Sonuç Paneli
 *
 * UFL (Enerji), PDIE/PDIN (Protein) ve UEL (Doluluk) durumunu gösterir.
 */
export function renderINRAPanel(result) {
  if (!result || !result.inra) return '';

  const inra = result.inra;
  const { supply, requirements, balance } = inra;

  // Bar renkleri
  const color = (pct) => {
    if (pct < 95) return 'var(--danger)';
    if (pct > 115) return 'var(--warning)';
    return 'var(--success)';
  };

  // UEL için ters mantık (fazla doluluk = kırmızı)
  const uelColor = (pct) => {
    if (pct > 100) return 'var(--danger)';
    if (pct > 90) return 'var(--warning)';
    return 'var(--success)';
  };

  // FAZ 22.4: mesajlar artık { level, text } objesi (emoji'siz) → level'a göre kutu + SVG ikon.
  const MSG_META = {
    warn: { box: 'box-warn', icon: 'ti-alert-triangle' },
    ok:   { box: 'box-ok',   icon: 'ti-circle-check' },
    info: { box: 'box-info', icon: 'ti-info-circle' },
  };
  const messagesHtml = balance.messages.map(m => {
    // Geriye dönük tolerans: eski string formatı gelirse de bozulmadan göster.
    const level = (m && typeof m === 'object') ? (m.level || 'info') : 'info';
    const text = (m && typeof m === 'object') ? m.text : String(m);
    const meta = MSG_META[level] || MSG_META.info;
    return `
    <div class="${meta.box} mb-1" style="padding: 8px; border-radius: 4px; font-size: 0.9em; display:flex; align-items:flex-start; gap:0.4rem;">
      <i class="ti ${meta.icon}" style="flex-shrink:0; margin-top:1px;"></i>
      <span>${escHtml(text)}</span>
    </div>
    `;
  }).join('');

  // (Denetim düzeltmesi: kullanılmayan/yanıltıcı "yaklaşık per-feed UFL" tablo bloğu
  //  kaldırıldı — rasyon-ortalaması per-kg değeri yem başına atfetmek hatalıydı.
  //  Yem-bazlı katkı zaten Rasyon Bileşenleri tablosunda kg KM olarak gösteriliyor.)

  return `
    <div class="card mt-2 border-primary">
      <div class="card-title">
        <span>${t('inra.title')}</span>
        <span class="badge bg-primary text-white">${t('inra.badge')}</span>
        <span class="badge badge-display">${t('results.display_badge')}</span>
      </div>
      <div class="info-box mb-2">
        ${t('inra.intro')}
      </div>

      <div class="messages-container mb-2">
        ${messagesHtml}
      </div>

      <div class="progress-grid">
        <!-- Energy (UFL) -->
        <div class="progress-box">
          <div class="flex justify-between text-small mb-1">
            <strong>${t('inra.energy')}</strong>
            <span>${supply.ufl.toFixed(2)} / ${requirements.ufl.total.toFixed(2)} UFL</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(100, balance.uflBalance_pct)}%; background-color: ${color(balance.uflBalance_pct)}"></div>
          </div>
          <div class="text-small text-muted mt-1 text-center">${t('inra.coverage', { p: balance.uflBalance_pct })}</div>
        </div>

        <!-- Protein (PDI/Effective) -->
        <div class="progress-box">
          <div class="flex justify-between text-small mb-1">
            <strong>${t('inra.protein')}</strong>
            <span>${balance.effectivePDI_g.toFixed(0)} / ${requirements.pdi.total.toFixed(0)} g/gün</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(100, balance.pdiBalance_pct)}%; background-color: ${color(balance.pdiBalance_pct)}"></div>
          </div>
          <div class="text-small text-muted mt-1 text-center">${t('inra.coverage', { p: balance.pdiBalance_pct })}</div>
          <div class="flex justify-between text-small text-muted mt-1" style="border-top: 1px dashed var(--border, #ccc); padding-top: 4px;">
            <span>PDIE: ${supply.pdie_g.toFixed(0)} g</span>
            <span>PDIN: ${supply.pdin_g.toFixed(0)} g</span>
          </div>
        </div>

        <!-- Fill (UEL) -->
        <div class="progress-box">
          <div class="flex justify-between text-small mb-1">
            <strong>${t('inra.fill')}</strong>
            <span>${supply.uel.toFixed(2)} / ${t('inra.capacity')}: ${requirements.uelCapacity.toFixed(2)}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(100, balance.uelUsage_pct)}%; background-color: ${uelColor(balance.uelUsage_pct)}"></div>
          </div>
          <div class="text-small text-muted mt-1 text-center">${t('inra.capacity_used', { p: balance.uelUsage_pct })}</div>
        </div>
      </div>

      <details class="acc-panel mt-2">
        <summary><strong>${t('inra.acc_title')}</strong></summary>
        <table class="diag-table mt-1">
          <thead>
            <tr>
              <th>${t('inra.col_unit')}</th>
              <th class="num">${t('inra.col_value')}</th>
              <th>${t('inra.col_desc')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>UFL</strong></td>
              <td class="num">${supply.perKgDM.ufl.toFixed(2)}</td>
              <td class="text-small text-muted">${t('inra.ufl_desc')}</td>
            </tr>
            <tr>
              <td><strong>PDIE</strong></td>
              <td class="num">${supply.perKgDM.pdie.toFixed(1)} g</td>
              <td class="text-small text-muted">${t('inra.pdie_desc')}</td>
            </tr>
            <tr>
              <td><strong>PDIN</strong></td>
              <td class="num">${supply.perKgDM.pdin.toFixed(1)} g</td>
              <td class="text-small text-muted">${t('inra.pdin_desc')}</td>
            </tr>
            <tr>
              <td><strong>UEL</strong></td>
              <td class="num">${supply.perKgDM.uel.toFixed(2)}</td>
              <td class="text-small text-muted">${t('inra.uel_desc')}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  `;
}
