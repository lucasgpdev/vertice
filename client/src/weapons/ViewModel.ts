import * as THREE from 'three';
import { colored, merge, roundedBox } from '../assets/geo.js';
import type { PistolRig } from './pistolModel.js';
import type { WeaponDef } from '@vertice/shared';

/**
 * Viewmodel de primeira pessoa: braços + arma em cena própria, renderizada
 * por cima do mundo (sem atravessar paredes) com FOV fixo.
 *
 * Animações PROCEDURAIS (sem rig/AnimationMixer nesta fase): equipar, idle
 * com respiração, balanço ao andar/correr, sway do mouse, agachar, pulo e
 * aterrissagem, disparo (ferrolho + coice), disparo a seco e recarga com
 * troca de carregador. Parâmetros por arma ficam em PROFILE abaixo.
 */

interface AnimProfile {
  hipPos: [number, number, number];
  kickBack: number;
  kickUp: number;
  slideTravel: number;
  slideTime: number;
  reloadDip: number;
  reloadTilt: number;
}

const PROFILE: Record<string, AnimProfile> = {
  'pistol-corvo': {
    hipPos: [0.15, -0.15, -0.42],
    kickBack: 0.035,
    kickUp: 0.13,
    slideTravel: 0.03,
    slideTime: 0.075,
    reloadDip: 0.06,
    reloadTilt: 0.55,
  },
};

