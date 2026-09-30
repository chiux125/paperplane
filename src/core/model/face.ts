import { AREA_EPS } from '../geom/eps';
import { apply, det } from '../geom/iso';
import { type BBox, type Polygon, bbox, bboxesOverlap, overlapArea } from '../geom/polygon';
import type { Face, FaceId, PaperState } from './types';

// Face 是不可變的，所以可以放心快取。
const foldedCache = new WeakMap<Face, Polygon>();
const bboxCache = new WeakMap<Face, BBox>();

/** 這一面摺好後的位置（逆時針排列）。 */
export function foldedPolygon(f: Face): Polygon {
  let poly = foldedCache.get(f);
  if (!poly) {
    const pts = f.cp.map((p) => apply(f.xf, p));
    poly = det(f.xf) < 0 ? pts.reverse() : pts;
    foldedCache.set(f, poly);
  }
  return poly;
}

export function foldedBBox(f: Face): BBox {
  let b = bboxCache.get(f);
  if (!b) {
    b = bbox(foldedPolygon(f));
    bboxCache.set(f, b);
  }
  return b;
}

/** 正面朝上？（正面 = 原本那張紙朝上的那一面） */
export const isFaceUp = (f: Face): boolean => det(f.xf) > 0;

/** 摺好後兩面是否有重疊（只是邊碰邊不算）。 */
export function facesOverlap(f: Face, g: Face): boolean {
  if (!bboxesOverlap(foldedBBox(f), foldedBBox(g))) return false;
  return overlapArea(foldedPolygon(f), foldedPolygon(g)) > AREA_EPS;
}

/** 依 id 排序的面清單（確保結果可重現）。 */
export const faceList = (s: PaperState): Face[] =>
  [...s.faces.values()].sort((a, b) => a.id - b.id);

export function getFace(s: PaperState, id: FaceId): Face {
  const f = s.faces.get(id);
  if (!f) throw new Error(`face ${id} not found`);
  return f;
}
