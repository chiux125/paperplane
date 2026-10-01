import { type PaperState, type Vec2, foldedBBox, vec } from '../../core';

/** 世界座標（mm，y 朝上）↔ 螢幕座標（CSS px，y 朝下）。 */
export interface View {
  readonly k: number; // 每 mm 幾個 px
  readonly ox: number;
  readonly oy: number;
}

export const toScreen = (v: View, p: Vec2): Vec2 => vec(v.ox + v.k * p.x, v.oy - v.k * p.y);
export const toWorld = (v: View, sx: number, sy: number): Vec2 => vec((sx - v.ox) / v.k, (v.oy - sy) / v.k);

/** 讓原紙範圍與目前摺好的紙都放得進畫布，並在上方留空間給「機頭」標示。 */
export function fitView(state: PaperState, cssW: number, cssH: number): View {
  const { width, height } = state.sheet;
  let minX = -width / 2;
  let maxX = width / 2;
  let minY = 0;
  let maxY = height;
  for (const f of state.faces.values()) {
    const b = foldedBBox(f);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  // 左右對稱，中線保持在畫面正中央
  const halfW = Math.max(-minX, maxX);
  const margin = 0.06 * height;
  const top = maxY + 2.5 * margin;
  const bottom = minY - margin;
  const k = Math.min(cssW / (2 * halfW + 2 * margin), cssH / (top - bottom));
  return { k, ox: cssW / 2, oy: (cssH - k * (top - bottom)) / 2 + k * top };
}
