import { initNavbar } from './navbar.js';
import { toast } from './utils/toast.js';
import { tooltips } from './utils/tooltip.js';
initNavbar();

const CRITERIA = [
  'ROE',
  'Net Income CAGR',
  'Dividend Yield',
  'MOS',
  'PBV Score',
  'PER Score',
  'Revenue CAGR',
  'EPS CAGR',
];

const DEFAULT_CONFIG = {
  use_cagr: {
    weights: [0.18, 0.06, 0.12, 0.2, 0.15, 0.15, 0.08, 0.12],
    recommended: 0.52,
    buy: 0.44,
    risk: 0.34,
  },
  no_cagr: {
    weights: [0.2, 0, 0.1, 0.3, 0.2, 0.2, 0, 0],
    recommended: 0.655,
    buy: 0.555,
    risk: 0.455,
  },
};

const PRESETS = {
  dividend: {
    use_cagr: [0.30, 0.05, 0.40, 0.10, 0.05, 0.05, 0.00, 0.05],
    no_cagr:  [0.40, 0.00, 0.50, 0.05, 0.05, 0.00, 0.00, 0.00]
  },
  value: {
    use_cagr: [0.15, 0.05, 0.05, 0.30, 0.20, 0.20, 0.00, 0.05],
    no_cagr:  [0.15, 0.00, 0.05, 0.40, 0.20, 0.20, 0.00, 0.00]
  },
  growth: {
    use_cagr: [0.15, 0.20, 0.00, 0.15, 0.05, 0.05, 0.20, 0.20],
    no_cagr:  [0.50, 0.00, 0.00, 0.20, 0.15, 0.15, 0.00, 0.00]
  }
};

function getStatusEl() {
  return document.getElementById('status');
}

function setStatus(text, tone = 'muted') {
  const el = getStatusEl();
  if (!el) return;
  el.textContent = text;
  el.className =
    tone === 'error'
      ? 'text-xs text-rose-300'
      : tone === 'ok'
        ? 'text-xs text-emerald-300'
        : 'text-xs text-slate-400';
}

function renderWeightRows(containerId, mode, weights) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  CRITERIA.forEach((name, idx) => {
    const row = document.createElement('label');
    row.className = 'flex items-center justify-between gap-2 text-[11px] text-slate-300';
    row.innerHTML = `
      <span class="flex items-center gap-1">
        ${idx + 1}. ${name}
        <span data-tooltip="${name}" class="text-[9px] opacity-30 cursor-help">ⓘ</span>
      </span>
      <input
        type="number"
        step="any"
        data-mode="${mode}"
        data-index="${idx}"
        value="${Number(weights[idx] ?? 0)}"
        class="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-xs"
      />
    `;
    container.appendChild(row);
  });
}

function readWeights(mode) {
  const inputs = Array.from(document.querySelectorAll(`input[data-mode="${mode}"]`));
  return inputs.map((el) => Number(el.value));
}

function updateSum(mode) {
  const weights = readWeights(mode);
  const sum = weights.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
  const sumEl = document.getElementById(mode === 'use_cagr' ? 'use-cagr-sum' : 'no-cagr-sum');
  if (!sumEl) return;
  sumEl.textContent = Number.isFinite(sum) ? sum.toFixed(4) : '-';
  sumEl.className =
    Number.isFinite(sum) && sum > 0
      ? 'font-semibold text-cyan-300'
      : 'font-semibold text-rose-300';
}

function fillForm(data) {
  const useCfg = data?.use_cagr || DEFAULT_CONFIG.use_cagr;
  const noCfg = data?.no_cagr || DEFAULT_CONFIG.no_cagr;

  renderWeightRows('use-cagr-weights', 'use_cagr', useCfg.weights || DEFAULT_CONFIG.use_cagr.weights);
  renderWeightRows('no-cagr-weights', 'no_cagr', noCfg.weights || DEFAULT_CONFIG.no_cagr.weights);

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  setValue('use-cagr-recommended', useCfg.recommended ?? DEFAULT_CONFIG.use_cagr.recommended);
  setValue('use-cagr-buy', useCfg.buy ?? DEFAULT_CONFIG.use_cagr.buy);
  setValue('use-cagr-risk', useCfg.risk ?? DEFAULT_CONFIG.use_cagr.risk);

  setValue('no-cagr-recommended', noCfg.recommended ?? DEFAULT_CONFIG.no_cagr.recommended);
  setValue('no-cagr-buy', noCfg.buy ?? DEFAULT_CONFIG.no_cagr.buy);
  setValue('no-cagr-risk', noCfg.risk ?? DEFAULT_CONFIG.no_cagr.risk);

  updateSum('use_cagr');
  updateSum('no_cagr');

  document.querySelectorAll('input[data-mode]').forEach((input) => {
    input.addEventListener('input', () => {
      updateSum(input.dataset.mode);
    });
  });
}

