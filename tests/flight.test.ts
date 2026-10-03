import { describe, expect, it } from 'vitest';
import {
  type FlightAero,
  ALPHA_STALL,
  DEFAULT_LAUNCH,
  classifyFlight,
  liftSlope,
  simulateFlight,
} from '../src/core';

// 一架典型的紙飛機（直接給氣動參數，方便單獨控制裕度／阻力）。
const base: FlightAero = {
  massKg: 0.005,
  areaM2: 0.02,
  chordM: 0.12,
  aspect: 1.6,
  margin: 0.15,
  incidenceRad: 0,
  dragIndex: 0,
};
const sim = (margin: number, extra: Partial<FlightAero> = {}) =>
  simulateFlight({ ...base, margin, ...extra });

describe('飛行模擬（縱向 3 自由度）', () => {
  it('裕度剛好 → 平穩滑翔：往前飛、慢慢下降', () => {
    const r = sim(0.15);
    expect(r.behavior).toBe('glide');
    expect(r.rangeM).toBeGreaterThan(2);
    // 最後比出手低（有下降），而且沒有暴衝爬升
    expect(r.samples[r.samples.length - 1].h).toBeLessThan(DEFAULT_LAUNCH.heightM);
    expect(r.maxClimbM).toBeLessThan(0.25);
  });

  it('重心太後面（裕度 ≤ 0）→ 仰頭失速：會爬升然後失速', () => {
    const r = sim(-0.05);
    expect(r.behavior).toBe('pitch-up');
    expect(r.stalled).toBe(true);
    expect(r.maxClimbM).toBeGreaterThan(0.25);
  });

  it('重心太前面（裕度很大）→ 栽頭：陡陡地往下、幾乎不爬升', () => {
    const r = sim(0.5);
    expect(r.behavior).toBe('nose-dive');
    expect(r.maxClimbM).toBeLessThan(0.1);
    const minGamma = Math.min(...r.samples.map((s) => s.gamma));
    expect(minGamma).toBeLessThan(-(35 * Math.PI) / 180);
  });

  it('穩定帶內都滑翔，裕度負的都仰頭', () => {
    for (const m of [0.08, 0.12, 0.18, 0.22]) expect(sim(m).behavior).toBe('glide');
    for (const m of [-0.1, -0.02]) expect(sim(m).behavior).toBe('pitch-up');
  });

  it('翼片翹起（阻力大）→ 飛得比較慢、比較近', () => {
    const off = sim(0.15, { dragIndex: 0 });
    const on = sim(0.15, { dragIndex: 0.4 });
    expect(on.rangeM).toBeLessThan(off.rangeM);
    const avg = (r: typeof off) => r.samples.reduce((a, s) => a + s.speed, 0) / r.samples.length;
    expect(avg(on)).toBeLessThan(avg(off));
  });

  it('左右對稱不存在於縱向模擬：結果只跟縱向參數有關（同參數 → 同結果）', () => {
    const a = sim(0.15);
    const b = sim(0.15);
    expect(a.rangeM).toBe(b.rangeM);
    expect(a.samples.length).toBe(b.samples.length);
  });

  it('升力斜率隨展弦比增加；失速角是正的', () => {
    expect(liftSlope(3)).toBeGreaterThan(liftSlope(1));
    expect(ALPHA_STALL).toBeGreaterThan(0);
  });

  it('classifyFlight：樣本太少回傳 glide（不崩）', () => {
    expect(classifyFlight([], false, DEFAULT_LAUNCH)).toBe('glide');
  });
});
