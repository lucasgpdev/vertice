import type { Vec3 } from '../math/vec3.js';
import type { AABB } from './aabb.js';
import { rayAabb } from './aabb.js';
import { MOVE } from './movement.js';

/**
 * Hitboxes do jogador, idênticas no cliente e no servidor.
 * Valores relativos aos pés, para a altura em pé (1,8 m). Quando agachado,
 * as alturas são escaladas pela razão crouchHeight/standHeight.
 * Fase 1: cabeça, tronco (inclui braços) e pernas. Braços separados: Fase 4.
 */
export type HitRegion = 'head' | 'torso' | 'legs';

interface HitboxDef {
  region: HitRegion;
  y0: number;
  y1: number;
  half: number;
  /** Deslocamento horizontal do centro (0 = centrado no jogador). */
}

export const HITBOXES: readonly HitboxDef[] = [
  { region: 'head', y0: 1.5, y1: 1.8, half: 0.15 },
  { region: 'torso', y0: 0.85, y1: 1.5, half: 0.27 },
  { region: 'legs', y0: 0.0, y1: 0.85, half: 0.22 },
];

export interface HitTarget {
  pos: Vec3;
  crouchT: number;
}

const box: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

export const hitboxScaleY = (crouchT: number): number =>
  1 + (MOVE.crouchHeight / MOVE.standHeight - 1) * crouchT;

export const getHitbox = (t: HitTarget, def: HitboxDef, out: AABB = box): AABB => {
  const sy = hitboxScaleY(t.crouchT);
  out.min.x = t.pos.x - def.half;
  out.max.x = t.pos.x + def.half;
  out.min.z = t.pos.z - def.half;
  out.max.z = t.pos.z + def.half;
  out.min.y = t.pos.y + def.y0 * sy;
  out.max.y = t.pos.y + def.y1 * sy;
  return out;
};

/** Retorna distância e região do primeiro acerto do raio no alvo, ou null. */
export const rayHitboxes = (
  origin: Vec3,
  dir: Vec3,
  target: HitTarget,
  maxDist: number,
): { t: number; region: HitRegion } | null => {
  let best: { t: number; region: HitRegion } | null = null;
  for (const def of HITBOXES) {
    const t = rayAabb(origin, dir, getHitbox(target, def), best ? best.t : maxDist);
    if (t >= 0 && (!best || t < best.t)) best = { t, region: def.region };
  }
  return best;
};

/** Posição aproximada da cabeça (para nomes e linha de visão). */
export const headPosition = (t: HitTarget, out: Vec3): Vec3 => {
  const sy = hitboxScaleY(t.crouchT);
  out.x = t.pos.x;
  out.y = t.pos.y + 1.65 * sy;
  out.z = t.pos.z;
  return out;
};
