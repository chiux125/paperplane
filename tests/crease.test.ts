import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type UserOp,
  applyOp,
  createHistory,
  createSheet,
  crease,
  current,
  doneOps,
  faceList,
  isFaceUp,
  near,
  paperMass,
  pointToPoint,
  push,
  replay,
  snapPoint,
  snapSources,
} from '../src/core';
import { expectValid, line, pt, unwrap } from './helpers';

const { width: W, height: H } = A4;

describe('摺痕', () => {
  it('沿中線留摺痕：切成兩面、仍攤平、合法，不改變重心', () => {
    const sheet = createSheet();
    const s = unwrap(crease(sheet, CENTER_LINE));
    expect(s.faces.size).toBe(2);
    // 攤平：沒有任何一面被翻到背面
    expect(faceList(s).every(isFaceUp)).toBe(true);
    expectValid(s);
    expect(near(paperMass(s).cg, paperMass(sheet).cg, 1e-9)).toBe(true);
    expect(s.step).toBe(1);
  });

  it('產生新的交點：中線上的 (0,0)、(0,H) 變成可吸附的頂點', () => {
    const s = unwrap(crease(createSheet(), CENTER_LINE));
    const src = snapSources(s);
    expect(src.vertices.some((v) => near(v, pt(0, 0), 1e-9))).toBe(true);
    expect(src.vertices.some((v) => near(v, pt(0, H), 1e-9))).toBe(true);
    // 這些交點可以被「點對點」吸到
    expect(snapPoint(src, pt(2, 3), 5)).toEqual({ point: pt(0, 0), kind: 'vertex' });
  });

  it('鏡像：不對稱的斜線會在兩邊各留一條摺痕', () => {
    // 從左上角到中線上一點的斜線（不左右對稱）
    const diag = line(-W / 2, H, 0, H - W / 2);
    const s = unwrap(crease(createSheet(), diag));
    // 左右各切一刀 → 至少 3 面（白紙 1 面被兩條摺痕切開）
    expect(s.faces.size).toBeGreaterThanOrEqual(3);
    expect(faceList(s).every(isFaceUp)).toBe(true);
    expectValid(s);
    // 右邊對稱位置也有交點
    const src = snapSources(s);
    expect(src.vertices.some((v) => near(v, pt(W / 2, H - W / 2), 1e-6) || near(v, pt(0, H - W / 2), 1e-6))).toBe(true);
  });

  it('摺痕後可以用「點對點」吸附到新交點來摺', () => {
    const s = unwrap(crease(createSheet(), CENTER_LINE));
    const src = snapSources(s);
    const a = snapPoint(src, pt(-104, 296), 5).point; // 左上角
    const b = snapPoint(src, pt(1, 296), 5).point; // 中線頂點 (0,H)
    expect(near(b, pt(0, H), 1e-9)).toBe(true);
    const spec = unwrap(pointToPoint(a, b));
    expect(spec.line).toBeDefined();
  });

  it('沒摺到紙的線 → 不行', () => {
    expect(crease(createSheet(), line(-W, -50, W, -50))).toEqual({ ok: false, error: 'nothing-to-fold' });
  });

  it('可以存進歷史並重播', () => {
    const op: UserOp = { kind: 'crease', line: CENTER_LINE };
    const h = unwrap(push(createHistory(createSheet()), op));
    expect(current(h).faces.size).toBe(2);
    const again = unwrap(replay(createSheet(), doneOps(h)));
    expect(current(again).faces.size).toBe(current(h).faces.size);
    // applyOp 也一致
    expect(unwrap(applyOp(createSheet(), op)).faces.size).toBe(2);
  });
});
