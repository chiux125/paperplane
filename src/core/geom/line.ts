import { EPS } from './eps';
import { type Vec2, add, cross, dist, dot, midpoint, perp, scale, sub } from './vec';

/** 無限長直線：通過 p，方向為單位向量 d。「左側」是 d 逆時針轉 90 度那一側。 */
export interface Line {
  readonly p: Vec2;
  readonly d: Vec2;
}

export function lineThrough(a: Vec2, b: Vec2): Line | null {
  const l = dist(a, b);
  if (l < EPS) return null;
  return { p: a, d: scale(sub(b, a), 1 / l) };
}

/** 帶正負號的距離：> 0 在左側，< 0 在右側。 */
export const signedDist = (l: Line, q: Vec2): number => cross(l.d, sub(q, l.p));

export function reflectPoint(l: Line, q: Vec2): Vec2 {
  return sub(q, scale(perp(l.d), 2 * signedDist(l, q)));
}

export function projectPoint(l: Line, q: Vec2): Vec2 {
  return add(l.p, scale(l.d, dot(sub(q, l.p), l.d)));
}

/** A、B 的中垂線：沿這條線摺，A 會落到 B 上。 */
export function perpendicularBisector(a: Vec2, b: Vec2): Line | null {
  const l = dist(a, b);
  if (l < EPS) return null;
  return { p: midpoint(a, b), d: perp(scale(sub(b, a), 1 / l)) };
}

export function intersectLines(l1: Line, l2: Line): Vec2 | null {
  const den = cross(l1.d, l2.d);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(l2.p, l1.p), l2.d) / den;
  return add(l1.p, scale(l1.d, t));
}
