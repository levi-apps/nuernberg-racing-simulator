/**
 * Tuning in der Werkstatt: Motor, Bremsen, Reifen und Nitro in je drei Stufen pro Auto.
 * Preise richten sich nach dem Wert des Autos.
 */
import type { CarSpec } from '../drive/Car.ts';
import type { CarModel } from './Cars.ts';

export type Part = 'engine' | 'brakes' | 'tires' | 'nitro';
export type Tuning = Record<Part, number>;
export const NO_TUNING: Tuning = { engine: 0, brakes: 0, tires: 0, nitro: 0 };
export const MAX_LEVEL = 3;

export const PARTS: Record<Part, { name: string; icon: string; levels: string[]; desc: string; factor: number[] }> = {
  engine: {
    name: 'Motor',
    icon: '⚙️',
    levels: ['Serie', 'Chiptuning', 'Sportauspuff + Ansaugung', 'Rennmotor'],
    desc: 'mehr Höchstgeschwindigkeit und Beschleunigung',
    factor: [0, 0.18, 0.4, 0.7],
  },
  brakes: {
    name: 'Bremsen',
    icon: '🛑',
    levels: ['Serie', 'Sportbeläge', 'Sportbremse', 'Keramikbremse'],
    desc: 'kürzerer Bremsweg',
    factor: [0, 0.08, 0.16, 0.28],
  },
  tires: {
    name: 'Reifen & Fahrwerk',
    icon: '🛞',
    levels: ['Serie', 'Sportreifen', 'Semi-Slicks + Gewindefahrwerk', 'Rennslicks'],
    desc: 'mehr Grip und präzisere Lenkung',
    factor: [0, 0.12, 0.25, 0.42],
  },
  nitro: {
    name: 'Nitro',
    icon: '🔥',
    levels: ['keins', 'kleine Flasche', 'große Flasche', 'Doppelflasche'],
    desc: 'Schub auf Knopfdruck (Shift), lädt sich langsam wieder auf',
    factor: [0, 0.25, 0.45, 0.7],
  },
};

/** Wirkung je Stufe */
const ENGINE_TOP = [1, 1.06, 1.12, 1.2];
const ENGINE_ACC = [1, 1.12, 1.25, 1.42];
const BRAKES = [1, 1.15, 1.3, 1.5];
const GRIP = [1, 1.1, 1.2, 1.32];
const STEER = [1, 1.04, 1.08, 1.12];
/** Nitro-Vorrat in Sekunden */
export const NITRO_SECONDS = [0, 3, 5, 8];

/** Preis der Stufe `level` (1..3) für dieses Auto */
export function tuningPrice(car: CarModel, part: Part, level: number): number {
  const ref = Math.max(180, car.price);
  return Math.round((ref * PARTS[part].factor[level]) / 5) * 5;
}

export function tunedSpec(base: CarSpec, t: Tuning): CarSpec {
  return {
    ...base,
    maxSpeed: base.maxSpeed * ENGINE_TOP[t.engine],
    accel: base.accel * ENGINE_ACC[t.engine],
    brake: base.brake * BRAKES[t.brakes],
    grip: base.grip * GRIP[t.tires],
    driftGrip: base.driftGrip * (1 + (GRIP[t.tires] - 1) * 0.5),
    steerRate: base.steerRate * STEER[t.tires],
  };
}
