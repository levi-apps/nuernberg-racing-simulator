/**
 * Tuning-Werkstatt: Stufen für Motor, Bremsen, Reifen, Nitro und Lackierung des aktuellen Autos.
 * Öffnet sich beim Anhalten an einer Werkstatt (🔧).
 */
import { PAINTS } from './Cars.ts';
import type { Profile } from './Profile.ts';
import { MAX_LEVEL, PARTS, tuningPrice, type Part } from './Tuning.ts';
import { formatEuro } from '../missions/MissionUi.ts';

export class TuningUi {
  private root = document.createElement('div');
  open = false;
  shop = '';
  onBuy?: (part: Part) => void;
  onPaint?: (color: number) => void;
  onClose?: () => void;
  /** Schaden 0..1 und Reparatur */
  damage?: () => number;
  onRepair?: (price: number) => void;
  /** Hinweis, wenn gerade ein Kundenauto gefahren wird */
  blocked?: () => string | null;

  constructor(private profile: Profile) {
    this.root.className = 'g-modal';
    this.root.id = 'tuning';
    this.root.style.display = 'none';
    document.body.append(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) {
        if (e.target === this.root) this.close();
        return;
      }
      if (el.dataset.act === 'close') this.close();
      if (el.dataset.act === 'buy') this.onBuy?.(el.dataset.part as Part);
      if (el.dataset.act === 'paint') this.onPaint?.(Number(el.dataset.c));
      if (el.dataset.act === 'repair') this.onRepair?.(Number(el.dataset.price));
      this.render();
    });
    window.addEventListener('keydown', (e) => {
      if (this.open && (e.code === 'Escape' || e.code === 'KeyG')) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  show(shop: string): void {
    this.shop = shop;
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

  render(): void {
    const p = this.profile;
    const car = p.car;
    const t = p.tuneOf(car.id);
    const block = this.blocked?.() ?? null;
    const rows = (Object.keys(PARTS) as Part[])
      .map((k) => {
        const d = PARTS[k];
        const lvl = t[k];
        const dots = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        let act: string;
        if (lvl >= MAX_LEVEL) act = '<span class="g-current">✔ maximal</span>';
        else {
          const price = tuningPrice(car, k, lvl + 1);
          act =
            !block && p.money >= price
              ? `<button class="g-buy" data-act="buy" data-part="${k}">${d.levels[lvl + 1]} · ${formatEuro(price)}</button>`
              : `<span class="g-missing">${d.levels[lvl + 1]} · ${formatEuro(price)}</span>`;
        }
        return `<div class="t-row"><div class="t-name">${d.icon} <b>${d.name}</b><small>${d.desc}</small></div><div class="t-lvl">${dots}<small>${d.levels[lvl]}</small></div><div class="t-act">${act}</div></div>`;
      })
      .join('');
    const paints = PAINTS.map(
      (col) => `<i data-act="paint" data-c="${col}" style="background:#${col.toString(16).padStart(6, '0')}" class="${p.colorOf(car.id) === col ? 'on' : ''}"></i>`,
    ).join('');
    const dmg = this.damage?.() ?? 0;
    const repairPrice = Math.round(dmg * car.price * 0.06 * 100) / 100 + (dmg > 0 ? 15 : 0);
    const repair =
      dmg <= 0.001
        ? '<span class="g-current">✔ keine Schäden</span>'
        : p.money >= repairPrice
          ? `<button class="g-buy" data-act="repair" data-price="${repairPrice}">Reparieren · ${formatEuro(repairPrice)}</button>`
          : `<span class="g-missing">Reparieren · ${formatEuro(repairPrice)}</span>`;
    const dmgBar = `<i style="display:inline-block;width:120px;height:8px;border-radius:4px;background:#e3e5e8;overflow:hidden;vertical-align:middle"><b style="display:block;height:100%;width:${Math.round(dmg * 100)}%;background:${dmg > 0.6 ? '#d2232a' : dmg > 0.3 ? '#ff8a00' : '#2b9a4a'}"></b></i>`;
    this.root.innerHTML = `<div class="g-box t-box">
      <div class="g-top"><h2>🔧 ${this.shop}</h2><span class="g-money">${formatEuro(p.money)}</span><button class="g-x" data-act="close">✕</button></div>
      <p class="g-where">Tuning für deinen <b>${car.name}</b>. ${block ?? 'Jede Stufe wirkt sofort.'}</p>
      <div class="t-row"><div class="t-name">🛠️ <b>Karosserie & Motor</b><small>Dellen, fehlende Teile, Leistung</small></div><div class="t-lvl">${dmgBar}<small>Schaden ${Math.round(dmg * 100)} %</small></div><div class="t-act">${repair}</div></div>
      <div class="t-rows">${rows}</div>
      <div class="t-row"><div class="t-name">🎨 <b>Lackierung</b><small>kostenlos</small></div><div class="g-paints">${paints}</div></div>
      <p class="g-foot">Nitro zündest du mit <b>Shift</b> (Gamepad: RB) · <b>Esc</b> schließt</p>
    </div>`;
  }
}
