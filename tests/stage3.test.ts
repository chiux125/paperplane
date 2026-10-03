import { describe, expect, it } from 'vitest';
import {
  CENTER_LINE,
  type Line,
  type Vec2,
  add,
  buildAssembly,
  circulationMag,
  createSheet,
  flowAt,
  inWake,
  isStalled,
  plate,
  scale,
  separationAlong,
  type SideFlap,
  sideSpeedProfile,
  simpleFold,
  tipVortexAxisV,
  topFlowAt,
  topWing,
  vec,
  vec3,
  wingChord,
} from '../src/core';
import { unwrap } from './helpers';

const deg = (d: number) => (d * Math.PI) / 180;
const H = 297;

describe('風洞流場（標準座標）', () => {
  it('遠離機翼 ≈ 均勻來流 (1, 0)', () => {
    const v = flowAt(deg(10), vec(-6, 4));
    expect(v.x).toBeCloseTo(1, 1);
    expect(Math.abs(v.y)).toBeLessThan(0.05);
  });

  it('攻角 0 沒有升力（環量 = 0）', () => {
    expect(circulationMag(0)).toBeCloseTo(0, 12);
  });

  it('攻角越大升力越大，失速後塌掉', () => {
    expect(circulationMag(deg(5))).toBeLessThan(circulationMag(deg(10)));
    expect(circulationMag(deg(10))).toBeLessThan(circulationMag(deg(14)));
    // 失速後環量比失速前小
    expect(circulationMag(deg(25))).toBeLessThan(circulationMag(deg(14)));
  });

  it('有升力時：前方上洗、後方下洗', () => {
    const a = deg(10);
    expect(flowAt(a, vec(-1.5, 0)).y).toBeGreaterThan(0); // 前方往上
    expect(flowAt(a, vec(1.5, 0)).y).toBeLessThan(0); //    後方往下
  });

  it('有升力時：上面流得比下面快', () => {
    const a = deg(10);
    const { le, dir, nUp } = plate(a);
    const mid = add(le, scale(dir, 0.5));
    const top = flowAt(a, add(mid, scale(nUp, 0.4)));
    const bot = flowAt(a, add(mid, scale(nUp, -0.4)));
    expect(top.x).toBeGreaterThan(1);
    expect(bot.x).toBeLessThan(1);
  });
});

describe('截面速度分布（定點風速）', () => {
  it('均勻來流：遠處截面每一點都 ≈ 100%', () => {
    const prof = sideSpeedProfile(0, [], 3, -1, 1, 20);
    expect(prof.samples).toHaveLength(20);
    expect(prof.minFrac).toBeCloseTo(1, 2);
    expect(prof.maxFrac).toBeCloseTo(1, 2);
    expect(prof.avgFrac).toBeGreaterThanOrEqual(prof.minFrac);
    expect(prof.avgFrac).toBeLessThanOrEqual(prof.maxFrac);
  });

  it('有攻角：截面上方比來流快、下方比來流慢（升力的樣子）', () => {
    const prof = sideSpeedProfile(deg(10), [], 0, -0.8, 0.8, 30);
    expect(prof.maxFrac).toBeGreaterThan(1.02);
    expect(prof.minFrac).toBeLessThan(0.98);
  });

  it('翼片尾流：截面落在翹起翼片後面 → 風速明顯變慢', () => {
    const flap: SideFlap = { base: vec(0, 0), tip: vec(0.2, 0.3), lift: 0.1, drag: 0.3 };
    const clean = sideSpeedProfile(0, [], 0.3, -0.1, 0.4, 24);
    const wake = sideSpeedProfile(0, [flap], 0.3, -0.1, 0.4, 24);
    expect(wake.minFrac).toBeLessThan(clean.minFrac);
    expect(wake.minFrac).toBeLessThan(0.9);
    expect(wake.samples.some((s) => s.wake > 0)).toBe(true);
  });
});

describe('失速與分離', () => {
  const stalledPoint = (a: number): Vec2 => {
    const { le, dir, nUp } = plate(a);
    return add(add(le, scale(dir, 0.7)), scale(nUp, 0.05)); // 機翼上面、七成翼弦處
  };

  it('失速門檻 15°', () => {
    expect(isStalled(deg(14))).toBe(false);
    expect(isStalled(deg(16))).toBe(true);
  });

  it('分離點：未失速在後緣，失速越深越往前緣', () => {
    expect(separationAlong(deg(10))).toBe(1);
    expect(separationAlong(deg(25))).toBeLessThan(separationAlong(deg(18)));
  });

  it('尾流只在失速時出現，且速度很慢', () => {
    expect(inWake(deg(5), stalledPoint(deg(20)))).toBe(false);
    expect(inWake(deg(20), stalledPoint(deg(20)))).toBe(true);
    // 失速尾流裡順流速度被壓得很慢
    expect(flowAt(deg(20), stalledPoint(deg(20))).x).toBeLessThan(0.3);
    // 同一相對位置未失速時仍快
    expect(flowAt(deg(5), stalledPoint(deg(5))).x).toBeGreaterThan(0.3);
  });
});

