import * as THREE from 'three';

/**
 * Texturas PBR geradas por código (albedo + rugosidade + normal), usadas
 * enquanto não houver texturas finais (ver docs/ASSETS_PENDENTES.md).
 * Todas originais: ruído fractal + padrões desenhados em canvas.
 */

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** Quantos metros uma repetição da textura cobre (UV em coordenadas de mundo). */
  metersPerTile: number;
  metalness: number;
  roughness: number;
}

// ---------- ruído ----------
const hash = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Ruído de valor periódico (tileable) com período `p` células. */
const vnoise = (x: number, y: number, p: number, seed: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const m = (v: number) => ((v % p) + p) % p;
  const a = hash(m(xi), m(yi), seed);
  const b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed);
  const d = hash(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};
const fbm = (u: number, v: number, base: number, oct: number, seed: number): number => {
  let s = 0;
  let amp = 0.5;
  let f = base;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(u * f, v * f, f, seed + o * 17);
    f *= 2;
    amp *= 0.5;
  }
  return s;
};

interface Layers {
  size: number;
  albedo: Uint8ClampedArray;
  height: Float32Array;
  rough: Uint8ClampedArray;
}

const makeLayers = (size: number): Layers => ({
  size,
  albedo: new Uint8ClampedArray(size * size * 4),
  height: new Float32Array(size * size),
  rough: new Uint8ClampedArray(size * size * 4),
});

const toCanvas = (size: number, data: Uint8ClampedArray): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return c;
};

const normalFromHeight = (L: Layers, strength: number): Uint8ClampedArray => {
  const { size, height } = L;
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nz = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = (-dx * nz * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * nz * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  return out;
};

const finish = (L: Layers, normalStrength: number, metersPerTile: number, metalness: number, roughness: number, srgbAlbedo = true): PbrSet => {
  const mk = (data: Uint8ClampedArray, srgb: boolean): THREE.Texture => {
    const t = new THREE.CanvasTexture(toCanvas(L.size, data));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    return t;
  };
  return {
    map: mk(L.albedo, srgbAlbedo),
    normalMap: mk(normalFromHeight(L, normalStrength), false),
    roughnessMap: mk(L.rough, false),
    metersPerTile,
    metalness,
    roughness,
  };
};

const put = (L: Layers, i: number, r: number, g: number, b: number, h: number, rough: number): void => {
  const j = i * 4;
  L.albedo[j] = r;
  L.albedo[j + 1] = g;
  L.albedo[j + 2] = b;
  L.albedo[j + 3] = 255;
  L.height[i] = h;
  L.rough[j] = L.rough[j + 1] = L.rough[j + 2] = rough;
  L.rough[j + 3] = 255;
};

// ---------- materiais ----------

/** Piso de placas de concreto 2 m com juntas e manchas. Tile = 4 m (2x2 placas). */
export const texFloor = (): PbrSet => {
  const S = 512;
  const L = makeLayers(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm(u, v, 8, 5, 1);
      const stain = fbm(u, v, 3, 3, 9);
      const tx = Math.floor(u * 2);
      const ty = Math.floor(v * 2);
      const tileTint = hash(tx, ty, 3) * 0.08;
      const gu = (u * 2) % 1;
      const gv = (v * 2) % 1;
      const seam = Math.min(gu, 1 - gu, gv, 1 - gv) < 0.006 ? 1 : 0;
      let c = 0.36 + n * 0.18 + tileTint - (stain > 0.62 ? (stain - 0.62) * 0.6 : 0);
      if (seam) c *= 0.45;
      put(L, y * S + x, c * 235, c * 228, c * 218, n * 0.6 - seam * 1.2, 190 + n * 50 - seam * 40);
    }
  return finish(L, 2.2, 4, 0, 1);
};

/** Concreto moldado com marcas de fôrma e furos de tirante. Tile = 2,4 m. */
export const texConcrete = (dark = false): PbrSet => {
  const S = 512;
  const L = makeLayers(S);
  const base = dark ? [0.25, 0.27, 0.31] : [0.52, 0.5, 0.47];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm(u, v, 6, 5, dark ? 21 : 4);
      const fine = vnoise(u * 128, v * 128, 128, 7);
      const pu = (u * 2) % 1;
      const pv = v % 1;
      const panel = Math.min(pu, 1 - pu) < 0.004 || Math.min(pv, 1 - pv) < 0.004;
      // furos de tirante
      const hx = (u * 4) % 1;
      const hy = (v * 2 + 0.25) % 1;
      const hole = Math.hypot(hx - 0.5, (hy - 0.5) * 0.5) < 0.03;
      const band = dark ? (Math.sin(v * Math.PI * 10) > 0.96 ? -0.05 : 0) : 0;
      let k = 0.82 + n * 0.32 + fine * 0.06 + band;
      if (panel) k *= 0.7;
      if (hole) k *= 0.35;
      put(L, y * S + x, base[0]! * k * 255, base[1]! * k * 255, base[2]! * k * 255, n * 0.8 + fine * 0.2 - (panel ? 0.8 : 0) - (hole ? 1.5 : 0), 205 + fine * 40);
    }
  return finish(L, 2.5, 2.4, 0, 1);
};

