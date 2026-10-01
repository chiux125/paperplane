// 3D 向量（mm）。只有階段 2 之後的立體組裝（Assembly）會用到，摺紙核心仍然是 2D。

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale3 = (a: Vec3, k: number): Vec3 => vec3(a.x * k, a.y * k, a.z * k);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export function normalize3(a: Vec3): Vec3 {
  const l = length3(a);
  if (l === 0) throw new Error('cannot normalize zero vector');
  return scale3(a, 1 / l);
}

/**
 * 繞著通過原點、單位方向為 axis 的軸，把 v 旋轉 angle（弧度，右手定則）。
 * Rodrigues 公式：v·cosθ + (axis×v)·sinθ + axis·(axis·v)·(1−cosθ)。
 */
export function rotateAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot3(axis, v) * (1 - c);
  const cr = cross3(axis, v);
  return vec3(
    v.x * c + cr.x * s + axis.x * k,
    v.y * c + cr.y * s + axis.y * k,
    v.z * c + cr.z * s + axis.z * k,
  );
}
