import type { Line } from './geom/line';
import type { Vec2 } from './geom/vec';
import type { PaperState } from './model/types';
import { flip } from './planners/flip';
import { simpleFold } from './planners/simpleFold';
import { type Result, ok } from './result';

/**
 * 使用者做的一步操作。只記錄「幾何意圖」（摺線、點了哪一側、選了哪個選項），
 * 不記錄面的 id，所以從白紙重播一定得到相同結果，也可以拿來產生步驟圖。
 * 之後的階段會在這裡加新的種類（鏡像、內翻／外翻、壓摺…），不影響既有的。
 */
export type UserOp =
  | { readonly kind: 'fold'; readonly line: Line; readonly pick: Vec2; readonly place: 'top' | 'bottom' }
  | { readonly kind: 'flip' };

export function applyOp(state: PaperState, op: UserOp): Result<PaperState> {
  switch (op.kind) {
    case 'fold':
      return simpleFold(state, op.line, op.pick, op.place);
    case 'flip':
      return ok(flip(state));
  }
}

/**
 * 歷史紀錄：states[0] 是白紙，states[i + 1] 是做完 ops[i] 之後的狀態，目前停在 states[cursor]。
 * 復原／重做只是移動 cursor；在中途做新的操作會丟掉後面的紀錄。
 */
export interface History {
  readonly states: readonly PaperState[];
  readonly ops: readonly UserOp[];
  readonly cursor: number;
}

export const createHistory = (initial: PaperState): History => ({ states: [initial], ops: [], cursor: 0 });

export const current = (h: History): PaperState => h.states[h.cursor];
export const canUndo = (h: History): boolean => h.cursor > 0;
export const canRedo = (h: History): boolean => h.cursor < h.states.length - 1;
export const undo = (h: History): History => (canUndo(h) ? { ...h, cursor: h.cursor - 1 } : h);
export const redo = (h: History): History => (canRedo(h) ? { ...h, cursor: h.cursor + 1 } : h);

/** 目前這一步之前做過的操作（給步驟圖、存檔用）。 */
export const doneOps = (h: History): readonly UserOp[] => h.ops.slice(0, h.cursor);

export function push(h: History, op: UserOp): Result<History> {
  const r = applyOp(current(h), op);
  if (!r.ok) return r;
  return ok({
    states: [...h.states.slice(0, h.cursor + 1), r.value],
    ops: [...h.ops.slice(0, h.cursor), op],
    cursor: h.cursor + 1,
  });
}

/** 從白紙依序重播所有操作。 */
export function replay(initial: PaperState, ops: readonly UserOp[]): Result<History> {
  let h = createHistory(initial);
  for (const op of ops) {
    const r = push(h, op);
    if (!r.ok) return r;
    h = r.value;
  }
  return ok(h);
}
