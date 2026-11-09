import type { Vec3 } from '../math/vec3.js';
import { clamp } from '../math/vec3.js';
import type { CollisionWorld } from './world.js';
import type { AABB } from './aabb.js';
import { aabbOverlap } from './aabb.js';
import { Buttons } from '../protocols/buttons.js';

/**
 * Movimento do jogador — código ÚNICO executado pelo servidor (autoritativo)
 * e pelo cliente (predição). Qualquer diferença aqui quebra a reconciliação,
 * então tudo é determinístico e depende apenas de (estado, input, mundo).
 */

export const MOVE = {
  halfWidth: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.15,
  standEye: 1.62,
  crouchEye: 1.0,
  walkSpeed: 4.6,
  sprintSpeed: 6.4,
  crouchSpeed: 2.2,
  groundAccel: 11,
  airAccel: 1.6,
  airSpeedCap: 0.9,
  friction: 7,
  stopSpeed: 1.6,
  gravity: 20,
  jumpVelocity: 6.6,
  terminalVelocity: 25,
  stepHeight: 0.45,
  /** Velocidade de transição do agachamento (unidades de 0..1 por segundo). */
  crouchRate: 8,
} as const;

export interface MoveState {
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  /** Intenção/estado de agachamento atual (com colisão de teto respeitada). */
  crouched: boolean;
  /** 0 = em pé, 1 = agachado (suaviza altura do olho). */
  crouchT: number;
  /** Pulo exige soltar a tecla entre pulos. */
  jumpHeld: boolean;
}

export interface MoveInput {
  buttons: number;
  yaw: number;
  pitch: number;
}

export interface MoveModifiers {
  /** Multiplicador de velocidade da arma equipada. */
  speedMult: number;
}

export const createMoveState = (x: number, y: number, z: number): MoveState => ({
  pos: { x, y, z },
  vel: { x: 0, y: 0, z: 0 },
  onGround: false,
  crouched: false,
  crouchT: 0,
  jumpHeld: false,
});

export const cloneMoveState = (s: MoveState): MoveState => ({
  pos: { ...s.pos },
  vel: { ...s.vel },
  onGround: s.onGround,
  crouched: s.crouched,
  crouchT: s.crouchT,
  jumpHeld: s.jumpHeld,
});

export const playerHeight = (s: MoveState): number => (s.crouched ? MOVE.crouchHeight : MOVE.standHeight);

export const eyeHeight = (s: MoveState): number =>
  MOVE.standEye + (MOVE.crouchEye - MOVE.standEye) * s.crouchT;

const scratch: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

const boxAt = (x: number, y: number, z: number, h: number, out: AABB = scratch): AABB => {
  out.min.x = x - MOVE.halfWidth;
  out.min.y = y;
  out.min.z = z - MOVE.halfWidth;
  out.max.x = x + MOVE.halfWidth;
  out.max.y = y + h;
  out.max.z = z + MOVE.halfWidth;
  return out;
};

const collides = (world: CollisionWorld, x: number, y: number, z: number, h: number): boolean => {
  const b = boxAt(x, y, z, h);
  let hit = false;
  world.queryRegion(b.min.x, b.min.z, b.max.x, b.max.z, (box) => {
    if (!hit && aabbOverlap(b, box, 1e-6)) hit = true;
  });
  return hit;
};

const SKIN = 1e-4;

/**
 * Move em um eixo e resolve a colisão empurrando para fora das caixas.
 * Retorna true se colidiu.
 */
const moveAxis = (world: CollisionWorld, s: MoveState, axis: 'x' | 'y' | 'z', delta: number, h: number): boolean => {
  if (delta === 0) return false;
  s.pos[axis] += delta;
  const b = boxAt(s.pos.x, s.pos.y, s.pos.z, h);
  let hit = false;
  world.queryRegion(b.min.x, b.min.z, b.max.x, b.max.z, (box) => {
    if (!aabbOverlap(b, box, 1e-6)) return;
    hit = true;
    if (axis === 'y') {
      if (delta > 0) s.pos.y = box.min.y - h - SKIN;
      else s.pos.y = box.max.y + SKIN;
    } else {
      const half = MOVE.halfWidth;
      if (delta > 0) s.pos[axis] = box.min[axis] - half - SKIN;
      else s.pos[axis] = box.max[axis] + half + SKIN;
    }
    boxAt(s.pos.x, s.pos.y, s.pos.z, h, b);
  });
  return hit;
};

/** Desloca horizontalmente com colisão por eixo. Retorna se colidiu em algum eixo. */
const moveHorizontal = (world: CollisionWorld, s: MoveState, dx: number, dz: number, h: number): { hx: boolean; hz: boolean } => {
  const hx = moveAxis(world, s, 'x', dx, h);
  const hz = moveAxis(world, s, 'z', dz, h);
  return { hx, hz };
};

/** Calcula a direção desejada (mundo) a partir dos botões e do yaw. */
const wishDir = (buttons: number, yaw: number): { x: number; z: number } => {
  let f = 0;
  let r = 0;
  if (buttons & Buttons.Forward) f += 1;
  if (buttons & Buttons.Back) f -= 1;
  if (buttons & Buttons.Right) r += 1;
  if (buttons & Buttons.Left) r -= 1;
  if (f === 0 && r === 0) return { x: 0, z: 0 };
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // frente = (-sin, -cos), direita = (cos, -sin)
  let x = -sin * f + cos * r;
  let z = -cos * f - sin * r;
  const len = Math.hypot(x, z);
  x /= len;
  z /= len;
  return { x, z };
};

