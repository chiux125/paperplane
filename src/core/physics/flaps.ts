import { centroid } from '../geom/polygon';
import { type Vec2, vec } from '../geom/vec';
import { faceList } from '../model/face';
import type { FaceId, PaperState } from '../model/types';
import { flapFor } from './assembly';

/**
 * 孩子選的一片翹起翼片。
 * 用「點的那一面在原紙上的一點」記錄，而不是面的 id：存檔、讀檔或重播後 id 可能不同，但原紙上的位置不變。
 * 要翹起哪些紙、繞哪條線，由 flapFor 從這一面自動找出來。
 */
export interface FlapBend {
  /** 點的那一面在原紙（cp）座標中的一點（取它的形心）。 */
  readonly at: Vec2;
  /** 翹起角度（度）。 */
  readonly deg: number;
}

/** 原紙上包含這一點的面（邊界上也算）。 */
function faceAt(state: PaperState, p: Vec2): FaceId | null {
  for (const f of faceList(state)) {
    const poly = f.cp;
    let inside = true;
    for (let i = 0; i < poly.length && inside; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -1e-6) inside = false;
    }
    if (inside) return f.id;
  }
  return null;
}

/** 這一面在原紙上的代表點（形心），存進 FlapBend.at 用。 */
export function flapAnchor(state: PaperState, id: FaceId): Vec2 {
  return centroid(state.faces.get(id)!.cp);
}

/**
 * 點了 id 這一面時要翹起的「根」：它自己，加上原紙上以中線鏡射的位置那一面（左右對稱的那一片）。
 * 對摺後兩片翼片在 3D 裡各在一邊，要一起翹才會和重心、升力的計算（本來就左右對稱）一致。
 * 這一面翹不起來就回傳空陣列。
 */
export function flapRoots(state: PaperState, id: FaceId): FaceId[] {
  if (!flapFor(state, id)) return [];
  const p = flapAnchor(state, id);
  const m = faceAt(state, vec(-p.x, p.y));
  return m !== null && m !== id && flapFor(state, m) ? [id, m] : [id];
}

/** 點了 id 這一面時，會跟著翹起來的所有紙（含左右對稱的那一片），給畫面發亮用。 */
export function flapPartners(state: PaperState, id: FaceId): FaceId[] {
  const out = new Set<FaceId>();
  for (const r of flapRoots(state, id)) for (const f of flapFor(state, r)!.faces) out.add(f);
  return [...out].sort((a, b) => a - b);
}

/** 已選的這片翼片會動到的所有紙（給畫面標示「已選」用）。 */
export function flapFacesOf(state: PaperState, flap: FlapBend): FaceId[] {
  const id = faceAt(state, flap.at);
  return id === null ? [] : flapPartners(state, id);
}

/**
 * 把孩子選的翼片換成 buildAssembly 要的「根 → 翹幾度（弧度）」：每一片連同左右對稱的那一片。
 * 摺紙改變後已經找不到、或不再能翹的翼片會被略過。
 */
export function resolveFlapBends(state: PaperState, flaps: readonly FlapBend[]): Map<FaceId, number> {
  const out = new Map<FaceId, number>();
  for (const flap of flaps) {
    const id = faceAt(state, flap.at);
    if (id === null || flap.deg === 0) continue;
    const rad = (flap.deg * Math.PI) / 180;
    for (const r of flapRoots(state, id)) out.set(r, rad);
  }
  return out;
}

/** 點了 id 這一面，對應到第幾片已選的翼片（點左邊或右邊那片都算同一片）；沒有回傳 -1。 */
export function flapIndexOf(state: PaperState, flaps: readonly FlapBend[], id: FaceId): number {
  const roots = new Set(flapRoots(state, id));
  if (roots.size === 0) return -1;
  return flaps.findIndex((flap) => {
    const fid = faceAt(state, flap.at);
    return fid !== null && roots.has(fid);
  });
}
