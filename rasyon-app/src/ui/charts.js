/**
 * Chart.js grafikleri — Besin dengesi, mineral, pasta grafiği
 */

import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

const chartInstances = {};

/**
 * FAZ 15.10: Chart.js global varsayılan renklerini temaya göre ayarlar.
 * Tüm grafikler (besin/mineral/pasta/rumen/dashboard/gözlem) bu global'ı
 * paylaştığından, tema değişiminden sonra yeniden çizilen her grafik adapte olur.
 * @param {'light'|'dark'} theme
 */
export function setChartTheme(theme) {
  const dark = theme === 'dark';
  Chart.defaults.color = dark ? '#cdd8d0' : '#5a7060';            // eksen/etiket metni
  Chart.defaults.borderColor = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'; // ızgara çizgileri
}

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

export function renderNutrientCharts(result) {
  renderNutrientBar(result);
  renderMineralBar(result);
  renderPieChart(result);
  if (result.rumenDynamics) renderRumenPHChart(result.rumenDynamics);
}

// ─── Rumen pH 24h Profile ─────────────────────────────────────────────────────

export function renderRumenPHChart(rumenSim) {
  const canvas = document.getElementById('chart-rumen-ph');
  if (!canvas) return;
  destroyChart('rumen-ph');

  const labels = rumenSim.hours.map(h => `${String(h).padStart(2,'0')}:00`);

  // Tehlike bantları (background fill)
  const dangerLine = rumenSim.hours.map(() => 5.5);  // akut asidoz eşiği
  const saraLine   = rumenSim.hours.map(() => 5.8);  // SARA eşiği
  const safeLine   = rumenSim.hours.map(() => 6.2);  // güvenli eşik

  chartInstances['rumen-ph'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Rumen pH',
          data: rumenSim.ph,
          borderColor: 'rgba(29,78,216,1)',
          backgroundColor: 'rgba(29,78,216,0.15)',
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: rumenSim.ph.map(p =>
            p < 5.5 ? '#7f1d1d' : p < 5.8 ? '#dc2626' : p < 6.2 ? '#d97706' : '#0f9d6b'
          ),
        },
        {
          label: 'Güvenli eşik (6.2)',
          data: safeLine,
          borderColor: 'rgba(29,78,216,0.5)',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'SARA eşiği (5.8)',
          data: saraLine,
          borderColor: 'rgba(240,165,0,0.7)',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Akut asidoz (5.5)',
          data: dangerLine,
          borderColor: 'rgba(217,83,79,0.8)',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 14, padding: 8 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: pH ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Saat', font: { size: 11 } },
          ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
        },
        y: {
          min: 5.0,
          max: 7.0,
          title: { display: true, text: 'Rumen pH', font: { size: 11 } },
          ticks: { font: { size: 11 }, stepSize: 0.2 },
        },
      },
    },
  });
}

// ─── Besin Dengesi (NEL / HP / NDF / NFC / peNDF) ────────────────────────────

function renderNutrientBar(result) {
  const canvas = document.getElementById('chart-nutrients');
  if (!canvas) return;
  destroyChart('nutrients');

  const { composition, requirements } = result;
  const req = requirements.compositionTargets;

  const labels = ['NEL (Mcal)', 'HP (%KM)', 'NDF (%KM)', 'NFC (%KM)', 'peNDF (%KM)', 'Kaba yem (%)'];
  const achieved = [
    composition.nel_mcal,
    composition.cp_pct,
    composition.ndf_pct,
    composition.nfc_pct,
    composition.peNDF_pct,
    composition.forage_pct,
  ];
  const minimum = [
    requirements.nel.total,
    req.cp_pct?.min ?? null,
    req.ndf_pct?.min ?? null,
    null,
    req.peNDF_pct?.min ?? null,
    req.forage_pct?.min ?? null,
  ];
  const maximum = [
    null,
    req.cp_pct?.max ?? null,
    req.ndf_pct?.max ?? null,
    req.nfc_pct?.max ?? null,
    null,
    req.forage_pct?.max ?? null,
  ];

  const barColors = achieved.map((v, i) => {
    const mn = minimum[i];
    const mx = maximum[i];
    if (mn !== null && v < mn) return 'rgba(240,165,0,0.75)';
    if (mx !== null && v > mx) return 'rgba(217,83,79,0.75)';
    return 'rgba(29,78,216,0.75)';
  });

  chartInstances['nutrients'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Rasyon Değeri',
          data: achieved,
          backgroundColor: barColors,
          borderColor: barColors.map(c => c.replace('0.75', '1')),
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          label: 'Minimum',
          data: minimum,
          type: 'scatter',
          pointStyle: 'line',
          pointRadius: 10,
          pointBorderWidth: 2,
          pointBorderColor: 'rgba(58,134,208,0.9)',
          backgroundColor: 'transparent',
          showLine: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ─── Mineral Dengesi ──────────────────────────────────────────────────────────

function renderMineralBar(result) {
  const canvas = document.getElementById('chart-minerals');
  if (!canvas) return;
  destroyChart('minerals');

  const { composition, requirements } = result;
  const mins = requirements.minerals;

  const labels = ['Ca', 'P', 'Mg', 'K', 'Na'];
  const achieved = [
    composition.ca_g,
    composition.p_g,
    composition.mg_g,
    composition.k_g,
    composition.na_g,
  ];
  const required = [
    mins.ca.dietary,
    mins.p.total,
    mins.mg.total,
    mins.k.total,
    mins.na.total,
  ];

  chartInstances['minerals'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Rasyon (g/gün)',
          data: achieved,
          backgroundColor: 'rgba(29,78,216,0.7)',
          borderColor: 'rgba(29,78,216,1)',
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          label: 'Gereksinim (g/gün)',
          data: required,
          backgroundColor: 'rgba(58,134,208,0.6)',
          borderColor: 'rgba(58,134,208,1)',
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, title: { display: true, text: 'g/gün', font: { size: 11 } } },
      },
    },
  });
}

// ─── Rasyon Pasta Grafiği ─────────────────────────────────────────────────────

function renderPieChart(result) {
  const canvas = document.getElementById('chart-pie');
  if (!canvas) return;
  destroyChart('pie');

  const { items } = result;
  if (!items || items.length === 0) return;

  const COLORS = [
    '#1d4ed8','#0d9488','#d97706','#dc2626','#7c3aed',
    '#17a2b8','#e67e22','#27ae60','#e91e63','#795548',
    '#607d8b','#ff5722','#009688','#673ab7','#cddc39',
  ];

  chartInstances['pie'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map(i => i.name),
      datasets: [{
        data: items.map(i => i.pctDm),
        backgroundColor: items.map((_, idx) => COLORS[idx % COLORS.length]),
        borderWidth: 1,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { size: 11 }, boxWidth: 14, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%`,
          },
        },
      },
    },
  });
}
