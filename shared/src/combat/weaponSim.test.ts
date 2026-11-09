import { describe, expect, it } from 'vitest';
import { createWeaponState, shotDirection, stepWeapon } from './weaponSim.js';
import { createMoveState } from '../physics/movement.js';
import { Buttons } from '../protocols/buttons.js';
import { WEAPONS, computeDamage, getWeapon } from '../data/weapons.js';
import { rayHitboxes } from '../physics/hitbox.js';

const pistol = getWeapon('pistol-corvo');
const grounded = () => {
  const m = createMoveState(0, 0, 0);
  m.onGround = true;
  return m;
};

describe('simulação de arma', () => {
  it('semiautomática: segurar o gatilho dispara uma vez só', () => {
    const ws = createWeaponState(pistol.id);
    ws.equipLeft = 0;
    let shots = 0;
    for (let i = 0; i < 120; i++) if (stepWeapon(ws, Buttons.Fire, grounded(), true).fired) shots++;
    expect(shots).toBe(1);
  });

  it('respeita a cadência máxima mesmo clicando a cada tick', () => {
    const ws = createWeaponState(pistol.id);
    ws.equipLeft = 0;
    ws.reserve = 0;
    let shots = 0;
    for (let i = 0; i < 60; i++) if (stepWeapon(ws, i % 2 === 0 ? Buttons.Fire : 0, grounded(), true).fired) shots++;
    // 60 ticks / intervalo de 9 ticks → no máximo 7 disparos
    expect(shots).toBeLessThanOrEqual(Math.ceil(60 / pistol.fireIntervalTicks));
    expect(shots).toBeGreaterThan(0);
  });

  it('não dispara sem munição e recarrega a partir da reserva', () => {
    const ws = createWeaponState(pistol.id);
    ws.equipLeft = 0;
    ws.ammo = 0;
    const r = stepWeapon(ws, Buttons.Fire, grounded(), true);
    expect(r.fired).toBe(false);
    expect(r.dryFire).toBe(true);
    expect(r.reloadStarted).toBe(true);
    for (let i = 0; i < pistol.reloadTicks; i++) stepWeapon(ws, 0, grounded(), true);
    expect(ws.ammo).toBe(pistol.magSize);
    expect(ws.reserve).toBe(pistol.reserveAmmo - pistol.magSize);
  });

  it('direção de disparo é determinística por (semente, índice)', () => {
    const a = shotDirection(0.3, 0.1, 0.05, 1234, 7, 0);
    const b = shotDirection(0.3, 0.1, 0.05, 1234, 7, 0);
    const c = shotDirection(0.3, 0.1, 0.05, 1234, 8, 0);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('dano por região e queda por distância', () => {
    expect(computeDamage(pistol, 'head', 5)).toBe(102);
    expect(computeDamage(pistol, 'torso', 5)).toBe(30);
    expect(computeDamage(pistol, 'legs', 5)).toBe(23);
    expect(computeDamage(pistol, 'torso', 100)).toBe(21);
  });

  it('todas as armas definidas têm dados coerentes', () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.magSize).toBeGreaterThan(0);
      expect(w.fireIntervalTicks).toBeGreaterThan(0);
      expect(w.falloff.end).toBeGreaterThan(w.falloff.start);
    }
  });
});

describe('hitboxes', () => {
  it('raio na altura da cabeça acerta a cabeça; no peito acerta o tronco', () => {
    const target = { pos: { x: 0, y: 0, z: -10 }, crouchT: 0 };
    const head = rayHitboxes({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }, target, 50);
    expect(head?.region).toBe('head');
    const chest = rayHitboxes({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0, z: -1 }, target, 50);
    expect(chest?.region).toBe('torso');
    const miss = rayHitboxes({ x: 1, y: 1.2, z: 0 }, { x: 0, y: 0, z: -1 }, target, 50);
    expect(miss).toBeNull();
  });

  it('agachado, a cabeça desce', () => {
    const target = { pos: { x: 0, y: 0, z: -10 }, crouchT: 1 };
    const r = rayHitboxes({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }, target, 50);
    expect(r).toBeNull();
  });
});
