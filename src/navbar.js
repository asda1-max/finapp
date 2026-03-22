/**
 * Shared navbar component for all pages.
 * Import and call initNavbar() to inject the navbar.
 */

const NAV_ITEMS = [
  { href: '/index.html', label: 'Dashboard', id: 'dashboard' },
  { href: '/ranking.html', label: 'Ranking', id: 'ranking' },
  { href: '/riskmgmt.html', label: 'Risk Mgmt', id: 'riskmgmt' },
  { href: '/config.html', label: 'Config', id: 'config' },
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
      ? 'border-sky-500 text-sky-300 bg-sky-950/40'
      : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600';
    return `<a href="${item.href}" class="px-3 py-1.5 text-xs font-medium border-b-2 transition-all ${activeClass}">${item.label}</a>`;
  }).join('');

  const navbar = document.createElement('nav');
  navbar.id = 'app-navbar';
  navbar.className = 'sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md';
  navbar.innerHTML = `
    <div class="mx-auto max-w-screen-2xl flex items-center justify-between px-4 py-2">
      <a href="/index.html" class="flex items-center gap-2 group">
        <span class="text-sm font-bold tracking-tight text-slate-100 group-hover:text-sky-300 transition-colors">Finapp</span>
        <span class="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">by Azeroth</span>
      </a>
      <div class="flex items-center gap-1">
        ${links}
      </div>
    </div>
  `;

  // Insert at the very top of body
  document.body.insertBefore(navbar, document.body.firstChild);
}
