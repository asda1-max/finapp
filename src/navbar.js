/**
 * Shared navbar component for all pages.
 * Import and call initNavbar() to inject the navbar.
 */

const NAV_ITEMS = [
  { href: 'index.html', label: 'Dashboard', id: 'dashboard', icon: '📊' },
  { href: 'ranking.html', label: 'Ranking', id: 'ranking', icon: '🏆' },
  { href: 'riskmgmt.html', label: 'Risk Mgmt', id: 'riskmgmt', icon: '🛡️' },
  { href: 'config.html', label: 'Config', id: 'config', icon: '⚙️' },
];

export function initNavbar() {
  // Determine active page from current URL
  const path = window.location.pathname;
  let activeId = 'dashboard';
  for (const item of NAV_ITEMS) {
    if (path.endsWith(item.href.replace('/', '')) || path.endsWith(item.href)) {
      activeId = item.id;
      break;
    }
  }

  // Build nav links
  const links = NAV_ITEMS.map(item => {
    const isActive = item.id === activeId;
    const activeClass = isActive
      ? 'border-sky-500 text-sky-300 bg-sky-950/40 shadow-[0_2px_8px_-2px_rgba(56,189,248,0.3)]'
      : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600 hover:bg-slate-800/30';
    return `<a href="${item.href}" class="relative px-3 py-1.5 text-xs font-medium border-b-2 transition-all duration-200 rounded-t-md flex items-center gap-1.5 ${activeClass}">
      <span class="text-[11px]">${item.icon}</span>
      <span>${item.label}</span>
      ${isActive ? '<span class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-[2px] bg-sky-400 rounded-full blur-sm"></span>' : ''}
    </a>`;
  }).join('');

  // Inject gradient accent line at top of page
  const accentLine = document.createElement('div');
  accentLine.className = 'gradient-accent-top';
  document.body.insertBefore(accentLine, document.body.firstChild);

  const navbar = document.createElement('nav');
  navbar.id = 'app-navbar';
  navbar.className = 'sticky top-[2px] z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl transition-all duration-300';
  navbar.innerHTML = `
    <div class="mx-auto max-w-screen-2xl flex items-center justify-between px-4 py-2.5 gap-4">
      <div class="flex items-center gap-6 flex-shrink-0">
        <a href="/index.html" class="flex items-center gap-2.5 group">
          <div class="relative flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500/20 to-violet-500/20 border border-sky-500/20 group-hover:border-sky-400/40 transition-all duration-300">
            <svg class="w-4 h-4 text-sky-400 group-hover:text-sky-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
            </svg>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-bold tracking-tight text-slate-100 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-sky-300 group-hover:to-violet-300 transition-all duration-300">Finapp</span>
            <span class="text-[8px] font-medium text-slate-600 leading-none">by Azeroth</span>
          </div>
        </a>
      </div>

      <!-- Search Bar -->
      <div class="relative flex-1 max-w-md hidden md:block group">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span class="text-xs text-slate-500 group-focus-within:text-sky-400 transition-colors">🔍</span>
        </div>
        <input 
          id="nav-search-input"
          type="text" 
          placeholder="Cari ticker (misal: BBCA)..."
          class="w-full bg-slate-900/50 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 focus:bg-slate-900 transition-all"
        />
        <div id="nav-search-results" class="absolute top-full left-0 right-0 mt-2 hidden bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50"></div>
      </div>

      <div class="flex items-center gap-4">
        <div class="flex items-center gap-0.5">
          ${links}
        </div>

        <!-- Market Status Indicator -->
        <div id="market-status-indicator" class="flex items-center gap-2 px-2 py-1 rounded-full bg-slate-900/40 border border-slate-800/60 transition-all hover:border-slate-700 group cursor-help">
          <div id="status-dot" class="status-pulse"></div>
          <span id="status-time" class="text-[9px] font-medium text-slate-500 group-hover:text-slate-300 transition-colors uppercase tracking-wider">Syncing...</span>
        </div>
      </div>
    </div>
  `;

  // Search Logic
  const searchInput = navbar.querySelector('#nav-search-input');
  const searchResults = navbar.querySelector('#nav-search-results');

  if (searchInput && searchResults) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toUpperCase();
      if (!q) {
        searchResults.classList.add('hidden');
        return;
      }

      // Try to get tickers from tickerCache (renderer.js saves it there)
      let tickers = [];
      try {
        const cached = sessionStorage.getItem('tickerCache');
        if (cached) {
          const parsed = JSON.parse(cached);
          tickers = Object.keys(parsed).map(symbol => ({ 
            ticker: symbol, 
            name: parsed[symbol].name || symbol 
          }));
        }
      } catch (e) {}

      const matches = tickers.filter(t => t.ticker.includes(q) || t.name.toUpperCase().includes(q)).slice(0, 5);
      
      if (matches.length > 0) {
        searchResults.innerHTML = matches.map(m => `
          <div class="search-item px-4 py-2 hover:bg-sky-500/10 cursor-pointer border-b border-slate-800/50 last:border-0 transition-colors flex items-center justify-between" data-ticker="${m.ticker}">
            <div class="flex flex-col">
              <span class="text-xs font-bold text-slate-200">${m.ticker}</span>
              <span class="text-[9px] text-slate-500">${m.name}</span>
            </div>
            <span class="text-[10px] text-sky-500">→</span>
          </div>
        `).join('');
        searchResults.classList.remove('hidden');

        searchResults.querySelectorAll('.search-item').forEach(item => {
          item.onclick = () => {
            window.location.href = `detailed.html?ticker=${item.dataset.ticker}`;
          };
        });
      } else {
        searchResults.classList.add('hidden');
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!navbar.contains(e.target)) {
        searchResults.classList.add('hidden');
      }
    });
  }

  // Market Status Logic
  const updateMarketStatus = () => {
    const timeEl = navbar.querySelector('#status-time');
    const dotEl = navbar.querySelector('#status-dot');
    if (!timeEl || !dotEl) return;

    try {
      const lastFresh = sessionStorage.getItem('last_data_fetch');
      if (lastFresh) {
        const diffMs = Date.now() - parseInt(lastFresh);
        const mins = Math.floor(diffMs / 60000);
        
        if (mins < 5) {
          timeEl.textContent = 'Live Data';
          dotEl.className = 'status-pulse'; // Green
        } else {
          timeEl.textContent = `${mins}m ago`;
          dotEl.className = 'status-pulse bg-amber-500'; // Amber
          dotEl.style.background = '#f59e0b';
        }
      } else {
        timeEl.textContent = 'No Data';
        dotEl.style.background = '#64748b';
      }
    } catch (e) {}
  };

  updateMarketStatus();
  setInterval(updateMarketStatus, 10000);

  // Insert after accent line
  document.body.insertBefore(navbar, accentLine.nextSibling);

  // Add border glow on scroll
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      if (window.scrollY > 10) {
        navbar.classList.add('shadow-lg', 'shadow-slate-950/50');
        navbar.style.borderBottomColor = 'rgba(56, 189, 248, 0.1)';
      } else {
        navbar.classList.remove('shadow-lg', 'shadow-slate-950/50');
        navbar.style.borderBottomColor = '';
      }
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}
