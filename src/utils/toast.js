/**
 * Simple Toast Notification system for FinApp.
 */

class ToastManager {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `
      toast pointer-events-auto min-w-[200px] max-w-sm p-4 rounded-xl border shadow-2xl 
      flex items-center gap-3 animate-slide-in-right transform transition-all duration-300
      ${this._getTypeStyles(type)}
    `;

    const icon = this._getIcon(type);
    
    toast.innerHTML = `
      <div class="text-xl">${icon}</div>
      <div class="flex-1 text-sm font-medium">${message}</div>
      <button class="opacity-50 hover:opacity-100 transition-opacity">&times;</button>
    `;

    // Close on button click
    const closeBtn = toast.querySelector('button');
    closeBtn.onclick = () => this._remove(toast);

    this.container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
      if (toast.parentElement) {
        this._remove(toast);
      }
    }, duration);
  }

  _remove(toast) {
    toast.classList.add('animate-slide-out-right', 'opacity-0', 'translate-x-full');
    setTimeout(() => {
      if (toast.parentElement) {
        this.container.removeChild(toast);
      }
    }, 300);
  }

  _getTypeStyles(type) {
    switch (type) {
      case 'success': return 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100 glow-emerald';
      case 'error': return 'bg-rose-950/90 border-rose-500/50 text-rose-100 glow-rose';
      case 'warning': return 'bg-amber-950/90 border-amber-500/50 text-amber-100 glow-amber';
      default: return 'bg-slate-900/95 border-sky-500/50 text-sky-100 glow-sky';
    }
  }

  _getIcon(type) {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  }
}

export const toast = new ToastManager();
window.showToast = (msg, type, dur) => toast.show(msg, type, dur);
