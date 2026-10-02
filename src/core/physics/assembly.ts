import { apply, det } from '../geom/iso';
import { type Line, lineThrough, signedDist } from '../geom/line';
import { hingeAngle } from '../engine/angle';
import { area, centroid, splitByDistances } from '../geom/polygon';
import { type Vec2, add as add2, scale as scale2, vec } from '../geom/vec';
import { type Vec3, add3, normalize3, rotateAxis, sub3, vec3 } from '../geom/vec3';
import { foldedPolygon, getFace } from '../model/face';
import type { FaceId, Hinge, PaperState } from '../model/types';
import { PAPER_GSM } from './mass';

/**
 * 階段 2 的立體組裝：由摺好的 2D 狀態「推導」出飛機的 3D 形狀，完全不動 PaperState。
 *
 * 做法（註：這是示意，不是精確模擬）：
 * - 對摺後整疊紙都在中線的同一側。沿孩子選的「機翼摺線」把每一面切成機身段與機翼段。
 * - 機身段（靠中線那半）立起來，掛在垂直的 X = 0 平面上（紙飛機的垂直龍骨／機身壁）。
 * - 機翼段繞著機翼摺線往外展開，和水平面夾「上反角」Γ。
 * - 這一疊其實是整張 A4（對摺後兩層疊在一起），展開飛行時會平均分到左右兩邊。
 *   所以我們把推導出來的半邊「鏡射」成左右對稱的整架飛機，每一片的紙密度算一半，
 *   總重量仍然等於一張 A4。這樣重心、升力中心天生左右對稱（x = 0）。
 *
 * 3D 座標：x = 翼展方向（右翼為 +x），y = 前後（機頭在 +y，和原紙一致），z = 上下（+z 向上）。
 */

export type Region = 'fuselage' | 'wing';

export interface AssemblyPiece {
  readonly faceId: FaceId;
  readonly region: Region;
  /** 正面（原紙朝上那面）朝外？只用來決定顏色。 */
  readonly frontUp: boolean;
  /** 這一片在空中的 3D 多邊形。 */
  readonly poly: readonly Vec3[];
  /** 這一片的紙面積（mm²，和攤平時相同）。 */
  readonly area: number;
  /** 這一片在空中的 3D 形心。 */
  readonly centroid: Vec3;
  /** 這一片是不是被「翼片翹起」掀起來的。 */
  readonly bent: boolean;
  /** 是不是鏡射出來的那一份（x 取負號）。 */
  readonly mirrored: boolean;
  /** 單位法向量，指向這一面在摺紙畫面中「朝上」（朝螢幕外）的那一側。 */
  readonly up: Vec3;
}

export interface Assembly {
  /** 左右對稱的整架飛機的所有紙片。 */
  readonly pieces: readonly AssemblyPiece[];
  /** 正規化後、位於 x ≥ 0 半邊的機翼摺線（給 UI 參考）。 */
  readonly wingLine: Line;
  /** 上反角（弧度）。 */
  readonly dihedral: number;
  /**
   * 機翼的「內建攻角」（弧度）：機翼翼弦在側視（前後向鉛直面）裡相對水平的傾角。
   * 摺線和中線平行時為 0；摺線傾斜時機翼會有內建攻角（風洞側視就看得到差別）。
   */
  readonly wingIncidence: number;
}

export type PaperclipSize = 'small' | 'large';

/** 迴紋針重量（公克）：小的約 0.5 g，大的約 1 g。 */
export const PAPERCLIP_MASS: Record<PaperclipSize, number> = { small: 0.5, large: 1 };

export interface Paperclip {
  readonly id: number;
  /** 掛在機身上的 3D 位置（x 一般為 0，在中線平面上）。 */
  readonly pos: Vec3;
  readonly size: PaperclipSize;
}

/** 面積小於這個值（mm²）的碎片略過，避免數值雜訊。 */
const MIN_PIECE = 1e-3;

/** 把摺好後的 2D 點嵌進「機身垂直」的基準 3D 位置：x→z（往外變高），y 不變，放在 X = 0 平面。 */
const embed = (p: Vec2): Vec3 => vec3(0, p.y, p.x);

/**
 * 一片可以翹起的翼片：從孩子點的那一面出發，沿一條摺線（轉軸）掀起來時會跟著一起動的所有紙。
 * 掛在它上面的小翼片（例如反摺上來的尖角）也算在裡面，會被一起帶起來。
 */
export interface FlapGroup {
  /** 點的那一面（決定了這片翼片）。 */
  readonly root: FaceId;
  /** 會跟著一起動的面（由小到大）。 */
  readonly faces: readonly FaceId[];
  /** 轉軸上的兩點（摺好後的 2D 座標）。 */
  readonly axis: readonly [Vec2, Vec2];
  /** 這片翼片的紙面積（mm²）。 */
  readonly area: number;
}

