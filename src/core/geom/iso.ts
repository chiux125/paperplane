import type { Line } from './line';
import { type Vec2, normalize, vec } from './vec';

/**
 * 平面等距變換（旋轉＋平移，可能含鏡射），排列方式同 Canvas 的 setTransform：
 *   x' = a·x + c·y + tx
 *   y' = b·x + d·y + ty
 * det = +1 為一般移動，det = -1 表示翻了面。
 */
export interface Iso2 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Iso2 = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export const apply = (m: Iso2, p: Vec2): Vec2 =>
  vec(m.a * p.x + m.c * p.y + m.tx, m.b * p.x + m.d * p.y + m.ty);

export const applyLinear = (m: Iso2, v: Vec2): Vec2 =>
  vec(m.a * v.x + m.c * v.y, m.b * v.x + m.d * v.y);

export const det = (m: Iso2): number => m.a * m.d - m.b * m.c;

/** m ∘ n：先做 n，再做 m。 */
export function compose(m: Iso2, n: Iso2): Iso2 {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
  };
}

export function invert(m: Iso2): Iso2 {
  const k = det(m);
  const a = m.d / k;
  const b = -m.b / k;
  const c = -m.c / k;
  const d = m.a / k;
  return { a, b, c, d, tx: -(a * m.tx + c * m.ty), ty: -(b * m.tx + d * m.ty) };
}

/** 對直線 l 鏡射（也就是紙沿這條線翻 180 度後的平面結果）。 */
export function reflection(l: Line): Iso2 {
  const { x: dx, y: dy } = l.d;
  const a = dx * dx - dy * dy;
  const b = 2 * dx * dy;
  const d = -a;
  return { a, b, c: b, d, tx: l.p.x - (a * l.p.x + b * l.p.y), ty: l.p.y - (b * l.p.x + d * l.p.y) };
}

export function transformLine(m: Iso2, l: Line): Line {
  return { p: apply(m, l.p), d: normalize(applyLinear(m, l.d)) };
}
