import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Utilitários de modelagem procedural. */

export interface PartOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

export const place = <T extends THREE.Object3D>(o: T, opts: PartOpts = {}): T => {
  if (opts.pos) o.position.set(...opts.pos);
  if (opts.rot) o.rotation.set(...opts.rot);
  if (opts.scale) o.scale.set(...opts.scale);
  return o;
};

export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);

/** Caixa com cantos chanfrados (perfil extrudado), mais orgânica que um cubo puro. */
export const roundedBox = (w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry => {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - r * 2,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r * 0.6,
    bevelSegments: seg,
    curveSegments: seg,
  });
  g.translate(0, 0, -(d - r * 2) / 2);
  g.computeVertexNormals();
  return g;
};

/** Aplica transformação e cor de vértice a uma geometria (para mesclagem). */
export const colored = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation, opts: PartOpts = {}): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  g.dispose();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(opts.pos ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot ?? [0, 0, 0]))),
    new THREE.Vector3(...(opts.scale ?? [1, 1, 1])),
  );
  geo.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = geo.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
};

/** Mescla geometrias coloridas em uma (1 draw call). */
export const merge = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const norm = geos.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(norm, false);
  if (!out) throw new Error('falha ao mesclar geometrias');
  norm.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
};

/**
 * Mescla todas as malhas de um grupo por material (útil para o modelo de
 * terceira pessoa da arma: menos draw calls, mesmos slots de material).
 */
export const mergeByMaterial = (root: THREE.Object3D): THREE.Group => {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld),
    );
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    let list = buckets.get(mat);
    if (!list) buckets.set(mat, (list = []));
    list.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat.name;
    mesh.castShadow = true;
    out.add(mesh);
  }
  return out;
};
