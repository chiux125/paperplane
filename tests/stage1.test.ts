import { describe, expect, it } from 'vitest';
import {
  A4,
  type PaperState,
  type UserOp,
  CENTER_LINE,
  centerSegment,
  createHistory,
  createSheet,
  current,
  doneOps,
  edgeToEdge,
  faceList,
  flip,
  foldedPolygon,
  isFaceUp,
  isHalved,
  near,
  paperMass,
  pointToPoint,
  push,
  replay,
  signedDist,
  simpleFold,
  snapPoint,
  snapSources,
  symmetricFoldOutcome,
} from '../src/core';
import { expectValid, line, pt, unwrap } from './helpers';

const { width: W, height: H } = A4;
const cornerLanded = (s: PaperState, target: ReturnType<typeof pt>) =>
  faceList(s).some((f) => !isFaceUp(f) && foldedPolygon(f).some((p) => near(p, target, 1e-6)));

describe('三種摺法的摺線', () => {
  it('點對點：左上角摺到中線上', () => {
    const spec = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
    // 中垂線剛好通過紙的上緣中點
    expect(Math.abs(signedDist(spec.line, pt(0, H)))).toBeLessThan(1e-9);
    const s = unwrap(simpleFold(createSheet(), spec.line, spec.pick));
    expect(cornerLanded(s, pt(0, H - W / 2))).toBe(true);
    expectValid(s);
    expect(pointToPoint(pt(1, 1), pt(1, 1))).toEqual({ ok: false, error: 'same-point' });
  });

  it('邊對邊：上緣左半邊摺到中線（標準飛鏢第一步）', () => {
    const spec = unwrap(edgeToEdge([pt(-W / 2, H), pt(0, H)], pt(-60, H), centerSegment(createSheet())));
    const s = unwrap(simpleFold(createSheet(), spec.line, spec.pick));
    expect(cornerLanded(s, pt(0, H - W / 2))).toBe(true);
    expectValid(s);
  });

  it('邊對邊：左邊緣對到中線（平行）→ 摺線在兩者正中間', () => {
    const spec = unwrap(edgeToEdge([pt(-W / 2, 0), pt(-W / 2, H)], pt(-W / 2, 100), centerSegment(createSheet())));
    expect(Math.abs(signedDist(spec.line, pt(-W / 4, 0)))).toBeLessThan(1e-9);
    expect(Math.abs(spec.line.d.x)).toBeLessThan(1e-12);
  });

  it('邊對邊：同一直線、或抓在交點上 → 不行', () => {
    const s = createSheet();
    expect(edgeToEdge([pt(-W / 2, 0), pt(-W / 2, 10)], pt(-W / 2, 5), [pt(-W / 2, 50), pt(-W / 2, 90)]).ok).toBe(false);
    const r = edgeToEdge([pt(-W / 2, H), pt(0, H)], pt(0, H), centerSegment(s));
    expect(r).toEqual({ ok: false, error: 'pick-on-line' });
  });
});

