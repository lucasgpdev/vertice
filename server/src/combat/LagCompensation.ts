import { HISTORY_TICKS } from '@vertice/shared';
import type { HitTarget, Vec3 } from '@vertice/shared';

interface Sample {
  time: number;
  x: number;
  y: number;
  z: number;
  crouchT: number;
  alive: boolean;
  /** Contador de spawn: não interpola entre vidas diferentes. */
  life: number;
}

/**
 * Histórico circular de posições de um jogador para "rewind" de disparos.
 * O servidor grava uma amostra por tick, com o mesmo carimbo de tempo enviado
 * nos snapshots — assim o rewind reproduz o que o atirador estava vendo.
 */
export class PositionHistory {
  private readonly buf: Sample[] = [];
  private head = 0;

  record(time: number, pos: Vec3, crouchT: number, alive: boolean, life: number): void {
    const s: Sample = { time, x: pos.x, y: pos.y, z: pos.z, crouchT, alive, life };
    if (this.buf.length < HISTORY_TICKS) this.buf.push(s);
    else {
      this.buf[this.head] = s;
      this.head = (this.head + 1) % HISTORY_TICKS;
    }
  }

  clear(): void {
    this.buf.length = 0;
    this.head = 0;
  }

  /** Amostras em ordem cronológica. */
  private ordered(): Sample[] {
    if (this.buf.length < HISTORY_TICKS) return this.buf;
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  /** Estado interpolado no instante `time`, ou null se o jogador não estava vivo. */
  sample(time: number): (HitTarget & { alive: boolean }) | null {
    const list = this.ordered();
    if (list.length === 0) return null;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (time <= first.time) return first.alive ? toTarget(first) : null;
    if (time >= last.time) return last.alive ? toTarget(last) : null;
    for (let i = list.length - 1; i > 0; i--) {
      const a = list[i - 1]!;
      const b = list[i]!;
      if (a.time <= time && time <= b.time) {
        if (!a.alive || !b.alive || a.life !== b.life) {
          const near = time - a.time < b.time - time ? a : b;
          return near.alive ? toTarget(near) : null;
        }
        const t = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
        return {
          pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
          crouchT: a.crouchT + (b.crouchT - a.crouchT) * t,
          alive: true,
        };
      }
    }
    return null;
  }
}

const toTarget = (s: Sample): HitTarget & { alive: boolean } => ({
  pos: { x: s.x, y: s.y, z: s.z },
  crouchT: s.crouchT,
  alive: s.alive,
});
