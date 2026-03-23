import { initNavbar } from './navbar.js';
import { toast } from './utils/toast.js';
import { tooltips } from './utils/tooltip.js';
initNavbar();

let cagrChart = null;
let priceChart = null;

function modeDisplay(mode) {
  if (mode === 'auto') return 'Auto';
  if (mode === 'direct') return 'Direct';
  return 'Annual';
}

function sourceDisplay(source) {
  if (source === 'auto_annual_report') return 'Annual report (yfinance)';
  if (source === 'direct_cagr_input') return 'Input CAGR langsung';
  if (source === 'manual_annual_input') return 'Input annual manual';
  return source || '-';
}

function updateCagrInfoPanel(meta = {}) {
  const modeEl = document.getElementById('cagr-info-mode');
  const periodEl = document.getElementById('cagr-info-period');
  const sourceEl = document.getElementById('cagr-info-source');
  if (!modeEl || !periodEl || !sourceEl) return;

  const mode = meta.inputMode || 'annual';
  const startYear = meta.periodStartYear;
  const endYear = meta.periodEndYear;
  const years = meta.cagrYears;

  let periodText = meta.periodLabel || '-';
  if (!periodText || periodText === '-') {
    if (Number.isFinite(Number(startYear)) && Number.isFinite(Number(endYear))) {
      periodText = `${startYear}-${endYear}`;
    } else if (mode === 'direct' && Number.isFinite(Number(years)) && Number(years) > 0) {
      periodText = `${Number(years)} tahun (direct CAGR input)`;
    } else if (mode === 'annual' && Number.isFinite(Number(years)) && Number(years) > 0) {
      periodText = `Manual input (${Number(years)} titik)`;
    }
  }

  modeEl.textContent = modeDisplay(mode);
  periodEl.textContent = periodText || '-';
  sourceEl.textContent = sourceDisplay(meta.periodSource);
}

function getQueryTicker() {
  const params = new URLSearchParams(window.location.search);
  let t = params.get('ticker');
  if (!t) t = sessionStorage.getItem('currentTicker');
  return t ? t.trim() : '';
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(2)}%`;
}

function formatSignedPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const num = Number(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const num = Number(value);
  if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function isLikelyInvalidTicker(stock, ticker) {
  if (!stock || typeof stock !== 'object') return true;

  const t = String(ticker || '').trim().toUpperCase();
  const name = String(stock['Name'] || '').trim().toUpperCase();
  const price = Number(stock['Price']);
  const marketCap = Number(stock['Market Cap']);
  const high52 = Number(stock['HIGH 52']);
  const low52 = Number(stock['LOW 52']);

  const noMarketData =
    (!Number.isFinite(price) || price <= 0) &&
    (!Number.isFinite(marketCap) || marketCap <= 0) &&
    (!Number.isFinite(high52) || high52 <= 0) &&
    (!Number.isFinite(low52) || low52 <= 0);

  const unresolvedName = !name || name === t || name === '-';
  return noMarketData && unresolvedName;
}

function renderCagrTable(ticker, cagrData) {
  const tableBody = document.getElementById('cagr-table-body');
  const container = document.getElementById('cagr-result');
  if (!tableBody || !container) return;

  const rows = [
    { label: 'Net Income', key: 'net_income' },
    { label: 'Revenue', key: 'revenue' },
    { label: 'EPS', key: 'eps' },
  ];

  rows.forEach((row) => {
    const val = cagrData?.[row.key] ?? null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-0.5 pr-2 text-slate-300">${row.label}</td>
      <td class="py-0.5 text-right font-medium">${formatPercent(val)}</td>
    `;
    tableBody.appendChild(tr);
  });

  container.classList.remove('hidden');
}