describe('鏡像模式', () => {
  const cornerOp = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));

  it('摺左上角，右上角自動跟著摺，而且只算一步', () => {
    const r = unwrap(symmetricFoldOutcome(createSheet(), cornerOp.line, cornerOp.pick));
    expect(r.movers).toHaveLength(2);
    expect(r.state.step).toBe(1);
    expect(r.state.hinges.every((h) => h.step === 1)).toBe(true);
    expect(cornerLanded(r.state, pt(0, H - W / 2))).toBe(true);
    expect(paperMass(r.state).cg.x).toBeCloseTo(0, 9);
    expectValid(r.state);
  });

  it('和分開摺兩次的結果一樣', () => {
    const mirrored = unwrap(symmetricFoldOutcome(createSheet(), cornerOp.line, cornerOp.pick)).state;
    let manual = unwrap(simpleFold(createSheet(), cornerOp.line, cornerOp.pick));
    manual = unwrap(simpleFold(manual, line(0, H, 1, H - 1), pt(W / 2 - 1, H - 1)));
    const a = paperMass(mirrored).cg;
    const b = paperMass(manual).cg;
    expect(near(a, b, 1e-9)).toBe(true);
    expect(mirrored.faces.size).toBe(manual.faces.size);
  });

  it('摺線本身左右對稱（橫線、中線）→ 只摺一次', () => {
    const across = unwrap(symmetricFoldOutcome(createSheet(), line(0, 250, 1, 250), pt(0, 290)));
    expect(across.movers).toHaveLength(1);
    expectValid(across.state);
    const center = unwrap(symmetricFoldOutcome(createSheet(), CENTER_LINE, pt(-10, 10)));
    expect(center.movers).toHaveLength(1);
    expect(isHalved(center.state)).toBe(true);
  });

  it('翻過去會跨過中線 → 不行', () => {
    const r = symmetricFoldOutcome(createSheet(), line(-30, 0, -30, 1), pt(-80, 100));
    expect(r).toEqual({ ok: false, error: 'crosses-center' });
  });

  it('對摺之後，整疊一起摺本來就對稱，只摺一次', () => {
    const halved = unwrap(simpleFold(createSheet(), CENTER_LINE, pt(-10, 10)));
    const r = unwrap(symmetricFoldOutcome(halved, line(30, 0, 30, 1), pt(80, 100)));
    expect(r.movers).toHaveLength(1);
    expectValid(r.state);
  });

  it('鏡像操作可以存進歷史並重播', () => {
    const op: UserOp = { kind: 'fold', line: cornerOp.line, pick: cornerOp.pick, place: 'top', mirror: true };
    const h = unwrap(push(createHistory(createSheet()), op));
    const again = unwrap(replay(createSheet(), doneOps(h)));
    expect(current(again).orders).toEqual(current(h).orders);
  });
});

describe('重心', () => {
  it('白紙：中心、A4 80 磅約 5 公克', () => {
    const m = paperMass(createSheet());
    expect(near(m.cg, pt(0, H / 2), 1e-9)).toBe(true);
    expect(m.mass).toBeCloseTo(4.99, 2);
  });

  it('兩個上角往下摺：重心往後移（手算驗證）', () => {
    const spec = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
    const r = unwrap(symmetricFoldOutcome(createSheet(), spec.line, spec.pick));
    // 每個角是直角邊 105 的三角形，形心 y 從 262 移到 227
    const tri = (105 * 105) / 2;
    const expected = H / 2 - (2 * tri * 35) / (W * H);
    expect(paperMass(r.state).cg.y).toBeCloseTo(expected, 9);
    expect(paperMass(r.state).mass).toBeCloseTo(paperMass(createSheet()).mass, 12);
  });

  it('翻面不改變重心的前後位置', () => {
    const s = unwrap(simpleFold(createSheet(), line(-105, 200, 105, 260), pt(0, 290)));
    expect(paperMass(flip(s)).cg.y).toBeCloseTo(paperMass(s).cg.y, 9);
  });
});

describe('吸附', () => {
  const src = snapSources(createSheet());
  it('角 > 中點 > 邊', () => {
    expect(snapPoint(src, pt(-103, 295), 5)).toEqual({ point: pt(-W / 2, H), kind: 'vertex' });
    expect(snapPoint(src, pt(1, 296), 5)).toEqual({ point: pt(0, H), kind: 'midpoint' });
    const onEdge = snapPoint(src, pt(-104, 100), 5);
    expect(onEdge.kind).toBe('line');
    expect(near(onEdge.point, pt(-W / 2, 100))).toBe(true);
    expect(snapPoint(src, pt(-50, 100), 5).kind).toBe('none');
  });

  it('中線的中點也能吸', () => {
    expect(snapPoint(src, pt(2, H / 2 + 1), 5)).toEqual({ point: pt(0, H / 2), kind: 'midpoint' });
  });
});
