import type { HitRegion } from '../physics/hitbox.js';

/**
 * Definições de armas orientadas a dados. Servidor (dano, cadência, munição)
 * e cliente (viewmodel, sons, efeitos) leem a MESMA definição.
 * Fase 1: apenas uma pistola. Novas armas = novas entradas aqui.
 */
export type FireMode = 'semi' | 'auto' | 'burst' | 'bolt';
export type WeaponCategory = 'pistol' | 'rifle' | 'sniper' | 'shotgun' | 'smg' | 'lmg' | 'melee' | 'equipment';
export type ReloadType = 'magazine' | 'single';

export interface WeaponDef {
  id: string;
  /** Nome comercial original (não usa marcas/modelos reais). */
  name: string;
  category: WeaponCategory;
  fireMode: FireMode;
  /** Dano base antes do multiplicador de região. */
  damage: number;
  regionMultiplier: Record<HitRegion, number>;
  /** Queda de dano: até `start` m = 100%; em `end` m = `minFactor`. */
  falloff: { start: number; end: number; minFactor: number };
  /** Intervalo mínimo entre disparos, em ticks de simulação (60 Hz). */
  fireIntervalTicks: number;
  magSize: number;
  reserveAmmo: number;
  reloadTicks: number;
  reloadType: ReloadType;
  range: number;
  pellets: number;
  /** Dispersão (radianos, meio-ângulo do cone). */
  spread: {
    base: number;
    crouch: number;
    moving: number;
    sprint: number;
    air: number;
    /** Acréscimo por disparo (bloom) e recuperação por tick. */
    perShot: number;
    recoveryPerTick: number;
    max: number;
  };
  /** Recuo visual (câmera) — Fase 1 é apenas visual, não altera a mira real. */
  recoil: { pitchKick: number; yawJitter: number; recoverySpeed: number };
  equipTicks: number;
  moveSpeedMult: number;
  price: number;
  /** Ids no manifesto de assets. */
  assets: {
    viewModel: string;
    worldModel: string;
    sounds: { fire: string; reload: string; equip: string };
  };
}

export const WEAPONS: Record<string, WeaponDef> = {
  'pistol-corvo': {
    id: 'pistol-corvo',
    name: 'Corvo SA-12',
    category: 'pistol',
    fireMode: 'semi',
    damage: 30,
    regionMultiplier: { head: 3.4, torso: 1.0, legs: 0.75 },
    falloff: { start: 12, end: 45, minFactor: 0.7 },
    fireIntervalTicks: 9, // 150 ms → 400 disparos/min máx.
    magSize: 12,
    reserveAmmo: 48,
    reloadTicks: Math.round(2.1 * 60),
    reloadType: 'magazine',
    range: 120,
    pellets: 1,
    spread: {
      base: 0.004,
      crouch: 0.0025,
      moving: 0.022,
      sprint: 0.05,
      air: 0.09,
      perShot: 0.012,
      recoveryPerTick: 0.0011,
      max: 0.05,
    },
    recoil: { pitchKick: 0.022, yawJitter: 0.006, recoverySpeed: 9 },
    equipTicks: Math.round(0.45 * 60),
    moveSpeedMult: 1.0,
    price: 0,
    assets: {
      viewModel: 'weapon.pistol-corvo.view',
      worldModel: 'weapon.pistol-corvo.world',
      sounds: { fire: 'sfx.pistol.fire', reload: 'sfx.pistol.reload', equip: 'sfx.weapon.equip' },
    },
  },
};

export const DEFAULT_WEAPON_ID = 'pistol-corvo';

export const getWeapon = (id: string): WeaponDef => {
  const w = WEAPONS[id];
  if (!w) throw new Error(`Arma desconhecida: ${id}`);
  return w;
};

/** Dano final para uma região e distância. Inteiro, decidido pelo servidor. */
export const computeDamage = (w: WeaponDef, region: HitRegion, distance: number): number => {
  const { start, end, minFactor } = w.falloff;
  let f = 1;
  if (distance > start) {
    const k = Math.min(1, (distance - start) / (end - start));
    f = 1 + (minFactor - 1) * k;
  }
  return Math.max(1, Math.round(w.damage * w.regionMultiplier[region] * f));
};
