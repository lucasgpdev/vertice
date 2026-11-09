import type { AABB } from './aabb.js';
import { rayAabb } from './aabb.js';
import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';

/**
 * Geometria de colisão estática do mapa (separada da malha visual).
 * Broadphase por grade uniforme no plano XZ para manter consultas baratas
 * quando os mapas tiverem centenas de caixas.
 */
export class CollisionWorld {
  readonly boxes: readonly AABB[];
  private readonly cell: number;
  private readonly grid = new Map<number, number[]>();
  private readonly stamp: Uint32Array;
  private stampId = 0;

  constructor(boxes: readonly AABB[], cellSize = 4) {
    this.boxes = boxes;
    this.cell = cellSize;
    this.stamp = new Uint32Array(boxes.length);
    boxes.forEach((b, i) => {
      const x0 = Math.floor(b.min.x / cellSize);
      const x1 = Math.floor(b.max.x / cellSize);
      const z0 = Math.floor(b.min.z / cellSize);
      const z1 = Math.floor(b.max.z / cellSize);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = this.key(x, z);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(i);
        }
    });
  }

  private key(x: number, z: number): number {
    return (x + 1024) * 4096 + (z + 1024);
  }

  /** Chama `fn` para cada caixa cuja célula toca a região [minX,maxX]x[minZ,maxZ]. */
  queryRegion(minX: number, minZ: number, maxX: number, maxZ: number, fn: (box: AABB) => void): void {
    const id = ++this.stampId;
    const c = this.cell;
    const x0 = Math.floor(minX / c);
    const x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c);
    const z1 = Math.floor(maxZ / c);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const list = this.grid.get(this.key(x, z));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          fn(this.boxes[i]!);
        }
      }
  }

  /**
   * Raycast contra a geometria. Retorna a distância do primeiro acerto ou -1.
   * Implementação simples: testa as caixas das células cobertas pelo AABB do raio.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, normalOut?: Vec3): number {
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    let best = -1;
    const n = vec3();
    this.queryRegion(
      Math.min(origin.x, ex),
      Math.min(origin.z, ez),
      Math.max(origin.x, ex),
      Math.max(origin.z, ez),
      (box) => {
        const t = rayAabb(origin, dir, box, best < 0 ? maxDist : best, n);
        if (t >= 0 && (best < 0 || t < best)) {
          best = t;
          if (normalOut) {
            normalOut.x = n.x;
            normalOut.y = n.y;
            normalOut.z = n.z;
          }
        }
      },
    );
    return best;
  }

  /** Verdadeiro se nada bloqueia o segmento a->b (linha de visão). */
  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const t = this.raycast(a, dir, len);
    return t < 0 || t >= len - 1e-3;
  }
}
