/**
 * Grafik-Einstellungen (Zahnrad oben rechts): Qualitätsstufe, Tageszeit und Ansicht.
 * Der Knopf zeigt gleichzeitig die Uhrzeit im Spiel.
 */
import { QUALITY, type Graphics, type Quality } from '../world/Graphics.ts';

export class GraphicsMenu {
  private btn = document.createElement('button');
  private root = document.createElement('div');
  open = false;
  onView3D?: (on: boolean) => void;
  is3D?: () => boolean;
  onOpenChange?: (open: boolean) => void;

  constructor(private gfx: Graphics) {
    this.btn.id = 'gfx-btn';
    this.btn.title = 'Grafik und Tageszeit';
    this.root.id = 'gfx-menu';
    this.root.style.display = 'none';
    document.body.append(this.btn, this.root);
    this.btn.addEventListener('click', () => this.toggle());
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) return;
      const a = el.dataset.act;
      if (a === 'q') gfx.setQuality(el.dataset.v as Quality);
      if (a === 'hour') gfx.setHour(Number(el.dataset.v), false);
      if (a === 'cycle') gfx.setHour(gfx.settings.hour, !gfx.settings.cycle);
      if (a === 'view') this.onView3D?.(!this.is3D?.());
      if (a === 'close') return this.toggle();
      this.render();
    });
    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.opt === 'hour') gfx.setHour(Number(t.value), false);
      if (t.dataset.opt === 'day') {
        gfx.settings.dayMinutes = Number(t.value);
        gfx.save();
      }
      this.renderTime();
    });
  }

  toggle(): void {
    this.open = !this.open;
    this.root.style.display = this.open ? '' : 'none';
    if (this.open) this.render();
    this.onOpenChange?.(this.open);
  }

  /** Uhrzeit im Knopf aktualisieren (jede Sekunde reicht) */
  tick(visible: boolean): void {
    this.btn.style.display = visible ? '' : 'none';
    const h = this.gfx.settings.hour;
    const icon = this.gfx.night > 0.5 ? '🌙' : h < 9 ? '🌅' : h > 17 ? '🌇' : '☀️';
    const txt = `${icon} ${clock(h)} ⚙`;
    if (this.btn.textContent !== txt) this.btn.textContent = txt;
    if (this.open) this.renderTime();
  }

  private renderTime(): void {
    const el = this.root.querySelector('#gfx-time');
    if (el) el.textContent = clock(this.gfx.settings.hour);
    const r = this.root.querySelector<HTMLInputElement>('[data-opt="hour"]');
    if (r && document.activeElement !== r) r.value = String(this.gfx.settings.hour);
  }

  private render(): void {
    const s = this.gfx.settings;
    const qs = (Object.keys(QUALITY) as Quality[])
      .map((q) => `<button data-act="q" data-v="${q}" class="${s.quality === q ? 'on' : ''}">${QUALITY[q].label}</button>`)
      .join('');
    const times: Array<[string, number]> = [
      ['🌅 Morgen', 7],
      ['☀️ Mittag', 13],
      ['🌇 Abend', 18.6],
      ['🌙 Nacht', 23],
    ];
    this.root.innerHTML = `<div class="gm-head"><b>Grafik</b><button data-act="close">✕</button></div>
      <h4>Qualität</h4><div class="gm-row">${qs}</div>
      <p class="gm-note">${QUALITY[s.quality].shadows ? 'Echte Schatten' : 'Einfache Schatten'}${QUALITY[s.quality].ao ? ', Umgebungsverdeckung' : ''}${QUALITY[s.quality].bloom ? ', Leuchteffekte' : ''} · Sichtweite ${QUALITY[s.quality].radius} m</p>
      <h4>Tageszeit <span id="gfx-time">${clock(s.hour)}</span></h4>
      <input type="range" data-opt="hour" min="0" max="23.99" step="0.05" value="${s.hour}">
      <div class="gm-row">${times.map(([l, h]) => `<button data-act="hour" data-v="${h}">${l}</button>`).join('')}</div>
      <label class="gm-check"><button data-act="cycle" class="${s.cycle ? 'on' : ''}">${s.cycle ? '⏵ Zeit läuft' : '⏸ Zeit steht'}</button>
      <span>1 Tag = <select data-opt="day">${[12, 24, 48, 96].map((m) => `<option value="${m}" ${s.dayMinutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></span></label>
      <h4>Ansicht</h4><button data-act="view">${this.is3D?.() ? '3D-Verfolgerkamera (an) – zur Draufsicht' : 'Draufsicht (an) – zur 3D-Ansicht'}</button>
      <p class="gm-note">Taste V wechselt die Ansicht, B schaut zurück.</p>`;
  }
}

function clock(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
