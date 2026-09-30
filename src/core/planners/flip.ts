import { reflection } from '../geom/iso';
import { vec } from '../geom/vec';
import { moveFaces } from '../engine/move';
import type { PaperState } from '../model/types';

/** 整張翻面（左右翻，以機身中線 x = 0 為軸），所有上下關係都會反過來。 */
export function flip(state: PaperState): PaperState {
  const axis = { p: vec(0, 0), d: vec(0, 1) };
  const moved = moveFaces(state, [{ faces: [...state.faces.keys()], transform: reflection(axis), place: { kind: 'top' } }]);
  return { ...moved, step: state.step + 1 };
}
