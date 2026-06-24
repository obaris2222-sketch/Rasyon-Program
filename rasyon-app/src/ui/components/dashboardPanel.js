/**
 * Dashboard Paneli (FAZ 15.1)
 *
 * Programa giriş ekranı — son rasyon özeti, sürü durumu, IOFC tahmini,
 * son gözlem trendi, hatırlatıcılar/uyarılar ve hızlı işlem butonları.
 */

import {
  animalProfileGetAll,
  herdGroupGetAll,
  observationGetAll,
  rationGetAll,
} from '../../data/db.js';
import { calcEconomics } from '../../core/economics.js';
import { calcLinearTrend } from '../../core/observationAnalysis.js';
import { interpretDCAD } from '../../core/dcad.js';
import { getSettings } from '../../data/settings.js';
import { weightToDisplay, weightUnit, formatWeight } from '../unitFormat.js';
import { escHtml, fmt } from '../utils.js';
import { t } from '../i18n.js';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

let trendChartInstance = null;

/** Laktasyon dönemi etiketi (dil-duyarlı; bilinmeyen → '—'). */
function stageLabel(key) {
  const v = t(`stages.${key}`);
  return v === `stages.${key}` ? '—' : v;
}

/**
 * Dashboard'u verilen container'a render eder.
 *
 * @param {HTMLElement} container
 * @param {object} state — global uygulama durumu
 * @param {object} options
 *   @param {(tab: string) => void} options.onNavigate — tab değiştirme callback'i
 */