function readModeConfig(mode) {
  const pref = mode === 'use_cagr' ? 'use-cagr' : 'no-cagr';
  return {
    weights: readWeights(mode),
    recommended: Number(document.getElementById(`${pref}-recommended`)?.value),
    buy: Number(document.getElementById(`${pref}-buy`)?.value),
    risk: Number(document.getElementById(`${pref}-risk`)?.value),
  };
}

function validateModeConfig(modeCfg, label) {
  if (!Array.isArray(modeCfg.weights) || modeCfg.weights.length !== 8) {
    throw new Error(`${label}: jumlah bobot harus 8`);
  }
  const invalid = modeCfg.weights.some((w) => Number.isNaN(w) || w < 0);
  if (invalid) {
    throw new Error(`${label}: bobot tidak valid (harus angka >= 0)`);
  }
  const sum = modeCfg.weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) {
    throw new Error(`${label}: total bobot harus > 0`);
  }

  const rec = Number(modeCfg.recommended);
  const buy = Number(modeCfg.buy);
  const risk = Number(modeCfg.risk);
  if ([rec, buy, risk].some((v) => Number.isNaN(v) || v < 0 || v > 1)) {
    throw new Error(`${label}: threshold harus di range 0..1`);
  }
  if (!(risk <= buy && buy <= rec)) {
    throw new Error(`${label}: harus memenuhi risk <= buy <= recommended`);
  }
}

async function loadConfig() {
  setStatus('Memuat config...');
  try {
    const res = await fetch('http://127.0.0.1:8000/hybrid-config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    fillForm(json);
    if (window.showToast) window.showToast('Config berhasil dimuat.', 'success');
    setStatus('Config berhasil dimuat.', 'ok');
  } catch (err) {
    fillForm(DEFAULT_CONFIG);
    if (window.showToast) window.showToast('Gagal memuat config API.', 'error');
    setStatus(`Gagal memuat config API, pakai default. (${String(err)})`, 'error');
  }
}

async function saveConfig() {
  try {
    const useCfg = readModeConfig('use_cagr');
    const noCfg = readModeConfig('no_cagr');

    validateModeConfig(useCfg, 'use_cagr');
    validateModeConfig(noCfg, 'no_cagr');

    setStatus('Menyimpan config...');

    const res = await fetch('http://127.0.0.1:8000/hybrid-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ use_cagr: useCfg, no_cagr: noCfg }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    if (window.showToast) window.showToast('Configuration Saved!', 'success');
    setStatus('Config berhasil disimpan.', 'ok');
  } catch (err) {
    if (window.showToast) window.showToast(`Error: ${err.message}`, 'error');
    setStatus(`Gagal simpan config: ${String(err)}`, 'error');
  }
}

function init() {
  const backBtn = document.getElementById('back-button');
  const resetBtn = document.getElementById('reset-default-btn');
  const saveBtn = document.getElementById('save-btn');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      fillForm(DEFAULT_CONFIG);
      setStatus('Form di-reset ke default (belum tersimpan).');
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveConfig();
    });
  }

  const applyPreset = (presetName, label) => {
    const p = PRESETS[presetName];
    if (!p) return;
    
    // Set into inputs directly so users can see immediately
    const setWeights = (mode, wArray) => {
      const inputs = Array.from(document.querySelectorAll(`input[data-mode="${mode}"]`));
      inputs.forEach((input, i) => {
        if (wArray[i] !== undefined) {
          input.value = wArray[i];
        }
      });
      updateSum(mode);
    };

    setWeights('use_cagr', p.use_cagr);
    setWeights('no_cagr', p.no_cagr);

    setStatus(`Preset ${label} diterapkan (belum tersimpan).`, 'ok');
  };

  const btnDiv = document.getElementById('preset-dividend-btn');
  if (btnDiv) btnDiv.addEventListener('click', () => applyPreset('dividend', 'Dividend Chaser'));

  const btnVal = document.getElementById('preset-value-btn');
  if (btnVal) btnVal.addEventListener('click', () => applyPreset('value', 'Value Champion'));

  const btnGrp = document.getElementById('preset-growth-btn');
  if (btnGrp) btnGrp.addEventListener('click', () => applyPreset('growth', 'Growth Aggressive'));

  loadConfig();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
