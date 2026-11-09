import type { WeaponDef } from '../data/weapons.js';
import { getWeapon } from '../data/weapons.js';
import { Buttons } from '../protocols/buttons.js';
import type { MoveState } from '../physics/movement.js';
import { MOVE, horizontalSpeed } from '../physics/movement.js';
import type { Vec3 } from '../math/vec3.js';
import { dirFromAngles } from '../math/vec3.js';
import { hash32, mulberry32 } from '../math/rng.js';

/**
 * Estado da arma, simulado por input (não por relógio) para que a predição do
 * cliente e o servidor cheguem ao mesmo resultado ao reaplicar inputs.
 */
export interface WeaponState {
  weaponId: string;
  ammo: number;
  reserve: number;
  /** Ticks até poder disparar de novo. */
  cooldown: number;
  /** Ticks restantes de recarga (0 = sem recarga). */
  reloadLeft: number;
  /** Ticks restantes da animação de equipar. */
  equipLeft: number;
  /** Gatilho estava pressionado no input anterior (disparo semiautomático). */
  triggerHeld: boolean;
  /** Contador de disparos (alimenta o RNG de dispersão). */
  shotCounter: number;
  /** Dispersão acumulada por disparos seguidos. */
  bloom: number;
}

export const createWeaponState = (weaponId: string): WeaponState => {
  const w = getWeapon(weaponId);
  return {
    weaponId,
    ammo: w.magSize,
    reserve: w.reserveAmmo,
    cooldown: 0,
    reloadLeft: 0,
    equipLeft: w.equipTicks,
    triggerHeld: false,
    shotCounter: 0,
    bloom: 0,
  };
};

export const cloneWeaponState = (s: WeaponState): WeaponState => ({ ...s });

export interface WeaponStepResult {
  fired: boolean;
  reloadStarted: boolean;
  reloadFinished: boolean;
  /** Tentou disparar com o carregador vazio (som de "clique"). */
  dryFire: boolean;
  /** Índice do disparo (para RNG) quando `fired`. */
  shotIndex: number;
  /** Dispersão usada no disparo. */
  spread: number;
}

/** Dispersão atual conforme movimento e bloom. */
export const currentSpread = (w: WeaponDef, move: MoveState, buttons: number, bloom: number): number => {
  const sp = w.spread;
  let base: number;
  const hs = horizontalSpeed(move);
  if (!move.onGround) base = sp.air;
  else if (hs > MOVE.walkSpeed * 1.05 && buttons & Buttons.Sprint) base = sp.sprint;
  else if (hs > 0.8) base = sp.moving * Math.min(1, hs / MOVE.walkSpeed);
  else base = move.crouched ? sp.crouch : sp.base;
  base = Math.max(base, move.crouched ? sp.crouch : sp.base);
  return base + Math.min(bloom, sp.max);
};

/** Avança o estado da arma em um tick de input. */
export const stepWeapon = (ws: WeaponState, buttons: number, move: MoveState, canFire: boolean): WeaponStepResult => {
  const w = getWeapon(ws.weaponId);
  const res: WeaponStepResult = {
    fired: false,
    reloadStarted: false,
    reloadFinished: false,
    dryFire: false,
    shotIndex: -1,
    spread: 0,
  };

  if (ws.cooldown > 0) ws.cooldown--;
  if (ws.equipLeft > 0) ws.equipLeft--;
  ws.bloom = Math.max(0, ws.bloom - w.spread.recoveryPerTick);

  if (ws.reloadLeft > 0) {
    ws.reloadLeft--;
    if (ws.reloadLeft === 0) {
      const need = w.magSize - ws.ammo;
      const take = Math.min(need, ws.reserve);
      ws.ammo += take;
      ws.reserve -= take;
      res.reloadFinished = true;
    }
  }

  const fireDown = (buttons & Buttons.Fire) !== 0;
  const firePressed = fireDown && !ws.triggerHeld;
  ws.triggerHeld = fireDown;

  const wantsReload = (buttons & Buttons.Reload) !== 0;
  const busy = ws.reloadLeft > 0 || ws.equipLeft > 0;

  if (!busy && wantsReload && ws.ammo < w.magSize && ws.reserve > 0) {
    ws.reloadLeft = w.reloadTicks;
    res.reloadStarted = true;
    return res;
  }

  const triggerOk = w.fireMode === 'auto' ? fireDown : firePressed;
  if (!busy && canFire && triggerOk && ws.cooldown === 0) {
    if (ws.ammo <= 0) {
      if (firePressed) {
        res.dryFire = true;
        // Recarga automática ao tentar disparar sem munição.
        if (ws.reserve > 0) {
          ws.reloadLeft = w.reloadTicks;
          res.reloadStarted = true;
        }
      }
      return res;
    }
    res.spread = currentSpread(w, move, buttons, ws.bloom);
    ws.ammo--;
    ws.cooldown = w.fireIntervalTicks;
    ws.bloom = Math.min(w.spread.max, ws.bloom + w.spread.perShot);
    res.fired = true;
    res.shotIndex = ws.shotCounter++;
  }
  return res;
};

/**
 * Direção de um projétil com dispersão determinística.
 * Mesma entrada → mesma direção no cliente e no servidor.
 */
export const shotDirection = (
  yaw: number,
  pitch: number,
  spread: number,
  seed: number,
  shotIndex: number,
  pellet: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 => {
  const rnd = mulberry32(hash32(seed, shotIndex * 31 + pellet));
  // Distribuição uniforme no disco (sqrt), em radianos.
  const r = Math.sqrt(rnd()) * spread;
  const a = rnd() * Math.PI * 2;
  return dirFromAngles(yaw + Math.cos(a) * r, pitch + Math.sin(a) * r, out);
};
