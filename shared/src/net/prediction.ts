import type { InputCmd, SelfSnap } from '../protocols/messages.js';
import type { PlayerSimState } from '../sim/playerSim.js';
import { clonePlayerSim, createPlayerSim, stepPlayerSim } from '../sim/playerSim.js';
import type { WeaponStepResult } from '../combat/weaponSim.js';
import type { CollisionWorld } from '../physics/world.js';
import { DEFAULT_WEAPON_ID } from '../data/weapons.js';

/** Converte o estado oficial recebido no snapshot em estado de simulação. */
export const simFromSelfSnap = (s: SelfSnap): PlayerSimState => ({
  move: {
    pos: { x: s.pos[0], y: s.pos[1], z: s.pos[2] },
    vel: { x: s.vel[0], y: s.vel[1], z: s.vel[2] },
    onGround: s.g,
    crouched: s.c,
    crouchT: s.ct,
    jumpHeld: s.jh,
  },
  weapon: {
    weaponId: s.w.id,
    ammo: s.w.ammo,
    reserve: s.w.reserve,
    cooldown: s.w.cd,
    reloadLeft: s.w.rl,
    equipLeft: s.w.eq,
    triggerHeld: s.w.th,
    shotCounter: s.w.sc,
    bloom: s.w.bl,
  },
  seed: s.seed,
});

export interface ReconcileResult {
  /** Diferença entre a posição prevista antes e depois (para suavização visual). */
  dx: number;
  dy: number;
  dz: number;
  teleported: boolean;
  /** Quantos inputs foram reaplicados. */
  replayed: number;
}

/**
 * Predição do lado do cliente + reconciliação.
 * Mantém os inputs ainda não confirmados; ao chegar o estado oficial, volta a
 * ele e reaplica os pendentes com o MESMO código de simulação do servidor.
 */
export class Predictor {
  state: PlayerSimState;
  private pending: InputCmd[] = [];
  private seq = 0;
  alive = false;
  hp = 100;
  life = -1;
  /** Erro de predição na última reconciliação (m), para o painel de debug. */
  lastError = 0;

  constructor(private readonly world: CollisionWorld) {
    this.state = createPlayerSim(0, 0, 0, DEFAULT_WEAPON_ID, 1);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Cria o próximo input, aplica localmente e o guarda como pendente. */
  step(buttons: number, yaw: number, pitch: number, viewTime: number): { cmd: InputCmd; result: WeaponStepResult | null } {
    const cmd: InputCmd = { s: this.seq++, b: buttons, y: yaw, p: pitch, vt: Math.max(0, viewTime) };
    this.pending.push(cmd);
    if (this.pending.length > 240) this.pending.shift();
    const result = this.alive ? stepPlayerSim(this.state, { seq: cmd.s, buttons, yaw, pitch }, this.world, true) : null;
    return { cmd, result };
  }

  reconcile(snap: SelfSnap): ReconcileResult {
    const before = { ...this.state.move.pos };
    const teleported = snap.tp !== this.life;
    this.life = snap.tp;
    this.alive = snap.alive;
    this.hp = snap.hp;
    this.pending = this.pending.filter((c) => c.s > snap.ack);
    this.state = simFromSelfSnap(snap);
    let replayed = 0;
    if (this.alive) {
      for (const c of this.pending) {
        stepPlayerSim(this.state, { seq: c.s, buttons: c.b, yaw: c.y, pitch: c.p }, this.world, true);
        replayed++;
      }
    }
    const p = this.state.move.pos;
    const dx = before.x - p.x;
    const dy = before.y - p.y;
    const dz = before.z - p.z;
    this.lastError = Math.hypot(dx, dy, dz);
    return { dx, dy, dz, teleported, replayed };
  }

  /**
   * Nova partida/reconexão. A sequência NÃO volta a zero (continua crescente
   * na mesma página); o servidor zera o `lastSeq` ao (re)admitir o jogador.
   */
  resetForMatch(): void {
    this.pending = [];
    this.life = -1;
    this.alive = false;
  }

  snapshot(): PlayerSimState {
    return clonePlayerSim(this.state);
  }
}
