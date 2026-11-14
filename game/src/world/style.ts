import type { AreaKind, LaneControl, LineKind, RoadClass, Turn } from '@nrs/shared';

import { Pat } from './materials.ts';

/** Boden zwischen allem anderen (Höfe, Gärten, Randflächen) */
export const BACKGROUND = 0xc3c2ae;

export const AREA_COLORS: Record<AreaKind, number> = {
  water: 0x4f7c9c,
  park: 0x8eab64,
  grass: 0x98b46e,
  forest: 0x5a7d43,
  farmland: 0xbdb47f,
  parking: 0x86888b,
  pedestrian: 0xc6c0b4,
  railway: 0xa8a196,
  industrial: 0xbfbcb4,
  residential: 0xbcbca2,
  commercial: 0xc8c2b8,
  cemetery: 0x88a26e,
  sports: 0x77a45a,
};

export const AREA_PATTERN: Record<AreaKind, Pat> = {
  water: Pat.Water,
  park: Pat.Grass,
  grass: Pat.Grass,
  forest: Pat.Forest,
  farmland: Pat.Grass,
  parking: Pat.Asphalt,
  pedestrian: Pat.Paving,
  railway: Pat.Gravel,
  industrial: Pat.Plain,
  residential: Pat.Grass,
  commercial: Pat.Plain,
  cemetery: Pat.Grass,
  sports: Pat.Grass,
};

/** Asphaltfarbe je Straßenklasse */
export const ROAD_COLORS: Record<RoadClass, number> = {
  motorway: 0x4b4e53,
  trunk: 0x4e5156,
  primary: 0x54575c,
  secondary: 0x57595e,
  tertiary: 0x595c60,
  unclassified: 0x5c5f63,
  residential: 0x5e6165,
  living_street: 0x8d877d,
  service: 0x64676a,
  track: 0x9a8e76,
  pedestrian: 0xbdb6aa,
};
export const ROAD_PATTERN: Partial<Record<RoadClass, Pat>> = { living_street: Pat.Paving, track: Pat.Gravel, pedestrian: Pat.Paving };
export const SIDEWALK = 0xb2aea5;
export const KERB = 0xd8d5cd;
export const PARAPET = 0xcfccc4;
export const MARKING_WHITE = 0xeeeeea;
export const MARKING_YELLOW = 0xe8c64a;

/** Farben für die Übersichtskarte (weit herausgezoomt) */
export const OVERVIEW_COLORS: Record<RoadClass, number> = {
  motorway: 0xd77a8c,
  trunk: 0xe89a7f,
  primary: 0xe8b46f,
  secondary: 0xd9cf72,
  tertiary: 0x9a9a9a,
  unclassified: 0x9a9a9a,
  residential: 0x9a9a9a,
  living_street: 0x9a9a9a,
  service: 0x9a9a9a,
  track: 0x9a9a9a,
  pedestrian: 0x9a9a9a,
};

export const LINE_STYLE: Record<LineKind, { w: number; color: number; pat: Pat }> = {
  footway: { w: 1.9, color: 0xc2bcb1, pat: Pat.Paving },
  steps: { w: 2.2, color: 0xb5afa4, pat: Pat.Paving },
  cycleway: { w: 1.8, color: 0x9e5b4a, pat: Pat.Asphalt },
  path: { w: 1.5, color: 0xb3a07e, pat: Pat.Gravel },
  rail: { w: 3.0, color: 0x958e84, pat: Pat.Gravel },
  tram: { w: 0, color: 0, pat: Pat.Plain },
  subway: { w: 0, color: 0, pat: Pat.Plain },
  river: { w: 8, color: 0x4f7c9c, pat: Pat.Water },
  stream: { w: 2, color: 0x56829f, pat: Pat.Water },
  hedge: { w: 1.1, color: 0x4a6b35, pat: Pat.Canopy },
  wall: { w: 0.35, color: 0x8a8174, pat: Pat.Plain },
  citywall: { w: 3.5, color: 0xa58c6c, pat: Pat.Roof },
  fence: { w: 0.08, color: 0x5e5e5e, pat: Pat.Plain },
};
export const RAIL_STEEL = 0x45474a;

/** Dachfarben: Ziegel (Nürnberg typisch rot), Schiefer/Beton grau, Kupfer */
export const ROOF_TILE = [0xa24e38, 0xab5a3e, 0x96473a, 0x8c4d40, 0xa76046, 0x7e4436, 0xb36a4c];
export const ROOF_DARK = [0x5a5d63, 0x4f5258, 0x676a6f];
export const ROOF_FLAT = [0x9b9a95, 0x8e9094, 0xa6a39b, 0x85878b, 0xa9a7a0, 0x7f8185];
export const ROOF_COPPER = [0x6f9686, 0x5b6a71];
export const BUILDING_EDGE_DARK = 0x3f3a35;

export const TREE_GREENS = [0x4d7a35, 0x56823a, 0x46702f, 0x5c8a40, 0x3f6a2c, 0x638d43];

export const LANE_COLOR_FWD = 0x2f7de1;
export const LANE_COLOR_BWD = 0x1db38a;

export const TURN_COLORS: Record<Turn, number> = {
  through: 0x8a8f99,
  left: 0x3d6fe0,
  right: 0x27a35a,
  uturn: 0xa040c0,
  merge: 0xe08a20,
};

export const CONTROL_COLORS: Record<LaneControl, number> = {
  none: 0xcccccc,
  signal: 0x000000, // dynamisch
  stop: 0xd0202a,
  yield: 0xf08c00,
  priority: 0xf3d21a,
  rbl: 0xc0309a,
  end: 0x222222,
};

export const SIGNAL_COLORS = { green: 0x19b34a, yellow: 0xf5b400, red: 0xe0262f };

export const LEGEND: Array<[string, number, boolean?]> = [
  ['Spur (Digitalisierrichtung)', LANE_COLOR_FWD],
  ['Spur (Gegenrichtung)', LANE_COLOR_BWD],
  ['Verbinder geradeaus', TURN_COLORS.through],
  ['Verbinder links', TURN_COLORS.left],
  ['Verbinder rechts', TURN_COLORS.right],
  ['Verbinder einfädeln', TURN_COLORS.merge],
  ['Wenden', TURN_COLORS.uturn],
  ['Ampel (aktueller Zustand)', SIGNAL_COLORS.green, true],
  ['Stopp', CONTROL_COLORS.stop, true],
  ['Vorfahrt gewähren', CONTROL_COLORS.yield, true],
  ['Vorfahrtstraße', CONTROL_COLORS.priority, true],
  ['Rechts vor links', CONTROL_COLORS.rbl, true],
  ['Sackgasse', CONTROL_COLORS.end, true],
];

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
