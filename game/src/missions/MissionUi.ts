/**
 * Oberfläche für Navigation und Aufträge: Abbiegehinweis, Auftragsfeld, Kontostand,
 * Richtungspfeil zum Ziel am Bildrand, Rahmen der Minikarte.
 */
export class MissionUi {
  private nav = div('nav-panel');
  private navArrow = div('nav-arrow');
  private navText = div('nav-text');
  private navSub = div('nav-sub');
  private job = div('job-panel');
  private money = div('money');
  private pointer = div('target-pointer');
  readonly minimapFrame = div('minimap-frame');
  private toast = div('job-toast');
  private toastTimer = 0;

  constructor() {
    const navBody = div('nav-body');
    navBody.append(this.navText, this.navSub);
    this.nav.append(this.navArrow, navBody);
    this.pointer.innerHTML = '<svg viewBox="0 0 40 40"><path d="M20 2 L36 34 L20 26 L4 34 Z"/></svg>';
    const root = document.getElementById('drive-hud') ?? document.body;
    root.append(this.nav, this.job, this.money, this.pointer, this.minimapFrame, this.toast);
    this.nav.style.display = 'none';
    this.job.style.display = 'none';
    this.pointer.style.display = 'none';
  }

  setNav(arrow: string, text: string, sub: string): void {
    this.nav.style.display = '';
    this.navArrow.textContent = arrow;
    this.navText.textContent = text;
    this.navSub.textContent = sub;
  }

  hideNav(): void {
    this.nav.style.display = 'none';
  }

  setJob(html: string | null): void {
    this.job.style.display = html ? '' : 'none';
    if (html) this.job.innerHTML = html;
  }

  setMoney(euro: number): void {
    this.money.textContent = formatEuro(euro);
  }

  /** Pfeil am Bildrand: Winkel in rad (Bildschirm, 0 = rechts, im Uhrzeigersinn), null = ausblenden */
  setPointer(x: number, y: number, angle: number | null): void {
    if (angle === null) {
      this.pointer.style.display = 'none';
      return;
    }
    this.pointer.style.display = '';
    this.pointer.style.transform = `translate(${x - 18}px, ${y - 18}px) rotate(${angle + Math.PI / 2}rad)`;
  }

  /** große Meldung (Auftrag erledigt usw.) */
  showToast(html: string, seconds = 4): void {
    this.toast.innerHTML = html;
    this.toast.style.opacity = '1';
    this.toast.style.transform = 'translateX(-50%) scale(1)';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.style.opacity = '0';
      this.toast.style.transform = 'translateX(-50%) scale(0.95)';
    }, seconds * 1000);
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

export function formatEuro(v: number): string {
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

export function formatTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
