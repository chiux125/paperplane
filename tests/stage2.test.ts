import { describe, expect, it } from 'vitest';
import {
  A4,
  CENTER_LINE,
  type Line,
  type Paperclip,
  assemblyMass,
  buildAssembly,
  createSheet,
  isHalved,
  liftCenter,
  paperMass,
  rotateAxis,
  simpleFold,
  stability,
  vec3,
} from '../src/core';
import { unwrap } from './helpers';

const { height: H } = A4;

/** 對摺後的狀態，機翼摺線為垂直線 x = w。 */
function halvedWith(w: number): { state: ReturnType<typeof createSheet>; wingLine: Line } {
  const state = unwrap(simpleFold(createSheet(), CENTER_LINE, { x: -1, y: H / 2 }));
  return { state, wingLine: { p: { x: w, y: 0 }, d: { x: 0, y: 1 } } };
}

describe('vec3 繞軸旋轉', () => {
  it('繞 y 軸 90°：+z 轉到 +x', () => {
    const r = rotateAxis(vec3(0, 0, 1), vec3(0, 1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(1, 12);
    expect(r.y).toBeCloseTo(0, 12);
    expect(r.z).toBeCloseTo(0, 12);
  });
});

describe('立體組裝', () => {
  it('對摺＋垂直機翼線＋上反角 0：機身垂直、機翼水平', () => {
    const { state, wingLine } = halvedWith(35);
    expect(isHalved(state)).toBe(true);
    const asm = buildAssembly(state, wingLine, 0);

    const fus = asm.pieces.filter((p) => p.region === 'fuselage');
    const wing = asm.pieces.filter((p) => p.region === 'wing');
    // 2 面 × (右 + 鏡射左) = 4 片機身、4 片機翼
    expect(fus).toHaveLength(4);
    expect(wing).toHaveLength(4);
    // 機身全部在 X = 0 平面（垂直）
    for (const p of fus) for (const v of p.poly) expect(Math.abs(v.x)).toBeLessThan(1e-9);
    // 上反角 0：機翼全部在同一水平高度（z 固定）
    for (const p of wing) for (const v of p.poly) expect(v.z).toBeCloseTo(35, 9);
  });

  it('重量等於一張 A4，重心左右對稱（x = 0）', () => {
    const { state, wingLine } = halvedWith(35);
    const asm = buildAssembly(state, wingLine, 0);
    const m = assemblyMass(asm);
    expect(m.mass).toBeCloseTo(paperMass(createSheet()).mass, 9);
    expect(m.cg.x).toBeCloseTo(0, 9);
    // 平板、無配重：重心在紙中間 y = H/2
    expect(m.cg.y).toBeCloseTo(H / 2, 6);
  });

  it('機頭加迴紋針：重心往前（+y）移，移動量符合手算', () => {
    const { state, wingLine } = halvedWith(35);
    const asm = buildAssembly(state, wingLine, 0);
    const before = assemblyMass(asm);
    const clip: Paperclip = { id: 1, pos: vec3(0, 290, 17.5), size: 'large' }; // 1 g 在機頭附近
    const after = assemblyMass(asm, [clip]);
    expect(after.cg.y).toBeGreaterThan(before.cg.y);
    // ΔCG.y = m_clip·(y_clip − CG0) / (M + m_clip)
    const expected = before.cg.y + (1 * (290 - before.cg.y)) / (before.mass + 1);
    expect(after.cg.y).toBeCloseTo(expected, 9);
    expect(after.cg.x).toBeCloseTo(0, 9);
  });

  it('上反角變大：俯視翼展變窄、升力中心升高', () => {
    const { state, wingLine } = halvedWith(35);
    const flat = liftCenter(buildAssembly(state, wingLine, 0));
    const up = liftCenter(buildAssembly(state, wingLine, (30 * Math.PI) / 180));
    expect(up.span).toBeLessThan(flat.span);
    expect(up.cp.z).toBeGreaterThan(flat.cp.z);
  });
});

describe('升力中心（25% 翼弦條帶法）', () => {
  it('矩形機翼：升力中心在前緣往後 25% 處，左右對稱', () => {
    const { state, wingLine } = halvedWith(35);
    const pf = liftCenter(buildAssembly(state, wingLine, 0));
    // 機翼矩形，前緣在機頭 y = 297，翼弦 = 297 → 25% 位置 y = 297 − 0.25·297
    expect(pf.cp.y).toBeCloseTo(297 - 0.25 * 297, 3);
    expect(pf.cp.x).toBeCloseTo(0, 6);
    expect(pf.meanChord).toBeCloseTo(297, 1);
    // 翼展：左右各 (105−35)=70 → 共 140
    expect(pf.span).toBeCloseTo(140, 0);
  });
});

describe('靜態穩定度門檻', () => {
  it('升力中心在重心前面 → 仰頭', () => {
    const s = stability(vec3(0, 100, 0), vec3(0, 150, 0), 100);
    expect(s.verdict).toBe('pitch-up');
    expect(s.margin).toBeCloseTo(-0.5, 9);
  });

  it('重心在升力中心前面一點點 → 穩', () => {
    const s = stability(vec3(0, 115, 0), vec3(0, 100, 0), 100); // margin 0.15
    expect(s.verdict).toBe('stable');
  });

  it('重心太前面 → 往下衝', () => {
    const s = stability(vec3(0, 150, 0), vec3(0, 100, 0), 100); // margin 0.5
    expect(s.verdict).toBe('nose-dive');
  });

  it('剛好在門檻上：5% 與 30% 都算穩', () => {
    expect(stability(vec3(0, 105, 0), vec3(0, 100, 0), 100).verdict).toBe('stable');
    expect(stability(vec3(0, 130, 0), vec3(0, 100, 0), 100).verdict).toBe('stable');
  });
});
