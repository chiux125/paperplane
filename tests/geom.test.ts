import { describe, expect, it } from 'vitest';
import {
  EPS,
  IDENTITY,
  apply,
  area,
  centroid,
  clipSegment,
  compose,
  convexIntersection,
  det,
  invert,
  isConvex,
  near,
  overlapArea,
  perpendicularBisector,
  reflectPoint,
  reflection,
  segmentCrossesInterior,
  signedDist,
  splitByDistances,
} from '../src/core';
import { line, pt } from './helpers';

const square = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];

describe('line', () => {
  it('左側為正、右側為負', () => {
    const l = line(0, 0, 1, 0);
    expect(signedDist(l, pt(3, 2))).toBeCloseTo(2);
    expect(signedDist(l, pt(3, -2))).toBeCloseTo(-2);
  });

  it('中垂線摺過去 A 會落在 B', () => {
    const a = pt(1, 7);
    const b = pt(-4, 2.5);
    const l = perpendicularBisector(a, b)!;
    expect(near(reflectPoint(l, a), b)).toBe(true);
    expect(perpendicularBisector(a, a)).toBeNull();
  });
});

describe('iso', () => {
  it('鏡射：線上的點不動、det = -1、做兩次回到原位', () => {
    const l = line(1, 2, 4, 3);
    const r = reflection(l);
    expect(det(r)).toBeCloseTo(-1);
    expect(near(apply(r, pt(1, 2)), pt(1, 2))).toBe(true);
    expect(near(apply(r, pt(7, 4)), pt(7, 4))).toBe(true);
    const p = pt(-3, 8);
    expect(near(apply(r, p), reflectPoint(l, p))).toBe(true);
    const rr = compose(r, r);
    expect(near(apply(rr, p), p)).toBe(true);
  });

  it('compose 先做右邊、invert 是反函數', () => {
    const m = compose(reflection(line(0, 0, 1, 1)), reflection(line(0, 5, 1, 5)));
    const p = pt(2, -1);
    const expected = reflectPoint(line(0, 0, 1, 1), reflectPoint(line(0, 5, 1, 5), p));
    expect(near(apply(m, p), expected)).toBe(true);
    expect(near(apply(invert(m), apply(m, p)), p)).toBe(true);
    expect(near(apply(IDENTITY, p), p)).toBe(true);
  });
});

describe('polygon', () => {
  it('面積、形心、凸性', () => {
    expect(area(square)).toBeCloseTo(100);
    expect(near(centroid(square), pt(5, 5))).toBe(true);
    expect(isConvex(square)).toBe(true);
    expect(isConvex([...square].reverse())).toBe(false); // 順時針
    expect(isConvex([pt(0, 0), pt(10, 0), pt(5, 2), pt(10, 10), pt(0, 10)])).toBe(false);
    // 共線點可以接受
    expect(isConvex([pt(0, 0), pt(5, 0), pt(10, 0), pt(10, 10), pt(0, 10)])).toBe(true);
  });

  const split = (poly: typeof square, l: ReturnType<typeof line>) =>
    splitByDistances(poly, poly.map((p) => signedDist(l, p)));

  it('一般切割：兩塊都是凸的、面積相加不變', () => {
    const s = split(square, line(0, 3, 10, 8));
    expect(s.left && s.right).toBeTruthy();
    expect(isConvex(s.left!)).toBe(true);
    expect(isConvex(s.right!)).toBe(true);
    expect(area(s.left!) + area(s.right!)).toBeCloseTo(100);
    expect(s.cut).toHaveLength(2);
  });

  it('沿對角線（穿過兩個頂點）切割', () => {
    const s = split(square, line(0, 0, 10, 10));
    expect(s.left).toHaveLength(3);
    expect(s.right).toHaveLength(3);
    expect(area(s.left!)).toBeCloseTo(50);
    expect(s.cut).toHaveLength(2);
  });

  it('線剛好貼著邊或在外面：不切', () => {
    const edge = split(square, line(0, 0, 10, 0)); // 整塊在左側
    expect(edge.right).toBeNull();
    expect(edge.left).toHaveLength(4);
    const outside = split(square, line(0, 20, 10, 20));
    expect(outside.left).toBeNull();
  });

  it('距離頂點小於 EPS 的線視為通過頂點（不產生極小的碎片）', () => {
    const tiny = EPS / 10;
    const s = split(square, line(0, tiny, 10, 10));
    expect(s.left).toHaveLength(3);
    expect(s.right).toHaveLength(3);
  });

  it('凸多邊形交集', () => {
    const b = square.map((p) => pt(p.x + 5, p.y + 5));
    expect(overlapArea(square, b)).toBeCloseTo(25);
    const touching = square.map((p) => pt(p.x + 10, p.y));
    expect(overlapArea(square, touching)).toBeCloseTo(0);
    expect(convexIntersection(square, square.map((p) => pt(p.x + 20, p.y)))).toEqual([]);
  });

  it('線段裁切與穿過內部', () => {
    const c = clipSegment(pt(-5, 5), pt(15, 5), square)!;
    expect(near(c[0], pt(0, 5))).toBe(true);
    expect(near(c[1], pt(10, 5))).toBe(true);
    expect(segmentCrossesInterior(pt(-5, 5), pt(15, 5), square)).toBe(true);
    // 貼著邊走不算穿過
    expect(segmentCrossesInterior(pt(0, -5), pt(0, 15), square)).toBe(false);
    expect(clipSegment(pt(-5, -1), pt(15, -1), square)).toBeNull();
  });
});
