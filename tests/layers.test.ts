import { describe, expect, it } from 'vitest';
import {
  type FaceId,
  type Line,
  type MoveGroup,
  type PaperState,
  type Vec2,
  compose,
  createSheet,
  faceList,
  foldedPolygon,
  getFace,
  isFaceUp,
  moveFaces,
  near,
  pairKey,
  reflection,
  signedDist,
  simpleFold,
  splitFaces,
  stackOrder,
  validate,
} from '../src/core';
import { expectValid, line, pt, unwrap } from './helpers';

const kinds = (s: PaperState) => validate(s).map((i) => i.kind);

/** 100×200 的紙沿中線對摺：A 側（正面朝上、在下）與 B 側（翻過來、在上），中線成了「背脊」。 */
function halved(): PaperState {
  return unwrap(simpleFold(createSheet({ width: 100, height: 200 }), line(0, 0, 0, 1), pt(-10, 100)));
}

interface Parts {
  A: FaceId; // 翼片中來自下層的那片
  B: FaceId; // 翼片中來自上層的那片
  A0: FaceId; // 不動的下層
  B0: FaceId; // 不動的上層
  T: MoveGroup['transform'];
}

/**
 * 在對摺後的長條上，沿 l 把尖端（flapPick 那一側）反摺。
 * 幾何位置一律是對 l 鏡射；各種摺法只差在分組與層序（groupsFor）。
 */
function reverseFold(l: Line, flapPick: Vec2, groupsFor: (p: Parts) => MoveGroup[]): PaperState {
  const s = halved();
  const next = { ...s, step: s.step + 1 };
  const split = unwrap(splitFaces(next, next.faces.keys(), l));
  const flapIsLeft = signedDist(l, flapPick) > 0;
  const flap = flapIsLeft ? split.left : split.right;
  const body = flapIsLeft ? split.right : split.left;
  expect(flap).toHaveLength(2);
  expect(body).toHaveLength(2);
  const st = split.state;
  const up = (id: FaceId) => isFaceUp(getFace(st, id));
  const parts: Parts = {
    A: flap.find(up)!,
    B: flap.find((id) => !up(id))!,
    A0: body.find(up)!,
    B0: body.find((id) => !up(id))!,
    T: reflection(l),
  };
  return moveFaces(st, groupsFor(parts));
}

const simple = ({ A, B, T }: Parts): MoveGroup[] => [{ faces: [A, B], transform: T, place: { kind: 'top' } }];
const inside = ({ A, B, B0, T }: Parts): MoveGroup[] => [
  { faces: [A], transform: T, place: { kind: 'between', under: [B0] } },
  { faces: [B], transform: T, place: { kind: 'between', under: [B0] } },
];
const outside = ({ A, B, T }: Parts): MoveGroup[] => [
  { faces: [A], transform: T, place: { kind: 'bottom' } },
  { faces: [B], transform: T, place: { kind: 'top' } },
];

// 幾何一：翼片反摺後整個落在機身範圍內 → 只能往裡塞（內翻），包在外面會穿紙
const G1 = { line: line(0, 150, 50, 200), flap: pt(10, 195) };
// 幾何二：翼片反摺後會超出背脊 → 只能包在外面（外翻），往裡塞會穿過背脊
const G2 = { line: line(0, 150, 50, 100), flap: pt(40, 190) };

describe('內翻／外翻：幾何相同，只差層序', () => {
  it('內翻與外翻的每一面落點完全相同', () => {
    const a = reverseFold(G1.line, G1.flap, inside);
    const b = reverseFold(G1.line, G1.flap, outside);
    for (const f of faceList(a)) {
      const g = b.faces.get(f.id)!;
      foldedPolygon(f).forEach((p, i) => expect(near(p, foldedPolygon(g)[i])).toBe(true));
    }
    expect(a.orders).not.toEqual(b.orders);
  });

  it('幾何一：內翻合法、外翻會穿紙、整疊簡單摺合法', () => {
    const s = reverseFold(G1.line, G1.flap, inside);
    expectValid(s);
    expect(stackOrder(s)).not.toBeNull();
    expect(kinds(reverseFold(G1.line, G1.flap, outside))).toContain('taco-tortilla');
    expectValid(reverseFold(G1.line, G1.flap, simple));
  });

  it('幾何二：外翻合法、內翻會穿過背脊、整疊簡單摺合法', () => {
    expectValid(reverseFold(G2.line, G2.flap, outside));
    expect(kinds(reverseFold(G2.line, G2.flap, inside))).toContain('taco-tortilla');
    expectValid(reverseFold(G2.line, G2.flap, simple));
  });

  it('只有一半塞進去、另一半蓋在上面：穿紙', () => {
    const mixed = ({ A, B, B0, T }: Parts): MoveGroup[] => [
      { faces: [A], transform: T, place: { kind: 'between', under: [B0] } },
      { faces: [B], transform: T, place: { kind: 'top' } },
    ];
    expect(kinds(reverseFold(G1.line, G1.flap, mixed))).toContain('taco-tortilla');
  });

  it('兩片塞進去的順序顛倒：兩個摺子交錯（taco-taco）', () => {
    const swapped = (p: Parts): MoveGroup[] => [...inside(p)].reverse();
    expect(kinds(reverseFold(G1.line, G1.flap, swapped))).toContain('taco-taco');
  });
});

describe('驗證器能抓到非法狀態', () => {
  const folded3 = () => {
    let s = createSheet({ width: 200, height: 200 });
    s = unwrap(simpleFold(s, line(0, 0, 0, 1), pt(-10, 10)));
    s = unwrap(simpleFold(s, line(0, 100, 1, 100), pt(10, 150)));
    return s;
  };

  it('撕裂：一面被移開', () => {
    const s = folded3();
    const f = faceList(s)[0];
    const faces = new Map(s.faces);
    faces.set(f.id, { ...f, xf: compose({ a: 1, b: 0, c: 0, d: 1, tx: 3, ty: 0 }, f.xf) });
    expect(kinds({ ...s, faces })).toContain('torn');
  });

  it('缺少層序', () => {
    const s = folded3();
    const orders = new Map(s.orders);
    orders.delete([...orders.keys()][0]);
    expect(kinds({ ...s, orders })).toContain('missing-order');
  });

  it('三層循環', () => {
    const s = folded3();
    const [a, , c] = stackOrder(s)!; // 由下到上 a < b < c
    const orders = new Map(s.orders);
    orders.set(pairKey(a, c), a < c ? 1 : -1); // 改成 a 在 c 上面 → a < b < c < a
    expect(kinds({ ...s, orders })).toContain('cycle');
  });

  it('凹多邊形', () => {
    const s = createSheet({ width: 10, height: 10 });
    const f = faceList(s)[0];
    const faces = new Map(s.faces);
    faces.set(f.id, { ...f, cp: [pt(-5, 0), pt(5, 0), pt(0, 3), pt(5, 10), pt(-5, 10)] });
    expect(kinds({ ...s, faces })).toContain('non-convex');
  });

  it('鉸鏈不在面的邊上', () => {
    const s = folded3();
    const h = s.hinges[0];
    const hinges = [{ ...h, cpSeg: [pt(-30, 30), pt(-20, 40)] as const }, ...s.hinges.slice(1)];
    expect(kinds({ ...s, hinges })).toContain('bad-hinge');
  });
});
