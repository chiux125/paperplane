import { reflection } from '../geom/iso';
import { moveFaces } from '../engine/move';
import type { PaperState } from '../model/types';
import type { FoldOutcome } from './simpleFold';
import { CENTER_LINE } from './symmetricFold';

/** 整張翻面（左右翻，以機身中線 x = 0 為軸），所有上下關係都會反過來。 */
export function flipOutcome(state: PaperState): FoldOutcome {
  const faces = [...state.faces.keys()];
  const moved = moveFaces(state, [{ faces, transform: reflection(CENTER_LINE), place: { kind: 'top' } }]);
  return { state: { ...moved, step: state.step + 1 }, movers: [{ faces, line: CENTER_LINE, place: 'top' }] };
}

export const flip = (state: PaperState): PaperState => flipOutcome(state).state;
