import type { AABB } from '../../physics/aabb.js';

/** Material de superfície — define aparência no cliente e (futuramente) som/impacto. */
export type SurfaceMaterial = 'concrete' | 'concreteDark' | 'metal' | 'crate' | 'trim' | 'floor';

export interface MapBox extends AABB {
  mat: SurfaceMaterial;
  /** Se false, só colide (invisível). */
  visible?: boolean;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MapLight {
  kind: 'point' | 'spot';
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  distance: number;
}

/** Faixa decorativa emissiva (só visual, sem colisão). */
export interface MapEmissiveStrip extends AABB {
  color: string;
  intensity: number;
}

export interface MapDef {
  id: string;
  name: string;
  /** Caixas de colisão (também usadas para gerar a malha visual nesta fase). */
  boxes: MapBox[];
  spawns: SpawnPoint[];
  lights: MapLight[];
  strips: MapEmissiveStrip[];
  sun: { dir: [number, number, number]; color: string; intensity: number };
  ambient: { sky: string; ground: string; intensity: number };
  fog: { color: string; near: number; far: number };
  /** Meta de desempenho (draw calls máx. em Média). */
  perfBudget: { maxDrawCalls: number };
}
