import { EPS } from '../geom/eps';
import { reflection } from '../geom/iso';
import { type Line, signedDist } from '../geom/line';
import type { Vec2 } from '../geom/vec';
import { moveFaces } from '../engine/move';
import { splitFaces } from '../engine/split';
import type { FaceId, PaperState } from '../model/types';
import { type Result, err, ok } from '../result';

/** 一組繞著 line 翻過去的面（動畫用：翻之前的位置 = 對 line 再鏡射一次）。 */
export interface Mover {
  readonly faces: readonly FaceId[];
  readonly line: Line;
  readonly place: 'top' | 'bottom';
}

/** 摺完的狀態，加上「哪些面繞哪條線翻過去」，給預覽與動畫使用。 */
export interface FoldOutcome {
  readonly state: PaperState;
  readonly movers: readonly Mover[];
}

/**
 * 簡單摺：沿 line 把 pick 那一側的「所有層」一起翻過去。
 * place = 'top' 時翻過去的部分蓋在上面（從上面看是谷摺）；'bottom' 則塞到下面（山摺）。
 * 整疊一起摺在數學上一定合法：每一面都被摺線切開，不會撕裂；翻過去的整疊只會在上面或下面，不會穿紙。
 */
export function simpleFoldOutcome(
  state: PaperState,
  line: Line,
  pick: Vec2,
  place: 'top' | 'bottom' = 'top',
): Result<FoldOutcome> {
  const side = signedDist(line, pick);
  if (Math.abs(side) <= EPS) return err('pick-on-line');

  const next = { ...state, step: state.step + 1 };
  const split = splitFaces(next, next.faces.keys(), line);
  if (!split.ok) return split;
  const { left, right } = split.value;
  const moving = side > 0 ? left : right;
  const staying = side > 0 ? right : left;
  if (moving.length === 0 || staying.length === 0) return err('nothing-to-fold');

  const moved = moveFaces(split.value.state, [{ faces: moving, transform: reflection(line), place: { kind: place } }]);
  return ok({ state: moved, movers: [{ faces: moving, line, place }] });
}

export function simpleFold(
  state: PaperState,
  line: Line,
  pick: Vec2,
  place: 'top' | 'bottom' = 'top',
): Result<PaperState> {
  const r = simpleFoldOutcome(state, line, pick, place);
  return r.ok ? ok(r.value.state) : r;
}
