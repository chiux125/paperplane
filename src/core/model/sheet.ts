import { IDENTITY } from '../geom/iso';
import { vec } from '../geom/vec';
import type { Face, PaperState, Sheet } from './types';

/** A4（mm），台灣最常見的影印紙。 */
export const A4: Sheet = { width: 210, height: 297 };

/** 一張還沒摺過的白紙：只有一面，正面朝上。 */
export function createSheet(sheet: Sheet = A4): PaperState {
  const w = sheet.width / 2;
  const h = sheet.height;
  const face: Face = {
    id: 0,
    cp: [vec(-w, 0), vec(w, 0), vec(w, h), vec(-w, h)],
    xf: IDENTITY,
    parent: null,
  };
  return { sheet, faces: new Map([[0, face]]), hinges: [], orders: new Map(), nextId: 1, step: 0 };
}