export const buildArms = (accent: THREE.ColorRepresentation): THREE.Group => {
  const g = new THREE.Group();
  const base = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
  const acc = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.2 });
  const glove = 0x15171b;
  const knuckle = 0x24272d;
  const sleeve = 0x2b2f36;
  const geos: THREE.BufferGeometry[] = [];

  // Mão direita envolvendo a empunhadura (origem = topo da empunhadura).
  geos.push(colored(roundedBox(0.04, 0.06, 0.055, 0.012), glove, { pos: [0.006, -0.035, 0.02], rot: [-0.28, 0, 0] })); // palma
  for (let i = 0; i < 3; i++) {
    geos.push(colored(roundedBox(0.036, 0.016, 0.022, 0.006), knuckle, { pos: [-0.004, -0.028 - i * 0.02, -0.012 - i * 0.004], rot: [-0.28, 0, 0] }));
  }
  geos.push(colored(roundedBox(0.016, 0.016, 0.05, 0.006), glove, { pos: [-0.019, 0.006, -0.014], rot: [0.05, -0.08, 0] })); // polegar
  geos.push(colored(roundedBox(0.014, 0.014, 0.034, 0.005), glove, { pos: [0.017, 0.012, -0.03] })); // indicador fora do gatilho
  // Antebraço direito → canto inferior direito da tela.
  geos.push(colored(roundedBox(0.062, 0.062, 0.3, 0.02), sleeve, { pos: [0.03, -0.075, 0.17], rot: [0.32, 0.1, 0] }));
  geos.push(colored(roundedBox(0.058, 0.058, 0.04, 0.015), glove, { pos: [0.015, -0.05, 0.05], rot: [0.32, 0.1, 0] })); // punho

  // Mão esquerda em apoio (por baixo/lado esquerdo).
  geos.push(colored(roundedBox(0.045, 0.05, 0.06, 0.014), glove, { pos: [-0.028, -0.04, 0.01], rot: [-0.2, 0.25, 0.35] }));
  for (let i = 0; i < 3; i++) {
    geos.push(colored(roundedBox(0.02, 0.015, 0.03, 0.006), knuckle, { pos: [0.012, -0.03 - i * 0.017, -0.006], rot: [-0.28, 0, 0] }));
  }
  geos.push(colored(roundedBox(0.062, 0.062, 0.3, 0.02), sleeve, { pos: [-0.09, -0.09, 0.15], rot: [0.3, -0.45, 0] }));

  const m = new THREE.Mesh(merge(geos), base);
  g.add(m);
  // Faixa de equipe no punho da manga.
  const cuff = new THREE.Mesh(
    merge([
      colored(roundedBox(0.066, 0.012, 0.066, 0.004), 0xffffff, { pos: [0.02, -0.062, 0.075], rot: [0.32 + Math.PI / 2, 0.1, 0] }),
      colored(roundedBox(0.066, 0.012, 0.066, 0.004), 0xffffff, { pos: [-0.06, -0.072, 0.072], rot: [0.3 + Math.PI / 2, -0.45, 0] }),
    ]),
    acc,
  );
  g.add(cuff);
  return g;
};

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly holder = new THREE.Group();
  private readonly kick = new THREE.Group();
  readonly gun: PistolRig;
  private readonly profile: AnimProfile;

  // estado de animação
  private t = 0;
  private equipT = 0;
  private fireT = 1;
  private dryT = 1;
  private reloadT = -1;
  private reloadDur = 2;
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private landT = 1;
  private wasGround = true;
  private sprintK = 0;
  private crouchK = 0;
  private kickAccum = 0;

  constructor(weapon: WeaponDef, gun: PistolRig, arms: THREE.Object3D) {
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.profile = PROFILE[weapon.id] ?? PROFILE['pistol-corvo']!;
    this.gun = gun;
    this.kick.add(this.gun.root, arms);
    this.holder.add(this.kick);
    this.scene.add(this.holder);
    this.holder.position.set(...this.profile.hipPos);
    this.gun.muzzle.add(this.flash);
    this.flash.position.z = -0.03;

    // Iluminação própria do viewmodel (coerente com o mapa).
    this.scene.add(new THREE.HemisphereLight(0xc9d6ee, 0x3a3228, 1.5));
    const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
    key.position.set(-1, 2, 1.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fd8ff, 0.8);
    rim.position.set(1.5, 0.5, -1);
    this.scene.add(rim);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  equip(): void {
    this.equipT = 0;
    this.reloadT = -1;
  }

  fire(): void {
    this.fireT = 0;
    this.kickAccum = Math.min(1, this.kickAccum + 0.6);
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.07 + Math.random() * 0.03);
    this.flashT = 0;
  }

  private flash: THREE.Sprite = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,248,225,1)');
    grd.addColorStop(0.3, 'rgba(255,190,80,0.85)');
    grd.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.visible = false;
    return s;
  })();
  private flashT = 1;

  dryFire(): void {
    this.dryT = 0;
  }

  reload(durationSec: number): void {
    this.reloadT = 0;
    this.reloadDur = durationSec;
  }

  cancelReload(): void {
    this.reloadT = -1;
  }

  /** Chamado a cada frame. */
  update(
    dt: number,
    s: { speed: number; onGround: boolean; sprint: boolean; crouchT: number; lookDX: number; lookDY: number; visible: boolean },
  ): void {
    this.holder.visible = s.visible;
    if (!s.visible) return;
    this.t += dt;
    const P = this.profile;

    // equipar
    this.equipT = Math.min(1, this.equipT + dt / 0.45);
    const eq = 1 - Math.pow(1 - this.equipT, 3);

    // balanço do passo
    const moveK = s.onGround ? Math.min(1, s.speed / 4.6) : 0;
    this.bobPhase += dt * (6 + s.speed * 1.4) * (moveK > 0.05 ? 1 : 0);
    this.sprintK += ((s.sprint && moveK > 0.5 ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    this.crouchK += (s.crouchT - this.crouchK) * Math.min(1, dt * 10);
    const bobX = Math.sin(this.bobPhase) * 0.006 * moveK * (1 + this.sprintK);
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.007 * moveK * (1 + this.sprintK);

    // respiração
    const breathY = Math.sin(this.t * 1.6) * 0.0016;
    const breathR = Math.sin(this.t * 0.8) * 0.004;

    // sway do mouse (atraso suave)
    this.swayX += (THREE.MathUtils.clamp(-s.lookDX * 0.6, -0.05, 0.05) - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (THREE.MathUtils.clamp(s.lookDY * 0.6, -0.04, 0.04) - this.swayY) * Math.min(1, dt * 9);

    // aterrissagem
    if (s.onGround && !this.wasGround) this.landT = 0;
    this.wasGround = s.onGround;
    this.landT = Math.min(1, this.landT + dt * 4);
    const land = Math.sin(this.landT * Math.PI) * 0.02 * (1 - this.landT);
    const airLift = s.onGround ? 0 : 0.012;

    // clarão de boca (2 frames curtos)
    this.flashT += dt;
    if (this.flashT > 0.045) this.flash.visible = false;

    // disparo
    this.fireT = Math.min(1, this.fireT + dt / 0.18);
    const fk = Math.exp(-this.fireT * 9) * (1 - this.fireT);
    this.kickAccum = Math.max(0, this.kickAccum - dt * 3);
    const slideP = Math.min(1, this.fireT * (0.18 / P.slideTime));
    const slideK = slideP < 0.5 ? slideP * 2 : 2 - slideP * 2;
    this.gun.slide.position.z = slideK * P.slideTravel * (this.fireT < 1 ? 1 : 0);
    this.dryT = Math.min(1, this.dryT + dt / 0.15);
    this.gun.trigger.rotation.x = 0.25 - (this.fireT < 0.3 || this.dryT < 0.5 ? 0.35 : 0);

    // recarga
    let rDip = 0;
    let rTilt = 0;
    let rRoll = 0;
    this.gun.magazine.visible = true;
    this.gun.magazine.position.y = -0.043;
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      const r = this.reloadT;
      const inOut = r < 0.15 ? r / 0.15 : r > 0.85 ? (1 - r) / 0.15 : 1;
      const ease = inOut * inOut * (3 - 2 * inOut);
      rDip = ease * P.reloadDip;
      rTilt = ease * P.reloadTilt;
      rRoll = ease * 0.35;
      // carregador sai (0,2–0,4), some, volta (0,5–0,7)
      if (r > 0.2 && r < 0.45) this.gun.magazine.position.y = -0.043 - ((r - 0.2) / 0.25) * 0.14;
      else if (r >= 0.45 && r < 0.5) this.gun.magazine.visible = false;
      else if (r >= 0.5 && r < 0.68) this.gun.magazine.position.y = -0.043 - (1 - (r - 0.5) / 0.18) * 0.12;
      // ferrolho liberado no final se estava vazio
      if (r > 0.75 && r < 0.82) this.gun.slide.position.z = P.slideTravel * (1 - (r - 0.75) / 0.07);
      if (r >= 1) this.reloadT = -1;
    }

    const sprintDrop = this.sprintK * 0.05;
    const crouchOff = this.crouchK * 0.012;
    this.holder.position.set(
      P.hipPos[0] + bobX + this.swayX * 0.4 - this.sprintK * 0.02,
      P.hipPos[1] + bobY + breathY - sprintDrop - (1 - eq) * 0.25 - land - rDip + airLift - crouchOff,
      P.hipPos[2] + fk * P.kickBack,
    );
    this.holder.rotation.set(
      fk * P.kickUp + this.swayY + (1 - eq) * -0.6 - this.sprintK * 0.35 + rTilt * 0.4 + this.kickAccum * 0.02,
      0.06 + this.swayX + this.sprintK * 0.5 + breathR,
      -this.swayX * 0.6 + rRoll + this.sprintK * 0.25,
    );
  }

  /** Posição da boca do cano em coordenadas da câmera do viewmodel. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.scene.updateMatrixWorld(true);
    return this.gun.muzzle.getWorldPosition(out);
  }
}
