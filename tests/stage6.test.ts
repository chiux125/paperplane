import { describe, expect, it } from 'vitest';
import {
  type FaceId,
  area,
  assemblyMass,
  bendableFaces,
  buildAssembly,
  createSheet,
  getFace,
  liftCenter,
  simpleFold,
  vec,
} from '../src/core';
import { line, pt, unwrap } from './helpers';

const deg = (d: number) => (d * Math.PI) / 180;
const wingLine = { p: vec(35, 0), d: vec(0, 1) };

// 摺一個角 → 角落三角是「只有一條鉸鏈」的翼片。
const cornerFolded = () => unwrap(simpleFold(createSheet(), line(0, 297, 105, 200), pt(60, 265)));

describe('翼片翹起（幾何）', () => {
  it('找得到可翹起的翼片（單鉸鏈）', () => {
    const s = cornerFolded();
    const b = bendableFaces(s);
    expect(b.length).toBeGreaterThan(0);
    for (const id of b) expect(getFace(s, id)).toBeDefined();
  });

  it('翹起 0 度 → 和沒翹起完全一樣', () => {
    const s = cornerFolded();
    const fid = bendableFaces(s)[0];
    const base = buildAssembly(s, wingLine, 0);
    const zero = buildAssembly(s, wingLine, 0, new Map([[fid, 0]]));
    expect(zero.pieces.map((p) => p.centroid)).toEqual(base.pieces.map((p) => p.centroid));
  });

  it('翹起 > 0 → 那片的高度(z)變高，而且左右對稱', () => {
    const s = cornerFolded();
    // 挑面積最小的那片（角落小翼片）
    const flap = bendableFaces(s).sort((a, b) => area(getFace(s, a).cp) - area(getFace(s, b).cp))[0] as FaceId;
    const maxZ = (asm: ReturnType<typeof buildAssembly>) =>
      Math.max(...asm.pieces.filter((p) => p.faceId === flap).map((p) => p.centroid.z));
    const flat = buildAssembly(s, wingLine, 0);
    const bent = buildAssembly(s, wingLine, 0, new Map([[flap, deg(45)]]));
    expect(maxZ(bent)).toBeGreaterThan(maxZ(flat) + 1);
    // 左右對稱：重心仍在中線、翼展投影左右鏡像
    expect(assemblyMass(bent).cg.x).toBeCloseTo(0, 6);
    expect(liftCenter(bent).cp.x).toBeCloseTo(0, 6);
  });
});

describe('翼片翹起（前翼效應＋阻力）', () => {
  it('翹起 0 度：阻力 0、升力中心和原本一樣', () => {
    const s = cornerFolded();
    const flat = liftCenter(buildAssembly(s, wingLine, 0));
    const zero = liftCenter(buildAssembly(s, wingLine, 0, new Map([[bendableFaces(s)[0], 0]])));
    expect(flat.dragIndex).toBe(0);
    expect(zero.cp.y).toBeCloseTo(flat.cp.y, 9);
  });

  it('翹起後：前翼讓升力中心往前（+y）移、阻力變大', () => {
    const s = cornerFolded();
    const flap = bendableFaces(s).sort((a, b) => area(getFace(s, a).cp) - area(getFace(s, b).cp))[0] as FaceId;
    const flat = liftCenter(buildAssembly(s, wingLine, 0));
    const bent = liftCenter(buildAssembly(s, wingLine, 0, new Map([[flap, deg(40)]])));
    expect(bent.cp.y).toBeGreaterThan(flat.cp.y); // 往機頭(+y) → 升力中心前移
    expect(bent.dragIndex).toBeGreaterThan(flat.dragIndex);
  });
});
