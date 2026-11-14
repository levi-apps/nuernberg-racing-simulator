/**
 * Anzeige im Fahrmodus: Tacho, Straßenname, Tempolimit, Meldungen, Tastenhilfe.
 */
export class Hud {
  root = document.createElement('div');
  private speedEl = document.createElement('div');
  private limitEl = document.createElement('div');
  private streetEl = document.createElement('div');
  private msgEl = document.createElement('div');
  private helpEl = document.createElement('div');
  private loadingEl = document.createElement('div');
  private violEl = document.createElement('div');
  private nitroEl = document.createElement('div');
  private nitroBar = document.createElement('i');
  private msgTimer = 0;

  constructor() {
    this.root.id = 'drive-hud';
    this.speedEl.className = 'speed';
    this.limitEl.className = 'limit';
    this.streetEl.className = 'street';
    this.msgEl.className = 'msg';
    this.helpEl.className = 'help';
    this.loadingEl.className = 'loading';
    this.violEl.className = 'violations';
    this.violEl.style.display = 'none';
    this.loadingEl.textContent = 'Lade Stadt …';
    this.helpEl.innerHTML = [
      '<b>W / ↑</b> Gas',
      '<b>S / ↓</b> Bremse, rückwärts',
      '<b>A D / ← →</b> lenken',
      '<b>Leertaste</b> Handbremse · <b>Shift</b> Nitro',
      '<b>R</b> zurück auf die Straße',
      '<b>V</b> 3D-Ansicht / Draufsicht',
      '<b>C</b> Kamera drehen',
      '<b>T</b> Verkehr an/aus, <b>+ / −</b> Dichte',
      'Jobs: zu farbigen Markern fahren und anhalten',
      '<b>X</b> Job abbrechen · <b>G</b> Garage/Autohaus',
      'Symbole: 🚗 Autohaus · 🔧 Tuning · 🏁 Rennen',
      '<b>O</b> Startgebiet wählen',
      '<b>K</b> Karte / Debug',
      '<b>H</b> Hilfe aus',
    ].join('<br>');
    const dash = document.createElement('div');
    dash.className = 'dash';
    this.nitroEl.className = 'nitro';
    this.nitroEl.innerHTML = '<span>NOS</span>';
    const track = document.createElement('b');
    track.className = 'track';
    track.append(this.nitroBar);
    this.nitroEl.append(track);
    this.nitroEl.style.display = 'none';
    dash.append(this.limitEl, this.speedEl, this.nitroEl);
    this.root.append(this.streetEl, dash, this.msgEl, this.helpEl, this.loadingEl, this.violEl);
    document.body.append(this.root);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  setSpeed(kmh: number): void {
    this.speedEl.innerHTML = `${Math.round(Math.abs(kmh))}<small>km/h</small>`;
  }

  setStreet(name: string | null, limit: number | null, over: boolean): void {
    this.streetEl.textContent = name ?? '';
    this.streetEl.style.visibility = name ? 'visible' : 'hidden';
    this.limitEl.textContent = limit ? String(limit) : '';
    this.limitEl.style.visibility = limit ? 'visible' : 'hidden';
    this.limitEl.classList.toggle('over', over);
  }

  message(text: string, seconds = 2): void {
    this.msgEl.textContent = text;
    this.msgEl.style.opacity = '1';
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => (this.msgEl.style.opacity = '0'), seconds * 1000);
  }

  toggleHelp(): void {
    this.helpEl.classList.toggle('hidden');
  }

  /** Nitro-Füllstand 0..1, null = kein Nitro verbaut */
  setNitro(level: number | null, active: boolean): void {
    this.nitroEl.style.display = level === null ? 'none' : '';
    if (level === null) return;
    this.nitroBar.style.width = `${Math.round(level * 100)}%`;
    this.nitroEl.classList.toggle('on', active);
  }

  setViolations(n: number): void {
    this.violEl.style.display = n ? '' : 'none';
    this.violEl.textContent = `Rotlichtverstöße: ${n}`;
  }

  setLoading(v: boolean): void {
    this.loadingEl.style.display = v ? '' : 'none';
  }
}