/** 比這還大的一塊（佔整張紙的比例）不算翼片，例如對摺後的整個半邊。 */
const MAX_FLAP_FRACTION = 0.2;
/** 判斷「摺痕在轉軸上」的距離容忍值（mm）。 */
const ON_AXIS = 1e-3;

interface HingeInfo {
  readonly hinge: Hinge;
  readonly seg: readonly [Vec2, Vec2];
  /** 攤平的摺痕（0°）：只是壓過的線，或鏡像摺順手多切的一刀。 */
  readonly flat: boolean;
}

/** 每一面接到的摺痕（含摺好後的位置）。撕裂（角度算不出來）的摺痕略過。 */
function hingeIndex(state: PaperState): Map<FaceId, HingeInfo[]> {
  const m = new Map<FaceId, HingeInfo[]>([...state.faces.keys()].map((id) => [id, []]));
  for (const h of state.hinges) {
    const angle = hingeAngle(state, h);
    if (angle === null) continue;
    const f = getFace(state, h.faces[0]);
    const info: HingeInfo = { hinge: h, seg: [apply(f.xf, h.cpSeg[0]), apply(f.xf, h.cpSeg[1])], flat: angle === 0 };
    for (const id of h.faces) m.get(id)?.push(info);
  }
  return m;
}

/** 這一面在原紙的左半還是右半（中線上算 0）。 */
const halfOf = (state: PaperState, id: FaceId): number => {
  const x = centroid(getFace(state, id).cp).x;
  return Math.abs(x) < 1e-6 ? 0 : Math.sign(x);
};

const flapCache = new WeakMap<PaperState, Map<FaceId, FlapGroup | null>>();

/**
 * 點了 id 這一面，要翹起的是哪一片翼片？自動找轉軸：
 * - 這一面邊上的每一條摺線都當作候選轉軸。
 * - 從這一面出發，不跨過那條轉軸線，能連到的紙全部一起動（掛在上面的小翼片也會被帶起來）。
 * - 這群紙和其他紙只靠這條轉軸線相連（兩個以上的支點都在同一條線上），才掀得起來而不會撕破。
 * - 太大塊的（例如整個半邊）不算；跨到原紙另一半的也不算（3D 裡左右兩半各往一邊展開，不能整片一起翹）。
 * 有好幾條轉軸都可以時，選會動的紙最少的那條——最像孩子想翹的那一片。
 * 優先用真正摺過的摺線當轉軸；都不行才考慮攤平的摺痕（例如孩子「留摺痕」壓的那條線）。都不行就回傳 null。
 */
export function flapFor(state: PaperState, id: FaceId): FlapGroup | null {
  let cache = flapCache.get(state);
  if (!cache) flapCache.set(state, (cache = new Map()));
  if (cache.has(id)) return cache.get(id)!;

  const index = hingeIndex(state);
  // 候選轉軸：和這一面「用攤平摺痕連成一整塊」的那些面上，真正摺過的摺線。
  // （點到被多切出來的小碎片時，才會找到整片尖角真正的摺線，而不是沿那條假摺痕把碎片自己掀起來。）
  const piece = new Set<FaceId>([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const h of index.get(stack.pop()!) ?? []) {
      if (!h.flat) continue;
      for (const o of h.hinge.faces) if (!piece.has(o)) (piece.add(o), stack.push(o));
    }
  }
  const folded = [...piece].flatMap((fid) => (index.get(fid) ?? []).filter((h) => !h.flat));
  const flat = (index.get(id) ?? []).filter((h) => h.flat);
  const best = bestFlap(state, id, index, folded) ?? bestFlap(state, id, index, flat);
  cache.set(id, best);
  return best;
}

