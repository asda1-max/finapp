import './index.css';
import { initNavbar } from './navbar.js';
initNavbar();

const searchedTickers = new Set();
const tickerCache = new Map();
const DASHBOARD_VIEW_MODE_KEY = 'dashboard-view-mode';

function updateTickerJson() {
  // panel JSON sudah dihapus dari UI, fungsi dibiarkan no-op untuk kompatibilitas.
}

// --- Terminal Loader Utils ---
let _terminalStartMs = 0;

function updateTerminalProgress(current, total) {
  const terminalLoader = document.getElementById('terminal-loader');
  const terminalProgressBar = document.getElementById('terminal-progress-bar');
  const terminalPercent = document.getElementById('terminal-percent');
  if (!terminalLoader || terminalLoader.classList.contains('hidden') || !terminalProgressBar || !terminalPercent) return;
  
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  terminalPercent.textContent = `${pct}%`;
  
  const barLen = 60;
  const fillLen = Math.floor((pct / 100) * barLen);
  const fill = '>'.repeat(fillLen);
  const empty = '.'.repeat(barLen - fillLen);
  terminalProgressBar.textContent = `[${fill}${empty}]`;
}

function appendTerminalLog(msg, type = 'info') {
  const terminalLog = document.getElementById('terminal-log');
  if (!terminalLog) return;
  const div = document.createElement('div');
  div.className = 'font-mono transition-colors';
  
  if (type === 'error') div.classList.add('text-rose-400');
  else if (type === 'success') div.classList.add('text-emerald-400');
  else if (type === 'warning') div.classList.add('text-amber-400', 'animate-pulse');
  else div.classList.add('text-slate-400');
  
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  div.textContent = `[${time}] ${msg}`;
  terminalLog.appendChild(div);
  
  // Smooth scroll to bottom
  terminalLog.scrollTo({ top: terminalLog.scrollHeight, behavior: 'smooth' });
}
// -----------------------------

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const num = Number(value);
  if (Math.abs(num) >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(num) >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(num) >= 1_000) {
    return `${(num / 1_000).toFixed(2)}K`;
  }
  return num.toFixed(2);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(2)}%`;
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

function buildCardHtml(ticker, s) {
  const name = s['Name'] ?? '-';
  const sector = s['Sector'] ?? '-';
  const price = formatNumber(s['Price']);
  const revenue = formatNumber(s['Revenue Annual (Prev)']);
  const eps = formatNumber(s['EPS NOW']);
  const per = formatNumber(s['PER NOW']);
  const high52 = formatNumber(s['HIGH 52']);
  const low52 = formatNumber(s['LOW 52']);
  const shares = formatNumber(s['Shares']);
  const marketCap = formatNumber(s['Market Cap']);
  const downFromHigh = formatPercent(s['Down From High 52 (%)']);
  const downFromMonth = formatPercent(s['Down From This Month (%)']);
  const downFromWeek = formatPercent(s['Down From This Week (%)']);
  const downFromToday = formatPercent(s['Down From Today (%)']);
  const riseFromLow = formatPercent(s['Rise From Low 52 (%)']);
  const bvp = formatNumber(s['BVP Per S']);
  const roe = formatPercent(s['ROE (%)']);
  const graham = formatNumber(s['Graham Number']);
  const mos = formatPercent(s['MOS (%)']);
  const pbv = formatNumber(s['PBV']);
  const divYield = formatPercent(s['Dividend Yield (%)']);
  const divGrowth = formatPercent(s['Dividend Growth (%)']);
  const payoutRatio = formatPercent(s['Payout Ratio (%)']);
  const payoutPenalty =
    s['Payout Penalty'] == null || Number.isNaN(Number(s['Payout Penalty']))
      ? '-'
      : Number(s['Payout Penalty']).toFixed(2);
  const buyDecision = s['Decision Buy'] ?? 'NO BUY';
  const finalDecision = s['Final Decision Buy'] ?? buyDecision;
  const executionDecision = s['Execution Decision'] ?? buyDecision;
  const safetyCheck = s['Safety Check'] ?? '-';
  const discountDecision = s['Decision Discount'] ?? '-';
  const discountScore =
    s['Discount Score'] == null || Number.isNaN(Number(s['Discount Score']))
      ? '-'
      : Number(s['Discount Score']).toFixed(3);
  const discountTimingVerdict = s['Discount Timing Verdict'] ?? '-';
  const dividendDecision = s['Decision Dividend'] ?? '-';
  const qualityScoreVal = typeof s['Quality Score'] === 'number' ? s['Quality Score'] : null;
  const qualityScore = qualityScoreVal != null ? qualityScoreVal.toFixed(3) : '-';
  const qualityLabel = s['Quality Label'] ?? '-';
  const qualityVerdict = s['Quality Verdict'] ?? '-';
  const hybridScoreValue = typeof s['Hybrid Score'] === 'number' ? s['Hybrid Score'] : null;
  const hybridScore = hybridScoreValue != null ? hybridScoreValue.toFixed(3) : '-';
  const finalHybridScoreValue =
    typeof s['Final Hybrid Score'] === 'number' ? s['Final Hybrid Score'] : hybridScoreValue;
  const finalHybridScore = finalHybridScoreValue != null ? finalHybridScoreValue.toFixed(3) : '-';
  const hybridCategory = s['Hybrid Category'] ?? '-';
  const finalHybridCategory = s['Final Hybrid Category'] ?? hybridCategory;
  const finalHybridMode = s['Final Hybrid Mode'] ?? '-';
  const cagrApplied = s['CAGR Applied'] === true ? 'Yes' : 'No';
  const cagrSource = s['CAGR Source'] ?? '-';

  // Determine accent border color based on execution decision
  const accentClass = executionDecision === 'BUY'
    ? 'card-accent-buy'
    : executionDecision === 'HOLD'
      ? 'card-accent-hold'
      : 'card-accent-nobuy';

  let safetyBadgeHtml = '';
  if (safetyCheck.includes('[SOLVENCY HOLD]')) {
    safetyBadgeHtml = `<div class="mt-2 mb-1 p-1.5 rounded bg-yellow-950/40 border border-yellow-700/50 text-[10px] text-yellow-400 font-bold flex items-center justify-center gap-1.5 w-full">
        ⚠️ Solvency Warning: High Leverage & Low Liquidity
    </div>`;
  } else if (safetyCheck.includes('[DANGER NO BUY]')) {
    safetyBadgeHtml = `<div class="mt-2 mb-1 p-1.5 rounded bg-red-950/40 border border-red-700/50 text-[10px] text-red-500 font-bold flex items-center justify-center gap-1.5 w-full">
        🚨 DANGER: Toxic Debt Trap Avoided
    </div>`;
  }


  return `
    <article
      class="glass-card ${accentClass} rounded-2xl p-3 sm:p-4 cursor-pointer transition-all duration-300 hover:scale-[1.01] animate-fade-in-up"
      data-ticker="${ticker}"
    >
      <header class="mb-2 flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1 pr-1">
          <h2 class="text-sm font-semibold leading-tight text-slate-50 truncate" title="${name}">${name}</h2>
          <p class="mt-0.5 text-[10px] uppercase text-slate-500 tracking-wide">${ticker}</p>
          <p class="mt-0.5 text-[10px] text-slate-500">Sector: ${sector}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <span class="badge-glow relative rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">MOS ${mos}</span>
          <button
            type="button"
            data-delete-ticker="${ticker}"
            class="rounded-md border border-rose-700/40 bg-rose-950/30 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:border-rose-500 hover:text-rose-200 hover:bg-rose-950/50 transition-all duration-200"
            title="Hapus entry"
          >
            🗑️
          </button>
        </div>
      </header>
      <div class="space-y-1.5 text-[11px] text-slate-300">
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Price</span>
          <span class="font-medium">${price}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Revenue Annual (Prev)</span>
          <span class="font-medium">${revenue}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">EPS NOW</span>
          <span class="font-medium">${eps}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">PER NOW</span>
          <span class="font-medium">${per}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">HIGH 52</span>
          <span class="font-medium">${high52}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">LOW 52</span>
          <span class="font-medium">${low52}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Shares</span>
          <span class="font-medium">${shares}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Market Cap</span>
          <span class="font-medium">${marketCap}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Down From High 52</span>
          <span class="font-medium">${downFromHigh}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Down From This Month</span>
          <span class="font-medium">${downFromMonth}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Down From This Week</span>
          <span class="font-medium">${downFromWeek}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Down From Today</span>
          <span class="font-medium">${downFromToday}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Rise From Low 52</span>
          <span class="font-medium">${riseFromLow}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">BVP Per S</span>
          <span class="font-medium">${bvp}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">ROE</span>
          <span class="font-medium">${roe}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Graham Number</span>
          <span class="font-medium">${graham}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">MOS</span>
          <span class="font-medium">${mos}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">PBV</span>
          <span class="font-medium">${pbv}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Dividend Yield</span>
          <span class="font-medium">${divYield}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Dividend Growth</span>
          <span class="font-medium">${divGrowth}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Payout Ratio</span>
          <span class="font-medium">${payoutRatio}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-slate-400">Payout Penalty</span>
          <span class="font-medium">${payoutPenalty}</span>
        </div>
        ${safetyBadgeHtml}
        <div class="divider-gradient my-2"></div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Base Signal (Hybrid)</span>
          <span class="font-semibold ${buyDecision === 'BUY' ? 'text-emerald-400' : 'text-slate-400'}">${buyDecision}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Final Signal (Detailed)</span>
          <span class="font-semibold ${finalDecision === 'BUY' ? 'text-emerald-300' : 'text-slate-400'}">${finalDecision}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Final Execution</span>
          <span class="font-semibold ${
            executionDecision === 'BUY'
              ? 'text-emerald-300'
              : executionDecision === 'HOLD'
                ? 'text-amber-300'
                : 'text-slate-400'
          }">${executionDecision}</span>
        </div>
        <div class="divider-gradient my-1.5"></div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Base Score</span>
          <span class="font-medium text-cyan-300">${hybridScore}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Final Score</span>
          <span class="font-medium text-emerald-300">${finalHybridScore}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Final Category</span>
          <span class="font-medium text-emerald-300">${finalHybridCategory}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Final Mode</span>
          <span class="font-medium text-slate-300">${finalHybridMode}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">CAGR Applied</span>
          <span class="font-medium ${cagrApplied === 'Yes' ? 'text-emerald-300' : 'text-amber-300'}">${cagrApplied}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">CAGR Source</span>
          <span class="font-medium text-slate-300">${cagrSource}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Quality Score</span>
          <span class="font-medium text-cyan-300">${qualityScore}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Quality Label</span>
          <span class="font-medium text-emerald-300">${qualityLabel}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Quality Verdict</span>
          <span class="font-medium text-amber-300">${qualityVerdict}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Safety Check</span>
          <span class="font-medium text-amber-300">${safetyCheck}</span>
        </div>
        <div class="divider-gradient my-1.5"></div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Diskon</span>
          <span class="font-medium text-sky-300">${discountDecision}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Discount Score</span>
          <span class="font-medium text-cyan-300">${discountScore}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Timing Verdict</span>
          <span class="font-medium text-amber-300 text-right">${discountTimingVerdict}</span>
        </div>
        <div class="flex justify-between gap-2 text-[10px]">
          <span class="text-slate-400">Dividen</span>
          <span class="font-medium text-amber-300">${dividendDecision}</span>
        </div>
      </div>
    </article>
  `;
}

function normalizeSectorLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return 'Unknown';
  return raw;
}

function getDashboardViewMode() {
  try {
    const saved = window.localStorage.getItem(DASHBOARD_VIEW_MODE_KEY);
    return saved === 'sector' ? 'sector' : 'flat';
  } catch {
    return 'flat';
  }
}

function setDashboardViewMode(mode) {
  try {
    window.localStorage.setItem(DASHBOARD_VIEW_MODE_KEY, mode === 'sector' ? 'sector' : 'flat');
  } catch {
    // ignore storage errors
  }
}

function renderDashboardCards() {
  const cardsEl = document.getElementById('stocks-cards');
  if (!cardsEl) return;

  const mode = getDashboardViewMode();
  const entries = Array.from(tickerCache.entries());
  cardsEl.innerHTML = '';

  if (entries.length === 0) {
    return;
  }

  if (mode !== 'sector') {
    for (const [ticker, payload] of entries) {
      const html = buildCardHtml(ticker, payload.stock);
      cardsEl.insertAdjacentHTML('beforeend', html);
    }
    return;
  }

  const groups = new Map();
  for (const [ticker, payload] of entries) {
    const sector = normalizeSectorLabel(payload.stock?.Sector);
    if (!groups.has(sector)) groups.set(sector, []);
    groups.get(sector).push({ ticker, payload });
  }

  const sectors = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < sectors.length; i += 1) {
    const sector = sectors[i];
    const wrapper = document.createElement('section');
    wrapper.className = `col-span-full space-y-3 ${i > 0 ? 'mt-6' : ''}`;

    const title = document.createElement('h3');
    title.className = 'text-center text-xs font-semibold uppercase tracking-wide text-sky-300';
    title.textContent = `-- ${sector} --`;
    wrapper.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'mx-auto grid justify-items-center gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

    const rows = groups.get(sector) || [];
    for (const row of rows) {
      const html = buildCardHtml(row.ticker, row.payload.stock);
      const cardWrap = document.createElement('div');
      cardWrap.className = 'w-full max-w-sm';
      cardWrap.innerHTML = html.trim();
      const article = cardWrap.querySelector('article');
      if (article) {
        article.classList.add('w-full');
      }
      grid.appendChild(cardWrap);
    }

    wrapper.appendChild(grid);
    cardsEl.appendChild(wrapper);
  }
}

async function loadSavedTickers() {
  const statusEl = document.getElementById('status');
  const cardsEl = document.getElementById('stocks-cards');

  if (!statusEl || !cardsEl) return;

  try {
    const res = await fetch('http://127.0.0.1:8000/saved-tickers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const tickers = Array.isArray(json.tickers) ? json.tickers : [];

    if (tickers.length === 0) {
      statusEl.textContent = 'Belum ada saham tersimpan.';
      tickerCache.clear();
      cardsEl.innerHTML = '';
      return;
    }

    statusEl.textContent = `Memuat ${tickers.length} saham tersimpan...`;

    tickerCache.clear();
    cardsEl.innerHTML = '';

    const terminalLoader = document.getElementById('terminal-loader');
    const terminalLog = document.getElementById('terminal-log');
    if (terminalLoader && terminalLog) {
      terminalLoader.classList.remove('hidden');
      terminalLoader.classList.add('flex');
      terminalLog.innerHTML = '';
      updateTerminalProgress(0, tickers.length);
      appendTerminalLog(`[SYSTEM] Initiating parallel load for ${tickers.length} tickers...`, 'warning');
    }

    let doneCount = 0;
    await Promise.allSettled(
      tickers.map(async (t) => {
        await loadSingleTicker(t, { skipSave: true, silent: true, useTerminal: true });
        doneCount += 1;
        if (statusEl) {
          statusEl.textContent = `Memuat saham... (${doneCount}/${tickers.length})`;
        }
        updateTerminalProgress(doneCount, tickers.length);
      })
    );

    if (terminalLoader) {
      appendTerminalLog(`[SYSTEM] All tickers processed. Rendering dashboard...`, 'success');
      setTimeout(() => {
        terminalLoader.classList.add('hidden');
        terminalLoader.classList.remove('flex');
      }, 1200);
    }

    renderDashboardCards();
    statusEl.textContent = `Menampilkan ${tickerCache.size} saham dari data.json.`;
  } catch (error) {
    statusEl.textContent = `Gagal memuat saham tersimpan: ${String(error)}`;
  }
}
async function loadSingleTicker(tickerRaw, options = {}) {
  const ticker = (tickerRaw || '').trim();
  const { skipSave = false, silent = false, useTerminal = false } = options;
  const statusEl = document.getElementById('status');
  const cardsEl = document.getElementById('stocks-cards');

  if (!statusEl || !cardsEl) return;

  if (!ticker) {
    if (!silent) statusEl.textContent = 'Masukkan ticker terlebih dahulu, misal: BBCA.JK';
    return;
  }

  try {
    if (useTerminal) appendTerminalLog(`LOADING Tickers : ${ticker}`, 'info');
    if (!silent) statusEl.textContent = `Memuat data untuk ${ticker}...`;

    const url = `http://127.0.0.1:8000/stocks?tickers=${encodeURIComponent(ticker)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      if (!silent) statusEl.textContent = `Tidak ada data untuk ticker ${ticker}.`;
      if (useTerminal) appendTerminalLog(`ERROR : No data returned for ${ticker}`, 'error');
      return;
    }

    let s = data[0];

    const isRateLimited = s['Is Rate Limited'] === true;
    if (isRateLimited) {
      if (!silent) statusEl.textContent = `YFinance API Limit tercapai saat memuat ${ticker}. Coba beberapa saat lagi.`;
      if (useTerminal) appendTerminalLog(`CRIT_ERR: YFinance API Rate Limit Reached for ${ticker}!`, 'error');
      return;
    }

    if (isLikelyInvalidTicker(s, ticker)) {
      if (!silent) statusEl.textContent = `Ticker ${ticker} tidak valid / data tidak ditemukan.`;
      if (useTerminal) appendTerminalLog(`ERROR : Ticker ${ticker} is invalid or delisted.`, 'error');
      return;
    }

    // If no CAGR stored yet, trigger auto-fetch from yfinance and save to backend
    try {
      const cagrRes = await fetch(`http://127.0.0.1:8000/cagr-raw/${encodeURIComponent(ticker)}`);
      if (cagrRes.ok) {
        const cagrJson = await cagrRes.json();
        const ni = Array.isArray(cagrJson?.net_income) ? cagrJson.net_income : [];
        const rev = Array.isArray(cagrJson?.revenue) ? cagrJson.revenue : [];
        const epsData = Array.isArray(cagrJson?.eps) ? cagrJson.eps : [];
        const annualReady = ni.length >= 2 && rev.length >= 2 && epsData.length >= 2;
        const hasNumeric = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v));
        const directReady =
          hasNumeric(cagrJson?.cagr_years) && Number(cagrJson?.cagr_years) >= 1 &&
          hasNumeric(cagrJson?.cagr_net_income) &&
          hasNumeric(cagrJson?.cagr_revenue) &&
          hasNumeric(cagrJson?.cagr_eps);

        if (!annualReady && !directReady) {
          // No manual CAGR yet — auto-fetch from yfinance and persist
          const autoRes = await fetch('http://127.0.0.1:8000/decision-cagr-auto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ ticker }] }),
          });
          // Re-fetch stock data so scores include CAGR
          if (autoRes.ok) {
            try {
              const refreshRes = await fetch(`http://127.0.0.1:8000/stocks?tickers=${encodeURIComponent(ticker)}`);
              if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (Array.isArray(refreshData) && refreshData.length > 0) {
                  s = refreshData[0];
                }
              }
            } catch (_) { /* refresh failure non-fatal */ }
          }
        } else if (annualReady || directReady) {
          // CAGR data exists but the initial /stocks call may not have used it
          // (e.g. auto_live extraction failed). Re-fetch to ensure scores include CAGR.
          if (s['CAGR Applied'] !== true) {
            try {
              const refreshRes = await fetch(`http://127.0.0.1:8000/stocks?tickers=${encodeURIComponent(ticker)}`);
              if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (Array.isArray(refreshData) && refreshData.length > 0) {
                  s = refreshData[0];
                }
              }
            } catch (_) { /* refresh failure non-fatal */ }
          }
        }
      }
    } catch (e) {
      // Auto-fetch failure is non-fatal; scoring will fall back to no-CAGR mode
    }

    tickerCache.set(ticker, { stock: s });
    if (useTerminal) appendTerminalLog(`SUCCESS : ${ticker} data loaded & integrated.`, 'success');

    // In silent/parallel mode the caller does a single final render; skip intermediate renders.
    if (!silent) renderDashboardCards();

    if (!skipSave) {
      searchedTickers.add(ticker);
      updateTickerJson();

      try {
        await fetch('http://127.0.0.1:8000/saved-tickers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
      } catch (e) {
        // ignore persistance error in UI
      }
    }

    if (!silent) statusEl.textContent = `Berhasil menambahkan card untuk ${ticker}.`;
  } catch (error) {
    if (useTerminal) appendTerminalLog(`ERROR : Failed fetching ${ticker} -> ${String(error)}`, 'error');
    if (!silent) statusEl.textContent = `Gagal mengambil data untuk ${ticker}: ${String(error)}`;
  }
}