/** Chapas de aço com rebites e arranhões. Tile = 2 m. */
export const texMetal = (): PbrSet => {
  const S = 512;
  const L = makeLayers(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm(u, v, 10, 4, 33);
      const scratch = vnoise(u * 256, v * 6, 256, 41);
      const pu = (u * 2) % 1;
      const pv = (v * 2) % 1;
      const seam = Math.min(pu, 1 - pu, pv, 1 - pv) < 0.008;
      const ru = (u * 16) % 1;
      const rv = (v * 2) % 1;
      const rivet = Math.min(rv, 1 - rv) < 0.05 && Math.hypot(ru - 0.5, 0) < 0.12 && Math.min(rv, 1 - rv) > 0.015;
      let k = 0.34 + n * 0.16 + (scratch > 0.82 ? 0.12 : 0);
      if (seam) k *= 0.5;
      if (rivet) k += 0.12;
      put(L, y * S + x, k * 205, k * 214, k * 225, n * 0.3 - (seam ? 1 : 0) + (rivet ? 0.8 : 0), 120 + n * 70 - (scratch > 0.82 ? 50 : 0));
    }
  return finish(L, 3, 2, 0.75, 1);
};

/** Faixa industrial: aço pintado escuro com listras de sinalização em âmbar. Tile = 2 m. */
export const texTrim = (): PbrSet => {
  const S = 512;
  const L = makeLayers(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm(u, v, 8, 4, 55);
      const wear = fbm(u, v, 16, 3, 77);
      const stripe = ((u + v) * 8) % 1 < 0.5;
      const zone = v > 0.82; // faixa de sinalização na parte inferior do tile
      let r: number;
      let g: number;
      let b: number;
      if (zone && stripe && wear < 0.7) {
        r = 255 * (0.85 + n * 0.1);
        g = 166 * (0.85 + n * 0.1);
        b = 26;
      } else {
        const k = 0.16 + n * 0.08;
        r = k * 240;
        g = k * 245;
        b = k * 255;
      }
      if (wear > 0.72) {
        r = g = b = 120 + n * 40; // tinta gasta → metal exposto
      }
      put(L, y * S + x, r, g, b, n * 0.4 + (wear > 0.72 ? -0.3 : 0), wear > 0.72 ? 110 : 170 + n * 40);
    }
  return finish(L, 2, 2, 0.35, 1);
};

/** Caixa de transporte de compósito (UV 0..1 por face). */
export const texCrate = (): PbrSet => {
  const S = 512;
  const L = makeLayers(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm(u, v, 8, 4, 91);
      const frame = Math.min(u, 1 - u, v, 1 - v) < 0.085;
      const edge = Math.abs(Math.min(u, 1 - u, v, 1 - v) - 0.085) < 0.006;
      const ribs = !frame && ((v * 6) % 1) < 0.06;
      const brace = !frame && (Math.abs(u - v) < 0.045 || Math.abs(u - (1 - v)) < 0.045);
      const stencil = !frame && u > 0.32 && u < 0.68 && v > 0.44 && v < 0.56 && ((u * 40) % 2 < 1.2) && !(v > 0.48 && v < 0.52 && u > 0.36 && u < 0.64);
      let r = 62;
      let g = 74;
      let b = 52;
      let hgt = 0;
      if (frame) {
        r = 44;
        g = 50;
        b = 40;
        hgt = 1;
      }
      if (brace) {
        r = 54;
        g = 64;
        b = 46;
        hgt = 0.6;
      }
      if (ribs) hgt = -0.4;
      if (edge) hgt = -1;
      if (stencil) {
        r = 200;
        g = 170;
        b = 90;
      }
      const k = 0.85 + n * 0.3;
      put(L, y * S + x, r * k, g * k, b * k, hgt + n * 0.3, 190 + n * 40);
    }
  return finish(L, 2.5, 1, 0, 1);
};

/** Textura de empunhadura pontilhada (para a pistola). */
export const texStipple = (): PbrSet => {
  const S = 256;
  const L = makeLayers(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const d = vnoise(u * 64, v * 64, 64, 5);
      const k = 0.14 + d * 0.06;
      put(L, y * S + x, k * 255, k * 255, k * 262, d, 215);
    }
  return finish(L, 4, 0.05, 0, 1);
};
