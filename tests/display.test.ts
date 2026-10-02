import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type Line,
  type PaperState,
  type Vec3,
  buildAssembly,
  createSheet,
  displayPieces,
  faceList,
  isFaceUp,
  layerDepths,
  pointToPoint,
  simpleFold,
  symmetricFoldOutcome,
} from '../src/core';
import { line, pt, unwrap } from './helpers';

const { width: W, height: H } = A4;
const T = 0.15;
const wingLine: Line = { p: { x: 35, y: 0 }, d: { x: 0, y: 1 } };

/** 標準飛鏢：兩上角摺到中線，再對摺。 */
function dart(): PaperState {
  const spec = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
  const corners = unwrap(symmetricFoldOutcome(createSheet(), spec.line, spec.pick)).state;
  return unwrap(simpleFold(corners, CENTER_LINE, pt(-1, H / 2)));
}

const avg = (poly: readonly Vec3[], k: 'x' | 'y' | 'z') => poly.reduce((s, v) => s + v[k], 0) / poly.length;

describe('局部層數', () => {
  it('連續對摺兩次：同一處疊了 4 層，層數 0～3', () => {
    let s = createSheet({ width: 200, height: 200 });
    s = unwrap(simpleFold(s, CENTER_LINE, pt(-10, 10)));
    s = unwrap(simpleFold(s, line(0, 100, 1, 100), pt(10, 150)));
    expect([...layerDepths(s).values()].sort()).toEqual([0, 1, 2, 3]);
  });

  it('只看重疊的面：翼片是第 1 層，沒被蓋住的紙都是第 0 層', () => {
    const spec = unwrap(pointToPoint(pt(-W / 2, H), pt(0, H - W / 2)));
    const s = unwrap(symmetricFoldOutcome(createSheet(), spec.line, spec.pick)).state;
    const d = layerDepths(s);
    for (const f of faceList(s)) expect(d.get(f.id)).toBe(isFaceUp(f) ? 0 : 1);
  });
});

describe('3D 預覽的擺放', () => {
  const s = dart();
  const asm = buildAssembly(s, wingLine, 0);
  const shown = displayPieces(s, asm, T);
  const depth = layerDepths(s);

  it('每一片紙只畫一次（不再左右各疊一份）', () => {
    expect(shown.length).toBe(asm.pieces.length / 2);
  });

  it('機身：下面那半張在右邊、上面那半張在左邊，不會疊在中線上', () => {
    const fus = shown.filter((p) => p.region === 'fuselage');
    const right = fus.filter((p) => avg(p.poly, 'x') > 0);
    const left = fus.filter((p) => avg(p.poly, 'x') < 0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    for (const p of fus) for (const v of p.poly) expect(Math.abs(v.x)).toBeGreaterThanOrEqual(T / 2 - 1e-9);
    // 同一半裡層數相同的面在同一個 x 上，層數越高越靠近中線（下半）
    const xs = right.map((p) => ({ d: depth.get(p.faceId)!, x: avg(p.poly, 'x') }));
    for (const a of xs) for (const b of xs) if (a.d < b.d) expect(a.x).toBeGreaterThan(b.x);
  });

  it('機翼：右翼在 +x、左翼在 -x，左右對稱（只差紙的厚度）', () => {
    const wings = shown.filter((p) => p.region === 'wing');
    const right = wings.filter((p) => avg(p.poly, 'x') > 0).map((p) => [avg(p.poly, 'x'), avg(p.poly, 'y')]);
    const left = wings.filter((p) => avg(p.poly, 'x') < 0).map((p) => [-avg(p.poly, 'x'), avg(p.poly, 'y')]);
    expect(right.length).toBe(left.length);
    const sort = (a: number[][]) => [...a].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    sort(right).forEach((p, i) => {
      expect(p[0]).toBeCloseTo(sort(left)[i][0], 0);
      expect(p[1]).toBeCloseTo(sort(left)[i][1], 0);
    });
  });

  it('上反角 0 時，同一個翼上的層從上到下依層序排好（不會穿透）', () => {
    const right = shown.filter((p) => p.region === 'wing' && avg(p.poly, 'x') > 0);
    for (const p of right) {
      const zs = p.poly.map((v) => v.z);
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-9); // 平的
    }
    // 不同層的 z 一定不同（相差至少一張紙厚）
    const levels = [...new Set(right.map((p) => Math.round(avg(p.poly, 'z') / T)))];
    expect(levels.length).toBe(new Set(right.map((p) => depth.get(p.faceId))).size);
  });

  it('厚度 0 時，位置和組裝結果完全相同', () => {
    for (const p of displayPieces(s, asm, 0)) {
      p.poly.forEach((v, i) => {
        expect(v.x).toBe(p.base[i].x);
        expect(v.z).toBe(p.base[i].z);
      });
    }
  });

  it('不影響組裝本身（重心、升力用的紙片沒被改到）', () => {
    expect(buildAssembly(s, wingLine, 0).pieces).toEqual(asm.pieces);
  });
});