/** 在這些候選轉軸裡，找出合法而且會動的紙最少的那一片。 */
function bestFlap(
  state: PaperState,
  id: FaceId,
  index: Map<FaceId, HingeInfo[]>,
  candidates: readonly HingeInfo[],
): FlapGroup | null {
  const limit = MAX_FLAP_FRACTION * state.sheet.width * state.sheet.height;
  const areaOf = (fid: FaceId) => area(getFace(state, fid).cp);
  const side = halfOf(state, id);
  let best: FlapGroup | null = null;

  const tried: Line[] = [];
  for (const cand of candidates) {
    const axisLine = lineThrough(cand.seg[0], cand.seg[1]);
    if (!axisLine) continue;
    const onAxis = (h: HingeInfo) => h.seg.every((p) => Math.abs(signedDist(axisLine, p)) < ON_AXIS);
    // 同一條直線上的摺痕只試一次
    if (tried.some((l) => cand.seg.every((p) => Math.abs(signedDist(l, p)) < ON_AXIS))) continue;
    tried.push(axisLine);

    // 從點的那一面出發，不跨過轉軸線，看能連到哪些紙
    const group = new Set<FaceId>([id]);
    const queue = [id];
    let total = areaOf(id);
    while (queue.length > 0 && total <= limit) {
      for (const h of index.get(queue.pop()!) ?? []) {
        if (onAxis(h)) continue;
        for (const other of h.hinge.faces) {
          if (group.has(other)) continue;
          group.add(other);
          queue.push(other);
          total += areaOf(other);
        }
      }
    }
    if (total > limit || (best && total >= best.area)) continue;
    if (side !== 0 && [...group].some((fid) => halfOf(state, fid) === -side)) continue;
    // 必須還連著別的紙（在轉軸上），不然是飄在空中的一片
    const attached = [...group].some((fid) =>
      (index.get(fid) ?? []).some((h) => onAxis(h) && h.hinge.faces.some((o) => !group.has(o))),
    );
    if (!attached) continue;
    best = {
      root: id,
      faces: [...group].sort((a, b) => a - b),
      axis: [axisLine.p, add2(axisLine.p, scale2(axisLine.d, 10))],
      area: total,
    };
  }
  return best;
}

/** 點了會翹起來的面（至少找得到一條可以當轉軸的摺線）。 */
export function bendableFaces(state: PaperState): FaceId[] {
  return [...state.faces.keys()].filter((id) => flapFor(state, id) !== null).sort((a, b) => a - b);
}

/**
 * 從摺好的狀態組裝 3D 飛機。
 * @param wingLine 機翼摺線（摺好後的 2D 座標，通常和中線平行）。
 * @param dihedral 上反角（弧度）。0 = 機翼水平，>0 = 翼尖往上翹。
 * @param bends 可選：要「翹起」的翼片與角度（弧度）。key 是孩子點的那一面，翼片由 flapFor 決定（會連同掛在上面的紙一起翹）。
 */
