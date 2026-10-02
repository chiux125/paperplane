import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type Line,
  type PaperState,
  bendableFaces,
  buildAssembly,
  centroid,
  createSheet,
  faceList,
  flapAnchor,
  flapIndexOf,
  mirrorFace,
  pointToPoint,
  resolveFlapBends,
  reverseFold,
  simpleFold,
  symmetricFoldOutcome,
} from '../src/core';
import { pt, unwrap } from './helpers';

const { width: W, height: H } = A4;
const wingLine: Line = { p: { x: 35, y: 0 }, d: { x: 0, y: 1 } };

/** 孩子的原型機：兩上角摺到中線，翼片尖角「只摺最上面那片」反摺上來，再對摺。 */
function kidPlane(): PaperState {
  const corner = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
  let s = unwrap(symmetricFoldOutcome(createSheet(), corner.line, corner.pick)).state;
  const tip = unwrap(pointToPoint(pt(0, H - W / 2), pt(35, 255)));
  s = unwrap(reverseFold(s, tip.line, tip.pick, 'top-over')).state;
  return unwrap(simpleFold(s, CENTER_LINE, pt(-1, H / 2)));
}

describe('點選翼片', () => {
  const s = kidPlane();
  const flapsAvail = bendableFaces(s);

  it('反摺上來的翼片尖角可以翹', () => {
    expect(flapsAvail.length).toBeGreaterThanOrEqual(2);
  });

  it('每一面都找得到左右對稱的那一面，而且互相對應', () => {
    for (const f of faceList(s)) {
      const m = mirrorFace(s, f.id);
      expect(m).not.toBeNull();
      expect(mirrorFace(s, m!)).toBe(f.id);
      const a = centroid(f.cp);
      const b = centroid(s.faces.get(m!)!.cp);
      expect(b.x).toBeCloseTo(-a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    }
  });

  it('選一片：連同對稱的那片一起翹，角度換成弧度', () => {
    const id = flapsAvail[0];
    const bends = resolveFlapBends(s, [{ at: flapAnchor(s, id), deg: 30 }]);
    expect(bends.size).toBe(2);
    expect(bends.get(id)).toBeCloseTo(Math.PI / 6, 12);
    expect(bends.get(mirrorFace(s, id)!)).toBeCloseTo(Math.PI / 6, 12);
    expect(buildAssembly(s, wingLine, 0, bends).pieces.some((p) => p.bent)).toBe(true);
  });

  it('點左邊或右邊那片，都算是同一組', () => {
    const id = flapsAvail[0];
    const flaps = [{ at: flapAnchor(s, id), deg: 30 }];
    expect(flapIndexOf(s, flaps, id)).toBe(0);
    expect(flapIndexOf(s, flaps, mirrorFace(s, id)!)).toBe(0);
    const other = faceList(s).find((f) => f.id !== id && f.id !== mirrorFace(s, id))!;
    expect(flapIndexOf(s, flaps, other.id)).toBe(-1);
  });

  it('角度 0、或那個位置的紙翹不起來：略過', () => {
    const id = flapsAvail[0];
    expect(resolveFlapBends(s, [{ at: flapAnchor(s, id), deg: 0 }]).size).toBe(0);
    const stuck = faceList(s).find((f) => !flapsAvail.includes(f.id))!;
    expect(resolveFlapBends(s, [{ at: flapAnchor(s, stuck.id), deg: 30 }]).size).toBe(0);
  });

  it('用原紙上的位置記錄，重新摺一次（面的編號可能不同）也找得到同一片', () => {
    const id = flapsAvail[0];
    const at = flapAnchor(s, id);
    const again = kidPlane();
    const bends = resolveFlapBends(again, [{ at, deg: 45 }]);
    expect(bends.size).toBe(2);
  });
});
