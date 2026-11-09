import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapDef, SurfaceMaterial } from '@vertice/shared';
import type { AssetManager } from '../assets/AssetManager.js';
import type { GraphicsSettings } from '../config/settings.js';

/**
 * Constrói a malha visual a partir da definição do mapa.
 * Nesta fase a malha visual é gerada das mesmas caixas da colisão; as caixas
 * são mescladas por material (≈7 draw calls para a geometria estática).
 * UVs em coordenadas de mundo → texturas contínuas entre peças.
 */

const TEX_FOR: Record<SurfaceMaterial, string> = {
  floor: 'tex.floor',
  concrete: 'tex.concrete',
  concreteDark: 'tex.concreteDark',
  metal: 'tex.metal',
  crate: 'tex.crate',
  trim: 'tex.trim',
};

const boxGeometry = (min: THREE.Vector3, max: THREE.Vector3, metersPerTile: number, worldUV: boolean): THREE.BufferGeometry => {
  const size = new THREE.Vector3().subVectors(max, min);
  const g = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
  g.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const pos = g.attributes.position!;
  const nor = g.attributes.normal!;
  const uv = g.attributes.uv!;
  if (worldUV) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      let u: number;
      let v: number;
      if (ny > 0.5) {
        u = x;
        v = z;
      } else if (nx > 0.5) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      uv.setXY(i, u / metersPerTile, v / metersPerTile);
    }
  }
  return g;
};

export interface BuiltMap {
  root: THREE.Group;
  sun: THREE.DirectionalLight;
  dispose: () => void;
}

export const buildMap = (def: MapDef, assets: AssetManager, gfx: GraphicsSettings, scene: THREE.Scene): BuiltMap => {
  const root = new THREE.Group();
  root.name = `map:${def.id}`;
  const disposables: { dispose: () => void }[] = [];

  // ---- geometria estática por material ----
  const groups = new Map<SurfaceMaterial, THREE.BufferGeometry[]>();
  for (const b of def.boxes) {
    if (b.visible === false) continue;
    const tex = assets.texture(TEX_FOR[b.mat]);
    const g = boxGeometry(
      new THREE.Vector3(b.min.x, b.min.y, b.min.z),
      new THREE.Vector3(b.max.x, b.max.y, b.max.z),
      tex.metersPerTile,
      b.mat !== 'crate',
    );
    let list = groups.get(b.mat);
    if (!list) groups.set(b.mat, (list = []));
    list.push(g);
  }
  for (const [mat, geos] of groups) {
    const tex = assets.texture(TEX_FOR[mat]);
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    const material = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      roughness: tex.roughness,
      metalness: tex.metalness,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `static:${mat}`;
    mesh.castShadow = mat !== 'floor';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    disposables.push(merged, material);
  }

  // ---- faixas emissivas (identidade visual) ----
  const stripGeos = new Map<string, THREE.BufferGeometry[]>();
  for (const s of def.strips) {
    const g = boxGeometry(new THREE.Vector3(s.min.x, s.min.y, s.min.z), new THREE.Vector3(s.max.x, s.max.y, s.max.z), 1, false);
    const key = `${s.color}|${s.intensity}`;
    let l = stripGeos.get(key);
    if (!l) stripGeos.set(key, (l = []));
    l.push(g);
  }
  for (const [key, geos] of stripGeos) {
    const [color, intensity] = key.split('|');
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    const c = new THREE.Color(color).multiplyScalar(Number(intensity));
    const material = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    disposables.push(merged, material);
  }

  // ---- céu (gradiente) ----
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#1d2a44') },
      mid: { value: new THREE.Color('#6b5a4f') },
      bottom: { value: new THREE.Color('#14161b') },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bottom, pow(-h, 0.4));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  root.add(sky);
  disposables.push(skyGeo, skyMat);

  // ---- luzes ----
  const amb = new THREE.HemisphereLight(def.ambient.sky, def.ambient.ground, def.ambient.intensity);
  root.add(amb);
  const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
  const d = new THREE.Vector3(...def.sun.dir).normalize();
  sun.position.copy(d.clone().multiplyScalar(-40));
  sun.target.position.set(0, 0, 0);
  root.add(sun, sun.target);
  if (gfx.shadows !== 'off') {
    sun.castShadow = true;
    const res = gfx.shadows === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(res, res);
    const cam = sun.shadow.camera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 1;
    cam.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  for (const l of def.lights) {
    const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 1.6);
    pl.position.set(l.x, l.y, l.z);
    root.add(pl);
  }

  scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  scene.add(root);

  return {
    root,
    sun,
    dispose: () => {
      scene.remove(root);
      disposables.forEach((x) => x.dispose());
      sun.shadow.map?.dispose();
    },
  };
};
