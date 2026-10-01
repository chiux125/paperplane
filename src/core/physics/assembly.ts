import { det } from '../geom/iso';
import { type Line, signedDist } from '../geom/line';
import { area, centroid, splitByDistances } from '../geom/polygon';
import { type Vec2, vec } from '../geom/vec';
import { type Vec3, add3, normalize3, rotateAxis, sub3, vec3 } from '../geom/vec3';
import { foldedPolygon } from '../model/face';
import type { FaceId, PaperState } from '../model/types';
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
}

export interface Assembly {
  /** 左右對稱的整架飛機的所有紙片。 */
  readonly pieces: readonly AssemblyPiece[];
  /** 正規化後、位於 x ≥ 0 半邊的機翼摺線（給 UI 參考）。 */
  readonly wingLine: Line;
  /** 上反角（弧度）。 */
  readonly dihedral: number;
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
 * 從摺好的狀態組裝 3D 飛機。
 * @param wingLine 機翼摺線（摺好後的 2D 座標，通常和中線平行）。
 * @param dihedral 上反角（弧度）。0 = 機翼水平，>0 = 翼尖往上翹。
 */
export function buildAssembly(state: PaperState, wingLine: Line, dihedral: number): Assembly {
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

  const pieces: AssemblyPiece[] = [];
  const emit = (faceId: FaceId, region: Region, frontUp: boolean, sub: readonly Vec2[]) => {
    const a = area(sub);
    if (a < MIN_PIECE) return;
    const place = region === 'wing' ? (p: Vec2) => swing(embed(p)) : embed;
    const poly3d = sub.map(place);
    const c = place(centroid(sub));
    // 右半邊
    pieces.push({ faceId, region, frontUp, poly: poly3d, area: a, centroid: c });
    // 鏡射出左半邊（x 取負號）
    pieces.push({
      faceId,
      region,
      frontUp,
      poly: poly3d.map((q) => vec3(-q.x, q.y, q.z)),
      area: a,
      centroid: vec3(-c.x, c.y, c.z),
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

  return { pieces, wingLine: line, dihedral };
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
