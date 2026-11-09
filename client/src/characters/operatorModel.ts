import * as THREE from 'three';
import { box, colored, cyl, merge, roundedBox } from '../assets/geo.js';
import { buildPistol } from '../weapons/pistolModel.js';
import { mergeByMaterial } from '../assets/geo.js';

/**
 * Operador procedural (terceira pessoa). PROVISÓRIO: sem rig de esqueleto.
 * É uma hierarquia de segmentos articulados (quadril, coxas, canelas, tronco
 * com braços em pose de mira, cabeça) animada por código. Cada segmento é
 * mesclado em 1 malha com cores por vértice → ~11 draw calls por personagem.
 * Dimensões batem com as hitboxes compartilhadas (cabeça 1,5–1,8 m,
 * tronco 0,85–1,5 m, pernas 0–0,85 m).
 */

export interface OperatorRig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  thighL: THREE.Group;
  thighR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  accent: THREE.MeshStandardMaterial;
  materials: THREE.Material[];
}

const C = {
  fabric: 0x4a515c,
  fabric2: 0x3c424c,
  armor: 0x5c6470,
  armor2: 0x4c535e,
  black: 0x1e2126,
  strap: 0x2a2d33,
  visor: 0x0a0c10,
};

export const buildOperator = (accentColor: THREE.ColorRepresentation): OperatorRig => {
  const base = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08 });
  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 2.4,
    roughness: 0.4,
  });
  const materials: THREE.Material[] = [base, accent];

  const seg = (geos: THREE.BufferGeometry[], accents: THREE.BufferGeometry[] = []): THREE.Group => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(merge(geos), base);
    m.castShadow = true;
    g.add(m);
    if (accents.length) {
      const a = new THREE.Mesh(merge(accents), accent);
      g.add(a);
    }
    return g;
  };

  const root = new THREE.Group();
  root.name = 'operator';
  const body = new THREE.Group();
  root.add(body);

  // ---- quadril ----
  const hips = seg([
    colored(roundedBox(0.34, 0.16, 0.22, 0.03), C.fabric2),
    colored(box(0.36, 0.05, 0.24), C.strap, { pos: [0, 0.06, 0] }), // cinto
    colored(box(0.08, 0.09, 0.06), C.armor2, { pos: [0.16, 0.0, -0.06] }), // coldre
    colored(box(0.08, 0.08, 0.05), C.armor2, { pos: [-0.15, 0.02, 0.09] }),
  ]);
  hips.position.y = 0.92;
  body.add(hips);

  // ---- pernas ----
  const leg = (side: number): [THREE.Group, THREE.Group] => {
    const thigh = seg([
      colored(roundedBox(0.14, 0.44, 0.16, 0.035), C.fabric, { pos: [0, -0.21, 0] }),
      colored(box(0.05, 0.12, 0.1), C.armor2, { pos: [side * 0.085, -0.2, 0] }), // bolso lateral
    ]);
    thigh.position.set(side * 0.1, -0.03, 0);
    const shin = seg([
      colored(roundedBox(0.125, 0.4, 0.14, 0.03), C.fabric, { pos: [0, -0.2, 0] }),
      colored(roundedBox(0.13, 0.12, 0.06, 0.02), C.armor, { pos: [0, -0.02, -0.08] }), // joelheira
      colored(roundedBox(0.135, 0.11, 0.27, 0.03), C.black, { pos: [0, -0.39, -0.04] }), // bota
      colored(box(0.14, 0.025, 0.28), C.strap, { pos: [0, -0.44, -0.04] }), // sola
    ]);
    shin.position.y = -0.44;
    thigh.add(shin);
    hips.add(thigh);
    return [thigh, shin];
  };
  const [thighL, shinL] = leg(-1);
  const [thighR, shinR] = leg(1);

  // ---- tronco + braços em pose de mira + arma ----
  const torsoGeos: THREE.BufferGeometry[] = [
    colored(roundedBox(0.38, 0.5, 0.22, 0.05), C.fabric, { pos: [0, 0.25, 0] }),
    colored(roundedBox(0.36, 0.34, 0.07, 0.025), C.armor, { pos: [0, 0.3, -0.12] }), // placa frontal
    colored(roundedBox(0.36, 0.36, 0.07, 0.025), C.armor, { pos: [0, 0.3, 0.12] }), // placa traseira
    colored(box(0.1, 0.1, 0.05), C.armor2, { pos: [-0.11, 0.14, -0.165] }), // porta-carregadores
    colored(box(0.1, 0.1, 0.05), C.armor2, { pos: [0, 0.14, -0.165] }),
    colored(box(0.1, 0.1, 0.05), C.armor2, { pos: [0.11, 0.14, -0.165] }),
    colored(box(0.22, 0.26, 0.1), C.armor2, { pos: [0, 0.3, 0.19] }), // mochila/rádio
    colored(cyl(0.006, 0.006, 0.3, 5), C.black, { pos: [0.08, 0.55, 0.2] }), // antena
    colored(roundedBox(0.14, 0.08, 0.16, 0.03), C.armor, { pos: [-0.24, 0.47, 0], rot: [0, 0, 0.35] }), // ombreiras
    colored(roundedBox(0.14, 0.08, 0.16, 0.03), C.armor, { pos: [0.24, 0.47, 0], rot: [0, 0, -0.35] }),
    colored(cyl(0.06, 0.07, 0.08, 10), C.fabric2, { pos: [0, 0.54, 0] }), // pescoço
  ];
  // Braços: ombro → cotovelo → mãos juntas na frente do peito (pose de pistola).
  const arm = (side: number, hand: [number, number, number]): void => {
    const sh = new THREE.Vector3(side * 0.22, 0.43, -0.02);
    const hd = new THREE.Vector3(...hand);
    const elbow = new THREE.Vector3().lerpVectors(sh, hd, 0.5).add(new THREE.Vector3(side * 0.09, -0.12, 0.02));
    const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: number) => {
      const len = a.distanceTo(b);
      const g = roundedBox(r * 2, len, r * 2, r * 0.6);
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
      const e = new THREE.Euler().setFromQuaternion(q);
      torsoGeos.push(colored(g, color, { pos: [mid.x, mid.y, mid.z], rot: [e.x, e.y, e.z] }));
    };
    limb(sh, elbow, 0.055, C.fabric);
    limb(elbow, hd, 0.048, C.fabric2);
    torsoGeos.push(colored(roundedBox(0.07, 0.08, 0.09, 0.02), C.black, { pos: [hd.x, hd.y, hd.z] })); // luva
  };
  arm(1, [0.03, 0.34, -0.42]);
  arm(-1, [-0.02, 0.32, -0.4]);
  const spine = seg(torsoGeos, [
    colored(box(0.37, 0.025, 0.012), 0xffffff, { pos: [0, 0.42, -0.158] }), // faixa de equipe no peito
    colored(box(0.15, 0.02, 0.17), 0xffffff, { pos: [-0.25, 0.5, 0], rot: [0, 0, 0.35] }),
    colored(box(0.15, 0.02, 0.17), 0xffffff, { pos: [0.25, 0.5, 0], rot: [0, 0, -0.35] }),
  ]);
  spine.position.y = 0.98;
  body.add(spine);

  // Pistola de terceira pessoa (mesmos slots de material, mesclada por material).
  const pistol = buildPistol();
  const pistolMerged = mergeByMaterial(pistol.root);
  pistolMerged.position.set(0.02, 0.37, -0.44);
  pistolMerged.scale.setScalar(1.1);
  spine.add(pistolMerged);
  pistolMerged.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) materials.push(m);
  });

  // ---- cabeça ----
  const head = seg(
    [
      colored(new THREE.SphereGeometry(0.11, 14, 10), C.fabric2, { pos: [0, 0.1, 0], scale: [0.95, 1.05, 1] }), // balaclava
      colored(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), C.armor, { pos: [0, 0.13, 0.005] }), // capacete
      colored(box(0.27, 0.025, 0.27), C.armor2, { pos: [0, 0.12, 0.01] }), // aba
      colored(cyl(0.04, 0.04, 0.035, 12), C.black, { pos: [-0.12, 0.09, 0], rot: [0, 0, Math.PI / 2] }), // protetor auricular
      colored(cyl(0.04, 0.04, 0.035, 12), C.black, { pos: [0.12, 0.09, 0], rot: [0, 0, Math.PI / 2] }),
      colored(roundedBox(0.2, 0.06, 0.06, 0.02), C.visor, { pos: [0, 0.085, -0.1] }), // óculos/visor
      colored(box(0.05, 0.03, 0.04), C.black, { pos: [0, 0.21, -0.11] }), // suporte de NVG
    ],
    [colored(box(0.17, 0.012, 0.01), 0xffffff, { pos: [0, 0.095, -0.131] })], // filete luminoso do visor
  );
  head.position.y = 0.56;
  spine.add(head);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });

  const rig: OperatorRig = { root, body, hips, spine, head, thighL, thighR, shinL, shinR, accent, materials };
  root.userData.rig = rig;
  return rig;
};

