import { EPS } from '../geom/eps';
import { type Line, intersectLines, lineThrough, perpendicularBisector, projectPoint, reflectPoint, signedDist } from '../geom/line';
import { type Vec2, add, cross, midpoint, normalize, sub } from '../geom/vec';
import { type Result, err, ok } from '../result';
import { type Seg, pointSegDist } from './snap';

/** 一個摺法 = 一條摺線 + 要翻過去那一側的一個點。 */
export interface FoldSpec {
  readonly line: Line;
  readonly pick: Vec2;
}

/** 自由畫線：摺線就是畫的那條線，pick 是孩子點的那一側。 */
export function freeLineFold(a: Vec2, b: Vec2, pick: Vec2): Result<FoldSpec> {
  const line = lineThrough(a, b);
  if (!line) return err('same-point');
  return ok({ line, pick });
}

/** 點對點：A 摺到 B。摺線是 AB 的中垂線，A 那一側翻過去。 */
export function pointToPoint(a: Vec2, b: Vec2): Result<FoldSpec> {
  const line = perpendicularBisector(a, b);
  if (!line) return err('same-point');
  return ok({ line, pick: a });
}

/**
 * 邊對邊：抓住 from 這條邊上的 grab 點，把這條邊摺到 to 這條邊（或中線）所在的直線上。
 * - 兩邊平行：摺線是兩線正中間的平行線。
 * - 兩邊相交：摺線是兩條角平分線之一，挑「抓的那一點翻過去後最靠近 to」的那條。
 */
export function edgeToEdge(from: Seg, grab: Vec2, to: Seg): Result<FoldSpec> {
  const l1 = lineThrough(from[0], from[1]);
  const l2 = lineThrough(to[0], to[1]);
  if (!l1 || !l2) return err('same-line');
  const pick = projectPoint(l1, grab);

  let candidates: Line[];
  if (Math.abs(cross(l1.d, l2.d)) < 1e-9) {
    if (Math.abs(signedDist(l1, l2.p)) <= EPS) return err('same-line');
    candidates = [{ p: midpoint(l1.p, projectPoint(l2, l1.p)), d: l1.d }];
  } else {
    const x = intersectLines(l1, l2)!;
    candidates = [
      { p: x, d: normalize(add(l1.d, l2.d)) },
      { p: x, d: normalize(sub(l1.d, l2.d)) },
    ];
  }

  let best: Line | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (Math.abs(signedDist(c, pick)) <= EPS) continue;
    const d = pointSegDist(reflectPoint(c, pick), to[0], to[1]);
    if (d < bestDist - EPS) {
      best = c;
      bestDist = d;
    }
  }
  if (!best) return err('pick-on-line');
  return ok({ line: best, pick });
}
