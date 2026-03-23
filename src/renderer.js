import { initNavbar } from './navbar.js';
import { toast } from './utils/toast.js';
import { tooltips } from './utils/tooltip.js';
initNavbar();

const searchedTickers = new Set();
const tickerCache = new Map();
const DASHBOARD_VIEW_MODE_KEY = 'dashboard-view-mode';
const DASHBOARD_DISPLAY_MODE_KEY = 'dashboard-display-mode';
const CACHE_KEY = 'renderer-ticker-cache';

let dashboardDisplayMode = localStorage.getItem(DASHBOARD_DISPLAY_MODE_KEY) || 'lite';

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

/**
 * Checks if a string value represents a negative number (e.g. "-15.20%" or "-1,000")
 */
function isNegative(val) {
  if (typeof val !== 'string') return false;
  const clean = val.trim();
  return clean.startsWith('-') && !clean.startsWith('-0.00');
}

function buildFullCardHtml(ticker, stock) {
  const s = stock;
  const name = s['Name'] ?? ticker;
  const sector = s['Sector'] ?? 'Unknown Sector';
  const price = formatNumber(s['Price']);
  const roe = formatPercent(s['ROE (%)']);
  const mos = formatPercent(s['MOS (%)']);
  const pbv = formatNumber(s['PBV']);
  const divYield = formatPercent(s['Dividend Yield (%)']);
  const divGrowth = formatPercent(s['Dividend Growth (%)']);
  const payoutRatio = formatPercent(s['Payout Ratio (%)']);
  
  const downFromHigh = formatPercent(s['Down From High 52 (%)']);
  const downFromMonth = formatPercent(s['Down From This Month (%)']);
  const downFromWeek = formatPercent(s['Down From This Week (%)']);
  const downFromToday = formatPercent(s['Down From Today (%)']);
  const riseFromLow = formatPercent(s['Rise From Low 52 (%)']);
  
  const revenue = formatNumber(s['Revenue Annual (Prev)']);
  const epsNow = formatNumber(s['EPS NOW']);
  const perNow = formatNumber(s['PER NOW']);
  const high52 = formatNumber(s['HIGH 52']);
  const low52 = formatNumber(s['LOW 52']);
  const shares = formatNumber(s['Shares']);
  const marketCap = formatNumber(s['Market Cap']);
  const bvpPerS = formatNumber(s['BVP Per S']);
  const graham = formatNumber(s['Graham Number']);
  const payoutPenalty = s['Payout Penalty']?.toFixed(2) ?? '0.00';
  
  const buyDecision = s['Buy Decision'] ?? 'NO BUY';
  const executionDecision = s['Execution Decision'] ?? '-';
  const safetyCheck = s['Safety Check'] ?? '-';
  const hybridScore = s['Hybrid Score']?.toFixed(3) ?? '-';
  const finalHybridScore = s['Final Hybrid Score']?.toFixed(3) ?? '-';
  const finalHybridCategory = s['Final Hybrid Category'] ?? '-';
  const finalMode = s['Final Mode'] ?? '-';
  const cagrApplied = s['CAGR Applied'] ?? 'No';

  const mosClass = isNegative(mos) ? 'text-negative font-bold' : 'text-emerald-400 font-semibold';
  const accentClass = executionDecision === 'BUY'
    ? 'card-accent-buy card-hover-buy'
    : executionDecision === 'HOLD'
      ? 'card-accent-hold card-hover-hold'
      : 'card-accent-nobuy card-hover-nobuy';

  const row = (label, val, valClass = 'text-slate-300', tooltipKey = null) => {
    const tooltipHtml = tooltipKey ? ` <span data-tooltip="${tooltipKey}" class="cursor-help opacity-30 text-[8px] hover:opacity-100 transition-opacity">ⓘ</span>` : '';
    return `
    <div class="flex justify-between items-center py-1 border-b border-white/5 last:border-0 hover:bg-white/5 px-1 rounded transition-colors group/item">
      <span class="text-[10px] text-slate-500">${label}${tooltipHtml}</span>
      <span class="text-[10px] font-medium ${valClass}">${val}</span>
    </div>
  `;
  };

  return `
    <article class="glass-card ${accentClass} rounded-2xl p-4 cursor-pointer transition-all duration-300 animate-fade-in-up" data-ticker="${ticker}">
      <header class="mb-3 flex items-start justify-between gap-2 border-b border-white/10 pb-2">
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-bold leading-tight text-white truncate" title="${name}">${name}</h2>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span class="header-pill text-[9px] uppercase tracking-widest text-sky-400">${ticker}</span>
            <span class="header-pill text-[9px] text-slate-400">${sector}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <span class="badge-glow rounded-full bg-slate-900/80 border border-slate-700/50 px-2.5 py-1 text-[10px] ${mosClass}">MOS ${mos}</span>
          <button type="button" data-delete-ticker="${ticker}" class="rounded-lg border border-rose-700/40 bg-rose-950/30 p-1.5 text-rose-300 hover:border-rose-500 hover:text-white transition-all">🗑️</button>
        </div>
      </header>

      <div class="space-y-0.5 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
        ${row('Price', price, 'text-white font-bold', 'Price')}
        ${row('Revenue Annual (Prev)', revenue)}
        ${row('EPS NOW', epsNow)}
        ${row('PER NOW', perNow, 'text-amber-300', 'PER')}
        ${row('HIGH 52', high52)}
        ${row('LOW 52', low52)}
        ${row('Shares', shares)}
        ${row('Market Cap', marketCap)}
        ${row('Down From High 52', downFromHigh, isNegative(downFromHigh) ? 'text-negative' : 'text-emerald-400')}
        ${row('Down From This Month', downFromMonth, isNegative(downFromMonth) ? 'text-negative' : 'text-emerald-400')}
        ${row('Down From This Week', downFromWeek, isNegative(downFromWeek) ? 'text-negative' : 'text-emerald-400')}
        ${row('Down From Today', downFromToday, isNegative(downFromToday) ? 'text-negative' : 'text-emerald-400')}
        ${row('Rise From Low 52', riseFromLow, 'text-emerald-400')}
        ${row('BVP Per S', bvpPerS)}
        ${row('ROE', roe, 'text-sky-300', 'ROE')}
        ${row('Graham Number', graham)}
        ${row('MOS', mos, mosClass, 'MOS')}
        ${row('PBV', pbv, 'text-violet-300', 'PBV')}
        ${row('Dividend Yield', divYield, 'text-emerald-400', 'Dividend Yield')}
        ${row('Dividend Growth', divGrowth, isNegative(divGrowth) ? 'text-negative' : 'text-emerald-300', 'Dividend Growth')}
        ${row('Payout Ratio', payoutRatio, 'text-slate-300', 'Payout Ratio')}
        ${row('Payout Penalty', payoutPenalty)}
        
        <div class="mt-3 pt-2 border-t border-white/10 space-y-0.5">
          ${row('Base Signal (Hybrid)', buyDecision)}
          ${row('Final Signal (Detailed)', executionDecision, executionDecision === 'BUY' ? 'text-emerald-400' : 'text-amber-400')}
          ${row('Final Execution', executionDecision, 'font-black ' + (executionDecision === 'BUY' ? 'text-emerald-400' : 'text-amber-400'))}
          ${row('Base Score', hybridScore)}
          ${row('Final Score', finalHybridScore, 'text-sky-400 font-bold')}
          ${row('Final Category', finalHybridCategory, 'text-emerald-400')}
          ${row('Final Mode', finalMode)}
          ${row('CAGR Applied', cagrApplied, 'text-emerald-400')}
        </div>
      </div>
    </article>
  `;
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
  const executionDecision = s['Execution Decision'] ?? buyDecision;
  const safetyCheck = s['Safety Check'] ?? '-';
  const qualityLabel = s['Quality Label'] ?? '-';
  const hybridScoreValue = typeof s['Hybrid Score'] === 'number' ? s['Hybrid Score'] : null;
  const hybridScore = hybridScoreValue != null ? hybridScoreValue.toFixed(3) : '-';
  const finalHybridScoreValue =
    typeof s['Final Hybrid Score'] === 'number' ? s['Final Hybrid Score'] : hybridScoreValue;
  const finalHybridScore = finalHybridScoreValue != null ? finalHybridScoreValue.toFixed(3) : '-';
  const hybridCategory = s['Hybrid Category'] ?? '-';
  const finalHybridCategory = s['Final Hybrid Category'] ?? hybridCategory;
  
  // Conditional coloring classes
  const mosClass = isNegative(mos) ? 'text-negative font-bold' : 'text-emerald-400 font-semibold';
  const divGrowthClass = isNegative(divGrowth) ? 'text-negative' : 'text-emerald-300';
  const priceMoveClass = (val) => isNegative(val) ? 'text-negative' : 'text-emerald-400';

  // Hover and border accent based on execution
  const accentClass = executionDecision === 'BUY'
    ? 'card-accent-buy card-hover-buy'
    : executionDecision === 'HOLD'
      ? 'card-accent-hold card-hover-hold'
      : 'card-accent-nobuy card-hover-nobuy';

  let safetyBadgeHtml = '';
  if (safetyCheck.includes('[SOLVENCY HOLD]')) {
    safetyBadgeHtml = `<div class="mt-2 mb-1 p-1.5 rounded bg-yellow-950/40 border border-yellow-700/50 text-[10px] text-yellow-400 font-bold flex items-center justify-center gap-1.5 w-full">
        ⚠️ Solvency Warning
    </div>`;
  } else if (safetyCheck.includes('[DANGER NO BUY]')) {
    safetyBadgeHtml = `<div class="mt-2 mb-1 p-1.5 rounded bg-red-950/40 border border-red-700/50 text-[10px] text-red-500 font-bold flex items-center justify-center gap-1.5 w-full">
        🚨 DANGER: Debt Trap
    </div>`;
  }

  return `
    <article
      class="glass-card ${accentClass} rounded-2xl p-4 cursor-pointer transition-all duration-300 animate-fade-in-up"
      data-ticker="${ticker}"
    >
      <header class="mb-3 flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-bold leading-tight text-white truncate" title="${name}">${name}</h2>
            <a 
              href="https://finance.yahoo.com/quote/${ticker}" 
              target="_blank" 
              class="text-[10px] text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-0.5"
              title="Lihat di Yahoo Finance"
              onclick="event.stopPropagation();"
            >
              <span class="p-0.5 rounded bg-sky-500/10 border border-sky-500/20">yF</span>
            </a>
          </div>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span class="header-pill text-[9px] uppercase tracking-widest text-sky-400">${ticker}</span>
            <span class="header-pill text-[9px] text-slate-400">${sector}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <span class="badge-glow rounded-full bg-slate-900/80 border border-slate-700/50 px-2.5 py-1 text-[10px] ${mosClass}">MOS ${mos}</span>
          <button
            type="button"
            data-delete-ticker="${ticker}"
            class="rounded-lg border border-rose-700/40 bg-rose-950/30 p-1.5 text-rose-300 hover:border-rose-500 hover:text-white transition-all"
            title="Hapus entry"
          >
            🗑️
          </button>
        </div>
      </header>
      
      <div class="space-y-3">
        <!-- Market Info Section -->
        <div class="metric-group">
          <div class="section-label"><span>📈</span> Market Info</div>
          <div class="space-y-1 text-[11px]">
            <div class="flex justify-between items-center group/item">
              <span class="text-slate-500">Price <span data-tooltip="Price" class="cursor-help opacity-40">ⓘ</span></span>
              <span class="font-bold text-white">${price}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-slate-500 text-[10px]">Down from High 52</span>
              <span class="font-medium ${priceMoveClass(downFromHigh)}">${downFromHigh}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-slate-500 text-[10px]">Down from Month</span>
              <span class="font-medium ${priceMoveClass(downFromMonth)}">${downFromMonth}</span>
            </div>
          </div>
        </div>

        <!-- Fundamentals & Valuation -->
        <div class="metric-group">
          <div class="section-label"><span>⚖️</span> Valuation</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <div class="flex justify-between border-b border-slate-800/50 pb-0.5">
              <span class="text-slate-500">ROE <span data-tooltip="ROE" class="cursor-help opacity-30">ⓘ</span></span>
              <span class="font-medium text-sky-300">${roe}</span>
            </div>
            <div class="flex justify-between border-b border-slate-800/50 pb-0.5">
              <span class="text-slate-500">PBV <span data-tooltip="PBV" class="cursor-help opacity-30">ⓘ</span></span>
              <span class="font-medium text-violet-300">${pbv}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">PER <span data-tooltip="PER" class="cursor-help opacity-30">ⓘ</span></span>
              <span class="font-medium text-amber-300">${per}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500 text-[10px]">Yield</span>
              <span class="font-medium text-emerald-400">${divYield}</span>
            </div>
          </div>
        </div>

        <!-- Dividend & Growth -->
        <div class="metric-group bg-emerald-500/5 border-emerald-500/10">
          <div class="section-label !text-emerald-500/60"><span>💰</span> Growth & Dividen</div>
          <div class="space-y-1 text-[11px]">
             <div class="flex justify-between">
              <span class="text-slate-500">Div. Growth <span data-tooltip="Dividend Growth" class="cursor-help opacity-30">ⓘ</span></span>
              <span class="font-medium ${divGrowthClass}">${divGrowth}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Payout <span data-tooltip="Payout Ratio" class="cursor-help opacity-30">ⓘ</span></span>
              <span class="font-medium text-slate-300">${payoutRatio}</span>
            </div>
          </div>
        </div>

        ${safetyBadgeHtml}

        <!-- System Verdict -->
        <div class="metric-group bg-sky-500/5 border-sky-500/10 !p-3">
          <div class="section-label !text-sky-500/60 flex justify-between items-baseline">
            <span>🎯 System Verdict</span>
            <span class="text-[9px] font-normal opacity-60">Base vs Final</span>
          </div>
          
          <div class="space-y-2">
            <!-- Main Signal (Base) -->
            <div class="flex justify-between items-center px-2 py-1.5 rounded bg-slate-900/40 border border-slate-800/50">
               <div>
                  <p class="text-[8px] text-slate-500 uppercase tracking-tighter">Base Signal</p>
                  <p class="text-[11px] font-bold text-slate-300">${buyDecision}</p>
               </div>
               <div class="text-right">
                  <p class="text-[8px] text-slate-500 uppercase tracking-tighter">Base Score</p>
                  <p class="text-sm font-black text-slate-400">${hybridScore}</p>
               </div>
            </div>

            <!-- Final Decision (After Filters) -->
            <div class="flex justify-between items-center px-2 py-2 rounded bg-sky-500/10 border border-sky-500/20 shadow-[0_0_15px_-5px_rgba(14,165,233,0.3)]">
               <div>
                  <p class="text-[9px] text-sky-500 uppercase font-black">Final Execution</p>
                  <p class="text-base font-black tracking-tight ${
                    executionDecision === 'BUY' ? 'text-emerald-400' : executionDecision === 'HOLD' ? 'text-amber-400' : 'text-slate-400'
                  }">${executionDecision}</p>
               </div>
               <div class="text-right">
                  <p class="text-[9px] text-sky-500 uppercase font-black">Final Score</p>
                  <p class="text-xl font-black text-white">${finalHybridScore}</p>
               </div>
            </div>
          </div>

          <div class="mt-2 flex justify-between items-center text-[10px] px-1">
             <div class="flex items-center gap-1">
                <span class="text-slate-500">Quality</span>
                <span class="font-bold text-cyan-400">${qualityLabel}</span>
             </div>
             <div class="flex items-center gap-1">
                <span class="text-slate-500 uppercase text-[8px]">Group</span>
                <span class="font-bold text-slate-400">${finalHybridCategory}</span>
             </div>
          </div>
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

// Logic sorting & filter
let currentSort = 'score-desc';
let currentSectorFilter = 'all';

function getSortedAndFilteredTickers() {
  const entries = Array.from(tickerCache.entries());

  // Populate Sector Filter if needed
  const sectors = new Set(['all']);
  entries.forEach(([_, payload]) => {
    const sector = normalizeSectorLabel(payload.stock?.Sector);
    if (sector) sectors.add(sector);
  });
  
  const filterEl = document.getElementById('filter-sector');
  if (filterEl && filterEl.options.length <= 1) { // Only populate if not already populated (or only has 'all')
    const sortedSectors = Array.from(sectors).sort((a, b) => {
      if (a === 'all') return -1; // 'all' always first
      if (b === 'all') return 1;
      return a.localeCompare(b);
    });
    filterEl.innerHTML = sortedSectors.map(sec => 
      `<option value="${sec}">${sec === 'all' ? 'Semua Sektor' : sec}</option>`
    ).join('');
    filterEl.value = currentSectorFilter;
  }

  // Filter
  let filtered = entries;
  if (currentSectorFilter !== 'all') {
    filtered = entries.filter(([_, payload]) => normalizeSectorLabel(payload.stock?.Sector) === currentSectorFilter);
  }

  // Sort
  filtered.sort((a, b) => {
    const sA = a[1].stock;
    const sB = b[1].stock;
    switch (currentSort) {
      case 'ticker-asc': return a[0].localeCompare(b[0]);
      case 'score-desc': return (sB['Final Hybrid Score'] || 0) - (sA['Final Hybrid Score'] || 0);
      case 'score-asc': return (sA['Final Hybrid Score'] || 0) - (sB['Final Hybrid Score'] || 0);
      case 'yield-desc': return (sB['Dividend Yield (%)'] || 0) - (sA['Dividend Yield (%)'] || 0);
      case 'mos-desc': return (sB['MOS (%)'] || 0) - (sA['MOS (%)'] || 0);
      default: return 0;
    }
  });

  return filtered.map(([ticker, payload]) => [ticker, payload.stock]);
}

function updateStatus() {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = `Menampilkan ${tickerCache.size} saham.`;
  }
}

function renderDashboardCards() {
  const container = document.getElementById('stocks-cards');
  if (!container) return;

  const sortedTickers = getSortedAndFilteredTickers();
  
  if (sortedTickers.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center animate-fade-in">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-800 mb-4">
          <span class="text-2xl text-slate-700">🔍</span>
        </div>
        <p class="text-slate-500 text-sm">Tidak ada saham yang ditemukan.</p>
      </div>
    `;
    updateStatus();
    return;
  }

  // Choose renderer based on mode
  const builder = dashboardDisplayMode === 'full' ? buildFullCardHtml : buildCardHtml;
  container.innerHTML = sortedTickers.map(([ticker, stock]) => builder(ticker, stock)).join('');
  
  updateStatus();
  tooltips.init();
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
      const total = tickers.length;
      updateTerminalProgress(total, total);
      appendTerminalLog(`Selesai! Berhasil memproses ${total} saham.`, 'success');
      if (window.showToast) window.showToast(`Update ${total} saham selesai.`, 'success');
      
      // UI feedback selesai
      setTimeout(() => {
        terminalLoader.classList.add('hidden');
        terminalLoader.classList.remove('flex');
      }, 1200);
    }

    renderDashboardCards();
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(tickerCache.entries())));
    } catch(e) {}
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
    if (!silent) {
      renderDashboardCards();
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(tickerCache.entries())));
      } catch(e) {}
    }

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
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached && !sessionStorage.getItem('force-refresh')) {
    try {
      const parsed = JSON.parse(cached);
      tickerCache.clear();
      parsed.forEach(p => tickerCache.set(p[0], p[1]));
      renderDashboardCards();
      // Save to Cache (Convert Map to Object for JSON)
    const cacheObj = {};
    tickerCache.forEach((v, k) => { cacheObj[k] = v; });
    sessionStorage.setItem('tickerCache', JSON.stringify(cacheObj));
    sessionStorage.setItem('last_data_fetch', Date.now().toString());
    sessionStorage.removeItem('force-refresh');

      const statusEl = document.getElementById('status');
      if (statusEl) statusEl.textContent = `Menampilkan ${tickerCache.size} saham (Cached). Klik Refresh untuk update.`;
    } catch(e) {
      loadSavedTickers();
    }
  } else {
    sessionStorage.removeItem('force-refresh');
    loadSavedTickers();
  }

  const input = document.getElementById('ticker-input');
  const button = document.getElementById('ticker-submit');
  // Toolbar Init
  const sortByEl = document.getElementById('sort-by');
  if (sortByEl) {
    sortByEl.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderDashboardCards();
    });
  }
  const sectorFilterEl = document.getElementById('filter-sector');
  if (sectorFilterEl) {
    sectorFilterEl.addEventListener('change', (e) => {
      currentSectorFilter = e.target.value;
      renderDashboardCards();
    });
  }

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
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(tickerCache.entries())));
            } catch(e) {}
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

  const displayModeSelect = document.getElementById('dashboard-display-mode');
  if (displayModeSelect) {
    displayModeSelect.value = dashboardDisplayMode;
    displayModeSelect.addEventListener('change', (e) => {
      dashboardDisplayMode = e.target.value;
      localStorage.setItem(DASHBOARD_DISPLAY_MODE_KEY, dashboardDisplayMode);
      renderDashboardCards();
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