/** Estado de animação procedural (por personagem). */
export class OperatorAnimator {
  private phase = 0;
  private deathT = 0;
  private air = 0;

  constructor(private readonly rig: OperatorRig) {}

  update(dt: number, s: { speed: number; crouchT: number; onGround: boolean; pitch: number; alive: boolean }): void {
    const r = this.rig;
    if (!s.alive) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      r.body.rotation.x = e * 1.45;
      r.body.position.y = -e * 0.05;
      r.body.position.z = e * 0.5;
      r.thighL.rotation.x = r.thighR.rotation.x = -e * 0.3;
      return;
    }
    this.deathT = 0;
    r.body.rotation.x = 0;
    r.body.position.set(0, 0, 0);

    const speedK = Math.min(1, s.speed / 4.6);
    this.phase += dt * (4 + s.speed * 1.6) * (s.speed > 0.2 ? 1 : 0);
    this.air += ((s.onGround ? 0 : 1) - this.air) * Math.min(1, dt * 10);
    const swing = Math.sin(this.phase) * 0.7 * speedK * (1 - this.air);
    const c = s.crouchT;

    // Agachamento: quadril desce 0,55 m e pernas dobram (cabeça ≈ 1,15 m).
    r.hips.position.y = 0.92 - c * 0.55;
    r.spine.position.y = 0.98 - c * 0.55;
    r.spine.rotation.x = s.pitch * 0.55 - c * 0.18;
    r.head.rotation.x = s.pitch * 0.45 + c * 0.12;

    const crouchThigh = c * 1.25;
    const crouchShin = -c * 2.3;
    const airThigh = this.air * 0.55;
    const airShin = -this.air * 0.9;
    r.thighL.rotation.x = crouchThigh + airThigh + swing;
    r.thighR.rotation.x = crouchThigh + airThigh - swing;
    r.shinL.rotation.x = crouchShin + airShin - Math.max(0, -Math.sin(this.phase)) * 0.9 * speedK * (1 - this.air);
    r.shinR.rotation.x = crouchShin + airShin - Math.max(0, Math.sin(this.phase)) * 0.9 * speedK * (1 - this.air);
    // Balanço vertical do passo.
    const bob = Math.abs(Math.cos(this.phase)) * 0.03 * speedK * (1 - this.air);
    r.hips.position.y += bob;
    r.spine.position.y += bob;
  }
}
