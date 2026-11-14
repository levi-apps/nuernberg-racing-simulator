import type { AreaKind, LaneControl, LineKind, RoadClass, Turn } from '@nrs/shared';

export const BACKGROUND = 0xece8dd;

export const AREA_COLORS: Record<AreaKind, number> = {
  water: 0xa9cbe8,
  park: 0xc5e3b0,
  grass: 0xd2e7bf,
  forest: 0xa8cf95,
  farmland: 0xe9e4c4,
  parking: 0xdcdad5,
  pedestrian: 0xe6e1ea,
  railway: 0xddd3d3,
  industrial: 0xe4dbe4,
  residential: 0xe5e1d8,
  commercial: 0xeedfd8,
  cemetery: 0xbfd8b5,
  sports: 0xb7e2c8,
};

export const ROAD_COLORS: Record<RoadClass, number> = {
  motorway: 0xe892a2,
  trunk: 0xf9b29c,
  primary: 0xfcd6a4,
  secondary: 0xf7fabf,
  tertiary: 0xffffff,
  unclassified: 0xffffff,
  residential: 0xffffff,
  living_street: 0xeeeeee,
  service: 0xf4f4f4,
  track: 0xd9c7a3,
  pedestrian: 0xdddde8,
};
export const ROAD_EDGE = 0xb9b2a5;

export const LINE_COLORS: Record<LineKind, number> = {
  footway: 0xe0826d,
  cycleway: 0x5b7cfa,
  path: 0xb08a5a,
  steps: 0xe0826d,
  rail: 0x777777,
  tram: 0x9a6e9a,
  subway: 0x999999,
  river: 0x7fb0dd,
  stream: 0x7fb0dd,
};

export const BUILDING_FILL = 0xd6cdbf;
export const BUILDING_EDGE = 0xbcb1a2;

export const MARKING_COLORS = {
  solid: 0x8e8e8e,
  dashed: 0xaaaaaa,
  edge: 0xa0a0a0,
  stop: 0x333333,
};

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
