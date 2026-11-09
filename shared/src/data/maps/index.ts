import type { MapDef } from './types.js';
import { ARENA } from './arena.js';

export const MAPS: Record<string, MapDef> = {
  [ARENA.id]: ARENA,
};

export const DEFAULT_MAP_ID = ARENA.id;

export const getMap = (id: string): MapDef => {
  const m = MAPS[id];
  if (!m) throw new Error(`Mapa desconhecido: ${id}`);
  return m;
};

export * from './types.js';
