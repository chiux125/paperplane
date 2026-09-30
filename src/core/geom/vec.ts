import { EPS } from './eps';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => vec(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => vec(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, k: number): Vec2 => vec(a.x * k, a.y * k);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D 外積（z 分量）：> 0 表示 b 在 a 的逆時針方向。 */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
/** 逆時針轉 90 度。 */
export const perp = (a: Vec2): Vec2 => vec(-a.y, a.x);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 =>
  vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const near = (a: Vec2, b: Vec2, eps = EPS): boolean => dist(a, b) <= eps;

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  if (l === 0) throw new Error('cannot normalize zero vector');
  return scale(a, 1 / l);
}