function renderFundamentals(ticker, stock) {
  const summary = document.getElementById('fundamental-summary');
  if (!summary || !stock) return;

  const nameEl = document.getElementById('fund-name');
  const tickerEl = document.getElementById('fund-ticker');
  const priceEl = document.getElementById('fund-price');
  const roeEl = document.getElementById('fund-roe');
  const mosEl = document.getElementById('fund-mos');
  const pbvEl = document.getElementById('fund-pbv');
  const divEl = document.getElementById('fund-dividend');
  const dfhEl = document.getElementById('fund-downfromhigh');
  const dfmEl = document.getElementById('fund-downfrommonth');
  const dfwEl = document.getElementById('fund-downfromweek');
  const dftEl = document.getElementById('fund-downfromtoday');
  const revEl = document.getElementById('fund-revenue');
  const epsEl = document.getElementById('fund-eps');
  const perEl = document.getElementById('fund-per');
  const highEl = document.getElementById('fund-high52');
  const lowEl = document.getElementById('fund-low52');
  const riseEl = document.getElementById('fund-risefromlow');
  const sharesEl = document.getElementById('fund-shares');
  const mcEl = document.getElementById('fund-marketcap');
  const bvpEl = document.getElementById('fund-bvp');
  const grahamEl = document.getElementById('fund-graham');
  const divGrowthEl = document.getElementById('fund-div-growth');
  const payoutEl = document.getElementById('fund-payout');
  const payoutPenaltyEl = document.getElementById('fund-payout-penalty');
  const execEl = document.getElementById('fund-exec');
  const safetyEl = document.getElementById('fund-safety');
  const discountScoreEl = document.getElementById('fund-discount-score');
  const timingVerdictEl = document.getElementById('fund-timing-verdict');
  const qualityScoreEl = document.getElementById('fund-quality-score');
  const qualityLabelEl = document.getElementById('fund-quality-label');
  const qualityVerdictEl = document.getElementById('fund-quality-verdict');

  const name = stock['Name'] ?? ticker;
  const price = formatNumber(stock['Price']);
  const roe = formatPercent(stock['ROE (%)']);
  const mos = formatPercent(stock['MOS (%)']);
  const pbv = formatNumber(stock['PBV']);
  const divYield = formatPercent(stock['Dividend Yield (%)']);
  const downFromHigh = formatPercent(stock['Down From High 52 (%)']);
  const downFromMonth = formatPercent(stock['Down From This Month (%)']);
  const downFromWeek = formatPercent(stock['Down From This Week (%)']);
  const downFromToday = formatPercent(stock['Down From Today (%)']);
  const revenue = formatNumber(stock['Revenue Annual (Prev)']);
  const epsNow = formatNumber(stock['EPS NOW']);
  const perNow = formatNumber(stock['PER NOW']);
  const high52 = formatNumber(stock['HIGH 52']);
  const low52 = formatNumber(stock['LOW 52']);
  const riseFromLow = formatPercent(stock['Rise From Low 52 (%)']);
  const shares = formatNumber(stock['Shares']);
  const marketCap = formatNumber(stock['Market Cap']);
  const bvpPerS = formatNumber(stock['BVP Per S']);
  const graham = formatNumber(stock['Graham Number']);
  const divGrowth = formatPercent(stock['Dividend Growth (%)']);
  const payoutRatio = formatPercent(stock['Payout Ratio (%)']);
  const payoutPenalty =
    stock['Payout Penalty'] == null || Number.isNaN(Number(stock['Payout Penalty']))
      ? '-'
      : Number(stock['Payout Penalty']).toFixed(2);
  const executionDecision = stock['Execution Decision'] ?? '-';
  const safetyCheck = stock['Safety Check'] ?? '-';
  const discountScore =
    stock['Discount Score'] == null || Number.isNaN(Number(stock['Discount Score']))
      ? '-'
      : Number(stock['Discount Score']).toFixed(3);
  const timingVerdict = stock['Discount Timing Verdict'] ?? '-';
  const qualityScore =
    typeof stock['Quality Score'] === 'number' ? stock['Quality Score'].toFixed(3) : '-';
  const qualityLabel = stock['Quality Label'] ?? '-';
  const qualityVerdict = stock['Quality Verdict'] ?? '-';

  if (nameEl) nameEl.textContent = name;
  if (tickerEl) tickerEl.textContent = ticker;
  if (priceEl) priceEl.textContent = price;
  if (roeEl) roeEl.textContent = roe;
  if (mosEl) mosEl.textContent = mos;
  if (pbvEl) pbvEl.textContent = pbv;
  if (divEl) divEl.textContent = divYield;
  if (dfhEl) dfhEl.textContent = downFromHigh;
  if (dfmEl) dfmEl.textContent = downFromMonth;
  if (dfwEl) dfwEl.textContent = downFromWeek;
  if (dftEl) dftEl.textContent = downFromToday;
  if (revEl) revEl.textContent = revenue;
  if (epsEl) epsEl.textContent = epsNow;
  if (perEl) perEl.textContent = perNow;
  if (highEl) highEl.textContent = high52;
  if (lowEl) lowEl.textContent = low52;
  if (riseEl) riseEl.textContent = riseFromLow;
  if (sharesEl) sharesEl.textContent = shares;
  if (mcEl) mcEl.textContent = marketCap;
  if (bvpEl) bvpEl.textContent = bvpPerS;
  if (grahamEl) grahamEl.textContent = graham;
  if (divGrowthEl) divGrowthEl.textContent = divGrowth;
  if (payoutEl) payoutEl.textContent = payoutRatio;
  if (payoutPenaltyEl) payoutPenaltyEl.textContent = payoutPenalty;
  if (execEl) execEl.textContent = executionDecision;
  if (safetyEl) safetyEl.textContent = safetyCheck;
  if (discountScoreEl) discountScoreEl.textContent = discountScore;
  if (timingVerdictEl) timingVerdictEl.textContent = timingVerdict;
  if (qualityScoreEl) qualityScoreEl.textContent = qualityScore;
  if (qualityLabelEl) qualityLabelEl.textContent = qualityLabel;
  if (qualityVerdictEl) qualityVerdictEl.textContent = qualityVerdict;

  summary.classList.remove('hidden');
}

