import type { Line } from '../geom/line';
import { splitFaces } from '../engine/split';
import type { PaperState } from '../model/types';
import { type Result, err, ok } from '../result';
import { isHalved, mirrorLine, sameLine } from './symmetricFold';

/**
 * 摺痕：沿一條線「摺一下再攤開」——只把被線穿過的面切開、留下摺痕與交點，
 * 但完全不移動（每一面的 xf 不變，紙維持攤平）。這些新的邊與頂點會成為
 * 「點對點／邊對邊」可以吸附的參考，方便做後續的摺法。
 *
 * 和一般摺法一樣遵守鏡像模式：線不對稱時，另一邊也留一條對稱的摺痕。
 */
export function crease(state: PaperState, line: Line): Result<PaperState> {
  const next = { ...state, step: state.step + 1 };
  const first = splitFaces(next, [...next.faces.keys()], line);
  if (!first.ok) return first;
  let s = first.value.state;

  // 鏡像：線本身不左右對稱、而且還沒對摺時，另一邊也留摺痕。
  if (!isHalved(state) && !sameLine(line, mirrorLine(line))) {
    const second = splitFaces(s, [...s.faces.keys()], mirrorLine(line));
    if (!second.ok) return second;
    s = second.value.state;
  }

  // 線根本沒摺到紙（沒有切出新的面）→ 不算一步。
  if (s.faces.size === state.faces.size) return err('nothing-to-fold');
  return ok(s);
}
