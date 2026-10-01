import { EPS, MATCH_EPS } from '../geom/eps';
import { apply, compose, reflection } from '../geom/iso';
import { type Line, lineThrough, signedDist } from '../geom/line';
import type { Vec2 } from '../geom/vec';
import { type MoveGroup, type Placement, moveFaces } from '../engine/move';
import { splitFaces } from '../engine/split';
import { facesOverlap, foldedPolygon, getFace } from '../model/face';
import { getOrder, stackOrder } from '../model/orders';
import type { Face, FaceId, PaperState } from '../model/types';
import { type Result, err, ok } from '../result';
import { isValid } from '../validate/validate';
import type { FoldOutcome, Mover } from './simpleFold';
import { isHalved, mirrorLine, mirrorPoint, sameLine } from './symmetricFold';

/**
 * 階段 4：反摺（內翻／外翻）。
 *
 * 關鍵（已由 tests/layers.test.ts 驗證）：內翻、外翻、整疊簡單摺的「幾何完全相同」——
 * 翼片都是對同一條摺線鏡射；差別只在「層序」（翼片塞進哪幾層之間）。所以這裡沿一條線
 * 把翼片切下來，套用同一個鏡射，再用不同的「分組＋放置位置」產生幾種候選，最後用
 * validate 篩掉會穿紙的，剩下的就是合法選項，交給 UI 預覽讓孩子挑。
 *
 * 介面上不講術語；這裡的 style 只是內部名稱：
 *   over       蓋在上面（整疊簡單摺、谷摺）
 *   under      收到下面（整疊簡單摺、山摺）
 *   inside     塞進裡面（內翻：翼片塞進最上層底下的口袋）
 *   outside    包在外面（外翻：翼片包住整疊的外面）
 *   top-over   只摺最上面那片，翻上來蓋在上面
 *   top-under  只摺最上面那片，收到底下
 *
 * 「只摺最上面那片」：從點選處最上層的那一面出發，只帶走「連在一起（不然會撕裂）」
 * 與「疊在它上面」的面，底下的紙不動（見 topLayerSet）。
 */
export type ReverseStyle = 'over' | 'under' | 'inside' | 'outside' | 'top-over' | 'top-under';

export const REVERSE_STYLES: readonly ReverseStyle[] = [
  'over',
  'under',
  'inside',
  'outside',
  'top-over',
  'top-under',
];

export interface ReverseOption {
  readonly style: ReverseStyle;
  readonly outcome: FoldOutcome;
}

interface Prep {
  readonly state: PaperState; // 已沿線切開、尚未移動
  readonly flap: FaceId[]; // 翼片（由下到上）
  readonly bodyTop: FaceId | null; // 翼片落點上方最頂的機身面
  readonly topLayer: FaceId[] | null; // 「只摺最上面那片」要動的面（由下到上）；null = 無此選項
  readonly topCover: FaceId | null; // topLayer 收到下面時，上方最頂的那一面
  readonly line: Line;
}

/** 點 p 是否落在這一面裡（含邊界；面是逆時針凸多邊形）。 */
function faceContains(f: Face, p: Vec2): boolean {
  const poly = foldedPolygon(f);
  for (let i = 0; i < poly.length; i++) {
    const e = lineThrough(poly[i], poly[(i + 1) % poly.length]);
    if (e && signedDist(e, p) < -MATCH_EPS) return false;
  }
  return true;
}

/** 這條鉸鏈（摺痕／切口）是不是正好落在摺線上。 */
function hingeOnLine(state: PaperState, h: PaperState['hinges'][number], line: Line): boolean {
  const f = getFace(state, h.faces[0]);
  const a = apply(f.xf, h.cpSeg[0]);
  const b = apply(f.xf, h.cpSeg[1]);
  return Math.abs(signedDist(line, a)) <= MATCH_EPS && Math.abs(signedDist(line, b)) <= MATCH_EPS;
}