function renderMcdmResult(ticker, methods) {
  const root = document.getElementById('mcdm-result');
  if (!root) return;

  const entries = [
    {
      name: 'SAW • Growth Score',
      key: 'SAW',
      color: 'text-amber-300',
      signalLabel: 'Growth Check',
      meaning: 'Apakah bisnis tumbuh kencang?',
      useFinalDecision: false,
    },
    {
      name: 'AHP • Growth Score (weighted)',
      key: 'AHP',
      color: 'text-fuchsia-300',
      signalLabel: 'Growth Check (Weighted)',
      meaning: 'Sama, dengan bobot AHP.',
      useFinalDecision: false,
    },
    {
      name: 'TOPSIS • Relative Quality Score',
      key: 'TOPSIS',
      color: 'text-sky-300',
      signalLabel: 'Relative Quality',
      meaning: 'Seberapa baik vs peer universe.',
      useFinalDecision: false,
    },
    {
      name: 'VIKOR • Regret Score',
      key: 'VIKOR',
      color: 'text-emerald-300',
      signalLabel: 'Regret Check',
      meaning: 'Seberapa besar risiko menyesal beli?',
      useFinalDecision: false,
    },
    {
      name: 'Hybrid • Final Decision',
      key: 'FUZZY_AHP_TOPSIS',
      color: 'text-cyan-300',
      signalLabel: 'Final Decision',
      meaning: 'Sesuai profil: Dividend > Growth > Value.',
      useFinalDecision: true,
    },
  ];

  entries.forEach((m) => {
    const info = methods?.[m.key]?.[ticker];
    if (!info) return;
    const decision = info.decision || 'NO BUY';
    const score = typeof info.score === 'number' ? info.score : null;
    const category = info.category || '-';
    const signalValue = m.useFinalDecision ? decision : decision === 'BUY' ? 'Pass' : 'Watch';
    const signalColor =
      signalValue === 'BUY' || signalValue === 'Pass'
        ? 'text-emerald-300'
        : signalValue === 'Watch'
          ? 'text-amber-300'
          : 'text-slate-400';

    const card = document.createElement('div');
    card.className = 'rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px]';
    card.innerHTML = `
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-slate-300 font-medium">${m.name}</span>
        <span class="text-[10px] rounded-full bg-slate-800 px-2 py-0.5 ${signalColor}">${signalValue}</span>
      </div>
      <div class="mt-1 flex justify-between text-slate-400">
        <span>${m.signalLabel}</span>
        <span class="${m.color}">${score != null ? score.toFixed(3) : '-'}</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[10px] text-slate-500 uppercase flex items-center gap-1">
          PBV Score
          <span data-tooltip="PBV" class="text-[8px] opacity-40 cursor-help">ⓘ</span>
        </span>
        <span class="text-xs font-bold text-slate-200">${Number(info['PBV Score'] || 0).toFixed(2)}</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[10px] text-slate-500 uppercase flex items-center gap-1">
          MOS
          <span data-tooltip="MOS" class="text-[8px] opacity-40 cursor-help">ⓘ</span>
        </span>
        <span class="text-xs font-bold text-emerald-400">${formatPercent(info['MOS (%)'])}</span>
      </div>
      ${
        m.useFinalDecision
          ? `<div class="mt-1 flex justify-between text-[10px] text-slate-400"><span>Tier</span><span class="text-emerald-300">${category}</span></div>`
          : ''
      }
      <div class="mt-1 text-[10px] text-slate-500">${m.meaning}</div>
    `;
    root.appendChild(card);
  });
}

function perfTextClass(value) {
  if (value == null || Number.isNaN(Number(value))) return 'text-slate-500';
  return Number(value) >= 0 ? 'text-emerald-300' : 'text-rose-300';
}

function renderPerformanceOverview(data, ticker) {
  const root = document.getElementById('performance-overview');
  const titleEl = document.getElementById('performance-title');
  const subtitleEl = document.getElementById('performance-subtitle');
  const cardsEl = document.getElementById('performance-cards');
  if (!root || !titleEl || !subtitleEl || !cardsEl) return;

  const returns = data?.returns;
  if (!returns || typeof returns !== 'object') {
    root.classList.add('hidden');
    return;
  }

  const asOfRaw = data?.as_of;
  let asOfText = '-';
  if (asOfRaw) {
    const dt = new Date(asOfRaw);
    if (!Number.isNaN(dt.getTime())) {
      asOfText = dt.toLocaleDateString('en-US');
    }
  }

  const bmName = data?.benchmark_name || data?.benchmark || 'Benchmark';
  const symbol = data?.ticker || ticker;

  titleEl.textContent = `Performance Overview: ${symbol}`;
  subtitleEl.textContent = `Trailing total returns as of ${asOfText}. Benchmark is ${bmName}.`;

  const windows = [
    { key: 'ytd', fallbackLabel: 'YTD Return' },
    { key: 'one_year', fallbackLabel: '1-Year Return' },
    { key: 'three_year', fallbackLabel: '3-Year Return' },
    { key: 'five_year', fallbackLabel: '5-Year Return' },
  ];

  cardsEl.innerHTML = '';
  windows.forEach((w) => {
    const row = returns[w.key] || {};
    const label = row.label || w.fallbackLabel;
    const assetValue = row.asset;
    const benchmarkValue = row.benchmark;

    const card = document.createElement('div');
    card.className = 'rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs';
    card.innerHTML = `
      <div class="mb-2 text-base font-semibold text-slate-100">${label}</div>
      <div class="flex items-center justify-between gap-2 text-[11px]">
        <span class="text-slate-400">${symbol}</span>
        <span class="font-semibold ${perfTextClass(assetValue)}">${formatSignedPercent(assetValue)}</span>
      </div>
      <div class="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span class="text-slate-500">${bmName}</span>
        <span class="font-semibold ${perfTextClass(benchmarkValue)}">${formatSignedPercent(
      benchmarkValue,
    )}</span>
      </div>
    `;
    cardsEl.appendChild(card);
  });

  root.classList.remove('hidden');
}

