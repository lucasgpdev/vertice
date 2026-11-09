import type { MoveState } from '../physics/movement.js';
import { cloneMoveState, createMoveState, eyeHeight, simulateMove } from '../physics/movement.js';
import type { WeaponState, WeaponStepResult } from '../combat/weaponSim.js';
import { cloneWeaponState, createWeaponState, stepWeapon } from '../combat/weaponSim.js';
import { getWeapon } from '../data/weapons.js';
import type { CollisionWorld } from '../physics/world.js';
import { TICK_DT } from '../constants/game.js';
import type { Vec3 } from '../math/vec3.js';

/**
 * Estado completo simulado de um jogador (movimento + arma).
 * É o que o cliente prevê e o que o servidor envia de volta para reconciliação.
 */
export interface PlayerSimState {
  move: MoveState;
  weapon: WeaponState;
  /** Semente de dispersão definida pelo servidor a cada spawn. */
  seed: number;
}

export interface SimInput {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
}

export const createPlayerSim = (x: number, y: number, z: number, weaponId: string, seed: number): PlayerSimState => ({
  move: createMoveState(x, y, z),
  weapon: createWeaponState(weaponId),
  seed,
});

export const clonePlayerSim = (s: PlayerSimState): PlayerSimState => ({
  move: cloneMoveState(s.move),
  weapon: cloneWeaponState(s.weapon),
  seed: s.seed,
});

/** Um passo de simulação por input. Ordem: movimento, depois arma. */
export const stepPlayerSim = (
  s: PlayerSimState,
  input: SimInput,
  world: CollisionWorld,
  canFire = true,
): WeaponStepResult => {
  const w = getWeapon(s.weapon.weaponId);
  simulateMove(s.move, input, world, TICK_DT, { speedMult: w.moveSpeedMult });
  return stepWeapon(s.weapon, input.buttons, s.move, canFire);
};

export const eyePosition = (s: MoveState, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 => {
  out.x = s.pos.x;
  out.y = s.pos.y + eyeHeight(s);
  out.z = s.pos.z;
  return out;
};
