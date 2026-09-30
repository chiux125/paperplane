import { AREA_EPS, EPS, MATCH_EPS, MIN_PIECE_AREA } from '../geom/eps';
import { apply } from '../geom/iso';
import { type Line, lineThrough, signedDist } from '../geom/line';
import {
  area,
  bbox,
  bboxesOverlap,
  centroid,
  clipSegment,
  convexIntersection,
  isConvex,
  overlapArea,
  segmentCrossesInterior,
  strictlyInside,
} from '../geom/polygon';
import { type Vec2, dist, dot, lerp, sub } from '../geom/vec';
import { hingeAngle } from '../engine/angle';
import { faceList, facesOverlap, foldedBBox, foldedPolygon } from '../model/face';
import { getOrder, isBetween, parseKey } from '../model/orders';
import type { Face, FaceId, Hinge, PaperState } from '../model/types';

export type IssueKind =
  | 'non-convex' // 面不是凸多邊形
  | 'too-small' // 碎片太小
  | 'coverage' // 各面在原紙上沒有剛好拼回整張紙
  | 'bad-hinge' // 鉸鏈資料不對（面不存在、摺痕不在兩面的邊上）
  | 'torn' // 撕裂：鉸鏈兩邊的面摺好後沒有接在一起
  | 'missing-order' // 重疊的兩面沒有上下關係
  | 'stale-order' // 沒重疊的兩面卻有上下關係
  | 'cycle' // 三面在同一處重疊卻互相壓成循環
  | 'taco-tortilla' // 一整片紙被夾進摺子裡（穿紙）
  | 'taco-taco' // 同一條線上的兩個摺子互相交錯（穿紙）
  | 'tortilla-tortilla'; // 攤平的摺痕兩側層序不一致（穿紙）

export interface Issue {
  readonly kind: IssueKind;
  readonly faces: readonly FaceId[];
}

interface FoldedHinge {
  readonly hinge: Hinge;
  readonly f: Face;
  readonly g: Face;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly line: Line;
  readonly angle: 0 | 180 | -180;
}

/**
 * 檢查整個狀態是否是一張「真的摺得出來」的紙。回傳空陣列表示合法。
 * 穿紙的檢查使用摺紙數學中標準的局部條件（taco-taco、taco-tortilla、tortilla-tortilla、遞移性）。
 */