function loadPerformanceOverview(ticker) {
  const t = (ticker || '').trim();
  if (!t) return;

  fetch(`http://127.0.0.1:8000/performance-overview?ticker=${encodeURIComponent(t)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (!json) return;
      renderPerformanceOverview(json, t);
    })
    .catch(() => {
      // abaikan error overview performa agar halaman tetap lanjut
    });
}

function createYearInputs(index) {
  const yearLabel = `Tahun ${index + 1}`;

  const ni = document.createElement('input');
  ni.type = 'number';
  ni.step = 'any';
  ni.placeholder = yearLabel;
  ni.className = 'cagr-input ni-input';

  const eps = document.createElement('input');
  eps.type = 'number';
  eps.step = 'any';
  eps.placeholder = yearLabel;
  eps.className = 'cagr-input eps-input';

  const rev = document.createElement('input');
  rev.type = 'number';
  rev.step = 'any';
  rev.placeholder = yearLabel;
  rev.className = 'cagr-input rev-input';

  return { ni, eps, rev };
}

function addYearRow() {
  const niContainer = document.getElementById('ni-container');
  const epsContainer = document.getElementById('eps-container');
  const revContainer = document.getElementById('rev-container');
  if (!niContainer || !epsContainer || !revContainer) return;

  const currentCount = niContainer.querySelectorAll('.ni-input').length;
  const { ni, eps, rev } = createYearInputs(currentCount);

  niContainer.appendChild(ni);
  epsContainer.appendChild(eps);
  revContainer.appendChild(rev);
}

function removeYearRow() {
  const niContainer = document.getElementById('ni-container');
  const epsContainer = document.getElementById('eps-container');
  const revContainer = document.getElementById('rev-container');
  if (!niContainer || !epsContainer || !revContainer) return;

  const niInputs = niContainer.querySelectorAll('.ni-input');
  const epsInputs = epsContainer.querySelectorAll('.eps-input');
  const revInputs = revContainer.querySelectorAll('.rev-input');

  const current = Math.min(niInputs.length, epsInputs.length, revInputs.length);
  if (current <= 2) return; // minimal 2 tahun

  niInputs[niInputs.length - 1]?.remove();
  epsInputs[epsInputs.length - 1]?.remove();
  revInputs[revInputs.length - 1]?.remove();
}

function renderCagrChart(ni, eps, rev) {
  const canvas = document.getElementById('cagr-chart');
  if (!canvas || typeof window.Chart === 'undefined') return;

  const maxLen = Math.max(ni.length, eps.length, rev.length);
  if (maxLen < 2) return;

  const labels = Array.from({ length: maxLen }, (_, i) => `Tahun ${i + 1}`);

  const pad = (arr) => {
    const out = [];
    for (let i = 0; i < maxLen; i += 1) {
      out.push(i < arr.length ? arr[i] : null);
    }
    return out;
  };

  const data = {
    labels,
    datasets: [
      {
        label: 'Net Income',
        data: pad(ni),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.2)',
        tension: 0.25,
      },
      {
        label: 'EPS',
        data: pad(eps),
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.2)',
        tension: 0.25,
      },
      {
        label: 'Revenue',
        data: pad(rev),
        borderColor: '#eab308',
        backgroundColor: 'rgba(234,179,8,0.2)',
        tension: 0.25,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#e5e7eb',
          font: { size: 10 },
        },
      },
      tooltip: {
        callbacks: {
          label(context) {
            const v = context.parsed.y;
            if (v == null || Number.isNaN(v)) return `${context.dataset.label}: -`;
            return `${context.dataset.label}: ${v}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#9ca3af', font: { size: 9 } },
        grid: { color: 'rgba(55,65,81,0.5)' },
      },
      y: {
        ticks: { color: '#9ca3af', font: { size: 9 } },
        grid: { color: 'rgba(55,65,81,0.4)' },
      },
    },
  };

  if (cagrChart) {
    cagrChart.destroy();
  }

  cagrChart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data,
    options,
  });
}

