import { apply, det } from '../geom/iso';
import { type Line, lineThrough, signedDist } from '../geom/line';
import { hingeAngle } from '../engine/angle';
import { area, centroid, splitByDistances } from '../geom/polygon';
import { type Vec2, vec } from '../geom/vec';
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

/** 一片可以翹起的翼片：可能由好幾個面組成（中間只隔著攤平的摺痕），繞同一條摺線轉。 */
export interface FlapGroup {
  /** 組成這片翼片的面（由小到大）。 */
  readonly faces: readonly FaceId[];
  /** 轉軸：翼片和其他紙相連的那條摺線（摺好後的 2D 座標）。 */
  readonly axis: readonly [Vec2, Vec2];
  /** 翼片的形心（摺好後的 2D 座標），用來決定往哪個方向翹是「往上」。 */
  readonly centroid: Vec2;
}

/** 比這還大的一塊（佔整張紙的比例）不算翼片，例如對摺後的整個半邊。 */
const MAX_FLAP_FRACTION = 0.2;

/**
 * 找出所有可以「翹起」的翼片，回傳「面 → 它所屬的翼片」。
 * - 攤平的摺痕（0°，例如「留摺痕」或鏡像摺順手多切的一刀）不算斷開：用它相連的面算同一片。
 * - 這一片和其他紙之間真正摺起來的摺痕，必須全部落在同一條直線上，才能整片繞那條線掀起來而不扯到別處。
 * - 太大塊的不算翼片。
 */
export function flapGroups(state: PaperState): Map<FaceId, FlapGroup> {
  const parent = new Map<FaceId, FaceId>([...state.faces.keys()].map((id) => [id, id]));
  const find = (x: FaceId): FaceId => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const angles = new Map<Hinge, number | null>();
  for (const h of state.hinges) {
    const a = hingeAngle(state, h);
    angles.set(h, a);
    if (a === 0) parent.set(find(h.faces[0]), find(h.faces[1]));
  }
  const members = new Map<FaceId, FaceId[]>();
  for (const id of state.faces.keys()) {
    const r = find(id);
    (members.get(r) ?? members.set(r, []).get(r)!).push(id);
  }

  const sheetArea = state.sheet.width * state.sheet.height;
  const out = new Map<FaceId, FlapGroup>();
  for (const [root, ids] of members) {
    let total = 0;
    let cx = 0;
    let cy = 0;
    for (const id of ids) {
      const f = getFace(state, id);
      const a = area(f.cp);
      const c = centroid(foldedPolygon(f));
      total += a;
      cx += a * c.x;
      cy += a * c.y;
    }
    if (total > MAX_FLAP_FRACTION * sheetArea) continue;

    // 對外的摺痕（另一面不在這一片裡）
    const external = state.hinges.filter((h) => (find(h.faces[0]) === root) !== (find(h.faces[1]) === root));
    if (external.length === 0 || external.some((h) => angles.get(h) === null)) continue;
    const segOf = (h: Hinge): [Vec2, Vec2] => {
      const f = getFace(state, h.faces[0]);
      return [apply(f.xf, h.cpSeg[0]), apply(f.xf, h.cpSeg[1])];
    };
    const axis = segOf(external[0]);
    const axisLine = lineThrough(axis[0], axis[1]);
    if (!axisLine) continue;
    const collinear = external.every((h) => segOf(h).every((p) => Math.abs(signedDist(axisLine, p)) < 1e-3));
    if (!collinear) continue;

    const group: FlapGroup = { faces: [...ids].sort((a, b) => a - b), axis, centroid: vec(cx / total, cy / total) };
    for (const id of ids) out.set(id, group);
  }
  return out;
}

/** 可以翹起的面（屬於某一片翼片的所有面）。 */
export function bendableFaces(state: PaperState): FaceId[] {
  return [...flapGroups(state).keys()].sort((a, b) => a - b);
}

/**
 * 從摺好的狀態組裝 3D 飛機。
 * @param wingLine 機翼摺線（摺好後的 2D 座標，通常和中線平行）。
 * @param dihedral 上反角（弧度）。0 = 機翼水平，>0 = 翼尖往上翹。
 * @param bends 可選：某些翼片要「翹起」的角度（弧度），key 是面 id。只有屬於某片翼片（flapGroups）的面會被翹起。
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

  const groups = bends && bends.size > 0 ? flapGroups(state) : null;
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

    // 翼片翹起：整片翼片繞它和其他紙相連的那條摺線轉 bend，讓自由端往上掀。
    const bend = bends?.get(faceId);
    const group = groups?.get(faceId);
    const isBent = !!bend && !!group;
    if (isBent && bend && group) {
      const aPt = place(nx(group.axis[0]));
      const bPt = place(nx(group.axis[1]));
      const ax = normalize3(sub3(bPt, aPt));
      // 選讓自由端往上(+z)的旋轉方向；整片用同一個判斷，翼片的每一塊才會一起往同一邊翹
      const gc = place(nx(group.centroid));
      let ang = bend;
      if (add3(aPt, rotateAxis(sub3(gc, aPt), ax, ang)).z < gc.z) ang = -bend;
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

  for (const f of state.faces.values()) {
    const poly = foldedPolygon(f).map(nx);
    const dists = poly.map((p) => signedDist(line, p));
    const split = splitByDistances(poly, dists);
    const [fusePoly, wingPoly] = fuselageOnLeft ? [split.left, split.right] : [split.right, split.left];
    const frontUp = det(f.xf) > 0;
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
