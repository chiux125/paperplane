import { type Vec2, dist, dot, lerp, midpoint, sub } from '../geom/vec';
import { foldedPolygon } from '../model/face';
import type { PaperState } from '../model/types';

export type Seg = readonly [Vec2, Vec2];

export type SnapKind = 'vertex' | 'midpoint' | 'line' | 'none';

export interface Snap {
  readonly point: Vec2;
  readonly kind: SnapKind;
}

/** 可以吸附的東西：角（頂點）、邊的中點、邊與摺痕（線段）。 */
export interface SnapSources {
  readonly vertices: readonly Vec2[];
  readonly midpoints: readonly Vec2[];
  readonly segments: readonly Seg[];
}

export function pointSegDist(q: Vec2, a: Vec2, b: Vec2): number {
  return dist(q, closestOnSeg(q, a, b));
}

export function closestOnSeg(q: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2));
  return lerp(a, b, t);
}

const keyOf = (p: Vec2) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

/** 中線在紙張範圍內的那一段。 */
export const centerSegment = (s: PaperState): Seg => [
  { x: 0, y: 0 },
  { x: 0, y: s.sheet.height },
];

/** 從摺好後的紙收集可吸附的點與線（重疊的層只留一份）。 */
export function snapSources(state: PaperState): SnapSources {
  const vertices = new Map<string, Vec2>();
  const segments = new Map<string, Seg>();
  for (const f of state.faces.values()) {
    const poly = foldedPolygon(f);
    poly.forEach((p, i) => {
      vertices.set(keyOf(p), p);
      const q = poly[(i + 1) % poly.length];
      const [ka, kb] = [keyOf(p), keyOf(q)].sort();
      segments.set(`${ka}|${kb}`, [p, q]);
    });
  }
  const segs = [...segments.values(), centerSegment(state)];
  const midpoints = new Map<string, Vec2>();
  for (const [a, b] of segs) {
    const m = midpoint(a, b);
    if (!vertices.has(keyOf(m))) midpoints.set(keyOf(m), m);
  }
  return { vertices: [...vertices.values()], midpoints: [...midpoints.values()], segments: segs };
}

/** 吸附：半徑內優先吸到角，其次中點，再其次邊或摺痕上最近的點。 */
export function snapPoint(src: SnapSources, q: Vec2, radius: number): Snap {
  const nearest = (pts: readonly Vec2[], r: number) => {
    let best: Vec2 | null = null;
    let bd = r;
    for (const p of pts) {
      const d = dist(p, q);
      if (d <= bd) {
        best = p;
        bd = d;
      }
    }
    return best;
  };
  const v = nearest(src.vertices, radius);
  if (v) return { point: v, kind: 'vertex' };
  const m = nearest(src.midpoints, radius);
  if (m) return { point: m, kind: 'midpoint' };
  const s = nearestSegment(src.segments, q, radius * 0.6);
  if (s) return { point: closestOnSeg(q, s[0], s[1]), kind: 'line' };
  return { point: q, kind: 'none' };
}

export function nearestSegment(segs: readonly Seg[], q: Vec2, radius: number): Seg | null {
  let best: Seg | null = null;
  let bd = radius;
  for (const s of segs) {
    const d = pointSegDist(q, s[0], s[1]);
    if (d <= bd) {
      best = s;
      bd = d;
    }
  }
  return best;
}
