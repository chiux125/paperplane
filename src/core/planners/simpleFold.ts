import { EPS } from '../geom/eps';
import { reflection } from '../geom/iso';
import { type Line, signedDist } from '../geom/line';
import type { Vec2 } from '../geom/vec';
import { moveFaces } from '../engine/move';
import { splitFaces } from '../engine/split';
import type { PaperState } from '../model/types';
import { type Result, err, ok } from '../result';

/**
 * 簡單摺：沿 line 把 pick 那一側的「所有層」一起翻過去。
 * place = 'top' 時翻過去的部分蓋在上面（從上面看是谷摺）；'bottom' 則塞到下面（山摺）。
 * 整疊一起摺在數學上一定合法：每一面都被摺線切開，不會撕裂；翻過去的整疊只會在上面或下面，不會穿紙。
 */
export function simpleFold(
  state: PaperState,
  line: Line,
  pick: Vec2,
  place: 'top' | 'bottom' = 'top',
): Result<PaperState> {
  const side = signedDist(line, pick);
  if (Math.abs(side) <= EPS) return err('pick-on-line');

  const next = { ...state, step: state.step + 1 };
  const split = splitFaces(next, next.faces.keys(), line);
  if (!split.ok) return split;
  const { left, right } = split.value;
  const moving = side > 0 ? left : right;
  const staying = side > 0 ? right : left;
  if (moving.length === 0 || staying.length === 0) return err('nothing-to-fold');

  return ok(moveFaces(split.value.state, [{ faces: moving, transform: reflection(line), place: { kind: place } }]));
}