/**
 * 「只摺最上面那片」要動的面集合 M：
 * - 起點：點選處、層序最上面、而且在點選那一側（翼片）的那一面。
 * - 重複擴張到不再變動：
 *   (1) 和 M 以「不在摺線上」的鉸鏈相連的面 → 加入（連在一起的紙要一起動，否則撕裂）。
 *   (2) 在點選那一側、疊在 M 中某一面上面且有重疊的面 → 加入（上面的紙被一起帶起來）。
 * - 若擴張會拉進「不是翼片（底下的紙）」的面 → 無法乾淨地只摺最上層，回傳 null。
 * - 若 M 剛好等於整個翼片 → 和整疊摺相同，回傳 null。
 */
function topLayerSet(state: PaperState, flapSet: Set<FaceId>, order: FaceId[], pick: Vec2, line: Line): FaceId[] | null {
  const containing = order.filter((id) => flapSet.has(id) && faceContains(getFace(state, id), pick));
  if (containing.length === 0) return null;
  const M = new Set<FaceId>([containing[containing.length - 1]]); // 最上面那一片

  let changed = true;
  while (changed) {
    changed = false;
    for (const h of state.hinges) {
      const [a, b] = h.faces;
      if (M.has(a) === M.has(b)) continue;
      const other = M.has(a) ? b : a;
      if (hingeOnLine(state, h, line)) continue;
      M.add(other);
      changed = true;
    }
    for (const id of flapSet) {
      if (M.has(id)) continue;
      for (const m of M) {
        if (getOrder(state.orders, id, m) === 1 && facesOverlap(getFace(state, id), getFace(state, m))) {
          M.add(id);
          changed = true;
          break;
        }
      }
    }
  }

  for (const id of M) if (!flapSet.has(id)) return null; // 拉到底下的紙 → 不提供此選項
  if (M.size === flapSet.size) return null; // 等於整疊 → 不重複
  return order.filter((id) => M.has(id));
}

function prep(state: PaperState, line: Line, pick: Vec2): Result<Prep> {
  const side = signedDist(line, pick);
  if (Math.abs(side) <= EPS) return err('pick-on-line');
  const next = { ...state, step: state.step + 1 };
  const sp = splitFaces(next, [...next.faces.keys()], line);
  if (!sp.ok) return sp;
  const st = sp.value.state;
  const flapIds = side > 0 ? sp.value.left : sp.value.right;
  const bodyIds = side > 0 ? sp.value.right : sp.value.left;
  if (flapIds.length === 0 || bodyIds.length === 0) return err('nothing-to-fold');

  const order = stackOrder(st);
  if (!order) return err('nothing-to-fold');
  const flapSet = new Set(flapIds);
  const flap = order.filter((id) => flapSet.has(id));

  // 翼片鏡射後會蓋到哪些機身面：取其中最頂的那一面，當作內翻要塞進去的「口袋口」。
  const T = reflection(line);
  const reflected = flapIds.map((id) => {
    const f = getFace(st, id);
    return { ...f, xf: compose(T, f.xf) };
  });
  const bodySet = new Set(bodyIds);
  const overlap = order.filter(
    (id) => bodySet.has(id) && reflected.some((rf) => facesOverlap(rf, getFace(st, id))),
  );
  const bodyTop = overlap.length ? overlap[overlap.length - 1] : null;

  // 「只摺最上面那片」：算出要動的面集合 M，以及收到下面時的覆蓋面。
  const topLayer = topLayerSet(st, flapSet, order, pick, line);
  let topCover: FaceId | null = null;
  if (topLayer) {
    const mSet = new Set(topLayer);
    const reflM = topLayer.map((id) => {
      const f = getFace(st, id);
      return { ...f, xf: compose(T, f.xf) };
    });
    const cover = order.filter((id) => !mSet.has(id) && reflM.some((rf) => facesOverlap(rf, getFace(st, id))));
    topCover = cover.length ? cover[cover.length - 1] : null;
  }

  return ok({ state: st, flap, bodyTop, topLayer, topCover, line });
}

