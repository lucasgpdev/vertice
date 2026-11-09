import { randomInt } from 'node:crypto';
import {
  CollisionWorld,
  DEFAULT_WEAPON_ID,
  INPUT_BURST_MAX,
  INPUT_QUEUE_MAX,
  INTERP_DELAY_MS,
  MAX_HEALTH,
  MAX_REWIND_MS,
  RESPAWN_DELAY_TICKS,
  SNAPSHOT_EVERY_TICKS,
  SPAWN_PROTECTION_TICKS,
  TICK_RATE,
  computeDamage,
  createPlayerSim,
  distVec3,
  eyePosition,
  getMap,
  getWeapon,
  horizontalSpeed,
  q2,
  q3,
  rayHitboxes,
  shotDirection,
  stepPlayerSim,
} from '@vertice/shared';
import type {
  EntitySnap,
  GameEvent,
  HitRegion,
  InputCmd,
  MapDef,
  MatchEndMsg,
  MatchStartMsg,
  PlayerSimState,
  RoomSettings,
  ScoreRow,
  SelfSnap,
  SnapshotMsg,
  Vec3,
} from '@vertice/shared';
import type { PlayerSession } from '../players/PlayerSession.js';
import { PositionHistory } from '../combat/LagCompensation.js';

export interface MatchHooks {
  onEnd: (result: MatchEndMsg) => void;
}

export interface MatchOptions {
  lagCompensation: boolean;
}

/** Estado de um jogador dentro da partida (autoritativo). */
export class MatchPlayer {
  sim: PlayerSimState;
  hp = MAX_HEALTH;
  alive = false;
  respawnAtTick = 0;
  spawnProtectUntil = 0;
  /** Contador de vidas (teleportes) — o cliente não suaviza entre vidas. */
  life = 0;
  spawnYaw = 0;
  queue: InputCmd[] = [];
  budget = INPUT_BURST_MAX;
  lastSeq = -1;
  lastYaw = 0;
  lastPitch = 0;
  readonly history = new PositionHistory();
  readonly privateEvents: GameEvent[] = [];
  kills = 0;
  deaths = 0;
  score = 0;
  /** Estatísticas de segurança (expostas para testes/depuração). */
  readonly stats = { inputsDropped: 0, inputsProcessed: 0, shotsFired: 0 };

  constructor(readonly session: PlayerSession) {
    this.sim = createPlayerSim(0, 0, 0, DEFAULT_WEAPON_ID, 1);
  }

  get id(): string {
    return this.session.id;
  }
}

/**
 * Partida de Mata-mata. Roda a simulação autoritativa a 60 Hz: consome os
 * inputs de cada jogador (com orçamento por tick), resolve disparos com
 * compensação de latência e envia snapshots a 30 Hz.
 */
export class Match {
  readonly map: MapDef;
  readonly world: CollisionWorld;
  readonly players = new Map<string, MatchPlayer>();
  tick = 0;
  readonly startedAt: number;
  readonly endsAt: number;
  ended = false;
  private broadcastEvents: GameEvent[] = [];
  private scoreDirty = true;
  private lastScoreSent = 0;
  /** Tempo do tick atual. */
  private now = 0;

  constructor(
    readonly settings: RoomSettings,
    now: number,
    private readonly hooks: MatchHooks,
    private readonly opts: MatchOptions,
  ) {
    this.map = getMap(settings.mapId);
    this.world = new CollisionWorld(this.map.boxes);
    this.startedAt = now;
    this.endsAt = now + settings.timeLimitMin * 60_000;
  }

  // ---------- entrada/saída ----------

  addPlayer(session: PlayerSession, now: number): MatchPlayer {
    let p = this.players.get(session.id);
    if (!p) {
      p = new MatchPlayer(session);
      this.players.set(session.id, p);
    }
    p.queue.length = 0;
    p.lastSeq = -1;
    this.spawn(p);
    this.scoreDirty = true;
    session.emit('match:start', this.startMsg(session.id, now));
    return p;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.scoreDirty = true;
  }

  /** Conexão caiu: congela o jogador (fora da simulação), mantém estatísticas. */
  onDisconnect(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.queue.length = 0;
    p.alive = false;
    p.history.clear();
    this.scoreDirty = true;
  }

  startMsg(selfId: string, now: number): MatchStartMsg {
    return {
      mapId: this.map.id,
      modeId: this.settings.modeId,
      selfId,
      tick: this.tick,
      serverTime: now,
      killLimit: this.settings.killLimit,
      endsAt: this.endsAt,
    };
  }

  // ---------- inputs ----------

  /** Enfileira inputs validados. Sequências antigas/duplicadas são descartadas. */
  enqueueInputs(id: string, cmds: InputCmd[]): void {
    const p = this.players.get(id);
    if (!p || !p.session.connected) return;
    let last = p.queue.length > 0 ? p.queue[p.queue.length - 1]!.s : p.lastSeq;
    for (const c of cmds) {
      if (c.s <= last) {
        p.stats.inputsDropped++;
        continue;
      }
      if (p.queue.length >= INPUT_QUEUE_MAX) {
        // Cliente mandando mais inputs do que o tempo permite (speedhack ou
        // rajada anormal): descarta o excesso.
        p.stats.inputsDropped++;
        continue;
      }
      p.queue.push(c);
      last = c.s;
    }
  }

