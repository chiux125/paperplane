import { area, centroid } from '../geom/polygon';
import { type Vec2, dist, vec } from '../geom/vec';
import { faceList } from '../model/face';
import type { FaceId, PaperState } from '../model/types';
import { bendableFaces } from './assembly';

/**
 * 孩子選的一片翹起翼片。
 * 用「翼片在原紙上的一點」記錄，而不是面的 id：存檔、讀檔或重播後 id 可能不同，但原紙上的位置不變。
 */
export interface FlapBend {
  /** 翼片在原紙（cp）座標中的一點（取翼片的形心）。 */
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
 * 左右對稱的那一面：原紙上以中線鏡射後形狀相同的面。找不到（不對稱）就回傳 null。
 * 對摺後左右兩片翼片在 3D 裡各在一邊，要一起翹才會和重心、升力的計算（本來就左右對稱）一致。
 */
export function mirrorFace(state: PaperState, id: FaceId): FaceId | null {
  const f = state.faces.get(id);
  if (!f) return null;
  const c = centroid(f.cp);
  const target = vec(-c.x, c.y);
  const a = area(f.cp);
  for (const g of faceList(state)) {
    if (dist(centroid(g.cp), target) < 0.05 && Math.abs(area(g.cp) - a) < 0.01 * a + 1e-6) return g.id;
  }
  return null;
}

/**
 * 把孩子選的翼片換成「要翹起哪些面、翹幾度（弧度）」：每一片連同它左右對稱的那一片一起翹。
 * 摺紙改變後已經找不到、或不再能翹（不是只靠一條摺痕連著）的翼片會被略過。
 */
export function resolveFlapBends(state: PaperState, flaps: readonly FlapBend[]): Map<FaceId, number> {
  const ok = new Set(bendableFaces(state));
  const out = new Map<FaceId, number>();
  for (const flap of flaps) {
    const id = faceAt(state, flap.at);
    if (id === null || !ok.has(id) || flap.deg === 0) continue;
    const rad = (flap.deg * Math.PI) / 180;
    out.set(id, rad);
    const m = mirrorFace(state, id);
    if (m !== null && ok.has(m)) out.set(m, rad);
  }
  return out;
}

/** 這一面屬於第幾片已選的翼片（含左右對稱的那一片）；不屬於任何一片回傳 -1。 */
export function flapIndexOf(state: PaperState, flaps: readonly FlapBend[], id: FaceId): number {
  const m = mirrorFace(state, id);
  return flaps.findIndex((flap) => {
    const fid = faceAt(state, flap.at);
    return fid === id || (m !== null && fid === m);
  });
}
