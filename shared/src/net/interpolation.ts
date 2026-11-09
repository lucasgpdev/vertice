import type { EntitySnap } from '../protocols/messages.js';
import { INTERP_DELAY_MS } from '../constants/game.js';
import { lerpAngle } from '../math/vec3.js';

/**
 * Relógio de snapshots: estima o "tempo do servidor como chega até nós"
 * (tempo do servidor − latência de ida). A renderização das entidades remotas
 * usa esse relógio − INTERP_DELAY_MS, e o mesmo valor vai no input (`vt`)
 * para o servidor fazer o rewind exatamente para o que o jogador viu.
 */
export class SnapshotClock {
  private offset = 0;
  private hasOffset = false;

  /** Chamado a cada snapshot recebido. */
  observe(serverTime: number, localNow: number): void {
    const sample = serverTime - localNow;
    if (!this.hasOffset || Math.abs(sample - this.offset) > 250) {
      this.offset = sample;
      this.hasOffset = true;
      return;
    }
    // Suavização assimétrica: snapshots "adiantados" puxam mais rápido que os
    // atrasados (atrasos costumam ser jitter, adiantamentos indicam deriva).
    const a = sample > this.offset ? 0.1 : 0.02;
    this.offset += (sample - this.offset) * a;
  }

  get ready(): boolean {
    return this.hasOffset;
  }

  serverTime(localNow: number): number {
    return localNow + this.offset;
  }

  renderTime(localNow: number, delay = INTERP_DELAY_MS): number {
    return this.serverTime(localNow) - delay;
  }

  reset(): void {
    this.hasOffset = false;
  }
}

export interface InterpolatedEntity {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouchT: number;
  onGround: boolean;
  speed: number;
  hp: number;
  alive: boolean;
  weaponId: string;
  life: number;
}

interface Frame {
  time: number;
  ents: Map<string, EntitySnap>;
}

/** Buffer de snapshots e interpolação das entidades remotas. */
export class InterpolationBuffer {
  private frames: Frame[] = [];

  push(time: number, ents: EntitySnap[]): void {
    const last = this.frames[this.frames.length - 1];
    if (last && time <= last.time) return; // fora de ordem/duplicado
    this.frames.push({ time, ents: new Map(ents.map((e) => [e.id, e])) });
    // Mantém ~1 s de histórico.
    while (this.frames.length > 40) this.frames.shift();
  }

  clear(): void {
    this.frames = [];
  }

  get latestTime(): number {
    return this.frames[this.frames.length - 1]?.time ?? 0;
  }

  /** Amostra todas as entidades no instante `t` (tempo do servidor). */
  sample(t: number): Map<string, InterpolatedEntity> {
    const out = new Map<string, InterpolatedEntity>();
    const n = this.frames.length;
    if (n === 0) return out;
    let a: Frame = this.frames[0]!;
    let b: Frame = a;
    if (t >= this.frames[n - 1]!.time) {
      a = b = this.frames[n - 1]!;
    } else if (t > a.time) {
      for (let i = n - 1; i > 0; i--) {
        if (this.frames[i - 1]!.time <= t) {
          a = this.frames[i - 1]!;
          b = this.frames[i]!;
          break;
        }
      }
    }
    const k = b.time === a.time ? 1 : (t - a.time) / (b.time - a.time);
    for (const [id, eb] of b.ents) {
      const ea = a.ents.get(id);
      if (!ea || ea.tp !== eb.tp || !ea.a || !eb.a) {
        out.set(id, toInterp(eb));
        continue;
      }
      out.set(id, {
        id,
        x: ea.p[0] + (eb.p[0] - ea.p[0]) * k,
        y: ea.p[1] + (eb.p[1] - ea.p[1]) * k,
        z: ea.p[2] + (eb.p[2] - ea.p[2]) * k,
        yaw: lerpAngle(ea.y, eb.y, k),
        pitch: ea.pi + (eb.pi - ea.pi) * k,
        crouchT: ea.ct + (eb.ct - ea.ct) * k,
        onGround: k < 0.5 ? ea.g : eb.g,
        speed: ea.sp + (eb.sp - ea.sp) * k,
        hp: eb.hp,
        alive: eb.a,
        weaponId: eb.w,
        life: eb.tp,
      });
    }
    return out;
  }
}

const toInterp = (e: EntitySnap): InterpolatedEntity => ({
  id: e.id,
  x: e.p[0],
  y: e.p[1],
  z: e.p[2],
  yaw: e.y,
  pitch: e.pi,
  crouchT: e.ct,
  onGround: e.g,
  speed: e.sp,
  hp: e.hp,
  alive: e.a,
  weaponId: e.w,
  life: e.tp,
});
