import { EPS } from '../geom/eps';
import { compose, reflection } from '../geom/iso';
import { type Line, signedDist } from '../geom/line';
import type { Vec2 } from '../geom/vec';
import { type MoveGroup, type Placement, moveFaces } from '../engine/move';
import { splitFaces } from '../engine/split';
import { facesOverlap, getFace } from '../model/face';
import { stackOrder } from '../model/orders';
import type { FaceId, PaperState } from '../model/types';
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
 *   over     蓋在上面（整疊簡單摺、谷摺）
 *   under    收到下面（整疊簡單摺、山摺）
 *   inside   塞進裡面（內翻：翼片塞進最上層底下的口袋）
 *   outside  包在外面（外翻：翼片包住整疊的外面）
 */
export type ReverseStyle = 'over' | 'under' | 'inside' | 'outside';

export const REVERSE_STYLES: readonly ReverseStyle[] = ['over', 'under', 'inside', 'outside'];

export interface ReverseOption {
  readonly style: ReverseStyle;
  readonly outcome: FoldOutcome;
}

interface Prep {
  readonly state: PaperState; // 已沿線切開、尚未移動
  readonly flap: FaceId[]; // 翼片（由下到上）
  readonly bodyTop: FaceId | null; // 翼片落點上方最頂的機身面
  readonly line: Line;
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

  return ok({ state: st, flap, bodyTop, line });
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
  }
}

function outcomeOf(p: Prep, style: ReverseStyle): FoldOutcome | null {
  const groups = groupsFor(p, style);
  if (!groups) return null;
  const state = moveFaces(p.state, groups);
  if (!isValid(state)) return null;
  const place = style === 'under' ? 'bottom' : 'top';
  const movers: Mover[] = [{ faces: p.flap, line: p.line, place }];
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
