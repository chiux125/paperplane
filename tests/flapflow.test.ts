import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type FaceId,
  type Line,
  type PaperState,
  type Vec2,
  buildAssembly,
  centroid,
  createSheet,
  faceList,
  flapFlowAt,
  pointToPoint,
  reverseFold,
  rotateSideFlaps,
  sideFlaps,
  simpleFold,
  symmetricFoldOutcome,
  topFlapWakeAt,
  topFlapWakes,
  topWing,
  vec,
  wingChord,
} from '../src/core';
import { pt, unwrap } from './helpers';

const { width: W, height: H } = A4;
const deg = (d: number) => (d * Math.PI) / 180;
const wingLine: Line = { p: { x: 25, y: 0 }, d: { x: 0, y: 1 } };

function kidPlane(): PaperState {
  const corner = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
  let s = unwrap(symmetricFoldOutcome(createSheet(), corner.line, corner.pick)).state;
  const tip = unwrap(pointToPoint(pt(0, H - W / 2), pt(35, 255)));
  s = unwrap(reverseFold(s, tip.line, tip.pick, 'top-over')).state;
  return unwrap(simpleFold(s, CENTER_LINE, pt(-1, H / 2)));
}
function faceNear(s: PaperState, p: Vec2): FaceId {
  const d = (id: FaceId) => {
    const c = centroid(s.faces.get(id)!.cp);
    return Math.hypot(c.x - p.x, c.y - p.y);
  };
  return faceList(s).reduce((a, b) => (d(a.id) < d(b.id) ? a : b)).id;
}

const s = kidPlane();
const orange = faceNear(s, pt(75, 245));
const asmWith = (bend: number) => buildAssembly(s, wingLine, 0, bend ? new Map([[orange, deg(bend)]]) : undefined);

/** 側視：和 WindTunnel 一樣，以機翼側影的中心與翼弦長正規化。 */
function side(bend: number) {
  const asm = asmWith(bend);
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (const p of asm.pieces) {
    if (p.region !== 'wing') continue;
    for (const v of p.poly) {
      cy += v.y;
      cz += v.z;
      n++;
    }
  }
  return sideFlaps(asm, vec(cy / n, cz / n), wingChord(asm));
}

describe('翼片對煙線的影響（側視）', () => {
  it('沒翹起任何翼片：完全不影響', () => {
    expect(side(0)).toEqual([]);
    const v = vec(1, 0.1);
    expect(flapFlowAt([], v, vec(0.3, 0.2))).toEqual({ v, wake: 0 });
  });

  it('翹起來：變成一小塊從根部往上翹的板，有前翼升力也有阻力', () => {
    const flaps = side(40);
    expect(flaps.length).toBeGreaterThan(0);
    for (const f of flaps) {
      expect(f.tip.y).toBeGreaterThan(f.base.y);
      expect(f.drag).toBeGreaterThan(0);
    }
    expect(flaps.some((f) => f.lift > 0)).toBe(true);
  });

  it('翹得越高，阻力越大', () => {
    const total = (b: number) => side(b).reduce((a, f) => a + f.drag, 0);
    expect(total(60)).toBeGreaterThan(total(20));
  });

  const flaps = side(50);
  const f = flaps.reduce((a, b) => (b.drag > a.drag ? b : a));
  const behind = vec(Math.max(f.base.x, f.tip.x) + 0.05, (f.base.y + f.tip.y) / 2);

  it('翼片後面是尾流：煙變慢', () => {
    const v = vec(1, 0);
    const r = flapFlowAt(flaps, v, behind);
    expect(r.wake).toBeGreaterThan(0.3);
    expect(Math.hypot(r.v.x, r.v.y)).toBeLessThan(0.8);
  });

  it('離翼片很遠的上游：幾乎不受影響', () => {
    const r = flapFlowAt(flaps, vec(1, 0), vec(f.base.x - 3, f.base.y));
    expect(r.wake).toBe(0);
    expect(r.v.x).toBeCloseTo(1, 1);
    expect(Math.abs(r.v.y)).toBeLessThan(0.05);
  });

  it('前翼升力：翼片前方的空氣被往上帶', () => {
    const lifting = flaps.filter((x) => x.lift > 0);
    const g = lifting[0];
    const ahead = vec(Math.min(g.base.x, g.tip.x) - 0.15, (g.base.y + g.tip.y) / 2);
    expect(flapFlowAt([g], vec(1, 0), ahead).v.y).toBeGreaterThan(0);
  });

  it('跟著攻角一起轉：轉 0 度不變、轉了長度不變', () => {
    expect(rotateSideFlaps(flaps, 0)).toEqual(flaps);
    const r = rotateSideFlaps([f], deg(12))[0];
    const len = (x: typeof f) => Math.hypot(x.tip.x - x.base.x, x.tip.y - x.base.y);
    expect(len(r)).toBeCloseTo(len(f), 12);
  });
});

describe('翼片對煙線的影響（俯視）', () => {
  it('沒翹起：沒有尾流', () => {
    const asm = asmWith(0);
    expect(topFlapWakes(asm, topWing(asm).rootChord)).toEqual([]);
  });

  it('翹起：兩片翼片後面各拖一條尾流，左右對稱，旁邊不受影響', () => {
    const asm = asmWith(45);
    const wakes = topFlapWakes(asm, topWing(asm).rootChord);
    expect(wakes.length).toBeGreaterThanOrEqual(2);
    const w = wakes.reduce((a, b) => (b.strength * b.halfW > a.strength * a.halfW ? b : a));
    expect(topFlapWakeAt(wakes, w.u0 + 0.1, w.vC)).toBeGreaterThan(0.2);
    expect(topFlapWakeAt(wakes, w.u0 + 0.1, -w.vC)).toBeGreaterThan(0.2);
    expect(topFlapWakeAt(wakes, w.u0 - 0.5, w.vC)).toBe(0); // 翼片前面
    expect(topFlapWakeAt(wakes, w.u0 + 0.1, w.vC + 5)).toBe(0); // 遠遠的旁邊
  });
});
