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
  facesOverlap,
  foldedPolygon,
  getOrder,
  isFaceUp,
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

describe('只摺最上面那片', () => {
  // 對摺後的 2 層長條（x∈[0,50]）。頂層（背面朝上）蓋在底層（正面朝上）上。
  // 在右上角附近切，只摺頂層那一小塊角。
  const rev = { line: line(50, 160, 20, 200), pick: pt(45, 190) };

  it('重現情境：只有最上面那片翻過來、底下白紙不動', () => {
    const s = halved();
    const opts = reverseFoldOptions(s, rev.line, rev.pick);
    const top = opts.find((o) => o.style === 'top-over')!;
    const over = opts.find((o) => o.style === 'over')!;
    expect(top).toBeDefined();
    expect(over).toBeDefined();

    // 只動一片（頂層尖角）；整疊摺會動兩片（還包含底下那層）
    expect(top.outcome.movers[0].faces.length).toBe(1);
    expect(top.outcome.movers[0].faces.length).toBeLessThan(over.outcome.movers[0].faces.length);
    expectValid(top.outcome.state);

    // 移動的那片：原本背面朝上，翻過來變正面朝上，而且疊在它蓋到的每一面上方
    const movedId = top.outcome.movers[0].faces[0];
    const moved = top.outcome.state.faces.get(movedId)!;
    expect(isFaceUp(moved)).toBe(true);
    for (const f of faceList(top.outcome.state)) {
      if (f.id !== movedId && facesOverlap(moved, f)) {
        expect(getOrder(top.outcome.state.orders, movedId, f.id)).toBe(1);
      }
    }

    // 底下的紙完全不動：除了那一片，其餘每一面的 xf 都和「摺之前（已沿線切開）」一模一樣
    const overMoved = new Set(over.outcome.movers[0].faces); // over 會動到的全部面
    for (const f of faceList(top.outcome.state)) {
      if (f.id === movedId) continue;
      // 不是這次移動的面 → 在 over（整疊摺）裡若也沒被移動，xf 應完全相同
      if (!overMoved.has(f.id)) {
        const g = over.outcome.state.faces.get(f.id);
        if (g) expect(f.xf).toEqual(g.xf);
      }
    }
  });

  it('白紙只有一層 → 不會出現「只摺最上面」', () => {
    const opts = reverseFoldOptions(createSheet(), line(-105, 250, -55, 297), pt(-90, 292));
    expect(opts.some((o) => o.style === 'top-over')).toBe(false);
  });

  it('可以存進歷史並重播', () => {
    const base = halved();
    const op: UserOp = { kind: 'reverse', line: rev.line, pick: rev.pick, style: 'top-over' };
    const h = unwrap(push(createHistory(base), op));
    expectValid(current(h));
    const again = unwrap(replay(base, doneOps(h)));
    expect(current(again).orders).toEqual(current(h).orders);
  });

  it('對摺前：只摺最上面也會左右一起（鏡像、對稱）', () => {
    // 把上緣往下摺（水平線、自身對稱）→ 上方有 2 層，左右對稱
    const folded = unwrap(simpleFold(createSheet(), line(0, 200, 1, 200), pt(0, 290)));
    const opts = reverseFoldOptions(folded, line(105, 130, 80, 103), pt(100, 110));
    const top = opts.find((o) => o.style === 'top-over')!;
    expect(top).toBeDefined();
    expectValid(top.outcome.state);
    expect(paperMass(top.outcome.state).cg.x).toBeCloseTo(0, 5); // 左右一起 → 對稱
    const moved = top.outcome.movers.reduce((n, m) => n + m.faces.length, 0);
    expect(moved).toBe(2); // 左右各一片
  });
});