  // ---------- simulação ----------

  step(now: number): void {
    if (this.ended) return;
    this.tick++;
    this.now = now;

    for (const p of this.players.values()) {
      if (!p.session.connected) continue;
      // Orçamento: 1 input por tick (com pequena rajada) → impossível acelerar o tempo.
      p.budget = Math.min(INPUT_BURST_MAX, p.budget + 1);
      while (p.queue.length > 0 && p.budget >= 1) {
        const cmd = p.queue.shift()!;
        p.budget -= 1;
        this.processInput(p, cmd, now);
      }
      if (!p.alive && this.tick >= p.respawnAtTick && !this.ended) this.spawn(p);
    }

    for (const p of this.players.values()) {
      if (!p.session.connected) continue;
      p.history.record(now, p.sim.move.pos, p.sim.move.crouchT, p.alive, p.life);
    }

    if (this.tick % SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots(now);

    if (this.scoreDirty || now - this.lastScoreSent > 1000) this.sendScore(now);

    if (!this.ended && now >= this.endsAt) this.finish('timeLimit');
  }

  private processInput(p: MatchPlayer, cmd: InputCmd, now: number): void {
    p.lastSeq = cmd.s;
    p.lastYaw = cmd.y;
    p.lastPitch = cmd.p;
    p.stats.inputsProcessed++;
    if (!p.alive) return;
    const res = stepPlayerSim(p.sim, { seq: cmd.s, buttons: cmd.b, yaw: cmd.y, pitch: cmd.p }, this.world, true);
    if (res.reloadStarted) this.broadcastEvents.push({ k: 'reload', s: p.id });
    if (res.fired) {
      p.stats.shotsFired++;
      p.spawnProtectUntil = 0;
      this.resolveShot(p, cmd, res.spread, res.shotIndex, now);
    }
  }

  private resolveShot(shooter: MatchPlayer, cmd: InputCmd, spread: number, shotIndex: number, now: number): void {
    const w = getWeapon(shooter.sim.weapon.weaponId);
    const origin = eyePosition(shooter.sim.move);
    for (let pellet = 0; pellet < w.pellets; pellet++) {
      const dir = shotDirection(cmd.y, cmd.p, spread, shooter.sim.seed, shotIndex, pellet);
      const normal: Vec3 = { x: 0, y: 0, z: 0 };
      const worldT = this.world.raycast(origin, dir, w.range, normal);
      const maxT = worldT >= 0 ? worldT : w.range;

      // Rewind: posiciona os alvos no instante que o atirador estava vendo.
      const rtt = shooter.session.rtt;
      const maxBack = Math.min(MAX_REWIND_MS, rtt + INTERP_DELAY_MS + 70);
      const viewTime = Math.min(now, Math.max(now - maxBack, cmd.vt));

      let best: { victim: MatchPlayer; t: number; region: HitRegion } | null = null;
      for (const q of this.players.values()) {
        if (q === shooter || !q.alive || !q.session.connected) continue;
        const target = this.opts.lagCompensation
          ? q.history.sample(viewTime)
          : { pos: q.sim.move.pos, crouchT: q.sim.move.crouchT, alive: true };
        if (!target || !target.alive) continue;
        const hit = rayHitboxes(origin, dir, target, best ? best.t : maxT);
        if (hit && (!best || hit.t < best.t)) best = { victim: q, t: hit.t, region: hit.region };
      }

      const endT = best ? best.t : maxT;
      const end: [number, number, number] = [
        q2(origin.x + dir.x * endT),
        q2(origin.y + dir.y * endT),
        q2(origin.z + dir.z * endT),
      ];
      this.broadcastEvents.push({
        k: 'shot',
        s: shooter.id,
        o: [q2(origin.x), q2(origin.y), q2(origin.z)],
        e: end,
        hit: best ? 'player' : worldT >= 0 ? 'world' : 'none',
        ...(best || worldT < 0 ? {} : { n: [normal.x, normal.y, normal.z] as [number, number, number] }),
      });

      if (best) this.applyDamage(shooter, best.victim, best.region, best.t, origin);
    }
  }

  private applyDamage(shooter: MatchPlayer, victim: MatchPlayer, region: HitRegion, dist: number, origin: Vec3): void {
    if (this.tick < victim.spawnProtectUntil) return;
    const w = getWeapon(shooter.sim.weapon.weaponId);
    const dmg = computeDamage(w, region, dist);
    victim.hp = Math.max(0, victim.hp - dmg);
    const kill = victim.hp <= 0;
    shooter.privateEvents.push({ k: 'hit', victim: victim.id, dmg, region, kill });
    victim.privateEvents.push({ k: 'hurt', from: [q2(origin.x), q2(origin.y), q2(origin.z)], dmg });
    if (kill) {
      victim.alive = false;
      victim.respawnAtTick = this.tick + RESPAWN_DELAY_TICKS;
      victim.deaths++;
      shooter.kills++;
      shooter.score += region === 'head' ? 150 : 100;
      this.scoreDirty = true;
      this.broadcastEvents.push({ k: 'kill', killer: shooter.id, victim: victim.id, weapon: w.id, head: region === 'head' });
      if (shooter.kills >= this.settings.killLimit) this.finish('killLimit');
    }
  }

  /** Escolhe o ponto de spawn mais distante dos inimigos vivos (com alguma variação). */
  private spawn(p: MatchPlayer): void {
    const others = [...this.players.values()].filter((q) => q !== p && q.alive && q.session.connected);
    const scored = this.map.spawns.map((sp) => {
      let minD = 1e9;
      for (const q of others) minD = Math.min(minD, distVec3(sp, q.sim.move.pos));
      return { sp, d: minD };
    });
    scored.sort((a, b) => b.d - a.d);
    const pick = scored[randomInt(Math.min(3, scored.length))]!.sp;
    p.sim = createPlayerSim(pick.x, pick.y, pick.z, DEFAULT_WEAPON_ID, randomInt(1, 2 ** 31 - 1));
    p.sim.move.onGround = true;
    p.spawnYaw = pick.yaw;
    p.hp = MAX_HEALTH;
    p.alive = true;
    p.life++;
    p.spawnProtectUntil = this.tick + SPAWN_PROTECTION_TICKS;
    this.broadcastEvents.push({ k: 'spawn', id: p.id });
  }

  // ---------- saída de dados ----------

  private selfSnap(p: MatchPlayer): SelfSnap {
    const m = p.sim.move;
    const w = p.sim.weapon;
    return {
      ack: p.lastSeq,
      pos: [m.pos.x, m.pos.y, m.pos.z],
      vel: [m.vel.x, m.vel.y, m.vel.z],
      g: m.onGround,
      c: m.crouched,
      ct: m.crouchT,
      jh: m.jumpHeld,
      w: {
        id: w.weaponId,
        ammo: w.ammo,
        reserve: w.reserve,
        cd: w.cooldown,
        rl: w.reloadLeft,
        eq: w.equipLeft,
        th: w.triggerHeld,
        sc: w.shotCounter,
        bl: w.bloom,
      },
      seed: p.sim.seed,
      hp: p.hp,
      alive: p.alive,
      tp: p.life,
      sy: p.spawnYaw,
      respawnIn: p.alive ? 0 : Math.max(0, (p.respawnAtTick - this.tick) / TICK_RATE),
    };
  }

  private entitySnap(p: MatchPlayer): EntitySnap {
    const m = p.sim.move;
    return {
      id: p.id,
      p: [q2(m.pos.x), q2(m.pos.y), q2(m.pos.z)],
      y: q3(p.lastYaw),
      pi: q3(p.lastPitch),
      ct: q2(m.crouchT),
      g: m.onGround,
      sp: q2(horizontalSpeed(m)),
      hp: p.hp,
      a: p.alive,
      w: p.sim.weapon.weaponId,
      tp: p.life,
    };
  }

  private sendSnapshots(now: number): void {
    const ents: EntitySnap[] = [];
    for (const p of this.players.values()) if (p.session.connected && p.life > 0) ents.push(this.entitySnap(p));
    const shared = this.broadcastEvents;
    this.broadcastEvents = [];
    for (const p of this.players.values()) {
      if (!p.session.connected) {
        p.privateEvents.length = 0;
        continue;
      }
      const ev = shared.filter((e) => !(e.k === 'shot' && e.s === p.id));
      if (p.privateEvents.length) ev.push(...p.privateEvents.splice(0));
      const msg: SnapshotMsg = {
        t: this.tick,
        st: now,
        self: this.selfSnap(p),
        ents: ents.filter((e) => e.id !== p.id),
        ev,
      };
      p.session.emit('snap', msg);
    }
  }

  scoreRows(): ScoreRow[] {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        nickname: p.session.nickname,
        kills: p.kills,
        deaths: p.deaths,
        score: p.score,
        ping: p.session.ping,
        status: p.session.connected ? ('connected' as const) : ('disconnected' as const),
      }))
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  }

  private sendScore(now: number): void {
    this.scoreDirty = false;
    this.lastScoreSent = now;
    const rows = this.scoreRows();
    for (const p of this.players.values()) p.session.emit('score', rows);
  }

  finish(reason: MatchEndMsg['reason']): void {
    if (this.ended) return;
    this.ended = true;
    const rows = this.scoreRows();
    const top = rows[0];
    const winnerId = reason === 'host' || reason === 'notEnoughPlayers' || !top || top.kills === 0 ? null : top.id;
    // Envia o último snapshot (com a eliminação final) antes do resultado.
    this.sendSnapshots(this.now);
    this.hooks.onEnd({ winnerId, reason, scoreboard: rows, backToLobbyInMs: 10_000 });
  }
}