export async function renderDashboardPanel(container, state, options = {}) {
  const onNavigate = options.onNavigate || (() => {});

  // Veri toplamak için paralel sorgular (IndexedDB yoksa boş diziye düş)
  const [profiles, groups, observationsRaw, rations] = await Promise.all([
    animalProfileGetAll().catch(() => []),
    herdGroupGetAll().catch(() => []),
    observationGetAll().catch(() => []),
    rationGetAll().catch(() => []),
  ]);

  // observationGetAll() IndexedDB primary-key (ekleme) sırasında döner —
  // tarih sıralı DEĞİL. "En yeni ilk" mantığı için tarihe göre azalan sırala.
  const observations = [...observationsRaw].sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
  );

  const lastResult = state.rationResult || null;
  const lastAt = state.lastOptimizedAt ? new Date(state.lastOptimizedAt) : null;
  // Optimize anındaki hayvan snapshot'ı (yoksa güncel forma düş — geriye uyumlu)
  const lastAnimal = state.lastOptimizedAnimal || state.animal || {};
  const milkPrice = state.economics?.milkPrice_tl ?? 18;
  const units = getSettings().units;   // FAZ 15.2: ağırlık göstergeleri için birim tercihi

  const totalAnimals = groups.reduce((s, g) => s + (g.animalCount || 0), 0);

  // Sürü-ölçek IOFC tahmini — mevcut rasyon × toplam hayvan
  let iofcEstimate = null;
  if (lastResult?.feasible && totalAnimals > 0) {
    const econ = calcEconomics({
      milkYield_kg: lastAnimal.milkYield ?? 0,
      milkPrice_tl: milkPrice,
      feedCost_tl_day: lastResult.totalCost ?? 0,
      dmi_kg: lastResult.dmi?.achieved_kg ?? 0,
      milkFat_pct: lastAnimal.milkFat,
      milkProtein_pct: lastAnimal.milkProtein,
      herdSize: totalAnimals,
    });
    iofcEstimate = {
      perCow: econ.daily.iofc_tl,
      herd: econ.herd.dailyIOFC_tl,
      monthly: econ.herd.monthlyIOFC_tl,
      annual: econ.herd.annualIOFC_tl,
      status: econ.status,
    };
  }

  // Son 7 gün gözlem trendi
  const sevenDayObs = filterLastDays(observations, 7);

  // Hatırlatıcılar
  const reminders = buildReminders({ lastResult, observations, profiles, animal: lastAnimal });

  container.innerHTML = `
    <div class="dashboard">
      <!-- 📖 Sekme Yardımı -->
      <details class="tab-help-accordion" style="margin-bottom:0.75rem; grid-column: 1/-1">
        <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
          <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
        </summary>
        <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
          <b>🏠 Ana Panel</b> — Programın genel durumuna tek bakışta göz atın.<br>
          • <b>Hızlı İşlemler:</b> Hayvan profili oluşturmak, rasyon optimize etmek veya fiyat güncellemek için kısayol butonları.<br>
          • <b>Son Rasyon:</b> En son optimize ettiğiniz rasyonun KM tüketimi, NEL, HP ve maliyeti.<br>
          • <b>Sürü Durumu:</b> Kayıtlı hayvan profilleri ve sürü gruplarının özeti.<br>
          • <b>IOFC Tahmini:</b> Son rasyona ve süt fiyatına göre inek başı ve sürü ölçeğinde tahmini günlük kâr.<br>
          • <b>Hatırlatıcılar:</b> BCS düşüşü, DCAD sorunu veya rasyon infeasibility gibi önemli uyarılar burada görünür.<br>
          • <b>Trend Grafiği:</b> Son 7 günün gözlem verileri (süt verimi + BCS zaman serisi).
        </div>
      </details>

      <!-- Hızlı İşlemler -->
      <div class="card">
        <div class="card-title"><i class="ti ti-bolt"></i> ${t('dashboard.quick_actions')}</div>
        <div class="dash-quick-actions">
          <button class="btn btn-primary" data-nav="animal"><i class="ti ti-clipboard-plus"></i> ${t('dashboard.new_profile')} / ${t('dashboard.edit_profile')}</button>
          <button class="btn btn-primary" data-nav="ration"><i class="ti ti-scale"></i> ${t('dashboard.new_ration')}</button>
          <button class="btn btn-secondary" data-nav="herd"><i class="ti ti-users"></i> ${t('dashboard.herd_mode')}</button>
          <button class="btn btn-secondary" data-nav="prices"><i class="ti ti-coins"></i> ${t('dashboard.update_prices')}</button>
          <button class="btn btn-secondary" data-nav="observations"><i class="ti ti-report-analytics"></i> ${t('dashboard.new_observation')}</button>
        </div>
      </div>

      <!-- 4 ana kart -->
      <div class="dashboard-grid">
        ${renderLastRationCard(lastResult, lastAt, lastAnimal, milkPrice, units)}
        ${renderHerdStatusCard(profiles, groups, totalAnimals)}
        ${renderIOFCCard(iofcEstimate, totalAnimals)}
        ${renderRemindersCard(reminders)}
      </div>

      <!-- Trend grafiği -->
      <div class="card mt-2">
        <div class="card-title">
          <i class="ti ti-chart-line"></i> ${t('dashboard.recent_trends')}
          <span class="text-small text-muted" style="font-weight:400;margin-left:auto">
            ${sevenDayObs.length} ${t('dashboard.measurements')}
          </span>
        </div>
        ${sevenDayObs.length < 2
          ? `<div class="empty-state" style="padding:1.5rem">
              <p class="text-muted">
                ${sevenDayObs.length === 0
                  ? t('dashboard.no_obs_7d')
                  : t('dashboard.need_2_obs')}
              </p>
              <button class="btn btn-sm btn-secondary mt-1" data-nav="observations">${t('dashboard.add_obs')}</button>
            </div>`
          : `<div class="dash-trend-mini"><canvas id="dash-trend-chart"></canvas></div>
             <div class="text-small text-muted mt-1">
               ${t('dashboard.total_records', { n: observations.length, p: profiles.length })}
             </div>`
        }
      </div>

      <!-- Veritabanı özet (alt çubuk) -->
      <div class="dash-db-stats text-small text-muted mt-2">
        <span>${t('dashboard.db_stats')}: <i class="ti ti-clipboard-list"></i> ${profiles.length} ${t('dashboard.stat_profiles')}</span>
        <span>•</span>
        <span><i class="ti ti-users"></i> ${groups.length} ${t('dashboard.stat_herd_groups')} (${totalAnimals} ${t('dashboard.head_unit')})</span>
        <span>•</span>
        <span><i class="ti ti-report-analytics"></i> ${observations.length} ${t('dashboard.stat_obs')}</span>
        <span>•</span>
        <span><i class="ti ti-device-floppy"></i> ${rations.length} ${t('dashboard.stat_saved_rations')}</span>
      </div>
    </div>
  `;

  // Hızlı işlem butonlarını bağla
  container.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => onNavigate(btn.dataset.nav));
  });

  // Mini trend grafiği
  if (sevenDayObs.length >= 2) {
    drawTrendChart(container.querySelector('#dash-trend-chart'), sevenDayObs);
  }
}

