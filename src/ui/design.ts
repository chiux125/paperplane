import { type Line, type PaperState, type Paperclip, foldedPolygon, vec } from '../core';

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
  /** 迴紋針。 */
  readonly clips: readonly Paperclip[];
}

export const DEFAULT_DESIGN: Design = { wingFrac: 0.45, tiltDeg: 0, dihedralDeg: 8, clips: [] };

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
