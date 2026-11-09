import type { Vec3 } from '../math/vec3.js';

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export const aabbOverlap = (a: AABB, b: AABB, eps = 0): boolean =>
  a.min.x < b.max.x - eps &&
  a.max.x > b.min.x + eps &&
  a.min.y < b.max.y - eps &&
  a.max.y > b.min.y + eps &&
  a.min.z < b.max.z - eps &&
  a.max.z > b.min.z + eps;

/**
 * Interseção raio x AABB (método das placas). Retorna a distância t >= 0 ao longo
 * de `dir` (normalizado) ou -1 se não houver acerto dentro de `maxDist`.
 * `normalOut` recebe a normal da face atingida.
 */
export const rayAabb = (
  origin: Vec3,
  dir: Vec3,
  box: AABB,
  maxDist: number,
  normalOut?: Vec3,
): number => {
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 0;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    const oi = o[i]!;
    const di = d[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < mn[i]! || oi > mx[i]!) return -1;
      continue;
    }
    const inv = 1 / di;
    let t1 = (mn[i]! - oi) * inv;
    let t2 = (mx[i]! - oi) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (normalOut) {
    normalOut.x = axis === 0 ? sign : 0;
    normalOut.y = axis === 1 ? sign : 0;
    normalOut.z = axis === 2 ? sign : 0;
  }
  return tmin;
};
