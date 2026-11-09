import * as THREE from 'three';
import {
  CollisionWorld,
  InterpolationBuffer,
  Predictor,
  SnapshotClock,
  TICK_MS,
  eyeHeight,
  getMap,
  getWeapon,
  horizontalSpeed,
  rayHitboxes,
  shotDirection,
} from '@vertice/shared';
import type { GameEvent, MatchStartMsg, ScoreRow, SnapshotMsg, Vec3, WeaponStepResult } from '@vertice/shared';
import type { Connection } from '../multiplayer/Connection.js';
import type { AssetManager } from '../assets/AssetManager.js';
import { disposeObject } from '../assets/AssetManager.js';
import type { AudioSystem } from '../audio/AudioSystem.js';
import { buildMap, type BuiltMap } from '../maps/MapBuilder.js';
import { Effects } from '../effects/Effects.js';
import { ViewModel } from '../weapons/ViewModel.js';
import { RemotePlayer } from '../characters/RemotePlayer.js';
import type { PistolRig } from '../weapons/pistolModel.js';
import { Input } from './Input.js';
import { Hud } from '../ui/hud/Hud.js';
import { settings } from '../config/settings.js';
import { h } from '../ui/dom.js';
import type { Renderer } from './Renderer.js';

export interface GameCallbacks {
  nameOf: (id: string) => string;
  isHost: () => boolean;
  openSettings: () => void;
  leaveRoom: () => void;
  endMatch: () => void;
}

const v3 = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);

