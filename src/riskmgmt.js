import './index.css';
import { initNavbar } from './navbar.js';
initNavbar();

let selectedProfile = 'balanced';

function formatRupiah(num) {
  if (num == null || Number.isNaN(Number(num))) return '-';
  return `Rp ${Number(num).toLocaleString('id-ID')}`;
}

function buildAllocationCard(alloc) {
  const { ticker, name, bucket, capital_allocated, price, lots, shares, pct_of_total, note, rank, hybrid_score } = alloc;

  const bucketColors = {
    bluechip: 'border-emerald-700/50 bg-emerald-950/30',
    dividend: 'border-sky-700/50 bg-sky-950/30',
    experimental: 'border-rose-700/50 bg-rose-950/30',
  };

  const lotColor = lots > 0 ? 'text-emerald-300' : 'text-slate-500';
  const borderClass = bucketColors[bucket] || 'border-slate-700 bg-slate-900';
  const rankBadge = rank ? `<span class="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">#${rank}</span>` : '';
  const scoreBadge = hybrid_score != null ? `<span class="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-cyan-300">Score ${hybrid_score}</span>` : '';

  return `
    <div class="rounded-xl border ${borderClass} p-3 space-y-1.5">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-1.5">
            ${rankBadge}
            <span class="text-xs font-semibold text-slate-100">${name}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-[10px] text-slate-500 uppercase">${ticker}</span>
            ${scoreBadge}
          </div>
        </div>
        <div class="text-right">
          <div class="text-sm font-bold ${lotColor}">${lots > 0 ? `${lots} lot` : '-'}</div>
          <div class="text-[10px] text-slate-400">${lots > 0 ? `${shares} lembar` : ''}</div>
        </div>
      </div>
      ${lots > 0 ? `
        <div class="flex justify-between text-[10px]">
          <span class="text-slate-400">Harga</span>
          <span class="text-slate-300">${formatRupiah(price)}</span>
        </div>
        <div class="flex justify-between text-[10px]">
          <span class="text-slate-400">Total Beli</span>
          <span class="font-medium text-slate-100">${formatRupiah(capital_allocated)}</span>
        </div>
        <div class="flex justify-between text-[10px]">
          <span class="text-slate-400">% dari Modal</span>
          <span class="text-cyan-300">${pct_of_total}%</span>
        </div>
      ` : ''}
      ${note ? `<div class="text-[10px] text-amber-300/80 mt-1">${note}</div>` : ''}
    </div>
  `;
}

function renderResults(data) {
  const resultsSection = document.getElementById('results-section');
  if (!resultsSection) return;
  resultsSection.classList.remove('hidden');

  // Summary
  document.getElementById('sum-total').textContent = formatRupiah(data.total_capital);
  document.getElementById('sum-investable').textContent = formatRupiah(data.investable_capital);
  document.getElementById('sum-invested').textContent = formatRupiah(data.total_invested);
  document.getElementById('sum-remaining').textContent = formatRupiah(data.total_remaining);

  // Anti-panic
  document.getElementById('panic-message').textContent = data.anti_panic?.message || '';

  // Buckets
  const bucketNames = ['bluechip', 'dividend', 'experimental'];
  for (const b of bucketNames) {
    const bucketData = data.buckets?.[b] || {};
    const pctEl = document.getElementById(`bucket-${b}-pct`);
    const cardsEl = document.getElementById(`bucket-${b}-cards`);
    const emptyEl = document.getElementById(`bucket-${b}-empty`);

    if (pctEl) {
      pctEl.textContent = `${bucketData.pct || 0}% — ${formatRupiah(bucketData.capital || 0)}`;
    }

    const bucketAllocations = (data.allocations || []).filter(a => a.bucket === b);

    if (cardsEl) {
      if (bucketAllocations.length === 0) {
        cardsEl.innerHTML = '';
        if (emptyEl) {
          emptyEl.classList.remove('hidden');
        }
      } else {
        if (emptyEl) emptyEl.classList.add('hidden');
        cardsEl.innerHTML = bucketAllocations.map(a => buildAllocationCard(a)).join('');
      }
    }
  }
}

