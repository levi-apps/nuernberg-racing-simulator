/**
 * Spielstand im Browser: Geld, erledigte Aufträge, eigene Autos, aktuelles Auto, Lackfarben.
 */
import { carById, CARS } from './Cars.ts';

const KEY = 'nrs.save';

interface Saved {
  money?: number;
  completed?: number;
  owned?: string[];
  current?: string;
  paint?: Record<string, number>;
  earned?: number;
}

export class Profile {
  money = 0;
  completed = 0;
  /** insgesamt verdient (Statistik) */
  earned = 0;
  owned: string[] = [CARS[0].id];
  current = CARS[0].id;
  paint: Record<string, number> = {};
  onChange?: () => void;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
      this.money = s.money ?? 0;
      this.completed = s.completed ?? 0;
      this.earned = s.earned ?? this.money;
      this.owned = s.owned?.length ? s.owned : [CARS[0].id];
      if (!this.owned.includes(CARS[0].id)) this.owned.unshift(CARS[0].id);
      this.current = s.current && this.owned.includes(s.current) ? s.current : CARS[0].id;
      this.paint = s.paint ?? {};
    } catch {
      /* Speicher nicht verfügbar */
    }
  }

  save(): void {
    try {
      const s: Saved = { money: this.money, completed: this.completed, owned: this.owned, current: this.current, paint: this.paint, earned: this.earned };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* egal */
    }
    this.onChange?.();
  }

  earn(amount: number): void {
    this.money += amount;
    this.earned += Math.max(0, amount);
    this.completed++;
    this.save();
  }

  owns(id: string): boolean {
    return this.owned.includes(id);
  }

  buy(id: string): boolean {
    const car = carById(id);
    if (this.owns(id) || this.money < car.price) return false;
    this.money -= car.price;
    this.owned.push(id);
    this.current = id;
    this.save();
    return true;
  }

  select(id: string): void {
    if (!this.owns(id)) return;
    this.current = id;
    this.save();
  }

  colorOf(id: string): number {
    return this.paint[id] ?? carById(id).color;
  }

  setPaint(id: string, color: number): void {
    this.paint[id] = color;
    this.save();
  }

  get car() {
    return carById(this.current);
  }

  /** hat das aktuelle Auto diese Fähigkeit? */
  has(cap: string): boolean {
    return (this.car.caps as string[]).includes(cap);
  }
}
