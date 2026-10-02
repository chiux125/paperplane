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
  crease,
  faceList,
  flapAnchor,
  flapGroups,
  flapIndexOf,
  flapPartners,
  pointToPoint,
  resolveFlapBends,
  reverseFold,
  simpleFold,
  symmetricFoldOutcome,
} from '../src/core';
import { line, pt, unwrap } from './helpers';

const { width: W, height: H } = A4;
const wingLine: Line = { p: { x: 35, y: 0 }, d: { x: 0, y: 1 } };

/** 孩子的原型機（還沒對摺）：兩上角摺到中線，翼片尖角「只摺最上面那片」反摺上來。 */
function kidPlaneOpen(): PaperState {
  const corner = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
  const s = unwrap(symmetricFoldOutcome(createSheet(), corner.line, corner.pick)).state;
  const tip = unwrap(pointToPoint(pt(0, H - W / 2), pt(35, 255)));
  return unwrap(reverseFold(s, tip.line, tip.pick, 'top-over')).state;
}
const kidPlane = (): PaperState => unwrap(simpleFold(kidPlaneOpen(), CENTER_LINE, pt(-1, H / 2)));

/** 原紙上的左右哪一邊。 */
const sideOf = (s: PaperState, id: number) => Math.sign(centroid(s.faces.get(id)!.cp).x);

describe('翼片（可以翹起的那些紙片）', () => {
  it('反摺上來的兩個尖角都是翼片，即使其中一個被鏡像摺多切了一刀（攤平的摺痕不算斷開）', () => {
    const s = kidPlane();
    const groups = [...new Set(flapGroups(s).values())];
    const tips = groups.filter((g) => g.faces.length >= 1);
    // 左右各一片尖角
    const left = tips.filter((g) => g.faces.every((id) => sideOf(s, id) < 0));
    const right = tips.filter((g) => g.faces.every((id) => sideOf(s, id) > 0));
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(right.length).toBe(left.length);
  });

  it('翼片的轉軸是它和其他紙相連的那條摺線，整片繞同一條線轉', () => {
    const s = kidPlane();
    for (const g of new Set(flapGroups(s).values())) {
      expect(Math.hypot(g.axis[1].x - g.axis[0].x, g.axis[1].y - g.axis[0].y)).toBeGreaterThan(1);
    }
  });

  it('在翼片上「留摺痕」之後，它還是一整片翼片', () => {
    const s0 = kidPlaneOpen();
    const before = bendableFaces(s0).length;
    expect(before).toBeGreaterThan(0);
    // 橫著壓一條摺痕，切過翼片尖角
    const s1 = unwrap(crease(s0, line(-100, 262, 100, 262)));
    const g1 = new Set(flapGroups(s1).values());
    const g0 = new Set(flapGroups(s0).values());
    expect(g1.size).toBe(g0.size);
  });

  it('太大塊的（例如對摺後的整個半邊）不算翼片', () => {
    const s = unwrap(simpleFold(createSheet(), CENTER_LINE, pt(-1, H / 2)));
    expect(bendableFaces(s)).toEqual([]);
  });
});

describe('點選翼片', () => {
  const s = kidPlane();
  const flapIds = bendableFaces(s);

  it('選一片：連同左右對稱的那片一起翹，角度換成弧度', () => {
    const id = flapIds[0];
    const partners = flapPartners(s, id);
    expect(partners.some((f) => sideOf(s, f) > 0)).toBe(true);
    expect(partners.some((f) => sideOf(s, f) < 0)).toBe(true);
    const bends = resolveFlapBends(s, [{ at: flapAnchor(s, id), deg: 30 }]);
    expect([...bends.keys()]).toEqual(partners);
    for (const rad of bends.values()) expect(rad).toBeCloseTo(Math.PI / 6, 12);
    expect(buildAssembly(s, wingLine, 0, bends).pieces.some((p) => p.bent)).toBe(true);
  });

  it('點左邊或右邊那片，都算是同一組', () => {
    const id = flapIds[0];
    const flaps = [{ at: flapAnchor(s, id), deg: 30 }];
    for (const f of flapPartners(s, id)) expect(flapIndexOf(s, flaps, f)).toBe(0);
    const other = faceList(s).find((f) => !flapPartners(s, id).includes(f.id))!;
    expect(flapIndexOf(s, flaps, other.id)).toBe(-1);
  });

  it('角度 0、或那個位置的紙翹不起來：略過', () => {
    const id = flapIds[0];
    expect(resolveFlapBends(s, [{ at: flapAnchor(s, id), deg: 0 }]).size).toBe(0);
    const stuck = faceList(s).find((f) => !flapIds.includes(f.id))!;
    expect(resolveFlapBends(s, [{ at: flapAnchor(s, stuck.id), deg: 30 }]).size).toBe(0);
  });

  it('翹起的翼片整片一起轉（同一片的每一塊都往同一邊翹）', () => {
    const id = flapIds[0];
    const bends = resolveFlapBends(s, [{ at: flapAnchor(s, id), deg: 40 }]);
    const flat = buildAssembly(s, wingLine, 0);
    const bent = buildAssembly(s, wingLine, 0, bends);
    // 翹起的紙片在機翼上（上反角 0，機翼是水平的）都往上（+z）離開原本的位置
    bent.pieces.forEach((p, i) => {
      if (!p.bent || p.region !== 'wing') return;
      expect(p.centroid.z).toBeGreaterThan(flat.pieces[i].centroid.z);
    });
  });

  it('用原紙上的位置記錄，重新摺一次也找得到同一片', () => {
    const id = flapIds[0];
    const at = flapAnchor(s, id);
    expect(resolveFlapBends(kidPlane(), [{ at, deg: 45 }]).size).toBe(flapPartners(s, id).length);
  });
});
