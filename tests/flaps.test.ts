import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type FaceId,
  type Line,
  type PaperState,
  type Vec2,
  area,
  bendableFaces,
  buildAssembly,
  centroid,
  createSheet,
  crease,
  faceList,
  flapAnchor,
  flapFor,
  flapIndexOf,
  flapPartners,
  flapRoots,
  pointToPoint,
  resolveFlapBends,
  reverseFold,
  simpleFold,
  symmetricFoldOutcome,
} from '../src/core';
import { line, pt, unwrap } from './helpers';

const { width: W, height: H } = A4;
const wingLine: Line = { p: { x: 35, y: 0 }, d: { x: 0, y: 1 } };
const deg = (d: number) => (d * Math.PI) / 180;

/** 孩子的原型機（還沒對摺）：兩上角摺到中線，翼片尖角「只摺最上面那片」反摺上來。 */
function kidPlaneOpen(): PaperState {
  const corner = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
  const s = unwrap(symmetricFoldOutcome(createSheet(), corner.line, corner.pick)).state;
  const tip = unwrap(pointToPoint(pt(0, H - W / 2), pt(35, 255)));
  return unwrap(reverseFold(s, tip.line, tip.pick, 'top-over')).state;
}
const kidPlane = (): PaperState => unwrap(simpleFold(kidPlaneOpen(), CENTER_LINE, pt(-1, H / 2)));

/** 原紙上形心最靠近 p 的那一面。 */
function faceNear(s: PaperState, p: Vec2): FaceId {
  let best = faceList(s)[0];
  for (const f of faceList(s)) {
    const d = (q: typeof f) => Math.hypot(centroid(q.cp).x - p.x, centroid(q.cp).y - p.y);
    if (d(f) < d(best)) best = f;
  }
  return best.id;
}
const cpX = (s: PaperState, id: FaceId) => centroid(s.faces.get(id)!.cp).x;

// 原紙上的位置：右上角翻下來的橘色翼片、以及它再反摺上來的尖角（紙的右上角）
const ORANGE = pt(75, 245);
const TIP = pt(95, 285);

describe('自動找轉軸', () => {
  const s = kidPlane();

  it('點橘色翼片：沿它和機身相連的對角線整片翹起，掛在上面的尖角一起被帶走', () => {
    const g = flapFor(s, faceNear(s, ORANGE))!;
    expect(g).not.toBeNull();
    const tip = flapFor(s, faceNear(s, TIP))!;
    for (const f of tip.faces) expect(g.faces).toContain(f);
    expect(g.area).toBeGreaterThan(tip.area);
    expect(g.area).toBeLessThan(0.2 * W * H);
    // 轉軸就是原紙上的對角線（右上角那條 45° 摺線）：翼片的每一面都在轉軸的同一側
    expect(g.faces.every((f) => cpX(s, f) > 0)).toBe(true);
  });

  it('點尖角：只翹尖角（即使它被鏡像摺多切了一刀，攤平的那條線不會被當成斷開）', () => {
    for (const p of [TIP, pt(-TIP.x, TIP.y)]) {
      const g = flapFor(s, faceNear(s, p))!;
      expect(g).not.toBeNull();
      expect(g.faces.every((f) => Math.abs(cpX(s, f)) > 80)).toBe(true);
    }
  });

  it('太大塊的（對摺後的整個半邊）翹不起來', () => {
    const big = faceList(s).reduce((a, b) => (area(a.cp) > area(b.cp) ? a : b));
    expect(flapFor(s, big.id)).toBeNull();
    expect(bendableFaces(unwrap(simpleFold(createSheet(), CENTER_LINE, pt(-1, H / 2))))).toEqual([]);
  });

  it('在翼片上「留摺痕」之後，點同一個位置還是翹得起來', () => {
    const s0 = kidPlaneOpen();
    const s1 = unwrap(crease(s0, line(-100, 255, 100, 255)));
    expect(flapFor(s1, faceNear(s1, ORANGE))).not.toBeNull();
  });
});

describe('翹起（3D）', () => {
  const s = kidPlane();
  const orange = faceNear(s, ORANGE);
  const tip = faceNear(s, TIP);

  it('翹起橘色翼片：尖角也跟著被標成翹起，左右對稱一起翹', () => {
    const bends = resolveFlapBends(s, [{ at: flapAnchor(s, orange), deg: 40 }]);
    expect([...bends.keys()].sort()).toEqual(flapRoots(s, orange).sort());
    expect(bends.size).toBe(2);
    const asm = buildAssembly(s, wingLine, 0, bends);
    for (const f of flapPartners(s, orange)) {
      expect(asm.pieces.filter((p) => p.faceId === f).every((p) => p.bent)).toBe(true);
    }
    expect(asm.pieces.filter((p) => !flapPartners(s, orange).includes(p.faceId)).some((p) => p.bent)).toBe(false);
  });

  it('兩片都翹（尖角掛在橘色翼片上）：尖角先自己翹，再跟著整片一起轉', () => {
    const one = buildAssembly(s, wingLine, 0, new Map([[orange, deg(40)]]));
    const both = buildAssembly(s, wingLine, 0, new Map([[orange, deg(40)], [tip, deg(40)]]));
    // 尖角可能被分成好幾塊；看移動最多的那塊
    const tipFaces = flapFor(s, tip)!.faces;
    const moved = one.pieces.map((p, i) => {
      if (!tipFaces.includes(p.faceId)) return 0;
      const a = p.centroid;
      const b = both.pieces[i].centroid;
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    });
    expect(Math.max(...moved)).toBeGreaterThan(3);
    // 不屬於任何一片的紙不動
    const fixed = (asm: typeof one) => asm.pieces.filter((p) => !p.bent).map((p) => p.centroid);
    expect(fixed(both)).toEqual(fixed(one));
  });

  it('點左邊或右邊那片，都算同一片', () => {
    const flaps = [{ at: flapAnchor(s, orange), deg: 30 }];
    for (const r of flapRoots(s, orange)) expect(flapIndexOf(s, flaps, r)).toBe(0);
    expect(flapIndexOf(s, flaps, tip)).toBe(-1); // 尖角是另一片
  });

  it('用原紙上的位置記錄，重新摺一次也找得到同一片', () => {
    const at = flapAnchor(s, orange);
    expect(resolveFlapBends(kidPlane(), [{ at, deg: 45 }]).size).toBe(2);
  });
});
