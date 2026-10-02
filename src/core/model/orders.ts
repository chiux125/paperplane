import { faceList } from './face';
import type { FaceId, Orders, PaperState } from './types';

export const pairKey = (f: FaceId, g: FaceId): string => (f < g ? `${f}:${g}` : `${g}:${f}`);

export function parseKey(key: string): [FaceId, FaceId] {
  const i = key.indexOf(':');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/** f 在 g 上面回傳 1，在下面回傳 -1，沒有記錄回傳 0。 */
export function getOrder(orders: Orders, f: FaceId, g: FaceId): 1 | -1 | 0 {
  const v = orders.get(pairKey(f, g));
  if (v === undefined) return 0;
  return f < g ? v : v === 1 ? -1 : 1;
}

export function setOrder(orders: Map<string, 1 | -1>, f: FaceId, g: FaceId, fAbove: boolean): void {
  const v = fAbove === f < g ? 1 : -1;
  orders.set(pairKey(f, g), v);
}

/** t 是否夾在 f 和 g 之間。 */
export function isBetween(orders: Orders, t: FaceId, f: FaceId, g: FaceId): boolean {
  const a = getOrder(orders, f, t);
  return a !== 0 && a === getOrder(orders, t, g);
}

/**
 * 每一面在「局部」疊了幾層：壓在它下面、而且和它重疊的最長一串面有幾片。
 * 不重疊的面互不影響，所以旁邊的紙疊得再厚也不會把它墊高。
 * 保證：f 在 g 上面（且重疊）⇒ depth(f) > depth(g)。層序有循環時盡量給值，不保證。
 */
export function layerDepths(s: PaperState): Map<FaceId, number> {
  const order = stackOrder(s) ?? faceList(s).map((f) => f.id);
  const depth = new Map<FaceId, number>();
  for (const id of order) {
    let d = 0;
    for (const [g, dg] of depth) {
      if (getOrder(s.orders, id, g) === 1) d = Math.max(d, dg + 1);
    }
    depth.set(id, d);
  }
  return depth;
}

/**
 * 由下到上的繪製順序（拓撲排序，同層時 id 小的先）。
 * 有循環（例如某些內翻摺造成 A>B>C>A 分別在不同區域）時回傳 null，
 * 這時繪圖要改用「分割成小格子、每格各自排序」的方式。
 */
export function stackOrder(s: PaperState): FaceId[] | null {
  const ids = faceList(s).map((f) => f.id);
  const above = new Map<FaceId, FaceId[]>(ids.map((id) => [id, []]));
  const indeg = new Map<FaceId, number>(ids.map((id) => [id, 0]));
  for (const [key, v] of s.orders) {
    const [lo, hi] = parseKey(key);
    const [below, top] = v === 1 ? [hi, lo] : [lo, hi];
    above.get(below)?.push(top);
    indeg.set(top, (indeg.get(top) ?? 0) + 1);
  }
  const out: FaceId[] = [];
  const ready = ids.filter((id) => indeg.get(id) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const id = ready.shift()!;
    out.push(id);
    for (const t of above.get(id) ?? []) {
      const n = indeg.get(t)! - 1;
      indeg.set(t, n);
      if (n === 0) ready.push(t);
    }
  }
  return out.length === ids.length ? out : null;
}
