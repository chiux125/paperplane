import { EPS, MATCH_EPS } from '../geom/eps';
import { apply, reflection } from '../geom/iso';
import { type Line, signedDist } from '../geom/line';
import { type Vec2, cross, vec } from '../geom/vec';
import { foldedPolygon } from '../model/face';
import type { PaperState } from '../model/types';
import { type Result, err, ok } from '../result';
import { type FoldOutcome, simpleFoldOutcome } from './simpleFold';

/** 機身中線 x = 0（方向朝機頭）。 */
export const CENTER_LINE: Line = { p: vec(0, 0), d: vec(0, 1) };

export const mirrorPoint = (p: Vec2): Vec2 => vec(-p.x, p.y);
export const mirrorLine = (l: Line): Line => ({ p: mirrorPoint(l.p), d: vec(-l.d.x, l.d.y) });

export function sameLine(a: Line, b: Line): boolean {
  return Math.abs(cross(a.d, b.d)) < 1e-9 && Math.abs(signedDist(a, b.p)) <= EPS;
}

/** 整疊紙都在中線的同一側（已經對摺過了）。 */
export function isHalved(state: PaperState): boolean {
  let left = false;
  let right = false;
  for (const f of state.faces.values()) {
    for (const p of foldedPolygon(f)) {
      if (p.x < -MATCH_EPS) left = true;
      if (p.x > MATCH_EPS) right = true;
    }
  }
  return !(left && right);
}

/**
 * 鏡像模式的摺法：摺一邊，另一邊自動對稱地摺。
 * - 摺線本身左右對稱（中線、或垂直於中線的線）→ 只摺一次就是對稱的。
 * - 已經對摺過 → 整疊一起摺本來就對稱，只摺一次。
 * - 其他情況 → 摺這邊，再摺鏡像的那邊。若翻過去的部分會跨過中線（左右會疊在一起），不允許。
 * 兩次摺合起來算同一步。
 */
export function symmetricFoldOutcome(
  state: PaperState,
  line: Line,
  pick: Vec2,
  place: 'top' | 'bottom' = 'top',
): Result<FoldOutcome> {
  const first = simpleFoldOutcome(state, line, pick, place);
  if (!first.ok) return first;
  if (isHalved(state) || sameLine(line, mirrorLine(line))) return first;
  if (!staysOnOneSide(first.value)) return err('crosses-center');

  const again = { ...first.value.state, step: state.step };
  const second = simpleFoldOutcome(again, mirrorLine(line), mirrorPoint(pick), place);
  if (!second.ok) return second;
  if (!staysOnOneSide(second.value)) return err('crosses-center');
  return ok({ state: second.value.state, movers: [...first.value.movers, ...second.value.movers] });
}

/** 翻過去的面，翻之前與翻之後都在中線的同一側。 */
function staysOnOneSide(outcome: FoldOutcome): boolean {
  let left = false;
  let right = false;
  for (const m of outcome.movers) {
    const back = reflection(m.line);
    for (const id of m.faces) {
      for (const p of foldedPolygon(outcome.state.faces.get(id)!)) {
        for (const q of [p, apply(back, p)]) {
          if (q.x < -MATCH_EPS) left = true;
          if (q.x > MATCH_EPS) right = true;
        }
      }
    }
  }
  return !(left && right);
}
