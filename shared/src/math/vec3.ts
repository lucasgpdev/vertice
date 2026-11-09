/** Vetor 3D mínimo, sem dependência de Three.js, usado pela simulação compartilhada. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copyVec3 = (out: Vec3, a: Vec3): Vec3 => {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
};
export const cloneVec3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const lerpVec3 = (out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
};
export const distVec3 = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Direção de visão a partir de yaw/pitch (radianos). yaw=0 olha para -Z (convenção Three.js). */
export const dirFromAngles = (yaw: number, pitch: number, out: Vec3 = vec3()): Vec3 => {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
};

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/** Interpola ângulo pelo caminho mais curto. */
export const lerpAngle = (a: number, b: number, t: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Arredonda para 1 cm (quantização de snapshots). */
export const q2 = (v: number): number => Math.round(v * 100) / 100;
/** Arredonda ângulos para 0,001 rad. */
export const q3 = (v: number): number => Math.round(v * 1000) / 1000;
