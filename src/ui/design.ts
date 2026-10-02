import {
  type FaceId,
  type FlapBend,
  type Line,
  type PaperState,
  type Paperclip,
  bendableFaces,
  foldedPolygon,
  resolveFlapBends,
  vec,
} from '../core';

/**
 * 「飛機設計」——由「看飛機」設定、「風洞」共用的同一份參數。
 * 用相對值（wingFrac、角度）而不是絕對座標，換新紙也不用重算。
 */
export interface Design {
  /** 機翼摺線離中線的距離，佔半邊寬的比例（0~1）。 */
  readonly wingFrac: number;
  /** 機翼摺線的傾斜角（度）：0 = 平行機腹；正／負 = 往兩邊斜，會給機翼內建攻角。 */
  readonly tiltDeg: number;
  /** 上反角（度）。 */
  readonly dihedralDeg: number;
  /** 孩子在 3D 裡點選要翹起的翼片（每片各自的角度，左右對稱的那片會一起翹）。 */
  readonly flaps?: readonly FlapBend[];
  /**
   * 舊版：把所有「單鉸鏈的小翼片」用同一個角度（度）一起掀起來。
   * 只為了讓舊的存檔和實測紀錄還能打開；新的操作一律用 flaps，並把這裡設成 0。
   */
  readonly flapBendDeg: number;
  /** 迴紋針。 */
  readonly clips: readonly Paperclip[];
}

export const DEFAULT_DESIGN: Design = { wingFrac: 0.45, tiltDeg: 0, dihedralDeg: 8, flaps: [], flapBendDeg: 0, clips: [] };

/** 由設計算出要翹起哪些翼片、翹幾度（弧度）。 */
export function bendsOf(state: PaperState, design: Design): Map<FaceId, number> {
  if (design.flaps && design.flaps.length > 0) return resolveFlapBends(state, design.flaps);
  const rad = ((design.flapBendDeg || 0) * Math.PI) / 180;
  const m = new Map<FaceId, number>();
  if (rad !== 0) for (const id of bendableFaces(state)) m.set(id, rad);
  return m;
}

/** 翼片相關的設定有沒有改變（給 useMemo 當相依值）。 */
export const flapKey = (design: Design): string =>
  `${design.flapBendDeg}|${(design.flaps ?? []).map((f) => `${f.at.x},${f.at.y},${f.deg}`).join(';')}`;

export interface PlaneMetrics {
  /** 半邊寬（中線到最外側，mm）。 */
  readonly halfSpan: number;
  /** 機頭位置（最大 y，mm）。 */
  readonly noseY: number;
}

export function planeMetrics(state: PaperState): PlaneMetrics {
  let maxX = 1;
  let maxY = 1;
  for (const f of state.faces.values()) {
    for (const p of foldedPolygon(f)) {
      maxX = Math.max(maxX, Math.abs(p.x));
      maxY = Math.max(maxY, p.y);
    }
  }
  return { halfSpan: maxX, noseY: maxY };
}

const deg2rad = (d: number) => (d * Math.PI) / 180;

/** 由設計算出機翼摺線（摺好後的 2D 座標）。 */
export function wingLineOf(design: Design, halfSpan: number): Line {
  const t = deg2rad(design.tiltDeg);
  return { p: vec(design.wingFrac * halfSpan, 0), d: vec(Math.sin(t), Math.cos(t)) };
}
