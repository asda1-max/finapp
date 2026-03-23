/**
 * Bilingual Tooltip system for FinApp.
 * Pulls definitions from a centralized dictionary.
 */

const DICTIONARY = {
  'ROE': {
    id: 'Return on Equity: Mengukur seberapa efisien perusahaan menghasilkan laba dari modal sendiri.',
    en: 'Return on Equity: Measures how efficiently a company generates profit from shareholders\' equity.'
  },
  'CAGR': {
    id: 'Compound Annual Growth Rate: Laju pertumbuhan tahunan rata-rata (Laba, Pendapatan, EPS).',
    en: 'Compound Annual Growth Rate: The average annual growth rate (Net Income, Revenue, EPS).'
  },
  'Dividend Yield': {
    id: 'Hasil Dividen: Persentase dividen tahunan dibanding harga saham saat ini.',
    en: 'Dividend Yield: Percentage of annual dividend relative to the current stock price.'
  },
  'MOS': {
    id: 'Margin of Safety: Selisih antara harga intrinsik (Fair Value) dengan harga pasar saat ini.',
    en: 'Margin of Safety: The difference between the intrinsic (Fair Value) and the current market price.'
  },
  'PBV': {
    id: 'Price to Book Value: Rasio harga pasar saham dibandingkan dengan nilai buku per lembar.',
    en: 'Price to Book Value: Compares a stock\'s market price to its book value per share.'
  },
  'PER': {
    id: 'Price to Earnings Ratio: Membandingkan harga saham dengan laba bersih per saham (EPS).',
    en: 'Price to Earnings Ratio: Compares a stock\'s price to its earnings per share (EPS).'
  },
  'Quality Score': {
    id: 'Skor Kualitas: Peringkat kesehatan fundamental (profitabilitas, solvabilitas, efisiensi).',
    en: 'Quality Score: Fundamental health rating (profitability, solvency, efficiency).'
  },
  'Discount Score': {
    id: 'Skor Diskon: Menunjukkan seberapa murah harga saham saat ini dibanding nilai wajarnya.',
    en: 'Discount Score: Indicates how cheap the stock is relative to its fair value.'
  },
  'Price': {
    id: 'Harga pasar terakhir saham yang tercatat.',
    en: 'The last recorded market price of the stock.'
  },
  'Revenue Annual (Prev)': {
    id: 'Total pendapatan perusahaan dalam satu tahun laporan terakhir.',
    en: 'The company\'s total revenue in the last reported fiscal year.'
  },
  'EPS NOW': {
    id: 'Earnings Per Share: Laba bersih per lembar saham pada saat ini.',
    en: 'Earnings Per Share: Current net income per share of outstanding stock.'
  },
  'HIGH 52': {
    id: 'Harga tertinggi saham dalam kurun waktu 52 minggu terakhir.',
    en: 'The highest price the stock has reached in the last 52 weeks.'
  },
  'LOW 52': {
    id: 'Harga terendah saham dalam kurun waktu 52 minggu terakhir.',
    en: 'The lowest price the stock has reached in the last 52 weeks.'
  },
  'Shares': {
    id: 'Jumlah total lembar saham perusahaan yang beredar di publik.',
    en: 'The total number of a company\'s outstanding shares.'
  },
  'Market Cap': {
    id: 'Market Capitalization: Total nilai pasar perusahaan (Harga x Jumlah Saham).',
    en: 'Market Capitalization: The total market value of a company (Price x Total Shares).'
  },
  'Down From High 52': {
    id: 'Persentase penurunan harga saat ini dari titik tertingginya dalam setahun.',
    en: 'Percentage drop from the stock\'s 52-week high price.'
  },
  'Down From This Month': {
    id: 'Persentase penurunan harga saham dibandingkan harga awal bulan ini.',
    en: 'Percentage drop from the stock\'s price at the beginning of this month.'
  },
  'BVP Per S': {
    id: 'Book Value Per Share: Nilai aset bersih perusahaan per lembar saham.',
    en: 'Book Value Per Share: The net asset value of a company per outstanding share.'
  },
  'Graham Number': {
    id: 'Angka Graham: Rumus nilai wajar konservatif (akar dari 22.5 x EPS x BVPS).',
    en: 'Graham Number: Conservative fair value formula (sqrt of 22.5 * EPS * BVPS).'
  },
  'Dividend Growth': {
    id: 'Laju kenaikan dividen tahunan rata-rata dalam beberapa periode terakhir.',
    en: 'The average annual percentage increase in a stock\'s dividend.'
  },
  'Payout Ratio': {
    id: 'Rasio Pembayaran: Persentase laba bersih yang dibagikan sebagai dividen.',
    en: 'Payout Ratio: The percentage of net income paid out as dividends to shareholders.'
  },
  'Payout Penalty': {
    id: 'Penalti Pembayaran: Pengurangan skor jika rasio pembayaran dividen terlalu tinggi (>85%).',
    en: 'Payout Penalty: Score reduction if the dividend payout ratio is too high (>85%).'
  },
  'Base Signal': {
    id: 'Sinyal dasar berdasarkan perhitungan Hybrid Score awal.',
    en: 'The baseline signal derived from the initial Hybrid Score calculation.'
  },
  'Final Signal': {
    id: 'Sinyal akhir setelah mempertimbangkan filter kualitas dan performa detail.',
    en: 'The final signal after quality filters and detailed performance checks.'
  },
  'Final Execution': {
    id: 'Keputusan final sistem: BUY, HOLD, atau NO BUY.',
    en: 'The final system decision: BUY, HOLD, or NO BUY.'
  },
  'Quality Label': {
    id: 'Label Kualitas: Klasifikasi kualitas perusahaan (Premium, Mid, Low).',
    en: 'Quality Label: Classification of company quality (Premium, Mid, Low).'
  },
  'Safety Check': {
    id: 'Pemeriksaan Solvabilitas: Menilai risiko kebangkrutan atau beban hutang berlebih.',
    en: 'Solvency Check: Assesses bankruptcy risk or excessive debt burden.'
  },
  'Timing Verdict': {
    id: 'Analisis Waktu: Menilai apakah harga saat ini sudah cukup diskon untuk masuk.',
    en: 'Timing Analysis: Assesses if the current price is discounted enough for entry.'
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