const accelerate = (vel: Vec3, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void => {
  const current = vel.x * wx + vel.z * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let speed = accel * wishSpeed * dt;
  if (speed > add) speed = add;
  vel.x += speed * wx;
  vel.z += speed * wz;
};

const applyFriction = (vel: Vec3, dt: number): void => {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) {
    vel.x = 0;
    vel.z = 0;
    return;
  }
  const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
  const drop = control * MOVE.friction * dt;
  const ns = Math.max(0, speed - drop) / speed;
  vel.x *= ns;
  vel.z *= ns;
};

/** Velocidade-alvo conforme estado (correr só para frente, como na maioria dos FPS). */
export const targetSpeed = (s: MoveState, buttons: number, mods: MoveModifiers): number => {
  let base: number = MOVE.walkSpeed;
  if (s.crouched) base = MOVE.crouchSpeed;
  else if (buttons & Buttons.Sprint && buttons & Buttons.Forward && !(buttons & Buttons.Back)) base = MOVE.sprintSpeed;
  return base * mods.speedMult;
};

/** Avança a simulação de movimento em `dt` segundos. Muta `s`. */
export const simulateMove = (
  s: MoveState,
  input: MoveInput,
  world: CollisionWorld,
  dt: number,
  mods: MoveModifiers = { speedMult: 1 },
): void => {
  const b = input.buttons;

  // --- agachamento (precisa de espaço para levantar) ---
  const wantCrouch = (b & Buttons.Crouch) !== 0;
  if (wantCrouch && !s.crouched) {
    s.crouched = true;
    // No ar, agachar recolhe as pernas: sobe os pés para manter a cabeça no lugar.
    if (!s.onGround) {
      const lift = MOVE.standHeight - MOVE.crouchHeight;
      if (!collides(world, s.pos.x, s.pos.y + lift, s.pos.z, MOVE.crouchHeight)) s.pos.y += lift;
    }
  } else if (!wantCrouch && s.crouched) {
    if (!collides(world, s.pos.x, s.pos.y, s.pos.z, MOVE.standHeight)) s.crouched = false;
  }
  s.crouchT = clamp(s.crouchT + (s.crouched ? 1 : -1) * MOVE.crouchRate * dt, 0, 1);
  const h = playerHeight(s);

  // --- pulo ---
  const jumpPressed = (b & Buttons.Jump) !== 0;
  if (jumpPressed && !s.jumpHeld && s.onGround && !s.crouched) {
    s.vel.y = MOVE.jumpVelocity;
    s.onGround = false;
  }
  s.jumpHeld = jumpPressed;

  // --- aceleração horizontal ---
  const wish = wishDir(b, input.yaw);
  const speed = targetSpeed(s, b, mods);
  if (s.onGround) {
    applyFriction(s.vel, dt);
    accelerate(s.vel, wish.x, wish.z, speed, MOVE.groundAccel, dt);
  } else {
    accelerate(s.vel, wish.x, wish.z, Math.min(speed, MOVE.airSpeedCap), MOVE.airAccel * 10, dt);
  }

  // --- gravidade ---
  s.vel.y = Math.max(s.vel.y - MOVE.gravity * dt, -MOVE.terminalVelocity);

  // --- deslocamento horizontal com subida de degraus ---
  const dx = s.vel.x * dt;
  const dz = s.vel.z * dt;
  const wasOnGround = s.onGround;
  const start = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
  const res = moveHorizontal(world, s, dx, dz, h);
  if ((res.hx || res.hz) && wasOnGround) {
    // Tenta de novo partindo de uma posição elevada (degrau).
    const flat = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    const flatDist = Math.hypot(flat.x - start.x, flat.z - start.z);
    s.pos.x = start.x;
    s.pos.y = start.y;
    s.pos.z = start.z;
    const upHit = moveAxis(world, s, 'y', MOVE.stepHeight, h);
    const raised = s.pos.y - start.y;
    let stepped = false;
    if (raised > 0.05 || !upHit) {
      const r2 = moveHorizontal(world, s, dx, dz, h);
      // Desce de volta até o chão.
      const downHit = moveAxis(world, s, 'y', -raised - SKIN * 2, h);
      const stepDist = Math.hypot(s.pos.x - start.x, s.pos.z - start.z);
      if (downHit && stepDist > flatDist + 1e-4) {
        stepped = true;
        if (!r2.hx) {
          /* mantém vel.x */
        } else s.vel.x = 0;
        if (r2.hz) s.vel.z = 0;
      }
    }
    if (!stepped) {
      s.pos.x = flat.x;
      s.pos.y = flat.y;
      s.pos.z = flat.z;
      if (res.hx) s.vel.x = 0;
      if (res.hz) s.vel.z = 0;
    }
  } else {
    if (res.hx) s.vel.x = 0;
    if (res.hz) s.vel.z = 0;
  }

  // --- deslocamento vertical ---
  const dy = s.vel.y * dt;
  const vHit = moveAxis(world, s, 'y', dy, h);
  if (vHit) {
    if (dy < 0) s.onGround = true;
    s.vel.y = 0;
  } else {
    s.onGround = false;
    // Gruda no chão ao descer degraus/rampas pequenas (não ao pular).
    if (wasOnGround && s.vel.y <= 0) {
      const before = s.pos.y;
      const snapHit = moveAxis(world, s, 'y', -MOVE.stepHeight, h);
      if (snapHit) {
        s.onGround = true;
        s.vel.y = 0;
      } else s.pos.y = before;
    }
  }

  // Segurança: limites do mundo (nunca cair para sempre).
  if (s.pos.y < -50) {
    s.pos.y = 5;
    s.vel.y = 0;
  }
};

/** Velocidade horizontal (para dispersão/animação). */
export const horizontalSpeed = (s: MoveState): number => Math.hypot(s.vel.x, s.vel.z);
