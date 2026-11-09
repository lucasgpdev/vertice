import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './world.js';
import { MOVE, createMoveState, cloneMoveState, simulateMove } from './movement.js';
import { Buttons } from '../protocols/buttons.js';
import { TICK_DT } from '../constants/game.js';
import { ARENA } from '../data/maps/arena.js';
import type { AABB } from './aabb.js';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
});
const floor = box(-50, -1, -50, 50, 0, 50);

const run = (world: CollisionWorld, s = createMoveState(0, 0, 0), buttons: number, ticks: number, yaw = 0) => {
  for (let i = 0; i < ticks; i++) simulateMove(s, { buttons, yaw, pitch: 0 }, world, TICK_DT);
  return s;
};

describe('movimento compartilhado', () => {
  it('cai por gravidade e para no chão', () => {
    const w = new CollisionWorld([floor]);
    const s = run(w, createMoveState(0, 3, 0), 0, 120);
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBeGreaterThanOrEqual(0);
    expect(s.pos.y).toBeLessThan(0.01);
  });

  it('anda para frente (-Z com yaw 0) e respeita a velocidade máxima', () => {
    const w = new CollisionWorld([floor]);
    const s = run(w, createMoveState(0, 0, 0), Buttons.Forward, 60);
    expect(s.pos.z).toBeLessThan(-3);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThanOrEqual(MOVE.walkSpeed + 1e-6);
  });

  it('é determinístico: mesma sequência → mesmo estado', () => {
    const w = new CollisionWorld(ARENA.boxes);
    const seq = Array.from({ length: 600 }, (_, i) => ({
      buttons: (i % 50 < 30 ? Buttons.Forward : Buttons.Left) | (i % 90 === 0 ? Buttons.Jump : 0) | (i % 200 > 150 ? Buttons.Crouch : 0),
      yaw: i * 0.013,
      pitch: 0,
    }));
    const a = createMoveState(-16, 0, -16);
    const b = cloneMoveState(a);
    for (const inp of seq) simulateMove(a, inp, w, TICK_DT);
    for (const inp of seq) simulateMove(b, inp, w, TICK_DT);
    expect(b).toEqual(a);
  });

  it('não atravessa paredes', () => {
    const w = new CollisionWorld([floor, box(-5, 0, -2.2, 5, 3, -2)]);
    const s = run(w, createMoveState(0, 0, 0), Buttons.Forward | Buttons.Sprint, 240);
    expect(s.pos.z).toBeGreaterThan(-2 + MOVE.halfWidth - 1e-3);
  });

  it('sobe degraus de até stepHeight e não sobe muros altos', () => {
    const step = new CollisionWorld([floor, box(-5, 0, -10, 5, 0.4, -2)]);
    const s1 = run(step, createMoveState(0, 0, 0), Buttons.Forward, 120);
    expect(s1.pos.y).toBeCloseTo(0.4, 2);
    expect(s1.pos.z).toBeLessThan(-3);

    const wall = new CollisionWorld([floor, box(-5, 0, -10, 5, 0.8, -2)]);
    const s2 = run(wall, createMoveState(0, 0, 0), Buttons.Forward, 120);
    expect(s2.pos.y).toBeLessThan(0.01);
    expect(s2.pos.z).toBeGreaterThan(-2);
  });

  it('pulo atinge ~1 m e exige soltar a tecla', () => {
    const w = new CollisionWorld([floor]);
    const s = createMoveState(0, 0, 0);
    run(w, s, 0, 5);
    let maxY = 0;
    for (let i = 0; i < 120; i++) {
      simulateMove(s, { buttons: Buttons.Jump, yaw: 0, pitch: 0 }, w, TICK_DT);
      maxY = Math.max(maxY, s.pos.y);
    }
    expect(maxY).toBeGreaterThan(0.9);
    expect(maxY).toBeLessThan(1.3);
    // Segurando a tecla não pula de novo.
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBeLessThan(0.01);
  });

  it('agachado não levanta sob teto baixo', () => {
    const w = new CollisionWorld([floor, box(-5, 1.4, -5, 5, 2, 5)]);
    const s = createMoveState(-8, 0, 0);
    run(w, s, 0, 5);
    run(w, s, Buttons.Crouch | Buttons.Right, 120, 0); // entra agachado embaixo do teto
    expect(s.crouched).toBe(true);
    expect(s.pos.x).toBeGreaterThan(-5);
    run(w, s, 0, 30); // solta o agachar
    expect(s.crouched).toBe(true);
  });

  it('todos os spawns da arena estão livres e apoiados no chão', () => {
    const w = new CollisionWorld(ARENA.boxes);
    for (const sp of ARENA.spawns) {
      const s = run(w, createMoveState(sp.x, sp.y + 0.05, sp.z), 0, 30);
      expect(s.onGround).toBe(true);
      expect(Math.abs(s.pos.x - sp.x)).toBeLessThan(1e-3);
      expect(Math.abs(s.pos.z - sp.z)).toBeLessThan(1e-3);
    }
  });

  it('consegue subir a escada da plataforma central', () => {
    const w = new CollisionWorld(ARENA.boxes);
    // Parte do leste e anda para oeste (yaw = +PI/2 → frente = -X).
    const s = run(w, createMoveState(5.5, 0, 0), Buttons.Forward, 70, Math.PI / 2);
    expect(s.pos.y).toBeCloseTo(1.6, 1);
  });
});
