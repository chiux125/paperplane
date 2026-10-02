import { centroid } from '../geom/polygon';
import { type Vec2, vec } from '../geom/vec';
import { faceList } from '../model/face';
import type { FaceId, PaperState } from '../model/types';
import { type FlapGroup, flapGroups } from './assembly';

/**
 * 孩子選的一片翹起翼片。
 * 用「翼片在原紙上的一點」記錄，而不是面的 id：存檔、讀檔或重播後 id 可能不同，但原紙上的位置不變。
 */
export interface FlapBend {
  /** 翼片在原紙（cp）座標中的一點（取點選那一面的形心）。 */
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
 * 這一面所屬的翼片，加上左右對稱的那一片翼片的所有面。不是翼片的一部分就回傳空陣列。
 * 對稱的那片用「原紙上以中線鏡射的位置」去找；對摺後兩片翼片在 3D 裡各在一邊，
 * 要一起翹才會和重心、升力的計算（本來就左右對稱）一致。
 */
export function flapPartners(state: PaperState, id: FaceId, groups = flapGroups(state)): FaceId[] {
  const g = groups.get(id);
  if (!g) return [];
  const out = new Set<FaceId>(g.faces);
  const p = flapAnchor(state, id);
  const m = faceAt(state, vec(-p.x, p.y));
  const mg: FlapGroup | undefined = m === null ? undefined : groups.get(m);
  if (mg) for (const f of mg.faces) out.add(f);
  return [...out].sort((a, b) => a - b);
}

/**
 * 把孩子選的翼片換成「要翹起哪些面、翹幾度（弧度）」：每一片連同它左右對稱的那一片一起翹。
 * 摺紙改變後已經找不到、或不再能翹的翼片會被略過。
 */
export function resolveFlapBends(state: PaperState, flaps: readonly FlapBend[]): Map<FaceId, number> {
  const groups = flapGroups(state);
  const out = new Map<FaceId, number>();
  for (const flap of flaps) {
    const id = faceAt(state, flap.at);
    if (id === null || flap.deg === 0) continue;
    const rad = (flap.deg * Math.PI) / 180;
    for (const f of flapPartners(state, id, groups)) out.set(f, rad);
  }
  return out;
}

/** 這一面屬於第幾片已選的翼片（含左右對稱的那一片）；不屬於任何一片回傳 -1。 */
export function flapIndexOf(state: PaperState, flaps: readonly FlapBend[], id: FaceId): number {
  const groups = flapGroups(state);
  const mine = new Set(flapPartners(state, id, groups));
  if (mine.size === 0) return -1;
  return flaps.findIndex((flap) => {
    const fid = faceAt(state, flap.at);
    return fid !== null && mine.has(fid);
  });
}
