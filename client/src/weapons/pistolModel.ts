import * as THREE from 'three';
import { box, cyl, place, roundedBox } from '../assets/geo.js';
import { texStipple } from '../assets/proceduralTextures.js';

/**
 * "Corvo SA-12" — pistola procedural original, montada com ~30 peças.
 * PROVISÓRIO (geometria procedural de qualidade, seção 5 item 2): o modelo
 * final em GLB está descrito em docs/ASSETS_PENDENTES.md.
 *
 * Slots de material (onde as skins serão aplicadas na Fase 3):
 *   slide, frame, grip, barrel, details, sight
 * Origem: topo da empunhadura (onde a mão segura). Cano aponta para -Z.
 */

export type PistolSlot = 'slide' | 'frame' | 'grip' | 'barrel' | 'details' | 'sight';

export interface PistolRig {
  root: THREE.Group;
  slide: THREE.Group;
  magazine: THREE.Group;
  trigger: THREE.Object3D;
  muzzle: THREE.Object3D;
  materials: Record<PistolSlot, THREE.MeshStandardMaterial>;
}

let stipple: ReturnType<typeof texStipple> | null = null;

export const createPistolMaterials = (): Record<PistolSlot, THREE.MeshStandardMaterial> => {
  stipple ??= texStipple();
  const m = (name: string, p: THREE.MeshStandardMaterialParameters) => {
    const mat = new THREE.MeshStandardMaterial(p);
    mat.name = name;
    return mat;
  };
  return {
    slide: m('slide', { color: 0x4a505a, metalness: 0.8, roughness: 0.38 }),
    frame: m('frame', { color: 0x2a2e35, metalness: 0.05, roughness: 0.6 }),
    grip: m('grip', { color: 0xffffff, map: stipple.map, normalMap: stipple.normalMap, roughness: 0.85, metalness: 0 }),
    barrel: m('barrel', { color: 0x9a9ea6, metalness: 0.95, roughness: 0.22 }),
    details: m('details', { color: 0x0c0e11, metalness: 0.4, roughness: 0.5 }),
    sight: m('sight', { color: 0x111111, emissive: 0xffb020, emissiveIntensity: 2.2 }),
  };
};

export const buildPistol = (materials = createPistolMaterials()): PistolRig => {
  const M = materials;
  const root = new THREE.Group();
  root.name = 'pistol-corvo';
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) => {
    const me = place(new THREE.Mesh(g, mat), { pos, rot });
    me.castShadow = true;
    return me;
  };

  // ---- ferrolho (anima no disparo) ----
  const slide = new THREE.Group();
  slide.name = 'slide';
  root.add(slide);
  slide.add(mesh(roundedBox(0.028, 0.03, 0.19, 0.004), M.slide, [0, 0.046, -0.06]));
  // chanfro superior
  slide.add(mesh(box(0.02, 0.004, 0.18), M.slide, [0, 0.062, -0.062]));
  // serrilhas traseiras
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) slide.add(mesh(box(0.0012, 0.022, 0.0022), M.details, [side * 0.0143, 0.046, 0.024 - i * 0.0055]));
  }
  // serrilhas dianteiras
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) slide.add(mesh(box(0.0012, 0.016, 0.002), M.details, [side * 0.0143, 0.048, -0.122 - i * 0.005]));
  }
  // janela de ejeção
  slide.add(mesh(box(0.004, 0.012, 0.034), M.details, [0.0125, 0.052, -0.035]));
  slide.add(mesh(box(0.008, 0.009, 0.03), M.barrel, [0.008, 0.052, -0.035]));
  // miras
  slide.add(mesh(box(0.006, 0.008, 0.007), M.details, [-0.0065, 0.066, 0.028]));
  slide.add(mesh(box(0.006, 0.008, 0.007), M.details, [0.0065, 0.066, 0.028]));
  slide.add(mesh(box(0.004, 0.009, 0.006), M.details, [0, 0.066, -0.146]));
  slide.add(mesh(new THREE.SphereGeometry(0.0014, 8, 6), M.sight, [0, 0.069, -0.1428]));
  slide.add(mesh(new THREE.SphereGeometry(0.0011, 8, 6), M.sight, [-0.0065, 0.068, 0.0318]));
  slide.add(mesh(new THREE.SphereGeometry(0.0011, 8, 6), M.sight, [0.0065, 0.068, 0.0318]));

  // ---- cano ----
  const barrel = mesh(cyl(0.0068, 0.0068, 0.03, 16), M.barrel, [0, 0.046, -0.148], [Math.PI / 2, 0, 0]);
  root.add(barrel);
  root.add(mesh(new THREE.TorusGeometry(0.0068, 0.0016, 6, 16), M.details, [0, 0.046, -0.1555]));

  // ---- armação ----
  root.add(mesh(roundedBox(0.026, 0.022, 0.15, 0.004), M.frame, [0, 0.02, -0.045]));
  // trilho sob o cano
  root.add(mesh(box(0.022, 0.008, 0.05), M.frame, [0, 0.006, -0.095]));
  for (let i = 0; i < 3; i++) root.add(mesh(box(0.024, 0.003, 0.004), M.details, [0, 0.0015, -0.08 - i * 0.012]));
  // guarda-mato
  const guard = mesh(new THREE.TorusGeometry(0.017, 0.0028, 6, 16, Math.PI), M.frame, [0, 0.008, -0.03], [0, Math.PI / 2, Math.PI]);
  root.add(guard);
  // gatilho
  const trigger = mesh(roundedBox(0.006, 0.019, 0.006, 0.002), M.details, [0, -0.002, -0.026], [0.25, 0, 0]);
  root.add(trigger);
  // cão / traseira
  root.add(mesh(box(0.01, 0.012, 0.01), M.details, [0, 0.05, 0.04]));
  // rabo de castor
  root.add(mesh(roundedBox(0.026, 0.014, 0.024, 0.004), M.frame, [0, 0.022, 0.034], [0.35, 0, 0]));
  // retém do ferrolho e da trava
  root.add(mesh(box(0.003, 0.005, 0.02), M.details, [-0.0145, 0.03, -0.02]));
  root.add(mesh(box(0.003, 0.007, 0.007), M.details, [-0.0145, 0.012, 0.004]));

  // ---- empunhadura ----
  const gripTilt = -0.28;
  const grip = mesh(roundedBox(0.03, 0.105, 0.044, 0.006, 3), M.grip, [0, -0.043, 0.014], [gripTilt, 0, 0]);
  root.add(grip);
  // costelas frontais (apoio dos dedos)
  for (let i = 0; i < 3; i++) root.add(mesh(box(0.031, 0.004, 0.006), M.frame, [0, -0.012 - i * 0.026, -0.006 - i * 0.0072], [gripTilt, 0, 0]));

  // ---- carregador (anima na recarga) ----
  const magazine = new THREE.Group();
  magazine.name = 'magazine';
  magazine.position.set(0, -0.043, 0.014);
  magazine.rotation.x = gripTilt;
  root.add(magazine);
  magazine.add(mesh(box(0.024, 0.1, 0.034), M.details, [0, -0.002, 0]));
  magazine.add(mesh(roundedBox(0.032, 0.01, 0.046, 0.003), M.frame, [0, -0.057, 0]));

  // ---- boca do cano (efeitos) ----
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.046, -0.168);
  root.add(muzzle);

  const rig: PistolRig = { root, slide, magazine, trigger, muzzle, materials: M };
  root.userData.rig = rig;
  return rig;
};
