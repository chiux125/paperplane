import { type Iso2, compose, det } from '../geom/iso';
import { facesOverlap, getFace } from '../model/face';
import { parseKey, setOrder } from '../model/orders';
import type { FaceId, PaperState } from '../model/types';

/**
 * 移動的面落地後，和「沒有動的面」之間的層序：
 * - top：蓋在最上面（簡單摺）
 * - bottom：塞到最下面（翻面後的簡單摺、外翻摺外側的那一半）
 * - between：夾在中間——在 under 列出的面之下、其他重疊的面之上（內翻摺）
 */
export type Placement =
  | { readonly kind: 'top' }
  | { readonly kind: 'bottom' }
  | { readonly kind: 'between'; readonly under: readonly FaceId[] };

/** 一組一起移動的面（像一疊紙被一起翻過去）。 */
export interface MoveGroup {
  readonly faces: readonly FaceId[];
  /** 在摺好後的座標中套用的變換，攤平摺法一律是對摺線鏡射。 */
  readonly transform: Iso2;
  readonly place: Placement;
}

/**
 * 移動若干組面，並更新層序。所有摺法（簡單摺、內翻、外翻、壓摺）都走這裡，差別只在分組與 placement：
 * - 同一組內：若是鏡射（整疊翻過去），彼此的上下關係會整個反過來。
 * - 不同組之間：groups 陣列中排在後面的組在上面。
 * - 組與不動的面之間：依 placement。
 * 鉸鏈不在這裡檢查；是否撕裂、穿紙由 validate() 判斷。
 */
export function moveFaces(state: PaperState, groups: readonly MoveGroup[]): PaperState {
  const groupOf = new Map<FaceId, number>();
  groups.forEach((g, i) => {
    for (const id of g.faces) {
      getFace(state, id);
      if (groupOf.has(id)) throw new Error(`face ${id} is in more than one group`);
      groupOf.set(id, i);
    }
  });

  const faces = new Map(state.faces);
  for (const [id, gi] of groupOf) {
    const f = getFace(state, id);
    faces.set(id, { ...f, xf: compose(groups[gi].transform, f.xf) });
  }

  const orders = new Map<string, 1 | -1>();
  for (const [key, v] of state.orders) {
    const [lo, hi] = parseKey(key);
    const gl = groupOf.get(lo);
    const gh = groupOf.get(hi);
    if (gl === undefined && gh === undefined) orders.set(key, v);
    else if (gl !== undefined && gl === gh) orders.set(key, det(groups[gl].transform) < 0 ? (v === 1 ? -1 : 1) : v);
  }

  const underSets = groups.map((g) => new Set(g.place.kind === 'between' ? g.place.under : []));
  const all = [...faces.values()];
  for (const [id, gi] of groupOf) {
    const m = faces.get(id)!;
    const place = groups[gi].place;
    for (const o of all) {
      const go = groupOf.get(o.id);
      if (go === gi) continue;
      // 兩面都在移動時只處理一次
      if (go !== undefined && o.id < id) continue;
      if (!facesOverlap(m, o)) continue;
      let mAbove: boolean;
      if (go !== undefined) mAbove = gi > go;
      else if (place.kind === 'top') mAbove = true;
      else if (place.kind === 'bottom') mAbove = false;
      else mAbove = !underSets[gi].has(o.id);
      setOrder(orders, id, o.id, mAbove);
    }
  }

  return { ...state, faces, orders };
}