/**
 * Uma partida em andamento no cliente: cena, predição do jogador local,
 * interpolação dos remotos, efeitos, viewmodel e HUD.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);
  readonly world: CollisionWorld;
  readonly predictor: Predictor;
  readonly interp = new InterpolationBuffer();
  readonly clock = new SnapshotClock();
  readonly input: Input;
  readonly hud = new Hud();
  private readonly map: BuiltMap;
  private readonly effects: Effects;
  private readonly viewmodel: ViewModel;
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly overlay = h('div');
  private readonly root: HTMLElement;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private correction = new THREE.Vector3();
  private camPunch = 0;
  private score: ScoreRow[] = [];
  private lastKiller: string | null = null;
  private deathCamT = 0;
  private disposed = false;
  private paused = false;
  private readonly unsubs: (() => void)[] = [];
  // métricas
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private snapCount = 0;
  private snapRate = 0;
  private frameMs = 0;
  private starvedFrames = 0;
  private framesTotal = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly conn: Connection,
    private readonly assets: AssetManager,
    private readonly audio: AudioSystem,
    uiRoot: HTMLElement,
    readonly match: MatchStartMsg,
    private readonly cb: GameCallbacks,
  ) {
    const def = getMap(match.mapId);
    this.world = new CollisionWorld(def.boxes);
    this.predictor = new Predictor(this.world);
    this.map = buildMap(def, assets, settings.value.graphics, this.scene);
    this.effects = new Effects(this.scene);
    const arms = assets.model('fp.arms');
    const gun = assets.model('weapon.pistol-corvo.view').userData.rig as PistolRig;
    this.viewmodel = new ViewModel(getWeapon('pistol-corvo'), gun, arms);
    const env = renderer.environment();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    this.viewmodel.scene.environment = env;
    this.viewmodel.scene.environmentIntensity = 0.4;
    this.camera.rotation.order = 'YXZ';
    this.camera.add(audio.listener);
    this.scene.add(this.camera);
    audio.attach(this.scene);
    this.input = new Input(renderer.canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);

    this.root = h('div', { class: 'game-root' }, this.hud.el, this.overlay);
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:auto';
    uiRoot.append(this.root);

    this.unsubs.push(
      conn.on('snap', (s) => this.onSnapshot(s)),
      conn.on('score', (rows) => (this.score = rows)),
      settings.subscribe(() => this.onResize()),
    );
    const onResize = (): void => this.onResize();
    window.addEventListener('resize', onResize);
    this.unsubs.push(() => window.removeEventListener('resize', onResize));
    this.onResize();
    this.showClickToPlay();
    if (this.input.e2e) this.installTestHooks();
    audio.play('equip');
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Reconexão: o servidor reenviou match:start (mesma partida, novo spawn). */
  resume(m: MatchStartMsg): void {
    this.predictor.resetForMatch();
    this.interp.clear();
    this.clock.reset();
    Object.assign(this.match, m);
  }

  // ---------- rede ----------

  private onSnapshot(s: SnapshotMsg): void {
    const now = performance.now();
    this.snapCount++;
    this.clock.observe(s.st, now);
    this.interp.push(s.st, s.ents);
    if (s.self) {
      const wasAlive = this.predictor.alive;
      const rr = this.predictor.reconcile(s.self);
      const p = this.predictor.state.move.pos;
      if (rr.teleported) {
        this.input.yaw = s.self.sy;
        this.input.pitch = 0;
        this.correction.set(0, 0, 0);
        this.currPos.set(p.x, p.y, p.z);
        this.prevPos.copy(this.currPos);
        this.viewmodel.equip();
        if (s.self.alive) this.audio.play('equip', 'effects', 0.6);
      } else {
        const d = new THREE.Vector3(rr.dx, rr.dy, rr.dz);
        if (d.lengthSq() > 9) this.correction.set(0, 0, 0);
        else this.correction.add(d);
        this.prevPos.sub(d);
        this.currPos.set(p.x, p.y, p.z);
      }
      if (wasAlive && !s.self.alive) this.deathCamT = 0;
      this.respawnIn = s.self.respawnIn;
      if (this.predictor.state.weapon.reloadLeft === 0) this.viewmodel.cancelReload();
    }
    for (const e of s.ev) this.onEvent(e);
  }

  private onEvent(e: GameEvent): void {
    const me = this.conn.playerId;
    switch (e.k) {
      case 'shot': {
        const r = this.remotes.get(e.s);
        const o = new THREE.Vector3(...e.o);
        const end = new THREE.Vector3(...e.e);
        let from = o.clone();
        if (r?.state) {
          // Sai da arma do modelo remoto (aprox. mão direita).
          const yaw = r.state.yaw;
          from = new THREE.Vector3(0.06, -0.3, -0.5).applyEuler(new THREE.Euler(r.state.pitch * 0.6, yaw, 0, 'YXZ')).add(o);
        }
        this.effects.tracer(from, end);
        this.effects.flash(from, 0.4, false);
        const dist = from.distanceTo(this.camera.position);
        this.audio.playAt(dist > 35 ? 'fireFar' : 'fire', from, dist > 35 ? 0.9 : 1);
        if (e.hit === 'world' && e.n) this.effects.impact(end, new THREE.Vector3(...e.n));
        break;
      }
      case 'hit':
        this.hud.hit(e.kill ? 'kill' : e.region === 'head' ? 'head' : 'body');
        this.audio.play(e.region === 'head' ? 'headshot' : 'hit', 'ui', 0.8);
        if (e.kill) this.audio.play('kill', 'ui', 0.6);
        break;
      case 'hurt': {
        const p = this.predictor.state.move.pos;
        const a = Math.atan2(-(e.from[0] - p.x), -(e.from[2] - p.z));
        this.hud.damageFrom(-(a - this.input.yaw));
        this.audio.play('hurt', 'effects', 0.7);
        break;
      }
      case 'kill':
        this.hud.killfeed(this.cb.nameOf(e.killer), this.cb.nameOf(e.victim), getWeapon(e.weapon).name, e.head, e.killer === me, e.victim === me);
        if (e.victim === me) this.lastKiller = e.killer;
        break;
      case 'reload': {
        const r = this.remotes.get(e.s);
        if (r?.state) this.audio.playAt('reload', new THREE.Vector3(r.state.x, r.state.y + 1.2, r.state.z), 0.5);
        break;
      }
      case 'spawn':
        break;
    }
  }

  // ---------- simulação local ----------

  private stepOnce(now: number): void {
    const buttons = this.predictor.alive && !this.paused ? this.input.buttons() : 0;
    const vt = this.clock.ready ? this.clock.renderTime(now) : 0;
    this.prevPos.copy(this.currPos);
    const { cmd, result } = this.predictor.step(buttons, this.input.yaw, this.input.pitch, vt);
    this.conn.sendInputs([cmd]);
    const p = this.predictor.state.move.pos;
    this.currPos.set(p.x, p.y, p.z);
    if (result) this.onLocalWeapon(result);
  }

  private onLocalWeapon(r: WeaponStepResult): void {
    const w = getWeapon(this.predictor.state.weapon.weaponId);
    if (r.reloadStarted) {
      this.viewmodel.reload(w.reloadTicks / 60);
      this.audio.play('reload', 'effects', 0.8);
    }
    if (r.dryFire) {
      this.viewmodel.dryFire();
      this.audio.play('dry');
    }
    if (!r.fired) return;
    this.viewmodel.fire();
    this.audio.play('fire');
    this.camPunch = Math.min(0.03, this.camPunch + w.recoil.pitchKick * 0.35);

    // Traçante previsto com a MESMA dispersão determinística do servidor.
    const s = this.predictor.state;
    const origin = new THREE.Vector3(s.move.pos.x, s.move.pos.y + eyeHeight(s.move), s.move.pos.z);
    const dir = shotDirection(this.input.yaw, this.input.pitch, r.spread, s.seed, r.shotIndex, 0);
    const n = { x: 0, y: 0, z: 0 };
    const tw = this.world.raycast(origin, dir, w.range, n);
    let tEnd = tw >= 0 ? tw : w.range;
    let hitPlayer = false;
    for (const rp of this.remotes.values()) {
      const st = rp.state;
      if (!st || !st.alive) continue;
      const hit = rayHitboxes(origin, dir, { pos: { x: st.x, y: st.y, z: st.z }, crouchT: st.crouchT }, tEnd);
      if (hit) {
        tEnd = hit.t;
        hitPlayer = true;
      }
    }
    const end = origin.clone().addScaledVector(v3(dir), tEnd);
    const muzzle = this.viewmodel.muzzleWorld(new THREE.Vector3());
    const muzzleWorld = this.camera.localToWorld(muzzle);
    this.effects.tracer(muzzleWorld, end);
    this.effects.muzzleLight.position.copy(muzzleWorld);
    this.effects.muzzleLight.intensity = 5;
    if (!hitPlayer && tw >= 0) this.effects.impact(end, v3(n));
  }

  // ---------- quadro ----------

  private frame(t: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
    const frameStart = performance.now();
    const now = t;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    if (this.input.pressed('debug')) settings.update((s) => (s.showDebug = !s.showDebug));

    // passos fixos de 60 Hz
    this.acc += dt * 1000;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 8) {
      this.stepOnce(now);
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    const alpha = this.acc / TICK_MS;

    // posição suavizada do jogador local
    this.correction.multiplyScalar(Math.exp(-dt * 14));
    const pos = new THREE.Vector3().lerpVectors(this.prevPos, this.currPos, alpha).add(this.correction);
    const mv = this.predictor.state.move;
    const eye = eyeHeight(mv);
    this.camPunch *= Math.exp(-dt * 18);

    if (this.predictor.alive) {
      this.camera.position.set(pos.x, pos.y + eye, pos.z);
      this.camera.rotation.set(this.input.pitch + this.camPunch, this.input.yaw, 0);
    } else {
      // câmera de eliminação: sobe e olha para quem eliminou
      this.deathCamT = Math.min(1, this.deathCamT + dt * 1.5);
      const k = 1 - Math.pow(1 - this.deathCamT, 3);
      this.camera.position.set(pos.x, pos.y + eye * (1 - k * 0.7) + k * 1.2, pos.z);
      const killer = this.lastKiller ? this.remotes.get(this.lastKiller)?.state : null;
      if (killer) {
        const target = new THREE.Vector3(killer.x, killer.y + 1.2, killer.z);
        const m = new THREE.Matrix4().lookAt(this.camera.position, target, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        this.camera.quaternion.slerp(q, Math.min(1, dt * 4));
      }
    }

    // entidades remotas (interpoladas ~100 ms no passado)
    const renderTime = this.clock.renderTime(now);
    if (this.clock.ready) {
      this.framesTotal++;
      // Buffer vazio = entidades remotas "congeladas" (falta de suavidade).
      if (renderTime > this.interp.latestTime) this.starvedFrames++;
    }
    const ents = this.interp.sample(renderTime);
    for (const [id, e] of ents) {
      let r = this.remotes.get(id);
      if (!r) {
        r = new RemotePlayer(id, this.cb.nameOf(id), this.scene, this.assets);
        this.remotes.set(id, r);
      }
      r.setName(this.cb.nameOf(id));
      r.apply(e, dt, now);
    }
    for (const [id, r] of this.remotes) {
      if (!ents.has(id)) {
        r.dispose();
        this.remotes.delete(id);
      }
    }
    // Nomes: só com linha de visão real (raycast no mapa), nunca através de paredes.
    const camPos = this.camera.position;
    for (const r of this.remotes.values()) {
      const st = r.state;
      const visible =
        settings.value.showNames &&
        !!st &&
        st.alive &&
        r.rig.root.visible &&
        camPos.distanceTo(r.head) < 70 &&
        this.world.lineOfSight(camPos, r.head);
      r.label.visible = visible;
    }

    // viewmodel e efeitos
    const look = this.input.consumeLook();
    this.viewmodel.update(dt, {
      speed: horizontalSpeed(mv),
      onGround: mv.onGround,
      sprint: this.input.held('sprint'),
      crouchT: mv.crouchT,
      lookDX: look.dx,
      lookDY: look.dy,
      visible: this.predictor.alive,
    });
    this.effects.update(dt);

    this.updateHud(now);

    // render: mundo + viewmodel por cima
    const r = this.renderer.webgl;
    r.info.reset();
    r.autoClear = false;
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.viewmodel.scene, this.viewmodel.camera);

    this.frameMs = performance.now() - frameStart;
    this.fpsFrames++;
    if (now - this.fpsTime > 500) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsTime);
      this.snapRate = (this.snapCount * 1000) / (now - this.fpsTime);
      this.fpsFrames = 0;
      this.snapCount = 0;
      this.fpsTime = now;
    }
    this.input.clearPressed();
  }

  private updateHud(now: number): void {
    const s = this.predictor.state;
    const w = getWeapon(s.weapon.weaponId);
    this.hud.setHealth(this.predictor.alive ? this.predictor.hp : 0);
    this.hud.setAmmo(s.weapon.ammo, s.weapon.reserve, w.name, s.weapon.reloadLeft > 0, w.magSize);
    this.hud.setTimer(this.match.endsAt - this.clock.serverTime(now));
    const me = this.score.find((r) => r.id === this.conn.playerId);
    const lead = this.score.reduce((m, r) => Math.max(m, r.kills), 0);
    this.hud.setScore(me?.kills ?? 0, lead, this.match.killLimit);
    const ping = me?.ping ?? Math.round(this.conn.rtt);
    this.hud.setNet(ping, this.conn.connected);
    this.hud.setDeath(!this.predictor.alive && this.clock.ready, this.lastKiller ? this.cb.nameOf(this.lastKiller) : undefined, this.respawnIn);
    this.hud.setScoreboard(this.input.held('scoreboard'), this.score, this.conn.playerId);

    const dbg = settings.value.showDebug;
    this.hud.debug.style.display = dbg ? '' : 'none';
    if (dbg) {
      const info = this.renderer.webgl.info;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      this.hud.debug.textContent = [
        `FPS        ${this.fps.toFixed(0)}  (${this.frameMs.toFixed(1)} ms CPU)`,
        `Ping       ${ping} ms (srv)  ${Math.round(this.conn.rtt)} ms (cli)`,
        `Snapshots  ${this.snapRate.toFixed(0)}/s  buffer ${(this.interp.latestTime - this.clock.renderTime(now)).toFixed(0)} ms`,
        `Predição   erro ${(this.predictor.lastError * 100).toFixed(1)} cm  pendentes ${this.predictor.pendingCount}`,
        `Draw calls ${info.render.calls}  tris ${info.render.triangles}`,
        `Memória    geo ${info.memory.geometries}  tex ${info.memory.textures}${mem ? `  heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}`,
        `Posição    ${s.move.pos.x.toFixed(2)} ${s.move.pos.y.toFixed(2)} ${s.move.pos.z.toFixed(2)}`,
      ].join('\n');
    }
  }

  private respawnIn = 0;

  // ---------- telas sobrepostas ----------

  private onLockChange(locked: boolean): void {
    if (this.disposed) return;
    if (locked) {
      this.paused = false;
      this.overlay.innerHTML = '';
      this.overlay.style.pointerEvents = 'none';
    } else if (!this.input.e2e) this.showPause();
  }

  private showClickToPlay(): void {
    if (this.input.e2e) {
      this.overlay.style.pointerEvents = 'none';
      return;
    }
    this.overlay.innerHTML = '';
    this.overlay.style.pointerEvents = 'auto';
    const btn = h('button', { class: 'btn primary', on: { click: () => void this.input.lock() } }, 'Clique para jogar');
    this.overlay.append(h('div', { class: 'center-msg' }, btn, h('div', { class: 'hint', style: { marginTop: '12px' } }, 'WASD mover · Mouse mirar · Clique atirar · R recarregar · Tab placar · Esc menu')));
  }

  private showPause(): void {
    this.paused = true;
    this.overlay.innerHTML = '';
    this.overlay.style.pointerEvents = 'auto';
    const panel = h(
      'div',
      { class: 'pause' },
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Pausa'), h('span', { class: 'hint' }, 'a partida continua')),
        h(
          'div',
          { class: 'panel-body' },
          h('button', { class: 'btn primary', on: { click: () => void this.input.lock() } }, 'Continuar'),
          h('button', { class: 'btn', on: { click: () => this.cb.openSettings() } }, 'Configurações'),
          this.cb.isHost() ? h('button', { class: 'btn danger', on: { click: () => this.cb.endMatch() } }, 'Encerrar partida') : null,
          h('button', { class: 'btn ghost', on: { click: () => this.cb.leaveRoom() } }, 'Sair da sala'),
        ),
      ),
    );
    this.overlay.append(panel);
  }

  /** Mostra o resultado e libera o mouse. */
  showResults(content: HTMLElement): void {
    this.input.enabled = false;
    this.input.unlock();
    this.overlay.innerHTML = '';
    this.overlay.style.pointerEvents = 'auto';
    this.overlay.append(content);
  }

  onResize(): void {
    const w = window.innerWidth;
    const hh = window.innerHeight;
    this.renderer.resize(w, hh);
    const aspect = w / hh;
    this.camera.aspect = aspect;
    // FOV das configurações é horizontal (padrão de FPS) → converte para vertical.
    const hf = THREE.MathUtils.degToRad(settings.value.fov);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect));
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(aspect);
  }

  // ---------- testes automatizados (somente com ?e2e=1) ----------

  private installTestHooks(): void {
    (window as unknown as Record<string, unknown>).__vertice = {
      state: () => ({
        alive: this.predictor.alive,
        hp: this.predictor.hp,
        pos: { ...this.predictor.state.move.pos },
        ammo: this.predictor.state.weapon.ammo,
        remotes: [...this.remotes.values()].map((r) => ({ id: r.id, ...r.state, labelVisible: r.label.visible })),
        score: this.score,
        fps: this.fps,
        snapRate: this.snapRate,
        predictionError: this.predictor.lastError,
        drawCalls: this.renderer.webgl.info.render.calls,
        starvedFrames: this.starvedFrames,
        framesTotal: this.framesTotal,
      }),
      look: (yaw: number, pitch: number) => {
        this.input.yaw = yaw;
        this.input.pitch = pitch;
      },
      aimAt: (id: string) => {
        const r = this.remotes.get(id)?.state;
        if (!r) return false;
        const eye = this.camera.position;
        const dx = r.x - eye.x;
        const dy = r.y + 1.15 - eye.y;
        const dz = r.z - eye.z;
        this.input.yaw = Math.atan2(-dx, -dz);
        this.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        return true;
      },
      fire: (on: boolean) => {
        this.input.extraButtons = on ? 1 << 7 : 0;
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    this.input.unlock();
    this.input.dispose();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.effects.dispose();
    this.map.dispose();
    disposeObject(this.viewmodel.scene);
    this.audio.detach();
    this.camera.remove(this.audio.listener);
    this.hud.dispose();
    this.root.remove();
    this.assets.dispose();
    this.renderer.webgl.renderLists.dispose();
    delete (window as unknown as Record<string, unknown>).__vertice;
  }
}
