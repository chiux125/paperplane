import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type UserOp,
  createSheet,
  readPaperplane,
  simpleFold,
  toFold,
  foldToJson,
} from '../src/core';
import { pt, unwrap } from './helpers';

describe('FOLD 匯出', () => {
  const folded = () => unwrap(simpleFold(createSheet(), CENTER_LINE, pt(-10, 150)));

  it('白紙：一個面、四個頂點、四條邊都是邊界、沒有層序', () => {
    const f = toFold(createSheet());
    expect(f.faces_vertices).toHaveLength(1);
    expect(f.vertices_coords).toHaveLength(4);
    expect(f.edges_assignment.every((a) => a === 'B')).toBe(true);
    expect(f.faceOrders).toHaveLength(0);
    expect(f.file_classes).toContain('singleModel');
  });

  it('對摺後：有一條摺痕（山/谷）、其餘是邊界、有一筆層序', () => {
    const f = toFold(folded());
    expect(f.faces_vertices.length).toBe(2);
    const creases = f.edges_assignment.filter((a) => a === 'M' || a === 'V');
    expect(creases.length).toBe(1); // 中線那條摺痕
    expect(f.edges_assignment.filter((a) => a === 'B').length).toBeGreaterThan(0);
    expect(f.faceOrders.length).toBe(1); // 兩面重疊 → 一筆層序
    // 每個頂點座標都在原紙範圍內
    for (const [x, y] of f.vertices_coords) {
      expect(Math.abs(x)).toBeLessThanOrEqual(A4.width / 2 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(A4.height + 1e-6);
    }
  });

  it('夾帶 paperplane: 步驟與設計，能原封不動讀回來', () => {
    const ops: UserOp[] = [{ kind: 'fold', line: CENTER_LINE, pick: pt(-10, 150), place: 'top', mirror: true }];
    const design = { wingFrac: 0.4, tiltDeg: 3, dihedralDeg: 10, clips: [] };
    const json = foldToJson(toFold(folded(), { ops, design }));
    const back = readPaperplane(json);
    expect(back).not.toBeNull();
    expect(back!.ops).toEqual(ops);
    expect(back!.design).toEqual(design);
    expect(back!.sheet).toEqual(A4);
  });

  it('不是本工具存的 FOLD（沒有 paperplane:ops）→ 讀回 null', () => {
    const plainFold = JSON.stringify({ file_spec: 1.1, vertices_coords: [], edges_vertices: [] });
    expect(readPaperplane(plainFold)).toBeNull();
    expect(readPaperplane('not json')).toBeNull();
  });
});
