import { EPS } from './eps';
import { lineThrough, signedDist } from './line';
import { type Vec2, cross, dist, lerp, sub, vec } from './vec';

/** 多邊形頂點依逆時針（CCW）排列。本專案中所有面都是凸多邊形。 */
export type Polygon = readonly Vec2[];

export function signedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export const area = (poly: Polygon): number => Math.abs(signedArea(poly));

export function centroid(poly: Polygon): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const w = p.x * q.y - q.x * p.y;
    a += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < 1e-12) {
    // 退化成線或點：用頂點平均
    const sx = poly.reduce((s, p) => s + p.x, 0);
    const sy = poly.reduce((s, p) => s + p.y, 0);
    return vec(sx / poly.length, sy / poly.length);
  }
  return vec(cx / (3 * a), cy / (3 * a));
}

/** 逆時針、面積為正、每個轉角都不往內凹（容許共線點）。 */
export function isConvex(poly: Polygon, eps = EPS): boolean {
  if (poly.length < 3 || signedArea(poly) <= 0) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const ab = dist(a, b);
    if (ab < eps) return false;
    // c 到直線 ab 的有號距離；凸多邊形不可以跑到右邊
    if (cross(sub(b, a), sub(c, b)) / ab < -eps) return false;
  }
  return true;
}

function dedupe(points: Vec2[], eps = EPS): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (out.length === 0 || dist(out[out.length - 1], p) > eps) out.push(p);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

export interface PolygonSplit {
  /** 在線左側（距離 ≥ 0）的部分；完全不在左側則為 null。 */
  readonly left: Vec2[] | null;
  readonly right: Vec2[] | null;
  /** 切口上的點（在原多邊形的座標中）。真的切開時恰好 2 個。 */
  readonly cut: Vec2[];
}

/**
 * 依「每個頂點到切線的有號距離」切開凸多邊形。
 * 距離是另外算好傳進來的，所以可以用摺好後的座標判斷左右，卻在原紙座標上切割。
 */
export function splitByDistances(poly: Polygon, dists: readonly number[], eps = EPS): PolygonSplit {
  const ds = dists.map((d) => (Math.abs(d) <= eps ? 0 : d));
  const hasPos = ds.some((d) => d > 0);
  const hasNeg = ds.some((d) => d < 0);
  if (!hasNeg) return { left: [...poly], right: null, cut: [] };
  if (!hasPos) return { left: null, right: [...poly], cut: [] };

  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const cut: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const p = poly[i];
    const dp = ds[i];
    const dq = ds[j];
    if (dp >= 0) left.push(p);
    if (dp <= 0) right.push(p);
    if (dp === 0) cut.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const x = lerp(p, poly[j], dp / (dp - dq));
      left.push(x);
      right.push(x);
      cut.push(x);
    }
  }
  return { left: dedupe(left, eps), right: dedupe(right, eps), cut: dedupe(cut, eps) };
}

/** 兩個凸多邊形的交集（Sutherland–Hodgman）。沒有交集時回傳空陣列。 */
export function convexIntersection(a: Polygon, b: Polygon): Vec2[] {
  let out: Vec2[] = [...a];
  for (let i = 0; i < b.length && out.length > 0; i++) {
    const edge = lineThrough(b[i], b[(i + 1) % b.length]);
    if (!edge) continue;
    out = splitByDistances(out, out.map((p) => signedDist(edge, p))).left ?? [];
  }
  return out.length >= 3 ? out : [];
}

export const overlapArea = (a: Polygon, b: Polygon): number => area(convexIntersection(a, b));

/** 點是否嚴格在凸多邊形內部（離每條邊都超過 eps）。 */
export function strictlyInside(p: Vec2, poly: Polygon, eps = EPS): boolean {
  for (let i = 0; i < poly.length; i++) {
    const edge = lineThrough(poly[i], poly[(i + 1) % poly.length]);
    if (edge && signedDist(edge, p) <= eps) return false;
  }
  return true;
}

/** 把線段裁切到凸多邊形內（含邊界）。剩下的長度不超過 eps 時回傳 null。 */
export function clipSegment(a: Vec2, b: Vec2, poly: Polygon, eps = EPS): [Vec2, Vec2] | null {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < poly.length; i++) {
    const edge = lineThrough(poly[i], poly[(i + 1) % poly.length]);
    if (!edge) continue;
    const da = signedDist(edge, a);
    const db = signedDist(edge, b);
    if (da < -eps && db < -eps) return null;
    if (da >= -eps && db >= -eps) continue;
    const t = da / (da - db);
    if (da < -eps) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  const p = lerp(a, b, t0);
  const q = lerp(a, b, t1);
  return dist(p, q) > eps ? [p, q] : null;
}

/** 線段是否穿過凸多邊形的內部（只是貼著邊走不算）。 */
export function segmentCrossesInterior(a: Vec2, b: Vec2, poly: Polygon, eps = EPS): boolean {
  const clipped = clipSegment(a, b, poly, eps);
  return clipped !== null && strictlyInside(lerp(clipped[0], clipped[1], 0.5), poly, eps);
}

export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function bbox(poly: Polygon): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export const bboxesOverlap = (a: BBox, b: BBox, eps = EPS): boolean =>
  a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minY < b.maxY - eps && b.minY < a.maxY - eps;
