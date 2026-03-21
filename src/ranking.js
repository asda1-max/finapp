import './index.css';

let rankingPayload = null;

function formatPercent(v) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return `${Number(v).toFixed(2)}%`;
}

function formatScore(v) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(3);
}

function methodLabel(key) {
  const map = {
    FUZZY_AHP_TOPSIS: 'Hybrid Fuzzy AHP-TOPSIS',
    TOPSIS: 'TOPSIS',
    SAW: 'SAW',
    AHP: 'AHP',
    VIKOR: 'VIKOR',
  };
  return map[key] || key;
}

function cagrYearsLabel(years, cagr) {
  const y = Number(years);
  if (Number.isNaN(y) || y <= 0) return 'Belum cukup data';

  if (y === 2) return 'cagr dapat berubah tahun ini';
  if (y >= 3 && y < 5) return 'seimbang';
  if (y >= 5 && y <= 10) return 'Sangat seimbang';

  if (y > 10) {
    const ni = Number(cagr?.net_income);
    const eps = Number(cagr?.eps);
    const rev = Number(cagr?.revenue);
    const vals = [ni, eps, rev].filter((v) => !Number.isNaN(v));
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    // "pertumbuhan super kecil" diasumsikan rata-rata CAGR <= 3%
    if (avg <= 3) return 'seimbang tapi tumbuhnya lambat banget';
    return 'super seimbang';
  }

  return 'Belum cukup data';
}

function renderUnranked(items) {
  const body = document.getElementById('unranked-body');
  if (!body) return;
  body.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="4" class="px-2 py-3 text-center text-slate-400">Semua ticker sudah punya input CAGR.</td>
      </tr>
    `;
    return;
  }

  items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-2 py-2">${idx + 1}</td>
      <td class="px-2 py-2 font-medium">${it.ticker || '-'}</td>
      <td class="px-2 py-2">${it.name || '-'}</td>
      <td class="px-2 py-2 text-amber-300">${it.reason || 'CAGR belum lengkap'}</td>
    `;
    body.appendChild(tr);
  });
}

function renderRanked(payload) {
  const body = document.getElementById('ranked-body');
  const methodEl = document.getElementById('method-select');
  const orderEl = document.getElementById('order-select');
  const summary = document.getElementById('summary');
  if (!body || !methodEl || !orderEl) return;

  const method = methodEl.value || 'FUZZY_AHP_TOPSIS';
  const order = orderEl.value || 'desc';

  const ranked = Array.isArray(payload?.ranked) ? [...payload.ranked] : [];

  ranked.sort((a, b) => {
    const sa = Number(a?.scores?.[method]?.score);
    const sb = Number(b?.scores?.[method]?.score);
    const va = Number.isNaN(sa) ? -Infinity : sa;
    const vb = Number.isNaN(sb) ? -Infinity : sb;
    return order === 'asc' ? va - vb : vb - va;
  });

  body.innerHTML = '';

  if (ranked.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="12" class="px-2 py-3 text-center text-slate-400">Belum ada ticker yang bisa diranking. Isi CAGR dulu di detailed page.</td>
      </tr>
    `;
  } else {
    ranked.forEach((it, idx) => {
      const scoreObj = it?.scores?.[method] || {};
      const yearsLabel = cagrYearsLabel(it?.cagr_years, it?.cagr);
      const tr = document.createElement('tr');
      tr.className = 'cursor-pointer hover:bg-slate-800/40';
      tr.setAttribute('data-ticker', it.ticker || '');
      tr.innerHTML = `
        <td class="px-2 py-2">${idx + 1}</td>
        <td class="px-2 py-2 font-medium">${it.ticker || '-'}</td>
        <td class="px-2 py-2">${it.name || '-'}</td>
        <td class="px-2 py-2 uppercase text-[10px] text-slate-300">${it.input_mode || '-'}</td>
        <td class="px-2 py-2 text-right">${it.cagr_years || '-'}</td>
        <td class="px-2 py-2 text-amber-300">${yearsLabel}</td>
        <td class="px-2 py-2 text-right text-cyan-300">${formatScore(scoreObj.score)}</td>
        <td class="px-2 py-2 ${scoreObj.decision === 'BUY' ? 'text-emerald-300' : 'text-slate-400'}">${scoreObj.decision || '-'}</td>
        <td class="px-2 py-2 text-amber-300">${scoreObj.category || '-'}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.cagr?.net_income)}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.cagr?.eps)}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.cagr?.revenue)}</td>
      `;
      body.appendChild(tr);
    });
  }

  if (summary) {
    summary.textContent = `Method: ${methodLabel(method)} • Ranked: ${payload?.ranked_count || 0} • Unranked: ${payload?.unranked_count || 0} • Total Saved: ${payload?.total_saved || 0}`;
  }
}

async function loadRanking() {
  const summary = document.getElementById('summary');
  if (summary) summary.textContent = 'Memuat data ranking...';

  try {
    const res = await fetch('http://127.0.0.1:8000/ranking-data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    rankingPayload = await res.json();
    renderRanked(rankingPayload);
    renderUnranked(rankingPayload?.unranked || []);
  } catch (err) {
    if (summary) summary.textContent = `Gagal memuat ranking: ${String(err)}`;
  }
}

function init() {
  const backBtn = document.getElementById('back-button');
  const methodEl = document.getElementById('method-select');
  const orderEl = document.getElementById('order-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const rankedBody = document.getElementById('ranked-body');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }

  if (methodEl) {
    methodEl.addEventListener('change', () => {
      if (rankingPayload) renderRanked(rankingPayload);
    });
  }

  if (orderEl) {
    orderEl.addEventListener('change', () => {
      if (rankingPayload) renderRanked(rankingPayload);
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadRanking();
    });
  }

  if (rankedBody) {
    rankedBody.addEventListener('click', (event) => {
      const tr = event.target.closest('tr[data-ticker]');
      if (!tr) return;
      const ticker = tr.getAttribute('data-ticker');
      if (!ticker) return;
      window.location.href = `/detailed.html?ticker=${encodeURIComponent(ticker)}`;
    });
  }

  loadRanking();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
