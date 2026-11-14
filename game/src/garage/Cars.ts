/**
 * Fahrzeugkatalog. Namen sind erfunden (keine echten Marken), Preise und Werte sind Spielwerte.
 *
 * Preise sind auf Spielzeit abgestimmt (Verdienst je Minute siehe missions/Economy.ts):
 *   günstig ~15 min, normal ~35 min, teuer ~50 min, Ultra-Luxus ~2 h, teuerstes ~7 h.
 */
import type { CarSpec } from '../drive/Car.ts';

/** Karosserieform für die Darstellung */
export type Body = 'small' | 'compact' | 'wagon' | 'van' | 'sedan' | 'sport' | 'tow' | 'bus' | 'hyper';

/** Fähigkeiten, die bestimmte Aufträge freischalten oder verbessern */
export type Cap = 'cargo' | 'premium' | 'fast' | 'space' | 'tow' | 'bus';

export interface CarModel {
  id: string;
  name: string;
  klass: string;
  price: number;
  body: Body;
  caps: Cap[];
  color: number;
  spec: CarSpec;
  note: string;
}

export const CAP_TEXT: Record<Cap, string> = {
  cargo: 'Umzüge',
  premium: 'VIP-Fahrten, mehr Trinkgeld',
  fast: '+50 % bei Express',
  space: '+30 % bei Express',
  tow: 'Abschleppdienst',
  bus: 'Buslinien',
};

const S = (length: number, width: number, kmh: number, accel: number, brake: number, steerRate: number, grip: number, driftGrip = 1.5): CarSpec => ({
  length,
  width,
  maxSpeed: kmh / 3.6,
  maxReverse: 8,
  accel,
  brake,
  steerRate,
  grip,
  driftGrip,
});

export const CARS: CarModel[] = [
  { id: 'stadtfloh', name: 'Stadtfloh', klass: 'Kleinwagen', price: 0, body: 'small', caps: [], color: 0xd7263d, note: 'Dein erstes Auto: wendig und sparsam.', spec: S(3.75, 1.7, 150, 7.2, 15, 2.55, 9.5) },
  { id: 'pendler', name: 'Pendler', klass: 'Kompaktwagen · günstig', price: 90, body: 'compact', caps: [], color: 0x2d6cc0, note: 'Mehr Durchzug, stabiler bei Tempo.', spec: S(4.3, 1.8, 185, 8.6, 16, 2.35, 9.2) },
  { id: 'familienkombi', name: 'Familienkombi', klass: 'Kombi · normal', price: 220, body: 'wagon', caps: ['space'], color: 0x6b7076, note: 'Viel Platz: Express-Pakete bringen 30 % mehr.', spec: S(4.75, 1.84, 195, 8.4, 16, 2.2, 9.0) },
  { id: 'lastesel', name: 'Lastesel', klass: 'Transporter · Nutzfahrzeug', price: 250, body: 'van', caps: ['cargo', 'space'], color: 0xf2f2f2, note: 'Langsam und schwer, aber Umzüge zahlen gut.', spec: S(5.4, 2.0, 150, 5.8, 12.5, 1.9, 8.0, 1.6) },
  { id: 'haken', name: 'Haken & Seil', klass: 'Abschleppwagen · Nutzfahrzeug', price: 450, body: 'tow', caps: ['tow', 'cargo'], color: 0xe8701a, note: 'Pannenautos zur Werkstatt bringen.', spec: S(6.2, 2.2, 140, 5.2, 12, 1.8, 8.5, 1.6) },
  { id: 'stadtbus', name: 'Stadtbus', klass: 'Linienbus · Nutzfahrzeug', price: 520, body: 'bus', caps: ['bus'], color: 0xc8102e, note: 'Echte Buslinien mit echten Haltestellen.', spec: S(12, 2.55, 90, 3.6, 9, 1.35, 8.0, 1.8) },
  { id: 'limousine', name: 'Gran Turismo Lounge', klass: 'Oberklasse · teuer', price: 650, body: 'sedan', caps: ['premium'], color: 0x1c1c1c, note: 'Für VIP-Fahrten; Fahrgäste geben viel mehr Trinkgeld.', spec: S(5.05, 1.92, 240, 10.2, 17.5, 2.25, 10.2) },
  { id: 'blitz', name: 'Blitz GT', klass: 'Sportwagen · Ultra-Luxus', price: 2200, body: 'sport', caps: ['premium', 'fast'], color: 0xf5b400, note: 'Brutal schnell. Express +50 %, gewinnt Rennen.', spec: S(4.5, 1.95, 290, 14, 20, 2.7, 12, 2.0) },
  { id: 'aurum', name: 'Aurum Hyper', klass: 'Hypercar · das teuerste', price: 8000, body: 'hyper', caps: ['premium', 'fast'], color: 0x6d2a8a, note: 'Das schnellste Auto der Stadt.', spec: S(4.7, 2.02, 345, 18, 24, 2.85, 13.5, 2.2) },
];

export const carById = (id: string): CarModel => CARS.find((c) => c.id === id) ?? CARS[0];

/** Lackfarben zur Auswahl */
export const PAINTS = [0xd7263d, 0x2d6cc0, 0x1c1c1c, 0xf2f2f2, 0x9aa0a6, 0x355e3b, 0xf5b400, 0xe8701a, 0x6d2a8a, 0x8c1c1c, 0x1f4e8c, 0xc9b98a];