export function validate(state: PaperState): Issue[] {
  const issues: Issue[] = [];
  const faces = faceList(state);

  // 1. 每一面都是夠大的凸多邊形，而且在原紙上剛好拼回整張紙
  let total = 0;
  for (const f of faces) {
    if (!isConvex(f.cp)) issues.push({ kind: 'non-convex', faces: [f.id] });
    const a = area(f.cp);
    if (a < MIN_PIECE_AREA) issues.push({ kind: 'too-small', faces: [f.id] });
    total += a;
  }
  const sheetArea = state.sheet.width * state.sheet.height;
  if (Math.abs(total - sheetArea) > 1e-6 * sheetArea) issues.push({ kind: 'coverage', faces: [] });
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const [f, g] = [faces[i], faces[j]];
      if (bboxesOverlap(bbox(f.cp), bbox(g.cp)) && overlapArea(f.cp, g.cp) > AREA_EPS) {
        issues.push({ kind: 'coverage', faces: [f.id, g.id] });
      }
    }
  }

  // 2. 鉸鏈：資料正確，而且沒有撕裂
  const folded: FoldedHinge[] = [];
  for (const h of state.hinges) {
    const f = state.faces.get(h.faces[0]);
    const g = state.faces.get(h.faces[1]);
    if (!f || !g || !onBoundary(h, f) || !onBoundary(h, g)) {
      issues.push({ kind: 'bad-hinge', faces: [...h.faces] });
      continue;
    }
    const angle = hingeAngle(state, h);
    if (angle === null) {
      issues.push({ kind: 'torn', faces: [f.id, g.id] });
      continue;
    }
    const a = apply(f.xf, h.cpSeg[0]);
    const b = apply(f.xf, h.cpSeg[1]);
    folded.push({ hinge: h, f, g, a, b, line: lineThrough(a, b)!, angle });
  }

  // 3. 層序：重疊的每一對都要有上下關係，沒重疊的不該有
  const overlapping = new Map<FaceId, Set<FaceId>>(faces.map((f) => [f.id, new Set()]));
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const [f, g] = [faces[i], faces[j]];
      if (!facesOverlap(f, g)) continue;
      overlapping.get(f.id)!.add(g.id);
      overlapping.get(g.id)!.add(f.id);
      if (getOrder(state.orders, f.id, g.id) === 0) issues.push({ kind: 'missing-order', faces: [f.id, g.id] });
    }
  }
  for (const key of state.orders.keys()) {
    const [lo, hi] = parseKey(key);
    if (!overlapping.get(lo)?.has(hi)) issues.push({ kind: 'stale-order', faces: [lo, hi] });
  }

  // 4. 遞移性：三面有共同重疊區時不能循環。
  //    共同區域裡的面兩兩都有關係，所以有循環就一定有三角循環，只查三面組即可。
  for (const f of faces) {
    const nf = [...overlapping.get(f.id)!].filter((id) => id > f.id);
    for (const gid of nf) {
      for (const kid of overlapping.get(gid)!) {
        if (kid <= gid || !overlapping.get(f.id)!.has(kid)) continue;
        const o1 = getOrder(state.orders, f.id, gid);
        const o2 = getOrder(state.orders, gid, kid);
        const o3 = getOrder(state.orders, kid, f.id);
        if (o1 === 0 || o1 !== o2 || o2 !== o3) continue;
        const g = state.faces.get(gid)!;
        const k = state.faces.get(kid)!;
        const common = convexIntersection(convexIntersection(foldedPolygon(f), foldedPolygon(g)), foldedPolygon(k));
        if (area(common) > AREA_EPS) issues.push({ kind: 'cycle', faces: [f.id, gid, kid] });
      }
    }
  }

  // 5. 穿紙
  const tacos = folded.filter((h) => h.angle !== 0);

  // 5a. taco-tortilla：一片紙橫跨摺痕，就不能夾在這個摺子的兩層之間
  for (const t of tacos) {
    const segBox = bbox([t.a, t.b]);
    for (const x of faces) {
      if (x.id === t.f.id || x.id === t.g.id) continue;
      if (!bboxesOverlap(segBox, foldedBBox(x), -EPS)) continue;
      if (!segmentCrossesInterior(t.a, t.b, foldedPolygon(x))) continue;
      if (isBetween(state.orders, x.id, t.f.id, t.g.id)) {
        issues.push({ kind: 'taco-tortilla', faces: [t.f.id, t.g.id, x.id] });
      }
    }
  }

  for (let i = 0; i < folded.length; i++) {
    for (let j = i + 1; j < folded.length; j++) {
      const h1 = folded[i];
      const h2 = folded[j];
      if (!collinearOverlap(h1, h2)) continue;
      const ids = new Set([h1.f.id, h1.g.id, h2.f.id, h2.g.id]);
      if (ids.size < 4) continue;
      const side1 = sideOf(h1.line, h1.f);

      if (h1.angle !== 0 && h2.angle !== 0) {
        // 5b. taco-taco：同一側的兩個摺子要嘛一個包住另一個，要嘛完全分開，不能交錯
        if (side1 !== sideOf(h1.line, h2.f)) continue;
        const c = isBetween(state.orders, h2.f.id, h1.f.id, h1.g.id);
        const d = isBetween(state.orders, h2.g.id, h1.f.id, h1.g.id);
        if (c !== d) issues.push({ kind: 'taco-taco', faces: [...ids] });
      } else if (h1.angle === 0 && h2.angle === 0) {
        // 5c. tortilla-tortilla：兩條攤平的摺痕重疊時，兩側的上下關係要一致
        const [t1, t2] = sideOf(h1.line, h1.f) === 1 ? [h1.f, h1.g] : [h1.g, h1.f];
        const [u1, u2] = sideOf(h1.line, h2.f) === 1 ? [h2.f, h2.g] : [h2.g, h2.f];
        const o1 = getOrder(state.orders, t1.id, u1.id);
        const o2 = getOrder(state.orders, t2.id, u2.id);
        if (o1 !== 0 && o2 !== 0 && o1 !== o2) issues.push({ kind: 'tortilla-tortilla', faces: [...ids] });
      } else {
        // 5d. taco-tortilla（攤平的摺痕版）：同一側的那片不能夾在摺子裡
        const [taco, flat] = h1.angle !== 0 ? [h1, h2] : [h2, h1];
        const tacoSide = sideOf(h1.line, taco.f);
        const same = sideOf(h1.line, flat.f) === tacoSide ? flat.f : flat.g;
        if (isBetween(state.orders, same.id, taco.f.id, taco.g.id)) {
          issues.push({ kind: 'taco-tortilla', faces: [taco.f.id, taco.g.id, same.id] });
        }
      }
    }
  }

  return dedupeIssues(issues);
}

export const isValid = (state: PaperState): boolean => validate(state).length === 0;

/** 摺痕在原紙上是否剛好落在這一面的邊上。 */
function onBoundary(h: Hinge, f: Face): boolean {
  const [a, b] = h.cpSeg;
  const len = dist(a, b);
  if (len <= EPS) return false;
  const clipped = clipSegment(a, b, f.cp);
  if (!clipped || Math.abs(dist(clipped[0], clipped[1]) - len) > MATCH_EPS) return false;
  return !strictlyInside(lerp(a, b, 0.5), f.cp);
}

function sideOf(line: Line, f: Face): 1 | -1 {
  return signedDist(line, centroid(foldedPolygon(f))) > 0 ? 1 : -1;
}

/** 兩條摺好後的摺痕是否在同一直線上且有一段重疊。 */
function collinearOverlap(h1: FoldedHinge, h2: FoldedHinge): boolean {
  if (Math.abs(signedDist(h1.line, h2.a)) > MATCH_EPS || Math.abs(signedDist(h1.line, h2.b)) > MATCH_EPS) {
    return false;
  }
  const t = (p: Vec2) => dot(sub(p, h1.line.p), h1.line.d);
  const [s0, s1] = [t(h1.a), t(h1.b)].sort((x, y) => x - y);
  const [u0, u1] = [t(h2.a), t(h2.b)].sort((x, y) => x - y);
  return Math.min(s1, u1) - Math.max(s0, u0) > MATCH_EPS;
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.kind}|${[...i.faces].sort((a, b) => a - b).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
