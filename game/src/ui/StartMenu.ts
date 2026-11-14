/**
 * Auswahl des Startgebiets: Stadtteile aus OSM, Zufall oder letzte Position.
 * Erscheint beim Start und jederzeit über die Taste O.
 */
import type { Place } from '@nrs/shared';

const DISTRICT_KINDS = new Set(['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet']);
const LAST_KEY = 'nrs.lastPos';

export interface StartChoice {
  x: number;
  y: number;
  name: string;
}

export class StartMenu {
  private root = document.createElement('div');
  private list = document.createElement('div');
  private search = document.createElement('input');
  private districts: Place[] = [];
  open = false;
  onChoose?: (c: StartChoice) => void;
  onClose?: () => void;

  constructor(places: Place[]) {
    this.districts = places.filter((p) => DISTRICT_KINDS.has(p.kind ?? '')).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    this.root.id = 'start-menu';
    this.root.innerHTML = `
      <div class="sm-box">
        <h1>Nürnberg Racing Simulator</h1>
        <p class="sm-sub">Wo willst du losfahren?</p>
        <div class="sm-top">
          <button data-act="last" class="sm-btn sm-main">▶ Weiterfahren</button>
          <button data-act="random" class="sm-btn">🎲 Zufälliger Stadtteil</button>
          <button data-act="center" class="sm-btn">Altstadt / Hauptmarkt</button>
        </div>
        <div class="sm-search-row"></div>
        <div class="sm-list"></div>
        <p class="sm-foot">W/S/A/D fahren · Leertaste Handbremse · Jobs: farbige Marker anfahren · <b>G</b> Garage · <b>Shift</b> Nitro · <b>^</b> Admin · <b>V</b> 3D · <b>O</b> dieses Menü · <b>H</b> Hilfe</p>
      </div>`;
    this.search.placeholder = 'Stadtteil suchen …';
    this.search.className = 'sm-search';
    this.root.querySelector('.sm-search-row')!.append(this.search);
    this.list = this.root.querySelector('.sm-list') as HTMLDivElement;
    this.search.addEventListener('input', () => this.renderList());
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const first = this.list.querySelector('button') as HTMLButtonElement | null;
        first?.click();
      }
      if (e.key === 'Escape') this.close();
    });
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) {
        if (e.target === this.root && this.canClose) this.close();
        return;
      }
      const act = b.dataset.act;
      if (act === 'last') {
        const l = StartMenu.lastPos();
        if (this.canClose || !l) this.close();
        else this.choose({ ...l, name: 'letzte Position' });
      } else if (act === 'random') {
        const d = this.districts[(Math.random() * this.districts.length) | 0];
        this.choose({ x: d.x, y: d.y, name: d.name });
      } else if (act === 'center') this.choose({ x: 120, y: -40, name: 'Altstadt' });
      else if (b.dataset.x) this.choose({ x: Number(b.dataset.x), y: Number(b.dataset.y), name: b.textContent ?? '' });
    });
    document.body.append(this.root);
    this.root.style.display = 'none';
    this.renderList();
  }

  /** darf ohne Auswahl geschlossen werden (nicht beim allerersten Start) */
  canClose = false;

  static lastPos(): { x: number; y: number } | null {
    try {
      const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as { x: number; y: number } | null;
      return v && Number.isFinite(v.x) ? v : null;
    } catch {
      return null;
    }
  }

  static saveLastPos(x: number, y: number): void {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
    } catch {
      /* egal */
    }
  }

  private renderList(): void {
    const q = this.search.value.trim().toLowerCase();
    const items = this.districts.filter((d) => !q || d.name.toLowerCase().includes(q));
    this.list.innerHTML = '';
    for (const d of items) {
      const b = document.createElement('button');
      b.className = 'sm-district';
      b.textContent = d.name;
      b.dataset.x = String(d.x);
      b.dataset.y = String(d.y);
      this.list.append(b);
    }
    if (!items.length) this.list.innerHTML = '<span class="sm-empty">Kein Stadtteil gefunden</span>';
  }

  show(canClose: boolean): void {
    this.canClose = canClose;
    this.open = true;
    const last = this.root.querySelector('[data-act="last"]') as HTMLButtonElement;
    last.style.display = StartMenu.lastPos() || canClose ? '' : 'none';
    last.textContent = canClose ? '▶ Weiterfahren' : '▶ Letzte Position';
    this.root.style.display = '';
    this.search.value = '';
    this.renderList();
    setTimeout(() => this.search.focus(), 50);
  }

  close(): void {
    this.open = false;
    this.root.style.display = 'none';
    this.search.blur();
    this.onClose?.();
  }

  private choose(c: StartChoice): void {
    this.close();
    this.onChoose?.(c);
  }
}