export function buildAssembly(
  state: PaperState,
  wingLine: Line,
  dihedral: number,
  bends?: ReadonlyMap<FaceId, number>,
): Assembly {
  // 把整疊紙正規化到 x ≥ 0 半邊（對摺結果本來就是如此，這裡保險處理另一側）。
  let sum = 0;
  for (const f of state.faces.values()) for (const p of foldedPolygon(f)) sum += p.x;
  const sx = sum >= 0 ? 1 : -1;
  const nx = (p: Vec2): Vec2 => vec(sx * p.x, p.y);

  // 正規化機翼摺線，並把方向調成朝機頭（d.y ≥ 0），讓展開方向固定。
  let d = vec(sx * wingLine.d.x, wingLine.d.y);
  if (d.y < 0 || (Math.abs(d.y) < 1e-9 && d.x < 0)) d = vec(-d.x, -d.y);
  const line: Line = { p: nx(wingLine.p), d };

  // 機身在中線（x = 0）那一側。用中線上的參考點判斷哪半是機身。
  const fuselageOnLeft = signedDist(line, vec(0, line.p.y)) >= 0;

  // 繞機翼摺線把機翼轉出平面：軸過 A、方向 u；轉 (90° − Γ) 讓機翼從朝上倒向 +x 並上翹 Γ。
  const axisPt = embed(line.p);
  const axis = normalize3(vec3(0, d.y, d.x));
  const theta = Math.PI / 2 - dihedral;
  const swing = (p: Vec3): Vec3 => add3(axisPt, rotateAxis(sub3(p, axisPt), axis, theta));

  // 機翼內建攻角：原紙上朝機頭的方向 (0,1) 嵌成 (0,1,0)，跟著機翼轉之後在側視 (y,z) 的傾角。
  const chordDir = rotateAxis(vec3(0, 1, 0), axis, theta);
  const wingIncidence = Math.atan2(chordDir.z, chordDir.y);

  // 要翹起的翼片：key 是孩子點的那一面，翼片是 flapFor 找出來的那一群。
  // 一面可能同時在好幾片裡（例如尖角又掛在整片翼片上）：先轉小的、再轉大的，大的會把小的一起帶走。
  const flaps: { group: FlapGroup; angle: number }[] = [];
  for (const [root, angle] of bends ?? []) {
    const group = angle ? flapFor(state, root) : null;
    if (group) flaps.push({ group, angle });
  }
  flaps.sort((a, b) => a.group.area - b.group.area);
  const pieces: AssemblyPiece[] = [];
  const emit = (faceId: FaceId, region: Region, frontUp: boolean, sub: readonly Vec2[]) => {
    const a = area(sub);
    if (a < MIN_PIECE) return;
    const place = region === 'wing' ? (p: Vec2) => swing(embed(p)) : embed;
    let poly3d = sub.map(place);
    let c = place(centroid(sub));
    // 摺紙畫面的「朝上」：embed 把 2D 的 x、y 送到 z、y，朝上 (x × y) 就落在 -x；
    // 正規化時若左右翻過（sx = -1），方向也跟著反過來。
    let up = vec3(-sx, 0, 0);
    if (region === 'wing') up = rotateAxis(up, axis, theta);

    // 翼片翹起：這一面所在的每一片翼片，依序繞各自的轉軸轉，讓自由端往上掀。
    let isBent = false;
    for (const { group, angle } of flaps) {
      if (!group.faces.includes(faceId)) continue;
      isBent = true;
      const aPt = place(nx(group.axis[0]));
      const bPt = place(nx(group.axis[1]));
      const ax = normalize3(sub3(bPt, aPt));
      // 選讓自由端往上(+z)的旋轉方向（同一片翼片的紙都在轉軸同一側，判斷結果一致）
      let ang = angle;
      if (add3(aPt, rotateAxis(sub3(c, aPt), ax, ang)).z < c.z) ang = -angle;
      const rot = (v: Vec3) => add3(aPt, rotateAxis(sub3(v, aPt), ax, ang));
      poly3d = poly3d.map(rot);
      c = rot(c);
      up = rotateAxis(up, ax, ang);
    }

    // 右半邊
    pieces.push({ faceId, region, frontUp, poly: poly3d, area: a, centroid: c, bent: isBent, mirrored: false, up });
    // 鏡射出左半邊（x 取負號）
    pieces.push({
      faceId,
      region,
      frontUp,
      poly: poly3d.map((q) => vec3(-q.x, q.y, q.z)),
      area: a,
      centroid: vec3(-c.x, c.y, c.z),
      bent: isBent,
      mirrored: true,
      up: vec3(-up.x, up.y, up.z),
    });
  };

  // 每一片要翹起的翼片，整片放進同一個基準框（機身或機翼），不被機翼摺線切成兩段。
  // 不然跨過摺線的翼片會一段立在機身、一段展在機翼，各繞各的軸轉而裂開。
  // 整片放哪一側：用面積加權看它主要落在機翼摺線的哪一邊。巢狀時外層（較大片）決定朝向。
  const flapRegionOf = new Map<FaceId, Region>();
  for (const { group } of flaps) {
    let signed = 0;
    for (const fid of group.faces) {
      const poly = foldedPolygon(getFace(state, fid)).map(nx);
      signed += area(poly) * signedDist(line, centroid(poly));
    }
    const region: Region = signed >= 0 === fuselageOnLeft ? 'fuselage' : 'wing';
    for (const fid of group.faces) flapRegionOf.set(fid, region);
  }

  for (const f of state.faces.values()) {
    const frontUp = det(f.xf) > 0;
    // 翹起的翼片：整片不切，放在上面算好的那個框裡。
    const whole = flapRegionOf.get(f.id);
    if (whole) {
      emit(f.id, whole, frontUp, foldedPolygon(f).map(nx));
      continue;
    }
    const poly = foldedPolygon(f).map(nx);
    const dists = poly.map((p) => signedDist(line, p));
    const split = splitByDistances(poly, dists);
    const [fusePoly, wingPoly] = fuselageOnLeft ? [split.left, split.right] : [split.right, split.left];
    if (fusePoly) emit(f.id, 'fuselage', frontUp, fusePoly);
    if (wingPoly) emit(f.id, 'wing', frontUp, wingPoly);
  }

  return { pieces, wingLine: line, dihedral, wingIncidence };
}

export interface MassProps3D {
  /** 公克 */
  readonly mass: number;
  /** 重心（3D，mm） */
  readonly cg: Vec3;
}

/**
 * 整架飛機的重量與重心。
 * 紙：每一片面積 × 面密度，形心取 3D 形心；因為是左右對稱的整組紙片，重心 x 自然為 0。
 * 面密度用「一半」：整組紙片其實是把對摺的一疊鏡射到兩邊，兩邊合起來才是一張 A4。
 * 迴紋針：點質量，加在它的位置。
 */
export function assemblyMass(assembly: Assembly, clips: readonly Paperclip[] = [], gsm = PAPER_GSM): MassProps3D {
  const density = gsm * 1e-6 * 0.5; // g/mm²，一半（見上）
  let m = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of assembly.pieces) {
    const w = p.area * density;
    m += w;
    mx += w * p.centroid.x;
    my += w * p.centroid.y;
    mz += w * p.centroid.z;
  }
  for (const c of clips) {
    const w = PAPERCLIP_MASS[c.size];
    m += w;
    mx += w * c.pos.x;
    my += w * c.pos.y;
    mz += w * c.pos.z;
  }
  return { mass: m, cg: vec3(mx / m, my / m, mz / m) };
}
