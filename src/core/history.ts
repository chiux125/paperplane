import type { Line } from './geom/line';
import type { Vec2 } from './geom/vec';
import type { PaperState } from './model/types';
import { flipOutcome } from './planners/flip';
import { type FoldOutcome, simpleFoldOutcome } from './planners/simpleFold';
import { symmetricFoldOutcome } from './planners/symmetricFold';
import { type Result, ok } from './result';

/**
 * 使用者做的一步操作。只記錄「幾何意圖」（摺線、點了哪一側、選了哪個選項），
 * 不記錄面的 id，所以從白紙重播一定得到相同結果，也可以拿來產生步驟圖。
 * 之後的階段會在這裡加新的種類（內翻／外翻、壓摺…），不影響既有的。
 */
export type UserOp =
  | {
      readonly kind: 'fold';
      readonly line: Line;
      readonly pick: Vec2;
      readonly place: 'top' | 'bottom';
      /** 鏡像模式：另一邊自動對稱地摺。 */
      readonly mirror?: boolean;
    }
  | { readonly kind: 'flip' };

export function applyOpOutcome(state: PaperState, op: UserOp): Result<FoldOutcome> {
  switch (op.kind) {
    case 'fold':
      return op.mirror
        ? symmetricFoldOutcome(state, op.line, op.pick, op.place)
        : simpleFoldOutcome(state, op.line, op.pick, op.place);
    case 'flip':
      return ok(flipOutcome(state));
  }
}

export function applyOp(state: PaperState, op: UserOp): Result<PaperState> {
  const r = applyOpOutcome(state, op);
  return r.ok ? ok(r.value.state) : r;
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

/** 記錄一個已經算好的結果（UI 先算出來做預覽和動畫，確認後再存進來，不用重算）。 */
export function pushApplied(h: History, op: UserOp, next: PaperState): History {
  return {
    states: [...h.states.slice(0, h.cursor + 1), next],
    ops: [...h.ops.slice(0, h.cursor), op],
    cursor: h.cursor + 1,
  };
}

export function push(h: History, op: UserOp): Result<History> {
  const r = applyOp(current(h), op);
  return r.ok ? ok(pushApplied(h, op, r.value)) : r;
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
