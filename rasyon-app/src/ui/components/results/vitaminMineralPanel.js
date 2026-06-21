/**
 * Vitamin & İz Mineral Profili paneli (FAZ 15.8 — resultsPanel'den ayrıldı)
 * Yağda çözünen vitaminler (A/D/E + β-karoten dönüşümü), fonksiyonel besinler,
 * iz mineraller (NRC 2001 Tablo 6-2) + B grubu koşullu öneri.
 */

import { t } from '../../i18n.js';

export function renderVitaminTraceMineralPanel(composition, requirements, dmi) {
  const vit = requirements?.vitamins;
  const tm  = requirements?.traceMinerals;
  if (!vit || !tm) return `<p class="text-muted">${t('vm.no_data')}</p>`;

  const IU = t('vm.unit_iu'), MG = t('vm.unit_mg'), G = t('vm.unit_g');

  // Durum hesaplama (supply vs requirement)
  const statusVit = (supplied, required, max) => {
    if (!supplied || supplied === 0) return { cls: 'above', label: t('vm.st_none'), val: '0' };
    if (max && supplied > max) return { cls: 'above', label: t('vm.st_excess'), val: supplied.toLocaleString() };
    if (supplied >= required) return { cls: 'ok', label: t('vm.st_ok'), val: supplied.toLocaleString() };
    const pct = Math.round(supplied / required * 100);
    return { cls: 'below', label: t('vm.st_pct', { pct }), val: supplied.toLocaleString() };
  };

  const statusTM = (supplied, minMg, maxMg) => {
    if (supplied < minMg) {
      const pct = minMg > 0 ? Math.round(supplied / minMg * 100) : 0;
      return { cls: 'below', label: t('vm.tm_low', { pct }) };
    }
    if (supplied > maxMg) return { cls: 'above', label: t('vm.tm_tox') };
    return { cls: 'ok', label: t('vm.tm_ok') };
  };

  // FAZ 10C: β-karoten → Vit A dönüşümü (1 mg β-karoten ≈ 200 IU Vit A sığır için)
  const bcarotene_mg = composition.bcarotene_mg ?? 0;
  const vitAFromBcarotene = bcarotene_mg * 200;
  const vitA_effective = (composition.vitA_IU ?? 0) + vitAFromBcarotene;

  // Vitamin satırları (FAZ 10C: NASEM 2021 katsayıları + β-karoten dönüşümü)
  const vitRows = [
    { name: 'Vitamin A', supplied: vitA_effective, req: vit.vitA?.recommendedIU, max: vit.vitA?.maxIU,
      unit: IU, func: `${t('vm.func_vitA')}${bcarotene_mg > 0 ? ` ${t('vm.func_vitA_bc', { x: Math.round(vitAFromBcarotene) })}` : ''}` },
    { name: 'Vitamin D', supplied: composition.vitD_IU, req: vit.vitD?.recommendedIU,
      unit: IU, func: t('vm.func_vitD') },
    { name: 'Vitamin E', supplied: composition.vitE_IU, req: vit.vitE?.recommendedIU,
      unit: IU, func: t('vm.func_vitE') },
  ];

  // FAZ 10C/F: Fonksiyonel besinler — NASEM 2021 dinamik hedefler
  const functionalRows = [
    { name: t('vm.fn_bcarotene'),  supplied: composition.bcarotene_mg ?? 0,
      req: vit.bcarotene?.recommendedMg ?? 300,  unit: MG, func: t('vm.func_bcarotene') },
    { name: t('vm.fn_niacin'), supplied: composition.niacin_mg ?? 0,
      req: (vit.niacin?.recommendedG ?? 6) * 1000, unit: MG,
      func: t('vm.func_niacin', { g: vit.niacin?.recommendedG ?? 6 }) },
    { name: t('vm.fn_biotin'), supplied: composition.biotin_mg ?? 0,
      req: (vit.biotin?.recommendedMg ?? 20), unit: MG, func: t('vm.func_biotin') },
    { name: t('vm.fn_choline'), supplied: composition.choline_g ?? 0,
      req: (vit.choline?.recommendedIonG ?? 0),  unit: G,
      func: vit.choline?.recommendedProductG_25pct
        ? t('vm.func_choline', { g: vit.choline.recommendedProductG_25pct })
        : t('vm.func_choline_base') },
  ];

  // İz mineral satırları
  const tmRows = [
    { name: t('vm.tm_fe'), supplied: composition.fe_mg, min: tm.fe.minMgDay, max: tm.fe.maxMgDay, unit: MG, func: t('vm.func_fe') },
    { name: t('vm.tm_zn'), supplied: composition.zn_mg, min: tm.zn.minMgDay, max: tm.zn.maxMgDay, unit: MG, func: t('vm.func_zn') },
    { name: t('vm.tm_cu'), supplied: composition.cu_mg, min: tm.cu.minMgDay, max: tm.cu.maxMgDay, unit: MG, func: t('vm.func_cu') },
    { name: t('vm.tm_mn'), supplied: composition.mn_mg, min: tm.mn.minMgDay, max: tm.mn.maxMgDay, unit: MG, func: t('vm.func_mn') },
    { name: t('vm.tm_se'), supplied: composition.se_mg, min: tm.se.minMgDay, max: tm.se.maxMgDay, unit: MG, func: t('vm.func_se') },
    { name: t('vm.tm_co'), supplied: composition.co_mg, min: tm.co.minMgDay, max: tm.co.maxMgDay, unit: MG, func: t('vm.func_co') },
    { name: t('vm.tm_i'),  supplied: composition.i_mg,  min: tm.i.minMgDay,  max: tm.i.maxMgDay,  unit: MG, func: t('vm.func_i') },
  ];

  // Hızlı özet — toplam eksik sayısı
  const vitDeficits = vitRows.filter(r => r.supplied < r.req).length;
  const tmDeficits  = tmRows.filter(r => r.supplied < r.min).length;
  const tmExcess    = tmRows.filter(r => r.supplied > r.max).length;

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1rem; margin-bottom:1rem">
      <div class="summary-card">
        <div class="val" style="color:${vitDeficits === 0 ? 'var(--primary)' : 'var(--warning)'}">${vitDeficits === 0 ? '<i class="ti ti-check"></i>' : vitDeficits}</div>
        <div class="lbl">${t('vm.sum_vit_def')}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${tmDeficits === 0 ? 'var(--primary)' : 'var(--warning)'}">${tmDeficits === 0 ? '<i class="ti ti-check"></i>' : tmDeficits}</div>
        <div class="lbl">${t('vm.sum_tm_def')}</div>
      </div>
      <div class="summary-card" style="background:${tmExcess > 0 ? 'var(--above-bg)' : 'var(--primary-light)'}">
        <div class="val" style="color:${tmExcess === 0 ? 'var(--primary)' : 'var(--danger)'}">${tmExcess === 0 ? '<i class="ti ti-check"></i>' : tmExcess}</div>
        <div class="lbl">${t('vm.sum_tox')}</div>
      </div>
    </div>

    <div class="section-title">${t('vm.sec_vitamins')}</div>
    <table class="diag-table">
      <thead>
        <tr><th>${t('vm.col_vitamin')}</th><th class="num">${t('vm.col_from_feed')}</th><th class="num">${t('vm.col_requirement')}</th><th>${t('vm.col_status')}</th><th>${t('vm.col_function')}</th></tr>
      </thead>
      <tbody>
        ${vitRows.map(r => {
          const st = statusVit(r.supplied, r.req, r.max);
          return `<tr class="status-row-${st.cls}">
            <td><b>${r.name}</b></td>
            <td class="num">${st.val} ${r.unit}</td>
            <td class="num">${r.req?.toLocaleString() ?? '—'} ${r.unit}</td>
            <td><span class="status-${st.cls}">${st.label}</span></td>
            <td class="text-muted text-small">${r.func}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <div class="section-title mt-2">${t('vm.sec_functional')}</div>
    <table class="diag-table">
      <thead>
        <tr><th>${t('vm.col_nutrient')}</th><th class="num">${t('vm.col_from_feed')}</th><th class="num">${t('vm.col_recommended')}</th><th>${t('vm.col_status')}</th><th>${t('vm.col_function')}</th></tr>
      </thead>
      <tbody>
        ${functionalRows.map(r => {
          if (r.req === 0) {
            return `<tr>
              <td><b>${r.name}</b></td>
              <td class="num">${r.supplied.toFixed(r.unit === G ? 1 : 0)} ${r.unit}</td>
              <td class="num text-muted">${t('vm.optional')}</td>
              <td><span class="text-muted">${t('vm.period_specific')}</span></td>
              <td class="text-muted text-small">${r.func}</td>
            </tr>`;
          }
          const st = r.supplied >= r.req ? { cls: 'ok', label: t('vm.fn_ok') }
                  : r.supplied >= r.req * 0.5 ? { cls: 'below', label: t('vm.fn_partial', { pct: Math.round(r.supplied/r.req*100) }) }
                  : { cls: 'above', label: t('vm.fn_missing') };
          return `<tr class="status-row-${st.cls}">
            <td><b>${r.name}</b></td>
            <td class="num">${r.supplied.toFixed(r.unit === G ? 1 : 0)} ${r.unit}</td>
            <td class="num">${r.req.toLocaleString()} ${r.unit}</td>
            <td><span class="status-${st.cls}">${st.label}</span></td>
            <td class="text-muted text-small">${r.func}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <div class="section-title mt-2">${t('vm.sec_tm')}</div>
    <table class="diag-table">
      <thead>
        <tr><th>${t('vm.col_mineral')}</th><th class="num">${t('vm.col_from_feed')}</th><th class="num">${t('vm.col_min')}</th><th class="num">${t('vm.col_max')}</th><th>${t('vm.col_status')}</th><th>${t('vm.col_function')}</th></tr>
      </thead>
      <tbody>
        ${tmRows.map(r => {
          const st = statusTM(r.supplied, r.min, r.max);
          return `<tr class="status-row-${st.cls}">
            <td><b>${r.name}</b></td>
            <td class="num">${r.supplied.toLocaleString()} ${r.unit}</td>
            <td class="num">${Math.round(r.min).toLocaleString()}</td>
            <td class="num">${Math.round(r.max).toLocaleString()}</td>
            <td><span class="status-${st.cls}">${st.label}</span></td>
            <td class="text-muted text-small">${r.func}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    ${vitDeficits > 0 || tmDeficits > 0 ? `
      <div class="info-box box-warn" style="margin-top:0.75rem">
        ${t('vm.premix_info', { a: vit.vitA?.recommendedIU?.toLocaleString() ?? '—', d: vit.vitD?.recommendedIU?.toLocaleString() ?? '—', e: vit.vitE?.recommendedIU?.toLocaleString() ?? '—' })}
      </div>
    ` : ''}
    ${tmExcess > 0 ? `
      <div class="info-box box-danger" style="margin-top:0.5rem">
        ${t('vm.tox_info')}
      </div>
    ` : ''}
    ${(vit.b12?.recommendedMg || vit.folicAcid?.recommendedMg) ? `
      <div class="info-box box-ok" style="margin-top:0.5rem">
        ${t('vm.bgroup_intro')}
        ${vit.b12?.recommendedMg ? t('vm.bgroup_b12', { mg: vit.b12.recommendedMg }) : ''}${(vit.b12?.recommendedMg && vit.folicAcid?.recommendedMg) ? ' + ' : ''}${vit.folicAcid?.recommendedMg ? t('vm.bgroup_folic', { mg: vit.folicAcid.recommendedMg }) : ''}
        ${t('vm.bgroup_outro')}
      </div>
    ` : ''}

    <div class="text-small text-muted mt-1">
      ${t('vm.footer')}
    </div>
  `;
}
