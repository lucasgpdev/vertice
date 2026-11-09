import * as THREE from 'three';
import type { InterpolatedEntity } from '@vertice/shared';
import { OperatorAnimator } from './operatorModel.js';
import type { AssetManager } from '../assets/AssetManager.js';
import type { OperatorRig } from './operatorModel.js';

/** Cores de relação (aliado/inimigo). Fase 1 = todos contra todos → inimigos. */
export const RELATION_COLORS = {
  enemy: new THREE.Color('#ff3b3b'),
  ally: new THREE.Color('#3fa9ff'),
};

const makeLabel = (text: string, color: string): THREE.Sprite => {
  const c = document.createElement('canvas');
  const scale = 2;
  const ctx = c.getContext('2d')!;
  const font = `600 ${22 * scale}px Bahnschrift, 'Barlow Condensed', 'Arial Narrow', sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28 * scale;
  c.width = w;
  c.height = 40 * scale;
  ctx.font = font;
  ctx.fillStyle = 'rgba(7,9,12,0.62)';
  ctx.fillRect(0, 4 * scale, w, 32 * scale);
  ctx.fillStyle = color;
  ctx.fillRect(0, 4 * scale, 4 * scale, 32 * scale);
  ctx.fillStyle = '#f2f5fa';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14 * scale, 21 * scale);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  const h = 0.032;
  s.scale.set((h * c.width) / c.height, h, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
};

/** Jogador remoto: modelo + animação + nome acima da cabeça. */
export class RemotePlayer {
  readonly rig: OperatorRig;
  private readonly anim: OperatorAnimator;
  label: THREE.Sprite;
  private labelText = '';
  readonly head = new THREE.Vector3();
  state: InterpolatedEntity | null = null;
  private hiddenSince = -1;

  constructor(
    readonly id: string,
    nickname: string,
    private readonly scene: THREE.Scene,
    assets: AssetManager,
  ) {
    this.rig = assets.model('character.operator').userData.rig as OperatorRig;
    this.rig.accent.color.copy(RELATION_COLORS.enemy);
    this.rig.accent.emissive.copy(RELATION_COLORS.enemy);
    this.anim = new OperatorAnimator(this.rig);
    scene.add(this.rig.root);
    this.label = makeLabel(nickname, '#ff3b3b');
    this.labelText = nickname;
    scene.add(this.label);
  }

  setName(nick: string): void {
    if (nick === this.labelText) return;
    this.scene.remove(this.label);
    disposeSprite(this.label);
    this.label = makeLabel(nick, '#ff3b3b');
    this.labelText = nick;
    this.scene.add(this.label);
  }

  apply(e: InterpolatedEntity, dt: number, now: number): void {
    this.state = e;
    const root = this.rig.root;
    root.position.set(e.x, e.y, e.z);
    root.rotation.y = e.yaw;
    this.anim.update(dt, { speed: e.speed, crouchT: e.crouchT, onGround: e.onGround, pitch: e.pitch, alive: e.alive });
    // Corpo some 2,5 s após a eliminação (até o respawn).
    if (!e.alive) {
      if (this.hiddenSince < 0) this.hiddenSince = now;
      root.visible = now - this.hiddenSince < 2500;
    } else {
      this.hiddenSince = -1;
      root.visible = true;
    }
    const sy = 1 + (1.15 / 1.8 - 1) * e.crouchT;
    this.head.set(e.x, e.y + 1.65 * sy, e.z);
    this.label.position.set(e.x, e.y + 1.84 * sy + 0.08, e.z);
  }

  dispose(): void {
    this.scene.remove(this.rig.root, this.label);
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.rig.materials.forEach((m) => m.dispose());
    disposeSprite(this.label);
  }
}

const disposeSprite = (s: THREE.Sprite): void => {
  s.material.map?.dispose();
  s.material.dispose();
};
