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
    FUZZY_AHP_TOPSIS: 'Hybrid • Final Decision',
    TOPSIS: 'TOPSIS • Relative Quality Score',
    SAW: 'SAW • Growth Score',
    AHP: 'AHP • Growth Score (weighted)',
    VIKOR: 'VIKOR • Regret Score',
  };
  return map[key] || key;
}

function methodSignal(method, decision) {
  const d = String(decision || '-').toUpperCase();
  if (method === 'FUZZY_AHP_TOPSIS') return d === 'BUY' ? 'BUY' : 'NO BUY';
  return d === 'BUY' ? 'Pass' : 'Watch';
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

function cagrReliabilityInfo(item) {
  const years = Number(item?.cagr_years);
  const nearZero = Boolean(item?.cagr_all_zero);

  if (Number.isNaN(years) || years <= 0) {
    return { label: '⚠️ Insufficient', className: 'text-rose-300', asterisk: true };
  }

  if (years <= 2) {
    if (nearZero) {
      return {
        label: '⚠️ Low reliability (2 titik, CAGR ~0)',
        className: 'text-rose-300',
        asterisk: true,
      };
    }
    return { label: '⚠️ Low reliability (2 titik)', className: 'text-amber-300', asterisk: true };
  }

  if (years < 5) {
    return { label: 'Medium reliability', className: 'text-amber-300', asterisk: false };
  }

  return { label: 'High reliability', className: 'text-emerald-300', asterisk: false };
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
        <td colspan="19" class="px-2 py-3 text-center text-slate-400">Belum ada ticker yang bisa diranking. Isi CAGR dulu di detailed page.</td>
      </tr>
    `;
  } else {
    ranked.forEach((it, idx) => {
      const scoreObj = it?.scores?.[method] || {};
      const yearsLabel = cagrYearsLabel(it?.cagr_years, it?.cagr);
      const reliability = cagrReliabilityInfo(it);
      const signal = methodSignal(method, scoreObj.decision);
      const signalClass =
        signal === 'BUY' || signal === 'Pass'
          ? 'text-emerald-300'
          : signal === 'Watch'
            ? 'text-amber-300'
            : 'text-slate-400';
      const category = method === 'FUZZY_AHP_TOPSIS' ? scoreObj.category || '-' : '-';
      const tickerLabel = `${it.ticker || '-'}${reliability.asterisk ? ' *' : ''}`;
      const tr = document.createElement('tr');
      tr.className = 'cursor-pointer hover:bg-slate-800/40';
      tr.setAttribute('data-ticker', it.ticker || '');
      tr.innerHTML = `
        <td class="px-2 py-2">${idx + 1}</td>
        <td class="px-2 py-2 font-medium">${tickerLabel}</td>
        <td class="px-2 py-2">${it.name || '-'}</td>
        <td class="px-2 py-2 text-slate-300">${it.sector || '-'}</td>
        <td class="px-2 py-2 uppercase text-[10px] text-slate-300">${it.input_mode || '-'}</td>
        <td class="px-2 py-2 text-right">${it.cagr_years || '-'}</td>
        <td class="px-2 py-2 ${reliability.className}">${reliability.label}<div class="text-[10px] text-slate-500">${yearsLabel}</div></td>
        <td class="px-2 py-2 text-right text-cyan-300">${formatScore(scoreObj.score)}</td>
        <td class="px-2 py-2 ${signalClass}">${signal}</td>
        <td class="px-2 py-2 text-amber-300">${category}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.mos_pct)}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.div_yield_pct)}</td>
        <td class="px-2 py-2 text-right text-cyan-300">${formatScore(it?.quality_score)}</td>
        <td class="px-2 py-2 text-emerald-300">${it?.quality_label || '-'}</td>
        <td class="px-2 py-2 text-right text-cyan-300">${formatScore(it?.discount_score)}</td>
        <td class="px-2 py-2 text-amber-300">${it?.timing_verdict || '-'}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.cagr?.net_income)}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.cagr?.eps)}</td>
        <td class="px-2 py-2 text-right">${formatPercent(it?.cagr?.revenue)}</td>
      `;
      body.appendChild(tr);
    });
  }

  if (summary) {
    summary.textContent = `Method: ${methodLabel(method)} • Ranked: ${payload?.ranked_count || 0} • Unranked/Excluded: ${payload?.unranked_count || 0} • Total Saved: ${payload?.total_saved || 0} • Note: tanda * = reliability rendah`;
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
