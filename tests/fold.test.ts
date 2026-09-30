import { describe, expect, it } from 'vitest';
import {
  A4,
  apply,
  area,
  createSheet,
  faceList,
  flip,
  foldedPolygon,
  getOrder,
  hingeAngle,
  isConvex,
  isFaceUp,
  near,
  simpleFold,
  stackOrder,
  validate,
} from '../src/core';
import { expectValid, line, pt, unwrap } from './helpers';

const CENTER = line(0, 0, 0, 1); // 機身中線 x = 0

describe('白紙', () => {
  it('一面、正面朝上、合法', () => {
    const s = createSheet();
    expect(s.faces.size).toBe(1);
    expect(area(faceList(s)[0].cp)).toBeCloseTo(A4.width * A4.height);
    expect(isFaceUp(faceList(s)[0])).toBe(true);
    expectValid(s);
  });
});

describe('簡單摺', () => {
  it('對摺：兩面、一條谷摺鉸鏈、左半邊翻到右半邊上面', () => {
    const s = unwrap(simpleFold(createSheet(), CENTER, pt(-50, 100)));
    expect(s.faces.size).toBe(2);
    expect(s.hinges).toHaveLength(1);
    expect(hingeAngle(s, s.hinges[0])).toBe(180);
    expect(s.step).toBe(1);
    expect(s.hinges[0].step).toBe(1);

    const [a, b] = faceList(s);
    const moved = isFaceUp(a) ? b : a;
    const stayed = isFaceUp(a) ? a : b;
    expect(getOrder(s.orders, moved.id, stayed.id)).toBe(1);
    expect(moved.parent).toBe(0);
    // 翻過去後整面都在 x ≥ 0
    for (const p of foldedPolygon(moved)) expect(p.x).toBeGreaterThanOrEqual(-1e-9);
    expectValid(s);
  });

  it('place = bottom 是山摺', () => {
    const s = unwrap(simpleFold(createSheet(), CENTER, pt(-50, 100), 'bottom'));
    expect(hingeAngle(s, s.hinges[0])).toBe(-180);
    expectValid(s);
  });

  it('翻面後，鉸鏈的谷／山不變，上下關係反轉', () => {
    const s = unwrap(simpleFold(createSheet(), CENTER, pt(-50, 100)));
    const f = flip(s);
    expect(hingeAngle(f, f.hinges[0])).toBe(180);
    const [a, b] = faceList(s);
    expect(getOrder(f.orders, a.id, b.id)).toBe(-getOrder(s.orders, a.id, b.id));
    expectValid(f);
  });

  it('紙飛機（標準飛鏢）前三步', () => {
    const { width: w, height: h } = A4;
    let s = createSheet();
    // 左上角摺到中線
    s = unwrap(simpleFold(s, line(0, h, -1, h - 1), pt(-w / 2 + 1, h - 1)));
    const corner = faceList(s).find((f) => !isFaceUp(f))!;
    expect(foldedPolygon(corner).some((p) => near(p, pt(0, h - w / 2), 1e-6))).toBe(true);
    expectValid(s);
    // 右上角摺到中線
    s = unwrap(simpleFold(s, line(0, h, 1, h - 1), pt(w / 2 - 1, h - 1)));
    expectValid(s);
    // 對摺
    s = unwrap(simpleFold(s, CENTER, pt(-50, 50)));
    expectValid(s);
    expect(stackOrder(s)).not.toBeNull();
    for (const f of s.faces.values()) {
      expect(isConvex(f.cp)).toBe(true);
      for (const p of foldedPolygon(f)) expect(p.x).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('連續對摺三次：8 層疊在同一處', () => {
    let s = createSheet({ width: 200, height: 200 });
    s = unwrap(simpleFold(s, CENTER, pt(-10, 10)));
    s = unwrap(simpleFold(s, line(0, 100, 1, 100), pt(10, 150)));
    s = unwrap(simpleFold(s, line(50, 0, 50, 1), pt(90, 50)));
    expect(s.faces.size).toBe(8);
    expectValid(s);
    const order = stackOrder(s)!;
    expect(order).toHaveLength(8);
  });

  it('摺線在紙外面、或沿著紙邊：不能摺', () => {
    const s = createSheet();
    expect(simpleFold(s, line(-500, 0, -500, 1), pt(-600, 0))).toEqual({ ok: false, error: 'nothing-to-fold' });
    expect(simpleFold(s, line(-105, 0, -105, 1), pt(0, 100))).toEqual({ ok: false, error: 'nothing-to-fold' });
  });

  it('點在摺線上：分不出哪一邊', () => {
    expect(simpleFold(createSheet(), CENTER, pt(0, 50))).toEqual({ ok: false, error: 'pick-on-line' });
  });

  it('會切出極細碎片的摺線：不能摺', () => {
    // 只切掉左下角 0.01 mm 大小的三角形
    const r = simpleFold(createSheet(), line(-105, 0.01, -104.99, 0), pt(0, 100));
    expect(r).toEqual({ ok: false, error: 'too-thin' });
  });

  it('沿著既有摺痕再摺一次（摺回去）也合法', () => {
    let s = unwrap(simpleFold(createSheet(), CENTER, pt(-50, 100)));
    // 現在全部在右半邊；沿 x = 0 把整疊翻回左邊 → 會變成 nothing-to-fold（另一側沒紙）
    expect(simpleFold(s, CENTER, pt(50, 100)).ok).toBe(false);
    s = unwrap(simpleFold(s, line(50, 0, 50, 1), pt(80, 10)));
    expectValid(s);
  });

  it('鉸鏈兩端摺好後會落在同一點', () => {
    const s = unwrap(simpleFold(createSheet(), line(-105, 100, 105, 200), pt(0, 290)));
    for (const h of s.hinges) {
      const f = s.faces.get(h.faces[0])!;
      const g = s.faces.get(h.faces[1])!;
      expect(near(apply(f.xf, h.cpSeg[0]), apply(g.xf, h.cpSeg[0]), 1e-6)).toBe(true);
    }
    expect(validate(s)).toEqual([]);
  });
});
