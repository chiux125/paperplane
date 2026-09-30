import { MIN_PIECE_AREA } from '../geom/eps';
import { apply } from '../geom/iso';
import { type Line, signedDist } from '../geom/line';
import { area, clipSegment, splitByDistances } from '../geom/polygon';
import { facesOverlap, getFace } from '../model/face';
import { parseKey, setOrder } from '../model/orders';
import type { Face, FaceId, Hinge, PaperState } from '../model/types';
import { type Result, err, ok } from '../result';

export interface SplitResult {
  readonly state: PaperState;
  /** 在摺線左側的面（含切開後的新面）。只包含有被要求切割的那些面。 */
  readonly left: FaceId[];
  readonly right: FaceId[];
}

/**
 * 沿一條線（摺好後的座標）切開指定的面。不移動任何東西。
 * 被切開的面會換成兩個新 id 的子面，並在切口加一條鉸鏈；
 * 原本的鉸鏈與層序會依子面重新分配。
 */
export function splitFaces(state: PaperState, faceIds: Iterable<FaceId>, line: Line): Result<SplitResult> {
  const faces = new Map(state.faces);
  const children = new Map<FaceId, Face[]>();
  const left: FaceId[] = [];
  const right: FaceId[] = [];
  const cutHinges: Hinge[] = [];
  let nextId = state.nextId;

  for (const id of [...new Set(faceIds)].sort((a, b) => a - b)) {
    const f = getFace(state, id);
    // 用摺好後的位置判斷左右，但切割在原紙座標上進行
    const dists = f.cp.map((p) => signedDist(line, apply(f.xf, p)));
    const split = splitByDistances(f.cp, dists);
    if (split.left && split.right) {
      if (area(split.left) < MIN_PIECE_AREA || area(split.right) < MIN_PIECE_AREA) return err('too-thin');
      if (split.cut.length !== 2) throw new Error(`face ${id}: expected 2 cut points, got ${split.cut.length}`);
      const fl: Face = { id: nextId++, cp: split.left, xf: f.xf, parent: f.id };
      const fr: Face = { id: nextId++, cp: split.right, xf: f.xf, parent: f.id };
      faces.delete(id);
      faces.set(fl.id, fl);
      faces.set(fr.id, fr);
      children.set(id, [fl, fr]);
      left.push(fl.id);
      right.push(fr.id);
      cutHinges.push({ faces: [fl.id, fr.id], cpSeg: [split.cut[0], split.cut[1]], step: state.step });
    } else if (split.left) {
      left.push(id);
    } else {
      right.push(id);
    }
  }

  if (children.size === 0) return ok({ state, left, right });

  const pieces = (id: FaceId): Face[] => children.get(id) ?? [faces.get(id)!];

  const hinges: Hinge[] = [];
  for (const h of state.hinges) {
    const [a, b] = h.faces;
    if (!children.has(a) && !children.has(b)) {
      hinges.push(h);
      continue;
    }
    for (const fa of pieces(a)) {
      for (const fb of pieces(b)) {
        const inA = clipSegment(h.cpSeg[0], h.cpSeg[1], fa.cp);
        const seg = inA && clipSegment(inA[0], inA[1], fb.cp);
        if (seg) hinges.push({ faces: [fa.id, fb.id], cpSeg: seg, step: h.step });
      }
    }
  }
  hinges.push(...cutHinges);

  const orders = new Map(state.orders);
  for (const [key, v] of state.orders) {
    const [lo, hi] = parseKey(key);
    if (!children.has(lo) && !children.has(hi)) continue;
    orders.delete(key);
    for (const fa of pieces(lo)) {
      for (const fb of pieces(hi)) {
        if (facesOverlap(fa, fb)) setOrder(orders, fa.id, fb.id, v === 1);
      }
    }
  }

  return ok({ state: { ...state, faces, hinges, orders, nextId }, left, right });
}
