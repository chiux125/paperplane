import { describe, expect, it } from 'vitest';
import {
  type PaperState,
  type UserOp,
  area,
  canRedo,
  canUndo,
  createHistory,
  createSheet,
  current,
  doneOps,
  foldedBBox,
  foldedPolygon,
  isConvex,
  push,
  redo,
  replay,
  stackOrder,
  undo,
  validate,
} from '../src/core';
import { line, pt, rng, unwrap } from './helpers';

const half: UserOp = { kind: 'fold', line: line(0, 0, 0, 1), pick: pt(-50, 100), place: 'top' };
const quarter: UserOp = { kind: 'fold', line: line(0, 150, 1, 150), pick: pt(50, 250), place: 'top' };

describe('歷史紀錄', () => {
  it('復原、重做、在中途做新操作會丟掉後面的紀錄', () => {
    let h = createHistory(createSheet());
    expect(canUndo(h)).toBe(false);
    h = unwrap(push(h, half));
    h = unwrap(push(h, quarter));
    expect(current(h).faces.size).toBe(4);

    h = undo(h);
    expect(current(h).faces.size).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(current(h).faces.size).toBe(4);

    h = undo(undo(h));
    expect(current(h).faces.size).toBe(1);
    h = unwrap(push(h, { kind: 'flip' }));
    expect(canRedo(h)).toBe(false);
    expect(h.ops).toEqual([{ kind: 'flip' }]);
  });

  it('失敗的操作不會改變歷史', () => {
    const h = createHistory(createSheet());
    const r = push(h, { kind: 'fold', line: line(500, 0, 500, 1), pick: pt(600, 0), place: 'top' });
    expect(r.ok).toBe(false);
  });

  it('重播得到完全相同的結果', () => {
    let h = createHistory(createSheet());
    for (const op of [half, quarter, { kind: 'flip' } as UserOp]) h = unwrap(push(h, op));
    const again = unwrap(replay(createSheet(), doneOps(h)));
    const a = current(h);
    const b = current(again);
    expect([...b.faces.keys()]).toEqual([...a.faces.keys()]);
    expect(b.orders).toEqual(a.orders);
    expect(b.hinges).toEqual(a.hinges);
  });
});

/** 隨機亂摺：模擬孩子隨便亂畫摺線，檢查不變式永遠成立。 */
describe('隨機亂摺（不變式）', () => {
  function randomOp(s: PaperState, r: () => number): UserOp {
    if (r() < 0.1) return { kind: 'flip' };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of s.faces.values()) {
      const b = foldedBBox(f);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const rp = () => pt(minX + r() * (maxX - minX), minY + r() * (maxY - minY));
    // 偶爾讓摺線剛好通過某個頂點，測試邊界情況
    const faces = [...s.faces.values()];
    const vertex = () => {
      const poly = foldedPolygon(faces[Math.floor(r() * faces.length)]);
      return poly[Math.floor(r() * poly.length)];
    };
    const a = r() < 0.3 ? vertex() : rp();
    let b = r() < 0.3 ? vertex() : rp();
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) b = pt(a.x + 10, a.y + 7);
    return { kind: 'fold', line: line(a.x, a.y, b.x, b.y), pick: rp(), place: r() < 0.5 ? 'top' : 'bottom' };
  }

  it('200 組隨機摺法：一律合法、面都是凸的、面積守恆', () => {
    const r = rng(20260930);
    let folds = 0;
    for (let n = 0; n < 200; n++) {
      let h = createHistory(createSheet());
      for (let k = 0; k < 6; k++) {
        const res = push(h, randomOp(current(h), r));
        if (!res.ok) continue; // 沒切到紙、太細等，本來就該被拒絕
        h = res.value;
        folds++;
        const s = current(h);
        const issues = validate(s);
        if (issues.length) throw new Error(`seq ${n} step ${k}: ${JSON.stringify(issues)}`);
        let total = 0;
        for (const f of s.faces.values()) {
          expect(isConvex(f.cp)).toBe(true);
          total += area(f.cp);
        }
        expect(total).toBeCloseTo(210 * 297, 3);
        expect(stackOrder(s)).not.toBeNull();
      }
    }
    expect(folds).toBeGreaterThan(600);
  });
});
