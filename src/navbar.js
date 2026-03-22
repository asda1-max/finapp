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
    <div class="mx-auto max-w-screen-2xl flex items-center justify-between px-4 py-2.5">
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
      <div class="flex items-center gap-0.5">
        ${links}
      </div>
    </div>
  `;

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
