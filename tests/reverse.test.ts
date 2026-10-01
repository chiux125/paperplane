import { describe, expect, it } from 'vitest';
import {
  type PaperState,
  type ReverseStyle,
  type UserOp,
  createHistory,
  createSheet,
  current,
  doneOps,
  faceList,
  foldedPolygon,
  near,
  paperMass,
  push,
  replay,
  reverseFold,
  reverseFoldOptions,
  simpleFold,
  stackOrder,
} from '../src/core';
import { expectValid, line, pt, unwrap } from './helpers';

/** 100×200 的紙沿中線對摺，成為兩層的長條，中線是背脊。 */
const halved = (): PaperState =>
  unwrap(simpleFold(createSheet({ width: 100, height: 200 }), line(0, 0, 0, 1), pt(-10, 100)));

// 幾何一：翼片反摺後落在機身內 → 內翻合法、外翻穿紙
const G1 = { line: line(0, 150, 50, 200), flap: pt(10, 195) };
// 幾何二：翼片反摺後超出背脊 → 外翻合法、內翻穿紙
const G2 = { line: line(0, 150, 50, 100), flap: pt(40, 190) };

const styles = (opts: { style: ReverseStyle }[]) => opts.map((o) => o.style);

describe('反摺：列出合法選項', () => {
  it('幾何一：有「塞進裡面」(inside)、沒有「包在外面」(outside)', () => {
    const opts = reverseFoldOptions(halved(), G1.line, G1.flap);
    const s = styles(opts);
    expect(s).toContain('inside');
    expect(s).not.toContain('outside');
    expect(s).toContain('over');
    expect(s).toContain('under');
    for (const o of opts) expectValid(o.outcome.state);
  });

  it('幾何二：有「包在外面」(outside)、沒有「塞進裡面」(inside)', () => {
    const s = styles(reverseFoldOptions(halved(), G2.line, G2.flap));
    expect(s).toContain('outside');
    expect(s).not.toContain('inside');
  });

  it('所有選項的幾何完全相同，只差層序', () => {
    const opts = reverseFoldOptions(halved(), G1.line, G1.flap);
    expect(opts.length).toBeGreaterThanOrEqual(2);
    const ref = opts[0].outcome.state;
    for (const o of opts.slice(1)) {
      for (const f of faceList(ref)) {
        const g = o.outcome.state.faces.get(f.id)!;
        foldedPolygon(f).forEach((p, i) => expect(near(p, foldedPolygon(g)[i])).toBe(true));
      }
      // 但層序不同
      expect(o.outcome.state.orders).not.toEqual(ref.orders);
    }
  });

  it('點在線上 → 沒有選項', () => {
    expect(reverseFoldOptions(halved(), G1.line, pt(0, 150))).toEqual([]);
  });

  it('對摺前：反摺會左右一起（鏡像、結果仍對稱）', () => {
    const corner = { line: line(-105, 250, -55, 297), pick: pt(-90, 292) };
    const opts = reverseFoldOptions(createSheet(), corner.line, corner.pick);
    expect(opts.length).toBeGreaterThanOrEqual(1);
    const st = opts[0].outcome.state;
    expect(st.faces.size).toBeGreaterThan(1);
    expectValid(st);
    expect(paperMass(st).cg.x).toBeCloseTo(0, 6); // 左右對稱 → 重心在中線
  });
});

describe('反摺：直接做某一種（給重播）', () => {
  it('合法的會成功、會穿紙的回報 reverse-pierces', () => {
    expect(reverseFold(halved(), G1.line, G1.flap, 'inside').ok).toBe(true);
    expect(reverseFold(halved(), G1.line, G1.flap, 'outside')).toEqual({ ok: false, error: 'reverse-pierces' });
    const r = reverseFold(halved(), G1.line, G1.flap, 'inside');
    expect(r.ok && stackOrder(r.value.state)).not.toBeNull();
  });

  it('可以存進歷史並重播', () => {
    const base = halved();
    const op: UserOp = { kind: 'reverse', line: G2.line, pick: G2.flap, style: 'outside' };
    const h = unwrap(push(createHistory(base), op));
    expectValid(current(h));
    const again = unwrap(replay(base, doneOps(h)));
    expect(current(again).orders).toEqual(current(h).orders);
  });
});
