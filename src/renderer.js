import './index.css';
import { initNavbar } from './navbar.js';
initNavbar();

const searchedTickers = new Set();
const tickerCache = new Map();
const DASHBOARD_VIEW_MODE_KEY = 'dashboard-view-mode';

function updateTickerJson() {
  // panel JSON sudah dihapus dari UI, fungsi dibiarkan no-op untuk kompatibilitas.
}

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

function buildCardHtml(ticker, s, options = {}) {
  const { cagrReady = false } = options;
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
  const cagrWarningHtml = cagrReady
    ? ''
    : `
      <div class="mt-1 rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300">
        ⚠️ Warning: data CAGR belum diinput. Isi di halaman detailed untuk akurasi decision yang lebih baik.
      </div>
    `;

  return `
    <article
      class="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 sm:p-4 shadow-sm shadow-slate-900/70 cursor-pointer hover:border-sky-500 hover:bg-slate-900"
      data-ticker="${ticker}"
    >
      <header class="mb-2 flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1 pr-1">
          <h2 class="text-sm font-semibold leading-tight text-slate-50 truncate" title="${name}">${name}</h2>
          <p class="mt-0.5 text-[10px] uppercase text-slate-500">${ticker}</p>
          <p class="mt-0.5 text-[10px] text-slate-500">Sector: ${sector}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <span class="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-emerald-300">MOS ${mos}</span>
          <button
            type="button"
            data-delete-ticker="${ticker}"
            class="rounded-md border border-rose-700/60 bg-rose-950/40 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:border-rose-500 hover:text-rose-200"
            title="Hapus entry"
          >
            Hapus
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
        <hr class="my-1 border-slate-800" />
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
        ${cagrWarningHtml}
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
      const html = buildCardHtml(ticker, payload.stock, { cagrReady: payload.cagrReady });
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
      const html = buildCardHtml(row.ticker, row.payload.stock, { cagrReady: row.payload.cagrReady });
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

    for (const t of tickers) {
      await loadSingleTicker(t, { skipSave: true });
    }

    renderDashboardCards();
    statusEl.textContent = `Menampilkan ${tickers.length} saham dari data.json.`;
  } catch (error) {
    statusEl.textContent = `Gagal memuat saham tersimpan: ${String(error)}`;
  }
}
async function loadSingleTicker(tickerRaw, options = {}) {
  const ticker = (tickerRaw || '').trim();
  const { skipSave = false } = options;
  const statusEl = document.getElementById('status');
  const cardsEl = document.getElementById('stocks-cards');

  if (!statusEl || !cardsEl) return;

  if (!ticker) {
    statusEl.textContent = 'Masukkan ticker terlebih dahulu, misal: BBCA.JK';
    return;
  }

  try {
    statusEl.textContent = `Memuat data untuk ${ticker}...`;

    const url = `http://127.0.0.1:8000/stocks?tickers=${encodeURIComponent(ticker)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      statusEl.textContent = `Tidak ada data untuk ticker ${ticker}.`;
      return;
    }

    const s = data[0];

    if (isLikelyInvalidTicker(s, ticker)) {
      statusEl.textContent = `Ticker ${ticker} tidak valid / data tidak ditemukan.`;
      return;
    }

    // Cek apakah user sudah menginput CAGR untuk ticker ini
    let cagrReady = false;
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

        cagrReady = annualReady || directReady;
      }
    } catch (e) {
      cagrReady = false;
    }

    tickerCache.set(ticker, { stock: s, cagrReady });
    renderDashboardCards();

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

    statusEl.textContent = `Berhasil menambahkan card untuk ${ticker}.`;
  } catch (error) {
    statusEl.textContent = `Gagal mengambil data untuk ${ticker}: ${String(error)}`;
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
      const url = `/detailed.html?ticker=${encodeURIComponent(t)}`;
      window.location.href = url;
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
