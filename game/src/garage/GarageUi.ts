/**
 * Autohaus und Garage (Taste G oder Anhalten an einem Autohaus-Marker).
 * Kaufen nur an einem echten Autohaus; eigene Autos wechseln und lackieren überall.
 */
import { CAP_TEXT, CARS, PAINTS, type CarModel } from './Cars.ts';
import type { Profile } from './Profile.ts';
import { formatEuro } from '../missions/MissionUi.ts';

export class GarageUi {
  private root = document.createElement('div');
  open = false;
  /** Name des Autohauses, an dem man steht (sonst null) */
  dealer: string | null = null;
  onSelect?: (id: string) => void;
  onPaint?: (id: string, color: number) => void;
  onBuy?: (id: string) => void;
  onNavigate?: () => void;
  onClose?: () => void;
  /** Text zum nächsten Autohaus (Name, Entfernung) */
  nearestText?: () => string;

  constructor(private profile: Profile) {
    this.root.id = 'garage';
    this.root.style.display = 'none';
    document.body.append(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) {
        if (e.target === this.root) this.close();
        return;
      }
      const id = el.dataset.id ?? '';
      switch (el.dataset.act) {
        case 'close':
          this.close();
          break;
        case 'buy':
          this.onBuy?.(id);
          this.render();
          break;
        case 'select':
          this.onSelect?.(id);
          this.render();
          break;
        case 'paint':
          this.onPaint?.(id, Number(el.dataset.c));
          this.render();
          break;
        case 'nav':
          this.onNavigate?.();
          this.close();
          break;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (this.open && (e.code === 'Escape' || e.code === 'KeyG')) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  show(dealer: string | null): void {
    this.dealer = dealer;
    this.open = true;
    this.root.style.display = '';
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    this.onClose?.();
  }

  private bar(label: string, v: number): string {
    return `<div class="g-stat"><span>${label}</span><i><b style="width:${Math.round(Math.min(1, v) * 100)}%"></b></i></div>`;
  }

  private card(c: CarModel): string {
    const p = this.profile;
    const owned = p.owns(c.id);
    const current = p.current === c.id;
    const s = c.spec;
    const caps = c.caps.map((k) => `<span class="g-cap">${CAP_TEXT[k]}</span>`).join('');
    let action = '';
    if (current) action = '<span class="g-current">● fährst du gerade</span>';
    else if (owned) action = `<button data-act="select" data-id="${c.id}">Fahren</button>`;
    else if (this.dealer && p.money >= c.price) action = `<button class="g-buy" data-act="buy" data-id="${c.id}">Kaufen · ${formatEuro(c.price)}</button>`;
    else if (this.dealer) action = `<span class="g-missing">Es fehlen ${formatEuro(c.price - p.money)}</span>`;
    else action = `<span class="g-price">${formatEuro(c.price)}</span>`;
    const paints =
      owned && current
        ? `<div class="g-paints">${PAINTS.map((col) => `<i data-act="paint" data-id="${c.id}" data-c="${col}" style="background:#${col.toString(16).padStart(6, '0')}" class="${p.colorOf(c.id) === col ? 'on' : ''}"></i>`).join('')}</div>`
        : '';
    const col = `#${p.colorOf(c.id).toString(16).padStart(6, '0')}`;
    return `<div class="g-card ${owned ? 'owned' : ''} ${current ? 'current' : ''}">
      <div class="g-head"><span class="g-swatch" style="background:${col}"></span><div><b>${c.name}</b><small>${c.klass}</small></div></div>
      ${this.bar('Tempo', s.maxSpeed / (345 / 3.6))}
      ${this.bar('Beschleunigung', s.accel / 18)}
      ${this.bar('Handling', (s.steerRate * s.grip) / (2.85 * 13.5))}
      <p>${c.note}</p>
      <div class="g-caps">${caps}</div>
      ${paints}
      <div class="g-act">${action}</div>
    </div>`;
  }

  render(): void {
    const p = this.profile;
    const where = this.dealer
      ? `Du bist bei <b>${this.dealer}</b> – hier kannst du kaufen.`
      : `Kaufen kannst du nur bei einem Autohaus (blaue 🚗-Marker). ${this.nearestText?.() ?? ''} <button data-act="nav">Navigation zum nächsten Autohaus</button>`;
    this.root.innerHTML = `<div class="g-box">
      <div class="g-top"><h2>${this.dealer ? 'Autohaus' : 'Garage'}</h2><span class="g-money">${formatEuro(p.money)}</span><button class="g-x" data-act="close">✕</button></div>
      <p class="g-where">${where}</p>
      <div class="g-grid">${CARS.map((c) => this.card(c)).join('')}</div>
      <p class="g-foot">Erledigte Jobs: ${p.completed} · insgesamt verdient: ${formatEuro(p.earned)} · <b>G</b> oder <b>Esc</b> schließt</p>
    </div>`;
  }
}
