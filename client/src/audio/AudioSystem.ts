import * as THREE from 'three';
import { settings } from '../config/settings.js';

/**
 * Áudio com Web Audio API. Sons SINTETIZADOS por código (originais, sem
 * arquivos de terceiros) — provisórios até a Fase 8 (ver ASSETS_PENDENTES).
 * Disparos remotos usam THREE.PositionalAudio (distância + direção).
 * Canais com volume próprio: geral, efeitos, interface.
 */

type SfxId = 'fire' | 'fireFar' | 'reload' | 'equip' | 'hit' | 'headshot' | 'kill' | 'dry' | 'click' | 'hurt';

const synth = (ctx: BaseAudioContext, dur: number, fn: (t: number, i: number, sr: number) => number): AudioBuffer => {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, sr);
  // normaliza
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(d[i]!));
  if (max > 0) for (let i = 0; i < n; i++) d[i]! /= max * 1.05;
  return buf;
};

const rnd = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
};

const buildBuffers = (ctx: BaseAudioContext): Record<SfxId, AudioBuffer> => {
  const r = rnd(7);
  let lp = 0;
  let lp2 = 0;
  return {
    // Disparo: estalo inicial + ruído filtrado + "corpo" grave decaindo.
    fire: synth(ctx, 0.35, (t) => {
      const n = r();
      lp += (n - lp) * 0.35;
      const crack = t < 0.004 ? n * 2 : 0;
      const body = Math.sin(2 * Math.PI * (110 - t * 140) * t) * Math.exp(-t * 28) * 1.2;
      const noise = lp * Math.exp(-t * 22) * 1.6;
      const tail = n * Math.exp(-t * 9) * 0.12;
      return crack + body + noise + tail;
    }),
    fireFar: synth(ctx, 0.5, (t) => {
      const n = r();
      lp2 += (n - lp2) * 0.08;
      return lp2 * Math.exp(-t * 10) * 3 + Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 14) * 0.6;
    }),
    reload: synth(ctx, 1.9, (t) => {
      const click = (at: number, f: number, a: number) =>
        t > at && t < at + 0.03 ? Math.sin(2 * Math.PI * f * (t - at)) * Math.exp(-(t - at) * 160) * a + r() * Math.exp(-(t - at) * 220) * a : 0;
      return click(0.32, 1800, 0.8) + click(0.38, 900, 0.5) + click(1.05, 1500, 0.9) + click(1.12, 2400, 0.6) + click(1.62, 1200, 1) + click(1.66, 2600, 0.7);
    }),
    equip: synth(ctx, 0.3, (t) => (t < 0.08 ? r() * Math.exp(-t * 40) * 0.5 : 0) + Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 90) * 0.6),
    hit: synth(ctx, 0.08, (t) => Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 70)),
    headshot: synth(ctx, 0.25, (t) => Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-t * 18) * 0.7 + Math.sin(2 * Math.PI * 4650 * t) * Math.exp(-t * 26) * 0.4),
    kill: synth(ctx, 0.35, (t) => Math.sin(2 * Math.PI * (900 + t * 900) * t) * Math.exp(-t * 10)),
    dry: synth(ctx, 0.06, (t) => Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-t * 200) + r() * Math.exp(-t * 300) * 0.4),
    click: synth(ctx, 0.04, (t) => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 180)),
    hurt: synth(ctx, 0.2, (t) => {
      const n = r();
      lp += (n - lp) * 0.15;
      return lp * Math.exp(-t * 18) * 2 + Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 20);
    }),
  };
};

export class AudioSystem {
  readonly listener = new THREE.AudioListener();
  private buffers: Record<SfxId, AudioBuffer> | null = null;
  private readonly effects: GainNode;
  private readonly ui: GainNode;
  private pool: THREE.PositionalAudio[] = [];
  private poolI = 0;

  constructor() {
    const ctx = this.listener.context;
    this.effects = ctx.createGain();
    this.ui = ctx.createGain();
    this.effects.connect(this.listener.getInput());
    this.ui.connect(this.listener.getInput());
    this.applyVolumes();
    settings.subscribe(() => this.applyVolumes());
    // O navegador só libera áudio após gesto do usuário.
    const unlock = (): void => {
      if (ctx.state === 'suspended') void ctx.resume();
      this.ensureBuffers();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensureBuffers(): void {
    if (!this.buffers) this.buffers = buildBuffers(this.listener.context);
  }

  applyVolumes(): void {
    const v = settings.value.volume;
    this.listener.setMasterVolume(v.master);
    this.effects.gain.value = v.effects;
    this.ui.gain.value = v.ui;
  }

  /** Cria o pool de fontes posicionais e anexa à cena. */
  attach(scene: THREE.Scene): void {
    this.detach();
    for (let i = 0; i < 16; i++) {
      const pa = new THREE.PositionalAudio(this.listener);
      pa.setRefDistance(4);
      pa.setRolloffFactor(1.2);
      pa.setDistanceModel('inverse');
      pa.setMaxDistance(120);
      pa.gain.disconnect();
      pa.gain.connect(this.effects);
      scene.add(pa);
      this.pool.push(pa);
    }
  }

  detach(): void {
    for (const p of this.pool) {
      if (p.isPlaying) p.stop();
      p.removeFromParent();
      p.disconnect();
    }
    this.pool = [];
  }

  /** Som não posicional (próprio jogador / interface). */
  play(id: SfxId, channel: 'effects' | 'ui' = 'effects', gain = 1, detune = 0): void {
    const ctx = this.listener.context;
    if (ctx.state !== 'running') return;
    this.ensureBuffers();
    const src = ctx.createBufferSource();
    src.buffer = this.buffers![id];
    src.detune.value = detune + (Math.random() - 0.5) * 60;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(channel === 'ui' ? this.ui : this.effects);
    src.start();
  }

  /** Som posicional no mundo (disparos de outros jogadores). */
  playAt(id: SfxId, pos: THREE.Vector3, gain = 1): void {
    const ctx = this.listener.context;
    if (ctx.state !== 'running' || this.pool.length === 0) return;
    this.ensureBuffers();
    const pa = this.pool[this.poolI++ % this.pool.length]!;
    if (pa.isPlaying) pa.stop();
    pa.position.copy(pos);
    pa.updateMatrixWorld();
    pa.setBuffer(this.buffers![id]);
    pa.setVolume(gain);
    pa.setDetune((Math.random() - 0.5) * 80);
    pa.play();
  }
}