async function calculateAllocation() {
  const statusEl = document.getElementById('status');
  const capitalInput = document.getElementById('capital-input');
  const calculateBtn = document.getElementById('calculate-btn');

  if (!capitalInput || !statusEl) return;

  const totalCapital = parseFloat(capitalInput.value);
  if (!totalCapital || totalCapital <= 0) {
    statusEl.textContent = 'Masukkan total modal yang valid (> 0).';
    return;
  }

  // Validate custom if selected
  if (selectedProfile === 'custom') {
    const bp = parseFloat(document.getElementById('custom-bluechip')?.value || '0');
    const dp = parseFloat(document.getElementById('custom-dividend')?.value || '0');
    const ep = parseFloat(document.getElementById('custom-experimental')?.value || '0');
    const sum = bp + dp + ep;
    if (Math.abs(sum - 100) > 0.01) {
      statusEl.textContent = `Bluechip + Dividend + Experimental harus = 100%. Sekarang: ${sum}%`;
      return;
    }
  }

  // Disable button
  if (calculateBtn) {
    calculateBtn.disabled = true;
    calculateBtn.textContent = 'Menghitung...';
  }
  statusEl.textContent = 'Mengambil data saham dan menghitung alokasi...';

  try {
    // Get saved tickers from dashboard
    const tickersRes = await fetch('http://127.0.0.1:8000/saved-tickers');
    if (!tickersRes.ok) throw new Error(`HTTP ${tickersRes.status}`);
    const tickersJson = await tickersRes.json();
    const tickers = Array.isArray(tickersJson.tickers) ? tickersJson.tickers : [];

    if (tickers.length === 0) {
      statusEl.textContent = 'Belum ada saham di dashboard. Tambahkan ticker dulu di halaman utama.';
      return;
    }

    const prefVal = document.getElementById('preferred-input')?.value || '';
    const preferredTickers = prefVal.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const blkVal = document.getElementById('blacklisted-input')?.value || '';
    const blacklistedTickers = blkVal.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    // Build request body
    const body = {
      profile: selectedProfile,
      total_capital: totalCapital,
      tickers,
      preferred_tickers: preferredTickers,
      blacklisted_tickers: blacklistedTickers,
    };

    // Add custom fields if custom profile
    if (selectedProfile === 'custom') {
      body.custom_bluechip_pct = parseFloat(document.getElementById('custom-bluechip')?.value || '0');
      body.custom_dividend_pct = parseFloat(document.getElementById('custom-dividend')?.value || '0');
      body.custom_experimental_pct = parseFloat(document.getElementById('custom-experimental')?.value || '0');
      body.custom_cash_reserve_pct = parseFloat(document.getElementById('custom-cash')?.value || '10');
    }

    // Call risk allocation
    const res = await fetch('http://127.0.0.1:8000/risk-allocation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    renderResults(data);
    statusEl.textContent = `Alokasi selesai! Profil: ${data.profile_label} — ${tickers.length} saham dianalisis.`;
  } catch (error) {
    statusEl.textContent = `Gagal menghitung alokasi: ${String(error)}`;
  } finally {
    if (calculateBtn) {
      calculateBtn.disabled = false;
      calculateBtn.textContent = 'Hitung Alokasi';
    }
  }
}

function updateCustomSum() {
  const bp = parseFloat(document.getElementById('custom-bluechip')?.value || '0');
  const dp = parseFloat(document.getElementById('custom-dividend')?.value || '0');
  const ep = parseFloat(document.getElementById('custom-experimental')?.value || '0');
  const sum = bp + dp + ep;
  const el = document.getElementById('custom-sum-val');
  const warnEl = document.getElementById('custom-sum-warning');
  if (el) {
    el.textContent = String(sum);
    if (Math.abs(sum - 100) > 0.01) {
      el.className = 'font-semibold text-rose-400';
      if (warnEl) warnEl.className = 'text-[10px] text-rose-400';
    } else {
      el.className = 'font-semibold text-cyan-300';
      if (warnEl) warnEl.className = 'text-[10px] text-slate-400';
    }
  }
}

function selectProfile(profile) {
  selectedProfile = profile;
  const buttons = document.querySelectorAll('.profile-btn');
  const customInputs = document.getElementById('custom-inputs');

  const profileColors = {
    ultra_conservative: 'border-emerald-500 bg-emerald-950/30',
    conservative: 'border-emerald-500 bg-emerald-950/30',
    conservative_semibalance: 'border-teal-500 bg-teal-950/30',
    balanced: 'border-sky-500 bg-sky-950/30',
    dividend_chaser: 'border-cyan-500 bg-cyan-950/30',
    aggressive: 'border-rose-500 bg-rose-950/30',
    custom: 'border-violet-500 bg-violet-950/30',
  };

  buttons.forEach(btn => {
    const p = btn.getAttribute('data-profile');
    const activeColor = profileColors[p] || 'border-sky-500 bg-sky-950/30';
    if (p === profile) {
      btn.className = `profile-btn rounded-xl border-2 ${activeColor} p-3 text-left transition-all`;
      if (p === 'custom') {
        btn.className = `profile-btn w-full rounded-xl border-2 ${activeColor} p-3 text-left transition-all`;
      }
    } else {
      if (p === 'custom') {
        btn.className = 'profile-btn w-full rounded-xl border-2 border-dashed border-slate-600 bg-slate-950/40 p-3 text-left transition-all hover:border-violet-500';
      } else {
        btn.className = 'profile-btn rounded-xl border-2 border-slate-700 bg-slate-950/60 p-3 text-left transition-all hover:border-sky-500';
      }
    }
  });

  // Show/hide custom inputs
  if (customInputs) {
    if (profile === 'custom') {
      customInputs.classList.remove('hidden');
      updateCustomSum();
    } else {
      customInputs.classList.add('hidden');
    }
  }
}

function init() {
  // Back button
  const backBtn = document.getElementById('back-button');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }

  // Profile buttons
  const profileBtns = document.querySelectorAll('.profile-btn');
  profileBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-profile');
      if (p) selectProfile(p);
    });
  });

  // Calculate button
  const calculateBtn = document.getElementById('calculate-btn');
  if (calculateBtn) {
    calculateBtn.addEventListener('click', calculateAllocation);
  }

  // Enter on capital input
  const capitalInput = document.getElementById('capital-input');
  if (capitalInput) {
    capitalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calculateAllocation();
    });
  }

  // Custom input listeners for live sum validation
  ['custom-bluechip', 'custom-dividend', 'custom-experimental'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCustomSum);
  });

  // Default selection
  selectProfile('balanced');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
