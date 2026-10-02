import { centroid } from '../geom/polygon';
import { type Vec3, add3, scale3, vec3 } from '../geom/vec3';
import { getFace } from '../model/face';
import { layerDepths } from '../model/orders';
import type { FaceId, PaperState } from '../model/types';
import type { Assembly, Region } from './assembly';

/** 顯示用的紙張厚度（mm），和真實影印紙差不多。 */
export const PAPER_THICKNESS = 0.15;

/** 3D 預覽要畫的一片紙：已經放到真實飛機上它該在的那一側，並依層序錯開。 */
export interface DisplayPiece {
  readonly faceId: FaceId;
  readonly region: Region;
  readonly poly: readonly Vec3[];
  /** 錯開之前的位置（判斷哪些邊是同一條時用）。 */
  readonly base: readonly Vec3[];
  /** 這一片在摺紙畫面中「朝上」那一側的單位法向量。 */
  readonly up: Vec3;
  /** 「朝上」那一側是紙的正面？（決定兩面各塗什麼顏色） */
  readonly frontUp: boolean;
}

/**
 * 只給 3D 預覽用的擺放方式，不影響任何計算（重心、升力仍然用 Assembly）。
 *
 * Assembly 為了讓重量左右對稱，把整疊紙鏡射到兩邊、每份算一半密度，所以同一個位置會疊著兩份一模一樣的紙，
 * 而且同一疊裡的每一層都在同一個平面上（厚度為 0），畫出來會互相穿透、底層的摺痕也會露出來。
 *
 * 這裡改成真實紙飛機的樣子：
 * - 對摺後疊在下面的那半張紙放在右邊（Assembly 未鏡射那份），疊在上面的那半張放在左邊。
 *   嵌進 3D 時摺紙畫面的「朝上」是 -x，所以下面那半本來就落在 +x、上面那半落在 -x，機身不用鏡射；
 *   左邊機翼則取鏡射那份（繞同一條軸往反方向轉，結果剛好等於鏡射），但它的「朝上」要反過來。
 * - 每一片依局部層序沿法線錯開一張紙的厚度：兩半之間的那幾層最靠近中線，往外一層層疊出去。
 *   這樣外層會遮住內層，從哪個角度看都只看得到最外面那一層。
 */
export function displayPieces(state: PaperState, assembly: Assembly, thickness = PAPER_THICKNESS): DisplayPiece[] {
  const depth = layerDepths(state);
  const halfOf = (id: FaceId): 1 | -1 => (centroid(getFace(state, id).cp).x >= 0 ? 1 : -1);

  // 哪一半疊在下面：平均層數比較低的那半。
  const sum = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  const count = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  for (const [id, d] of depth) {
    sum[halfOf(id)] += d;
    count[halfOf(id)] += 1;
  }
  const avg = (h: 1 | -1) => (count[h] ? sum[h] / count[h] : Infinity);
  const bottomHalf: 1 | -1 = avg(1) <= avg(-1) ? 1 : -1;

  // 下半：最上面那層貼著中線；上半：最下面那層貼著中線。
  let maxBottom = 0;
  let minTop = Infinity;
  for (const [id, d] of depth) {
    if (halfOf(id) === bottomHalf) maxBottom = Math.max(maxBottom, d);
    else minTop = Math.min(minTop, d);
  }
  if (!Number.isFinite(minTop)) minTop = 0;

  const out: DisplayPiece[] = [];
  for (const p of assembly.pieces) {
    const isBottom = halfOf(p.faceId) === bottomHalf;
    let up: Vec3;
    if (p.region === 'fuselage') {
      if (p.mirrored) continue;
      up = p.up;
    } else {
      if (p.mirrored === isBottom) continue; // 下半用右翼（未鏡射），上半用左翼（鏡射）
      up = isBottom ? p.up : vec3(-p.up.x, -p.up.y, -p.up.z);
    }
    const d = depth.get(p.faceId) ?? 0;
    // 「朝上」方向的位移：下半往「朝下」方向疊出去，上半往「朝上」方向疊出去。
    const k = isBottom ? -(maxBottom - d + 0.5) : d - minTop + 0.5;
    const off = scale3(up, k * thickness);
    out.push({
      faceId: p.faceId,
      region: p.region,
      poly: p.poly.map((v) => add3(v, off)),
      base: p.poly,
      up,
      frontUp: p.frontUp,
    });
  }
  return out;
}