// ─── Kart Render'ları ────────────────────────────────────────────────────────

function renderLastRationCard(result, lastAt, animal, milkPrice, units = 'metric') {
  if (!result) {
    return `
      <div class="dash-card">
        <div class="dash-card-title"><i class="ti ti-clipboard-data"></i> ${t('dashboard.latest_ration')}</div>
        <div class="empty-state" style="padding:1rem">
          <p class="text-muted">${t('dashboard.no_ration')}</p>
          <button class="btn btn-primary btn-sm mt-1" data-nav="ration">${t('dashboard.go_optimize')}</button>
        </div>
      </div>`;
  }

  const dmi   = result.dmi?.achieved_kg ?? 0;
  const nel   = result.composition?.nel_mcal ?? 0;
  const cp    = result.composition?.cp_pct ?? 0;
  const cost  = result.totalCost ?? 0;
  const itemsN = result.items?.length ?? 0;
  const feasibleBadge = result.feasible
    ? `<span class="badge-ok status-badge">${t('dashboard.feasible')}</span>`
    : result.relaxation?.applied
      ? `<span class="badge-warn status-badge">${t('dashboard.relaxed')}</span>`
      : `<span class="badge-above status-badge">${t('dashboard.infeasible')}</span>`;

  const econ = result.feasible
    ? calcEconomics({
        milkYield_kg: animal?.milkYield ?? 0,
        milkPrice_tl: milkPrice,
        feedCost_tl_day: cost,
        dmi_kg: dmi,
        milkFat_pct: animal?.milkFat,
        milkProtein_pct: animal?.milkProtein,
      })
    : null;

  const stage = stageLabel(animal?.lactationStage);
  const breed = animal?.breed || 'Holstein';
  const bw    = formatWeight(animal?.bw, units);   // FAZ 15.2: kg/lb birim tercihi
  const my    = animal?.milkYield != null
    ? `${formatWeight(animal.milkYield, units)} ${t('dashboard.milk_per_day')}`   // aynı kartta birim tutarlılığı
    : '—';

  return `
    <div class="dash-card">
      <div class="dash-card-title">
        <i class="ti ti-clipboard-data"></i> ${t('dashboard.latest_ration')} ${feasibleBadge}
      </div>
      <div class="dash-card-sub">
        ${escHtml(breed)} &middot; ${escHtml(bw)} &middot; ${escHtml(stage)} &middot; ${escHtml(my)}
      </div>
      <div class="dash-stats-row">
        <div class="dash-stat">
          <div class="dash-stat-val">${fmt(weightToDisplay(dmi, units), 1)}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_dmi')} ${weightUnit(units)}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">${fmt(nel, 1)}</div>
          <div class="dash-stat-lbl">NEL Mcal</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">${fmt(cp, 1)}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_cp')}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">${fmt(cost, 0)}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_cost')}</div>
        </div>
      </div>
      ${econ
        ? `<div class="dash-card-iofc">
            IOFC: <b>${fmt(econ.daily.iofc_tl, 0)} ${t('dashboard.iofc_per_cow')}</b>
            &middot; ${t('dashboard.feed_milk')}: ${fmt(econ.daily.feedCostPerLiter_tl, 2)} ₺/L
            &middot; FE: ${fmt(econ.daily.feedEfficiency, 2)}
          </div>`
        : ''}
      <div class="dash-card-footer">
        <span class="text-small text-muted">
          ${itemsN} ${t('dashboard.feeds_count')} &middot; ${lastAt ? lastAt.toLocaleString() : '—'}
        </span>
        <button class="btn btn-sm btn-secondary" data-nav="results">${t('dashboard.detail')}</button>
      </div>
    </div>`;
}