function init() {
  loadSavedTickers();

  const input = document.getElementById('ticker-input');
  const button = document.getElementById('ticker-submit');
  const refreshAllBtn = document.getElementById('refresh-all-btn');
  const resetAllBtn = document.getElementById('reset-all-btn');
  const resetModal = document.getElementById('reset-modal');
  const resetConfirmInput = document.getElementById('reset-confirm-input');
  const resetConfirmError = document.getElementById('reset-confirm-error');
  const resetCancelBtn = document.getElementById('reset-cancel-btn');
  const resetConfirmBtn = document.getElementById('reset-confirm-btn');

  if (button && input) {
    button.addEventListener('click', () => {
      loadSingleTicker(input.value);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        loadSingleTicker(input.value);
      }
    });
  }

  if (refreshAllBtn) {
    refreshAllBtn.addEventListener('click', () => {
      loadSavedTickers();
    });
  }

  if (resetAllBtn) {
    const openResetModal = () => {
      if (!resetModal) return;
      resetModal.classList.remove('hidden');
      resetModal.classList.add('flex');
      if (resetConfirmError) resetConfirmError.classList.add('hidden');
      if (resetConfirmInput) {
        resetConfirmInput.value = '';
        resetConfirmInput.focus();
      }
    };

    const closeResetModal = () => {
      if (!resetModal) return;
      resetModal.classList.add('hidden');
      resetModal.classList.remove('flex');
    };

    const runReset = async () => {
      const statusEl = document.getElementById('status');
      const cardsEl = document.getElementById('stocks-cards');

      const confirmation = resetConfirmInput ? resetConfirmInput.value : '';
      if (confirmation !== 'yes, i want to reset') {
        if (resetConfirmError) resetConfirmError.classList.remove('hidden');
        if (statusEl) statusEl.textContent = 'Reset dibatalkan. Frasa konfirmasi tidak cocok.';
        return;
      }

      try {
        const res = await fetch('http://127.0.0.1:8000/reset-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        if (cardsEl) cardsEl.innerHTML = '';
        tickerCache.clear();
        searchedTickers.clear();
        updateTickerJson();
        if (statusEl) statusEl.textContent = 'Semua data berhasil di-reset.';
        closeResetModal();
      } catch (err) {
        if (statusEl) statusEl.textContent = `Gagal reset data: ${String(err)}`;
      }
    };

    resetAllBtn.addEventListener('click', () => {
      openResetModal();
    });

    if (resetCancelBtn) {
      resetCancelBtn.addEventListener('click', () => {
        closeResetModal();
      });
    }

    if (resetConfirmBtn) {
      resetConfirmBtn.addEventListener('click', () => {
        runReset();
      });
    }

    if (resetConfirmInput) {
      resetConfirmInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          runReset();
        }
      });
    }
  }

  const cardsEl = document.getElementById('stocks-cards');
  if (cardsEl) {
    cardsEl.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('button[data-delete-ticker]');
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();

        const t = deleteBtn.getAttribute('data-delete-ticker');
        if (!t) return;

        const ok = window.confirm(`Hapus entry ${t} dari dashboard dan data CAGR?`);
        if (!ok) return;

        const statusEl = document.getElementById('status');
        const article = deleteBtn.closest('article[data-ticker]');

        fetch(`http://127.0.0.1:8000/entry/${encodeURIComponent(t)}`, { method: 'DELETE' })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (!json || !json.deleted) {
              if (statusEl) statusEl.textContent = `Entry ${t} tidak ditemukan atau gagal dihapus.`;
              return;
            }

            if (article) article.remove();
            tickerCache.delete(t);
            renderDashboardCards();
            searchedTickers.delete(t);
            updateTickerJson();

            if (statusEl) statusEl.textContent = `Entry ${t} berhasil dihapus.`;
          })
          .catch((err) => {
            if (statusEl) statusEl.textContent = `Gagal hapus entry ${t}: ${String(err)}`;
          });
        return;
      }

      const article = event.target.closest('article[data-ticker]');
      if (!article) return;
      const t = article.getAttribute('data-ticker');
      if (!t) return;
      sessionStorage.setItem('currentTicker', t);
      window.location.href = 'detailed.html';
    });
  }

  const viewModeEl = document.getElementById('dashboard-view-mode');
  if (viewModeEl) {
    viewModeEl.value = getDashboardViewMode();
    viewModeEl.addEventListener('change', () => {
      setDashboardViewMode(viewModeEl.value || 'flat');
      renderDashboardCards();
    });
  }

  // ── Batch Import ──────────────────────────────────────────────
  const batchBtn = document.getElementById('batch-import-btn');
  const batchModal = document.getElementById('batch-modal');
  const batchTextarea = document.getElementById('batch-textarea');
  const batchPreview = document.getElementById('batch-preview');
  const batchProgress = document.getElementById('batch-progress');
  const batchProgressText = document.getElementById('batch-progress-text');
  const batchProgressCount = document.getElementById('batch-progress-count');
  const batchProgressBar = document.getElementById('batch-progress-bar');
  const batchResult = document.getElementById('batch-result');
  const batchCancelBtn = document.getElementById('batch-cancel-btn');
  const batchSubmitBtn = document.getElementById('batch-import-submit');

  function parseBatchTickers(text) {
    return [...new Set(
      (text || '')
        .split(/[\s,;\n\r\t]+/)
        .map(t => t.trim().toUpperCase())
        .filter(t => t.length > 0)
    )];
  }

  function openBatchModal() {
    if (!batchModal) return;
    batchModal.classList.remove('hidden');
    batchModal.classList.add('flex');
    if (batchTextarea) {
      batchTextarea.value = '';
      batchTextarea.disabled = false;
      batchTextarea.focus();
    }
    if (batchPreview) batchPreview.textContent = '0 ticker terdeteksi';
    if (batchProgress) batchProgress.classList.add('hidden');
    if (batchResult) { batchResult.classList.add('hidden'); batchResult.innerHTML = ''; }
    if (batchSubmitBtn) batchSubmitBtn.disabled = false;
  }

  function closeBatchModal() {
    if (!batchModal) return;
    batchModal.classList.add('hidden');
    batchModal.classList.remove('flex');
  }

  if (batchTextarea && batchPreview) {
    batchTextarea.addEventListener('input', () => {
      const tickers = parseBatchTickers(batchTextarea.value);
      const existing = tickers.filter(t => tickerCache.has(t));
      const newOnes = tickers.filter(t => !tickerCache.has(t));
      let text = `${tickers.length} ticker terdeteksi`;
      if (existing.length > 0) {
        text += ` · ${existing.length} sudah ada`;
      }
      if (newOnes.length > 0) {
        text += ` · ${newOnes.length} baru`;
      }
      batchPreview.textContent = text;
    });
  }

  if (batchBtn) {
    batchBtn.addEventListener('click', openBatchModal);
  }

  if (batchCancelBtn) {
    batchCancelBtn.addEventListener('click', closeBatchModal);
  }

  if (batchSubmitBtn) {
    batchSubmitBtn.addEventListener('click', async () => {
      const tickers = parseBatchTickers(batchTextarea?.value);
      if (tickers.length === 0) {
        if (batchPreview) batchPreview.textContent = '⚠️ Tidak ada ticker untuk diimport.';
        return;
      }

      // Disable UI during import
      if (batchSubmitBtn) batchSubmitBtn.disabled = true;
      if (batchTextarea) batchTextarea.disabled = true;
      if (batchProgress) batchProgress.classList.remove('hidden');
      if (batchResult) { batchResult.classList.add('hidden'); batchResult.innerHTML = ''; }

      const alreadyLoaded = tickers.filter(t => tickerCache.has(t));
      const newTickers = tickers.filter(t => !tickerCache.has(t));

      // ── Phase 1: Save all new tickers to backend (no yfinance, just data.json) ──
      if (batchProgressText) batchProgressText.textContent = `Menyimpan ${newTickers.length} ticker ke daftar...`;
      if (batchProgressBar) batchProgressBar.style.width = '10%';
      if (batchProgressCount) batchProgressCount.textContent = `0/${newTickers.length}`;

      let savedCount = 0;
      for (const t of newTickers) {
        try {
          await fetch('http://127.0.0.1:8000/saved-tickers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: t }),
          });
        } catch {
          // ignore individual save errors; loadSavedTickers will only load what's saved
        }
        savedCount++;
        if (batchProgressCount) batchProgressCount.textContent = `${savedCount}/${newTickers.length}`;
      }

      if (batchProgressBar) batchProgressBar.style.width = '30%';

      // ── Phase 2: Reload all saved tickers in parallel (handles yfinance fetching) ──
      if (batchProgressText) batchProgressText.textContent = 'Memuat data saham secara paralel...';

      // Intercept loadSavedTickers progress to update the batch progress bar
      const prevSize = tickerCache.size;
      await loadSavedTickers();

      if (batchProgressBar) batchProgressBar.style.width = '100%';
      if (batchProgressText) batchProgressText.textContent = 'Selesai!';

      // ── Results ──
      const success = newTickers.filter(t => tickerCache.has(t)).length;
      const failed = newTickers.length - success;
      const failedTickers = newTickers.filter(t => !tickerCache.has(t));

      if (batchResult) {
        let html = '<div class="space-y-1">';
        html += `<div class="text-emerald-300">✅ Berhasil: ${success} ticker</div>`;
        if (alreadyLoaded.length > 0) html += `<div class="text-sky-300">⏭️ Dilewati (sudah ada): ${alreadyLoaded.length} ticker</div>`;
        if (failed > 0) html += `<div class="text-rose-300">❌ Gagal load: ${failed} ticker (${failedTickers.join(', ')})</div>`;
        html += '</div>';
        batchResult.innerHTML = html;
        batchResult.classList.remove('hidden');
      }

      if (batchSubmitBtn) batchSubmitBtn.disabled = false;
      if (batchTextarea) batchTextarea.disabled = false;
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