function renderPriceChart(labels, prices) {
  const canvas = document.getElementById('price-chart');
  if (!canvas || typeof window.Chart === 'undefined') return;

  if (!Array.isArray(labels) || !Array.isArray(prices) || labels.length < 2) return;

  const paddedPrices = prices.map((v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v)));

  const data = {
    labels,
    datasets: [
      {
        label: 'Harga Penutupan',
        data: paddedPrices,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.25)',
        tension: 0.25,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#e5e7eb',
          font: { size: 10 },
        },
      },
      tooltip: {
        callbacks: {
          label(context) {
            const v = context.parsed.y;
            if (v == null || Number.isNaN(v)) return `${context.dataset.label}: -`;
            return `${context.dataset.label}: ${formatNumber(v)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#9ca3af', font: { size: 9 } },
        grid: { color: 'rgba(55,65,81,0.5)' },
      },
      y: {
        ticks: {
          color: '#9ca3af',
          font: { size: 9 },
          callback: (value) => formatNumber(value),
        },
        grid: { color: 'rgba(55,65,81,0.4)' },
      },
    },
  };

  if (priceChart) {
    priceChart.destroy();
  }

  priceChart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data,
    options,
  });
}

function loadPriceHistory(ticker, interval) {
  const t = (ticker || '').trim();
  if (!t) return;

  let period = '1y';
  if (interval === '1d') {
    // Harian: fokus 30 hari terakhir (~1 bulan)
    period = '1mo';
  } else if (interval === '1mo') {
    // Bulanan: fokus 12 bulan terakhir (~1 tahun)
    period = '1y';
  }

  const url = `http://127.0.0.1:8000/price-history?ticker=${encodeURIComponent(
    t,
  )}&interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}`;

  fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (!json) return;
      let dates = Array.isArray(json.dates) ? json.dates : [];
      let close = Array.isArray(json.close) ? json.close : [];

      // Batasi window data agar lebih fokus sesuai interval
      if (interval === '1d' && dates.length > 30) {
        const start = dates.length - 30;
        dates = dates.slice(start);
        close = close.slice(start);
      } else if (interval === '1mo' && dates.length > 12) {
        const start = dates.length - 12;
        dates = dates.slice(start);
        close = close.slice(start);
      }
      if (dates.length >= 2 && close.length >= 2) {
        renderPriceChart(dates, close);
      }
    })
    .catch(() => {
      // abaikan error chart harga jika gagal
    });
}

function toggleInputModeUI(mode) {
  const annualSection = document.getElementById('annual-input-section');
  const annualActions = document.getElementById('annual-actions');
  const addYearBtn = document.getElementById('add-year-btn');
  const removeYearBtn = document.getElementById('remove-year-btn');
  const submitBtn = document.querySelector('#cagr-form button[type="submit"]');
  const directSection = document.getElementById('direct-cagr-section');
  const autoSection = document.getElementById('auto-cagr-section');
  const help = document.getElementById('input-mode-help');
  const annualChartSection = document.getElementById('annual-growth-chart-section');

  const isDirect = mode === 'direct';
  const isAuto = mode === 'auto';
  const isAnnual = mode === 'annual';

  if (annualSection) {
    annualSection.classList.toggle('hidden', !isAnnual);
  }
  if (annualActions) {
    annualActions.classList.remove('hidden');
  }
  if (addYearBtn) {
    addYearBtn.classList.toggle('hidden', !isAnnual);
  }
  if (removeYearBtn) {
    removeYearBtn.classList.toggle('hidden', !isAnnual);
  }
  if (submitBtn) {
    submitBtn.classList.remove('hidden');
  }
  if (directSection) {
    directSection.classList.toggle('hidden', !isDirect);
    directSection.classList.toggle('grid', isDirect);
  }
  if (autoSection) {
    autoSection.classList.toggle('hidden', !isAuto);
  }
  if (isDirect) {
    const yearsEl = document.getElementById('direct-cagr-years');
    if (yearsEl && !yearsEl.value) yearsEl.value = '5';
  }
  if (help) {
    help.textContent = isAuto
      ? 'Mode Otomatis: data annual report diambil otomatis lalu CAGR dihitung otomatis.'
      : isDirect
        ? 'Mode Direct: isi kurun tahun CAGR + CAGR Net Income, EPS, dan Revenue langsung dalam persen.'
        : 'Mode Annual: isi minimal 2 tahun data Net Income, EPS, dan Revenue.';
  }

  if (annualChartSection) {
    annualChartSection.classList.toggle('hidden', isDirect);
    annualChartSection.classList.toggle('opacity-60', isDirect);
  }

  if (isDirect && cagrChart) {
    cagrChart.destroy();
    cagrChart = null;
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const statusEl = document.getElementById('status');
  const tickerInput = document.getElementById('ticker-input');
  const inputModeEl = document.getElementById('input-mode');
  if (!statusEl || !tickerInput || !inputModeEl) return;

  const ticker = (tickerInput.value || '').trim() || getQueryTicker() || '-';
  const inputMode = inputModeEl.value || 'annual';

  const tableBody = document.getElementById('cagr-table-body');
  const mcdmRoot = document.getElementById('mcdm-result');

  try {
    if (inputMode === 'direct') {
      const directYearsEl = document.getElementById('direct-cagr-years');
      const directNetEl = document.getElementById('direct-cagr-net');
      const directRevEl = document.getElementById('direct-cagr-rev');
      const directEpsEl = document.getElementById('direct-cagr-eps');
      if (!directYearsEl || !directNetEl || !directRevEl || !directEpsEl) return;

      const cagrYears = Number(directYearsEl.value);

      const cagrNet = Number(directNetEl.value);
      const cagrRev = Number(directRevEl.value);
      const cagrEps = Number(directEpsEl.value);

      if (
        Number.isNaN(cagrYears) ||
        cagrYears < 1 ||
        Number.isNaN(cagrNet) ||
        Number.isNaN(cagrRev) ||
        Number.isNaN(cagrEps)
      ) {
        statusEl.textContent = 'Mode direct membutuhkan kurun tahun + 3 nilai CAGR yang valid.';
        return;
      }

      statusEl.textContent = `Mengirim CAGR direct untuk ${ticker}...`;

      const body = {
        items: [
          {
            ticker,
            cagr_years: Math.round(cagrYears),
            cagr_net_income: cagrNet,
            cagr_revenue: cagrRev,
            cagr_eps: cagrEps,
          },
        ],
      };

      const res = await fetch('http://127.0.0.1:8000/decision-cagr-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const cagrData = json?.cagr?.[ticker];
      const methods = json?.methods;

      if (!cagrData) {
        statusEl.textContent = 'Gagal menghitung CAGR (data kosong).';
        return;
      }

      if (tableBody) tableBody.innerHTML = '';
      if (mcdmRoot) mcdmRoot.innerHTML = '';

      renderCagrTable(ticker, cagrData);
      renderMcdmResult(ticker, methods);

      updateCagrInfoPanel({
        inputMode: 'direct',
        cagrYears,
        periodLabel: `${Math.round(cagrYears)} tahun (direct CAGR input)`,
        periodSource: 'direct_cagr_input',
      });

      try {
        const key = `cagr-result-${ticker}`;
        const stored = { cagr: cagrData, methods };
        window.localStorage.setItem(key, JSON.stringify(stored));
      } catch (e) {
        // abaikan error storage
      }

      statusEl.textContent = `Berhasil menghitung CAGR (direct) dan keputusan untuk ${ticker}.`;
      return;
    }

    if (inputMode === 'auto') {
      statusEl.textContent = `Menghitung CAGR otomatis dari annual report untuk ${ticker}...`;

      const body = {
        items: [
          {
            ticker,
          },
        ],
      };

      const res = await fetch('http://127.0.0.1:8000/decision-cagr-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const cagrData = json?.cagr?.[ticker];
      const methods = json?.methods;
      const annualRaw = json?.annual?.[ticker];

      if (!cagrData) {
        statusEl.textContent = 'Gagal menghitung CAGR otomatis (data annual report kosong/tidak cukup).';
        return;
      }

      if (tableBody) tableBody.innerHTML = '';
      if (mcdmRoot) mcdmRoot.innerHTML = '';

      renderCagrTable(ticker, cagrData);
      renderMcdmResult(ticker, methods);
      if (annualRaw) {
        const ni = Array.isArray(annualRaw.net_income) ? annualRaw.net_income : [];
        const rev = Array.isArray(annualRaw.revenue) ? annualRaw.revenue : [];
        const eps = Array.isArray(annualRaw.eps) ? annualRaw.eps : [];
        if (ni.length >= 2 && rev.length >= 2 && eps.length >= 2) {
          renderCagrChart(ni, eps, rev);
        }
      }

      updateCagrInfoPanel({
        inputMode: 'auto',
        cagrYears: annualRaw?.cagr_years,
        periodStartYear: annualRaw?.period_start_year,
        periodEndYear: annualRaw?.period_end_year,
        periodLabel: annualRaw?.period_label,
        periodSource: 'auto_annual_report',
      });

      try {
        const key = `cagr-result-${ticker}`;
        const stored = { cagr: cagrData, methods };
        window.localStorage.setItem(key, JSON.stringify(stored));
      } catch (e) {
        // abaikan error storage
      }

      statusEl.textContent = `Berhasil menghitung CAGR otomatis dan keputusan untuk ${ticker}.`;
      return;
    }

    const niInputs = Array.from(document.querySelectorAll('.ni-input'));
    const revInputs = Array.from(document.querySelectorAll('.rev-input'));
    const epsInputs = Array.from(document.querySelectorAll('.eps-input'));

    const parseValues = (nodes) =>
      nodes
        .map((el) => Number(el.value))
        .filter((v) => !Number.isNaN(v));

    const ni = parseValues(niInputs);
    const rev = parseValues(revInputs);
    const eps = parseValues(epsInputs);

    if (ni.length < 2 || rev.length < 2 || eps.length < 2) {
      statusEl.textContent = 'Minimal 2 tahun data untuk tiap kategori diperlukan.';
      return;
    }

    statusEl.textContent = `Mengirim data CAGR untuk ${ticker}...`;

    const body = {
      items: [
        {
          ticker,
          net_income: ni,
          revenue: rev,
          eps,
        },
      ],
    };

    const res = await fetch('http://127.0.0.1:8000/decision-cagr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    const cagrData = json?.cagr?.[ticker];
    const methods = json?.methods;

    if (!cagrData) {
      statusEl.textContent = 'Gagal menghitung CAGR (data kosong).';
      return;
    }

    // Bersihkan tampilan lama hanya setelah respons sukses dan data valid
    if (tableBody) tableBody.innerHTML = '';
    if (mcdmRoot) mcdmRoot.innerHTML = '';

    renderCagrTable(ticker, cagrData);
    renderMcdmResult(ticker, methods);

    updateCagrInfoPanel({
      inputMode: 'annual',
      cagrYears: Math.max(ni.length, rev.length, eps.length),
      periodLabel: `Manual input (${Math.max(ni.length, rev.length, eps.length)} titik)`,
      periodSource: 'manual_annual_input',
    });

    // Simpan hasil terakhir ke localStorage agar muncul lagi jika halaman reload
    try {
      const key = `cagr-result-${ticker}`;
      const stored = { cagr: cagrData, methods };
      window.localStorage.setItem(key, JSON.stringify(stored));
    } catch (e) {
      // abaikan error storage
    }

    // Render grafik berdasarkan data annual yang baru saja dipakai
    renderCagrChart(ni, eps, rev);

    statusEl.textContent = `Berhasil menghitung CAGR dan keputusan untuk ${ticker}.`;
  } catch (error) {
    statusEl.textContent = `Gagal memproses data: ${String(error)}`;
  }
}

function init() {
  const titleEl = document.getElementById('detail-title');
  const tickerInput = document.getElementById('ticker-input');
  const backButton = document.getElementById('back-button');
  const deleteEntryBtn = document.getElementById('delete-entry-btn');
  const form = document.getElementById('cagr-form');
  const addYearBtn = document.getElementById('add-year-btn');
  const removeYearBtn = document.getElementById('remove-year-btn');
  const priceIntervalSelect = document.getElementById('price-interval');
  const inputModeEl = document.getElementById('input-mode');
  const cagrInfoToggle = document.getElementById('cagr-info-toggle');
  const cagrInfoPanel = document.getElementById('cagr-info-panel');

  const t = getQueryTicker();
  if (t && tickerInput) {
    tickerInput.value = t;
  }
  if (t && titleEl) {
    titleEl.textContent = `Detailed CAGR Analysis - ${t}`;
  }

  if (backButton) {
    backButton.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  if (deleteEntryBtn && t) {
    deleteEntryBtn.addEventListener('click', async () => {
      const statusEl = document.getElementById('status');
      const ok = window.confirm(`Hapus entry ${t} dari dashboard dan data CAGR?`);
      if (!ok) return;

      try {
        const res = await fetch(`http://127.0.0.1:8000/entry/${encodeURIComponent(t)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json?.deleted) {
          if (statusEl) statusEl.textContent = `Entry ${t} tidak ditemukan atau gagal dihapus.`;
          return;
        }
        if (statusEl) statusEl.textContent = `Entry ${t} berhasil dihapus. Kembali ke dashboard...`;
        
        // Force main dashboard to reload instead of using cache
        sessionStorage.setItem('force-refresh', 'true');

        setTimeout(() => {
          window.location.href = 'index.html';
        }, 600);
      } catch (err) {
        if (statusEl) statusEl.textContent = `Gagal hapus entry: ${String(err)}`;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  if (inputModeEl) {
    inputModeEl.addEventListener('change', () => {
      toggleInputModeUI(inputModeEl.value || 'annual');
    });
  }

  if (cagrInfoToggle && cagrInfoPanel) {
    cagrInfoToggle.addEventListener('click', () => {
      cagrInfoPanel.classList.toggle('hidden');
    });
  }

  // Inisialisasi input tahun: jika ada data tersimpan, muat; kalau tidak, buat 2 tahun kosong
  const niContainer = document.getElementById('ni-container');
  const epsContainer = document.getElementById('eps-container');
  const revContainer = document.getElementById('rev-container');

  const ensureMinYears = (min) => {
    const current = niContainer ? niContainer.querySelectorAll('.ni-input').length : 0;
    for (let i = current; i < min; i += 1) {
      addYearRow();
    }
  };

  if (t && niContainer && epsContainer && revContainer) {
    const statusEl = document.getElementById('status');
    // Ambil data fundamental untuk ditampilkan seperti di card utama
    fetch(`http://127.0.0.1:8000/stocks?tickers=${encodeURIComponent(t)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (Array.isArray(json) && json.length > 0) {
          if (isLikelyInvalidTicker(json[0], t)) {
            if (statusEl) statusEl.textContent = `Ticker ${t} tidak valid / data tidak ditemukan.`;
            return;
          }
          renderFundamentals(t, json[0]);
        } else if (statusEl) {
          statusEl.textContent = `Ticker ${t} tidak ditemukan.`;
        }
      })
      .catch((err) => {
        if (statusEl) statusEl.textContent = `Gagal memuat data fundamental: ${String(err)}`;
      });

    // Ambil histori harga (default: harian, 3 bulan terakhir)
    loadPriceHistory(t, '1d');
    loadPerformanceOverview(t);

    // Auto-refresh interval (every 60 seconds)
    setInterval(() => {
      fetch(`http://127.0.0.1:8000/stocks?tickers=${encodeURIComponent(t)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (Array.isArray(json) && json.length > 0 && !isLikelyInvalidTicker(json[0], t)) {
            renderFundamentals(t, json[0]);
          }
        })
        .catch(() => {});
        
      const intervalSelect = document.getElementById('price-interval');
      const val = intervalSelect ? (intervalSelect.value || '1d') : '1d';
      loadPriceHistory(t, val);
    }, 60000);

    fetch(`http://127.0.0.1:8000/cagr-raw/${encodeURIComponent(t)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) {
          ensureMinYears(2);
          return;
        }

        const ni = Array.isArray(json.net_income) ? json.net_income : [];
        const rev = Array.isArray(json.revenue) ? json.revenue : [];
        const eps = Array.isArray(json.eps) ? json.eps : [];
        const inputMode = json.input_mode || 'annual';

        if (inputModeEl) {
          inputModeEl.value = inputMode;
          toggleInputModeUI(inputMode);
        }

        updateCagrInfoPanel({
          inputMode,
          cagrYears: json.cagr_years,
          periodStartYear: json.period_start_year,
          periodEndYear: json.period_end_year,
          periodLabel: json.period_label,
          periodSource: json.period_source,
        });

        if (inputMode === 'direct') {
          const directNetEl = document.getElementById('direct-cagr-net');
          const directRevEl = document.getElementById('direct-cagr-rev');
          const directEpsEl = document.getElementById('direct-cagr-eps');
          const directYearsEl = document.getElementById('direct-cagr-years');
          if (directYearsEl) directYearsEl.value = json.cagr_years ?? '';
          if (directNetEl) directNetEl.value = json.cagr_net_income ?? '';
          if (directRevEl) directRevEl.value = json.cagr_revenue ?? '';
          if (directEpsEl) directEpsEl.value = json.cagr_eps ?? '';
          return;
        }

        if (inputMode === 'auto') {
          if (ni.length >= 2 && rev.length >= 2 && eps.length >= 2) {
            renderCagrChart(ni, eps, rev);
          }
          return;
        }

        const maxLen = Math.max(ni.length, rev.length, eps.length);

        if (maxLen === 0) {
          ensureMinYears(2);
          return;
        }

        for (let i = 0; i < maxLen; i += 1) {
          addYearRow();
        }

        const niInputs = niContainer.querySelectorAll('.ni-input');
        const revInputs = revContainer.querySelectorAll('.rev-input');
        const epsInputs = epsContainer.querySelectorAll('.eps-input');

        ni.forEach((v, idx) => {
          if (niInputs[idx]) niInputs[idx].value = v;
        });
        rev.forEach((v, idx) => {
          if (revInputs[idx]) revInputs[idx].value = v;
        });
        eps.forEach((v, idx) => {
          if (epsInputs[idx]) epsInputs[idx].value = v;
        });

        // Render grafik dari data yang dimuat
        if (ni.length >= 2 && rev.length >= 2 && eps.length >= 2) {
          renderCagrChart(ni, eps, rev);
        }
      })
      .catch(() => {
        ensureMinYears(2);
      });
  } else {
    ensureMinYears(2);
  }

  // default mode saat pertama buka
  if (inputModeEl) {
    toggleInputModeUI(inputModeEl.value || 'annual');
  }

  // Jika pernah ada hasil MCDM yang disimpan, render kembali agar tidak "hilang" setelah reload
  if (t) {
    try {
      const key = `cagr-result-${t}`;
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.cagr && parsed.methods) {
          renderCagrTable(t, parsed.cagr);
          renderMcdmResult(t, parsed.methods);
        }
      }
    } catch (e) {
      // abaikan error parsing/storage
    }
  }

  if (addYearBtn) {
    addYearBtn.addEventListener('click', () => {
      addYearRow();
    });
  }

  if (removeYearBtn) {
    removeYearBtn.addEventListener('click', () => {
      removeYearRow();
    });
  }

  if (priceIntervalSelect && t) {
    priceIntervalSelect.addEventListener('change', (e) => {
      const val = e.target.value || '1d';
      loadPriceHistory(t, val);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