function renderHerdStatusCard(profiles, groups, totalAnimals) {
  if (profiles.length === 0) {
    return `
      <div class="dash-card">
        <div class="dash-card-title"><i class="ti ti-users"></i> ${t('dashboard.herd_status')}</div>
        <div class="empty-state" style="padding:1rem">
          <p class="text-muted">${t('dashboard.no_profiles')}</p>
          <button class="btn btn-primary btn-sm mt-1" data-nav="animal">${t('dashboard.add_profile')}</button>
        </div>
      </div>`;
  }

  // Laktasyon dönemine göre dağılım
  const stageCounts = { early: 0, mid: 0, late: 0, far_off: 0, close_up: 0 };
  for (const p of profiles) {
    if (p.lactationStage in stageCounts) stageCounts[p.lactationStage]++;
  }
  const stageItems = Object.entries(stageCounts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<li>${stageLabel(k)}: <b>${n}</b></li>`)
    .join('');

  return `
    <div class="dash-card">
      <div class="dash-card-title"><i class="ti ti-users"></i> ${t('dashboard.herd_status')}</div>
      <div class="dash-stats-row">
        <div class="dash-stat">
          <div class="dash-stat-val">${profiles.length}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_profile')}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">${groups.length}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_herd_group')}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">${totalAnimals}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_total_animals')}</div>
        </div>
      </div>
      ${stageItems
        ? `<ul class="dash-stage-list">${stageItems}</ul>`
        : ''}
      <div class="dash-card-footer">
        <span class="text-small text-muted">${t('dashboard.herd_ready', { n: profiles.length })}</span>
        <button class="btn btn-sm btn-secondary" data-nav="herd">${t('dashboard.herd_optimize')}</button>
      </div>
    </div>`;
}

function renderIOFCCard(iofc, totalAnimals) {
  if (!iofc) {
    return `
      <div class="dash-card">
        <div class="dash-card-title"><i class="ti ti-coins"></i> ${t('dashboard.estimated_iofc')}</div>
        <div class="empty-state" style="padding:1rem">
          <p class="text-muted">
            ${totalAnimals === 0
              ? t('dashboard.iofc_no_herd')
              : t('dashboard.iofc_no_ration')}
          </p>
          <button class="btn btn-sm btn-primary mt-1" data-nav="${totalAnimals === 0 ? 'animal' : 'ration'}">
            ${totalAnimals === 0 ? t('dashboard.go_profile') : t('dashboard.build_ration')}
          </button>
        </div>
      </div>`;
  }

  const statusColor = iofc.status.level === 'loss' ? 'var(--danger)'
                    : iofc.status.level === 'low' ? 'var(--warning)'
                    : 'var(--primary)';

  return `
    <div class="dash-card">
      <div class="dash-card-title"><i class="ti ti-coins"></i> ${t('dashboard.estimated_iofc')}</div>
      <div class="dash-stats-row">
        <div class="dash-stat">
          <div class="dash-stat-val" style="color:${statusColor}">${fmt(iofc.perCow, 0)}</div>
          <div class="dash-stat-lbl">${t('dashboard.stat_cow_day')}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val" style="color:${statusColor}">
            ${iofc.herd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div class="dash-stat-lbl">${t('dashboard.stat_herd_day')}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">
            ${iofc.monthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div class="dash-stat-lbl">${t('dashboard.stat_monthly')}</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-val">
            ${iofc.annual.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div class="dash-stat-lbl">${t('dashboard.stat_annual')}</div>
        </div>
      </div>
      <div class="dash-card-iofc">
        ${t('dashboard.status_label')}: <b style="color:${statusColor}">${escHtml(iofc.status.label)}</b>
        &middot; ${t('dashboard.based_on', { n: totalAnimals })}
      </div>
      <div class="text-small text-muted mt-1">
        ${t('dashboard.iofc_note')}
      </div>
    </div>`;
}

function renderRemindersCard(reminders) {
  if (reminders.length === 0) {
    return `
      <div class="dash-card">
        <div class="dash-card-title"><i class="ti ti-circle-check"></i> ${t('dashboard.reminders')}</div>
        <div class="empty-state" style="padding:1rem">
          <p class="text-muted">${t('dashboard.no_reminders')}</p>
        </div>
      </div>`;
  }

  return `
    <div class="dash-card">
      <div class="dash-card-title">
        <i class="ti ti-alert-triangle"></i> ${t('dashboard.reminders')}
        <span class="text-small text-muted" style="font-weight:400;margin-left:auto">${reminders.length}</span>
      </div>
      <ul class="dash-reminders">
        ${reminders.map(r => `
          <li class="dash-reminder dash-reminder-${r.level}">
            <span class="dash-reminder-icon"><i class="ti ${r.icon}"></i></span>
            <div class="dash-reminder-body">
              <div class="dash-reminder-title">${escHtml(r.title)}</div>
              <div class="dash-reminder-text">${escHtml(r.text)}</div>
            </div>
            ${r.nav
              ? `<button class="btn btn-sm btn-secondary" data-nav="${r.nav}" aria-label="Git"><i class="ti ti-arrow-right"></i></button>`
              : ''}
          </li>
        `).join('')}
      </ul>
    </div>`;
}

// ─── Hatırlatıcı Üreteç ───────────────────────────────────────────────────────

function buildReminders({ lastResult, observations, profiles, animal = {} }) {
  const reminders = [];

  // Rasyon durumu uyarıları
  if (lastResult) {
    if (!lastResult.feasible && lastResult.relaxation?.applied) {
      reminders.push({
        level: 'warn',
        icon: 'ti-alert-triangle',
        title: t('dashboard.rem_relaxed_t'),
        text: t('dashboard.rem_relaxed_x', { n: lastResult.relaxation.violations?.length || 0 }),
        nav: 'results',
      });
    } else if (!lastResult.feasible) {
      reminders.push({
        level: 'danger',
        icon: 'ti-alert-circle',
        title: t('dashboard.rem_infeasible_t'),
        text: t('dashboard.rem_infeasible_x'),
        nav: 'ration',
      });
    }

    // DCAD anormal — dönem (cowPeriod) animal.lactationStage'ten türetilir
    // (resultsPanel.renderDCADPanel ile aynı eşleme); eşik tek kaynak interpretDCAD.
    const dcad = lastResult.composition?.dcad_meq;
    if (Number.isFinite(dcad)) {
      const cowPeriod = animal.lactationStage === 'close_up' ? 'transition'
                      : animal.lactationStage === 'far_off'  ? 'dry_faroff'
                      : 'lactation';
      const di = interpretDCAD(dcad, cowPeriod);
      if (di.status !== 'optimal' && (di.severity === 'high' || di.severity === 'medium')) {
        const dir = di.status === 'below_target' ? t('dashboard.dcad_low') : t('dashboard.dcad_high');
        const fix = cowPeriod === 'transition' ? t('dashboard.fix_anionic') : t('dashboard.fix_buffer');
        reminders.push({
          level: di.severity === 'high' ? 'danger' : 'warn',
          icon: 'ti-bolt',
          title: t('dashboard.rem_dcad_t', { dir, label: di.target.label }),
          text: t('dashboard.rem_dcad_x', { v: dcad.toFixed(1), min: di.target.min, max: di.target.max, fix }),
          nav: 'results',
        });
      }
    }

    // Süt humması riski yüksek
    const fever = lastResult.milkFever;
    if (fever && (fever.riskLevel === 'high' || fever.riskLevel === 'very_high')) {
      reminders.push({
        level: 'danger',
        icon: 'ti-stethoscope',
        title: t('dashboard.rem_fever_t'),
        text: t('dashboard.rem_fever_x', { level: fever.riskLevel === 'very_high' ? t('dashboard.fever_vhigh') : t('dashboard.fever_high') }),
        nav: 'results',
      });
    }
  }

  // Gözlem trendi uyarıları (en son profilin son 4 gözlemi)
  if (observations.length >= 2 && profiles.length > 0) {
    // En son gözlem alınan profil ID
    const lastObsProfile = observations[0]?.profileId;
    const profileObs = observations
      .filter(o => o.profileId === lastObsProfile)
      .slice(0, 8);   // son 8 ölçüm
    const profile = profiles.find(p => p.id === lastObsProfile);

    if (profile && profileObs.length >= 2) {
      const series = [...profileObs].reverse();
      const bcs = calcLinearTrend(series.map(o => o.bcs).filter(Number.isFinite));
      const my  = calcLinearTrend(series.map(o => o.milkYield).filter(Number.isFinite));

      const pname = profile.name || profile.id;
      if (bcs && bcs.slope < -0.05) {
        reminders.push({
          level: 'warn',
          icon: 'ti-trending-down',
          title: t('dashboard.rem_bcs_down_t', { name: pname }),
          text: t('dashboard.rem_bcs_down_x', { slope: bcs.slope.toFixed(3) }),
          nav: 'observations',
        });
      } else if (bcs && bcs.slope > 0.05) {
        reminders.push({
          level: 'warn',
          icon: 'ti-trending-up',
          title: t('dashboard.rem_bcs_up_t', { name: pname }),
          text: t('dashboard.rem_bcs_up_x', { slope: bcs.slope.toFixed(3) }),
          nav: 'observations',
        });
      }

      if (my && my.slope < -0.5) {
        reminders.push({
          level: 'warn',
          icon: 'ti-trending-down',
          title: t('dashboard.rem_my_down_t', { name: pname }),
          text: t('dashboard.rem_my_down_x', { slope: my.slope.toFixed(2) }),
          nav: 'observations',
        });
      }
    }
  }

  // Gözlem güncelleme hatırlatıcısı (uzun süre kayıt yoksa)
  if (profiles.length > 0 && observations.length > 0) {
    const latestObsDate = new Date(observations[0].date);
    const daysSince = (Date.now() - latestObsDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) {
      reminders.push({
        level: 'info',
        icon: 'ti-calendar',
        title: t('dashboard.rem_obs_late_t'),
        text: t('dashboard.rem_obs_late_x', { d: Math.floor(daysSince) }),
        nav: 'observations',
      });
    }
  }

  // Profil var ama gözlem yok
  if (profiles.length > 0 && observations.length === 0) {
    reminders.push({
      level: 'info',
      icon: 'ti-bulb',
      title: t('dashboard.rem_no_obs_t'),
      text: t('dashboard.rem_no_obs_x'),
      nav: 'observations',
    });
  }

  return reminders;
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

function filterLastDays(observations, days) {
  if (!Array.isArray(observations) || observations.length === 0) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return observations
    .filter(o => o.date && new Date(o.date).getTime() >= cutoff)
    .sort((a, b) => new Date(a.date) - new Date(b.date));   // kronolojik
}

function drawTrendChart(canvas, observations) {
  if (!canvas) return;
  if (trendChartInstance) {
    trendChartInstance.destroy();
    trendChartInstance = null;
  }

  const labels = observations.map(o =>
    new Date(o.date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
  );
  const myData  = observations.map(o => o.milkYield ?? null);
  const bcsData = observations.map(o => o.bcs ?? null);

  trendChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: t('dashboard.chart_milk'),
          data: myData,
          borderColor: 'rgba(29,78,216,1)',
          backgroundColor: 'rgba(29,78,216,0.14)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          fill: true,
          yAxisID: 'y',
          spanGaps: true,
        },
        {
          label: 'BCS',
          data: bcsData,
          borderColor: 'rgba(217,119,6,1)',
          backgroundColor: 'rgba(217,119,6,0.1)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          fill: false,
          yAxisID: 'y1',
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14 } },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
        y: {
          beginAtZero: false,
          position: 'left',
          title: { display: true, text: t('dashboard.chart_milk_axis'), font: { size: 10 } },
          ticks: { font: { size: 10 } },
        },
        y1: {
          beginAtZero: false,
          position: 'right',
          min: 2.0,
          max: 5.0,
          title: { display: true, text: 'BCS', font: { size: 10 } },
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 } },
        },
      },
    },
  });
}
