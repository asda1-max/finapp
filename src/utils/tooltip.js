/**
 * Bilingual Tooltip system for FinApp.
 * Pulls definitions from a centralized dictionary.
 */

const DICTIONARY = {
  'ROE': {
    id: 'Return on Equity: Mengukur kemampuan perusahaan mencetak laba dari modal pemegang saham.',
    en: 'Return on Equity: Measures the company\'s ability to generate profit from shareholders\' equity.'
  },
  'CAGR': {
    id: 'Compound Annual Growth Rate: Laju pertumbuhan tahunan rata-rata (Net Income, Revenue, EPS).',
    en: 'Compound Annual Growth Rate: The average annual growth rate (Net Income, Revenue, EPS).'
  },
  'Dividend Yield': {
    id: 'Persentase dividen dibanding harga saham saat ini.',
    en: 'Percentage of dividend relative to the current stock price.'
  },
  'MOS': {
    id: 'Margin of Safety: Selisih antara harga intrinsik (estimasi) dengan harga pasar saat ini.',
    en: 'Margin of Safety: The difference between the intrinsic (estimated) value and the current market price.'
  },
  'PBV': {
    id: 'Price to Book Value: Membandingkan harga pasar saham dengan nilai bukunya.',
    en: 'Price to Book Value: Compares a stock\'s market price to its book value.'
  },
  'PER': {
    id: 'Price to Earnings Ratio: Membandingkan harga saham dengan laba bersih per saham.',
    en: 'Price to Earnings Ratio: Compares a stock\'s price to its earnings per share.'
  },
  'Quality Score': {
    id: 'Skor kesehatan fundamental berdasarkan profitabilitas, solvabilitas, dan efisiensi.',
    en: 'Fundamental health score based on profitability, solvency, and efficiency.'
  },
  'Discount Score': {
    id: 'Skor tingkat diskon/murahnya harga saham saat ini.',
    en: 'Score representing the discount level or cheapness of the stock price.'
  }
};

class TooltipManager {
  constructor() {
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'fixed hidden z-[10000] p-3 text-[11px] leading-relaxed bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl max-w-xs pointer-events-none transition-opacity duration-200 opacity-0';
    document.body.appendChild(this.tooltipEl);
    this.init();
  }

  init() {
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        this.show(target);
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-tooltip]')) {
        this.hide();
      }
    });
  }

  show(target) {
    const key = target.getAttribute('data-tooltip');
    const content = DICTIONARY[key];
    if (!content) return;

    this.tooltipEl.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center gap-2 border-b border-slate-800 pb-1 mb-1">
          <span class="font-bold text-sky-300 uppercase">${key}</span>
        </div>
        <div class="text-slate-100 italic">"${content.en}"</div>
        <div class="text-slate-400 border-t border-slate-800/50 pt-1">${content.id}</div>
      </div>
    `;

    this.tooltipEl.classList.remove('hidden');
    
    // Position
    const rect = target.getBoundingClientRect();
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    let top = rect.top - tooltipRect.height - 10;

    // Boundary check
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10;
    if (top < 10) top = rect.bottom + 10;

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
    
    requestAnimationFrame(() => {
      this.tooltipEl.style.opacity = '1';
    });
  }

  hide() {
    this.tooltipEl.style.opacity = '0';
    setTimeout(() => {
      if (this.tooltipEl.style.opacity === '0') {
        this.tooltipEl.classList.add('hidden');
      }
    }, 200);
  }
}

export const tooltips = new TooltipManager();