describe('從飛機取翼弦', () => {
  it('對摺平板：翼弦 = 機頭到機尾 297 mm', () => {
    const state = unwrap(simpleFold(createSheet(), CENTER_LINE, vec(-1, H / 2)));
    const wingLine: Line = { p: vec(35, 0), d: vec(0, 1) };
    const asm = buildAssembly(state, wingLine, 0);
    expect(wingChord(asm)).toBeCloseTo(H, 3);
  });
});

describe('機翼內建攻角（摺線斜度）', () => {
  const halved = () => unwrap(simpleFold(createSheet(), CENTER_LINE, vec(-1, H / 2)));
  const tiltedLine = (tiltDeg: number): Line => ({
    p: vec(35, 0),
    d: vec(Math.sin(deg(tiltDeg)), Math.cos(deg(tiltDeg))),
  });

  it('摺線平行中線（斜度 0）→ 內建攻角 0', () => {
    expect(buildAssembly(halved(), tiltedLine(0), 0).wingIncidence).toBeCloseTo(0, 9);
  });

  it('上反角 0 時：內建攻角 = 摺線斜度', () => {
    expect(buildAssembly(halved(), tiltedLine(10), 0).wingIncidence).toBeCloseTo(deg(10), 6);
    expect(buildAssembly(halved(), tiltedLine(-8), 0).wingIncidence).toBeCloseTo(deg(-8), 6);
  });
});

describe('翼尖渦流（上面看）', () => {
  const halved = () => unwrap(simpleFold(createSheet(), CENTER_LINE, vec(-1, H / 2)));
  const wingLine: Line = { p: vec(50, 0), d: vec(0, 1) };
  const wing = topWing(buildAssembly(halved(), wingLine, deg(8)));
  // 右翼尖渦流軸正上方的一個點（會被捲進去）
  const pR = vec3(wing.tipU + 0.2, tipVortexAxisV(wing), 0.12);

  it('攻角 0 → 沒有升力 → 側向與上下速度都約 0（煙線筆直）', () => {
    const v = topFlowAt(wing, 0, pR);
    expect(v.x).toBeCloseTo(1, 9);
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
    expect(Math.abs(v.z)).toBeLessThan(1e-9);
  });

  it('攻角越大渦流越強（同一點旋轉速度變大）', () => {
    const swirl = (a: number) => {
      const v = topFlowAt(wing, deg(a), pR);
      return Math.hypot(v.y, v.z);
    };
    expect(swirl(5)).toBeGreaterThan(0);
    expect(swirl(12)).toBeGreaterThan(swirl(5));
  });

  it('失速後渦流變弱（環量塌陷）', () => {
    const swirl = (a: number) => {
      const v = topFlowAt(wing, deg(a), pR);
      return Math.hypot(v.y, v.z);
    };
    expect(swirl(20)).toBeLessThan(swirl(12));
  });

  it('左右對稱：v 與 −v 的側向速度互為鏡像', () => {
    const a = deg(10);
    const p = vec3(wing.tipU + 0.3, 0.4, 0.05);
    const mirror = vec3(p.x, -p.y, p.z);
    const v = topFlowAt(wing, a, p);
    const vm = topFlowAt(wing, a, mirror);
    expect(vm.y).toBeCloseTo(-v.y, 9);
    expect(vm.z).toBeCloseTo(v.z, 9);
  });

  it('機翼上游很遠、或離翼尖很遠 → 影響約 0', () => {
    const up = topFlowAt(wing, deg(10), vec3(-1, tipVortexAxisV(wing), 0.1));
    expect(Math.abs(up.y)).toBeLessThan(1e-6);
    expect(Math.abs(up.z)).toBeLessThan(1e-6);
    const far = topFlowAt(wing, deg(10), vec3(wing.tipU + 0.3, 8, 0.1));
    expect(Math.hypot(far.y, far.z)).toBeLessThan(1e-3);
  });

  it('機翼形狀改變（上反角使俯視翼展變窄）→ 渦流軸位置跟著變', () => {
    const flat = topWing(buildAssembly(halved(), wingLine, 0));
    const up = topWing(buildAssembly(halved(), wingLine, deg(30)));
    expect(tipVortexAxisV(up)).toBeLessThan(tipVortexAxisV(flat));
  });
});