function groupsFor(p: Prep, style: ReverseStyle): MoveGroup[] | null {
  const transform = reflection(p.line);
  const between = (under: FaceId[]): Placement => ({ kind: 'between', under });
  const top: Placement = { kind: 'top' };
  const bottom: Placement = { kind: 'bottom' };
  switch (style) {
    case 'over':
      return [{ faces: p.flap, transform, place: top }];
    case 'under':
      return [{ faces: p.flap, transform, place: bottom }];
    case 'inside':
      if (p.bodyTop === null) return null;
      return p.flap.map((f) => ({ faces: [f], transform, place: between([p.bodyTop!]) }));
    case 'outside':
      if (p.bodyTop === null || p.flap.length < 2) return null;
      return [
        { faces: [p.flap[0]], transform, place: bottom },
        ...p.flap.slice(1, -1).map((f) => ({ faces: [f], transform, place: between([p.bodyTop!]) })),
        { faces: [p.flap[p.flap.length - 1]], transform, place: top },
      ];
    case 'top-over':
      if (!p.topLayer) return null;
      return [{ faces: p.topLayer, transform, place: top }];
    case 'top-under':
      if (!p.topLayer || p.topCover === null) return null;
      return [{ faces: p.topLayer, transform, place: between([p.topCover]) }];
  }
}

function outcomeOf(p: Prep, style: ReverseStyle): FoldOutcome | null {
  const groups = groupsFor(p, style);
  if (!groups) return null;
  const state = moveFaces(p.state, groups);
  if (!isValid(state)) return null;
  const movingFaces = style === 'top-over' || style === 'top-under' ? p.topLayer! : p.flap;
  const place = style === 'under' || style === 'top-under' ? 'bottom' : 'top';
  const movers: Mover[] = [{ faces: movingFaces, line: p.line, place }];
  return { state, movers };
}

const ordersSig = (s: PaperState): string =>
  [...s.orders.entries()].map(([k, v]) => `${k}=${v}`).sort().join(';');

/** 單邊反摺（不鏡像）。 */
function reverseOne(state: PaperState, line: Line, pick: Vec2, style: ReverseStyle): Result<FoldOutcome> {
  const p = prep(state, line, pick);
  if (!p.ok) return p;
  const outcome = outcomeOf(p.value, style);
  return outcome ? ok(outcome) : err('reverse-pierces');
}

/**
 * 鏡像感知的反摺：和一般摺法一致。
 * - 已經對摺、或摺線本身左右對稱 → 只反摺一邊。
 * - 其他情況 → 這邊反摺，另一邊也對稱地反摺，合起來算同一步；最後整體再驗證一次。
 */
function reverseSym(state: PaperState, line: Line, pick: Vec2, style: ReverseStyle): Result<FoldOutcome> {
  const first = reverseOne(state, line, pick, style);
  if (!first.ok) return first;
  if (isHalved(state) || sameLine(line, mirrorLine(line))) return first;
  const mid = { ...first.value.state, step: state.step };
  const second = reverseOne(mid, mirrorLine(line), mirrorPoint(pick), style);
  if (!second.ok) return second;
  if (!isValid(second.value.state)) return err('reverse-pierces');
  return ok({ state: second.value.state, movers: [...first.value.movers, ...second.value.movers] });
}

/** 列出這條線在 pick 那一側所有「合法」的反摺選項（鏡像感知；去除結果相同的重複）。 */
export function reverseFoldOptions(state: PaperState, line: Line, pick: Vec2): ReverseOption[] {
  const out: ReverseOption[] = [];
  const seen = new Set<string>();
  for (const style of REVERSE_STYLES) {
    const r = reverseSym(state, line, pick, style);
    if (!r.ok) continue;
    const sig = ordersSig(r.value.state);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ style, outcome: r.value });
  }
  return out;
}

/** 直接做某一種反摺（給歷史重播用；同樣鏡像感知）。 */
export function reverseFold(state: PaperState, line: Line, pick: Vec2, style: ReverseStyle): Result<FoldOutcome> {
  return reverseSym(state, line, pick, style);
}
