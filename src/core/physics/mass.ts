import { area, centroid } from '../geom/polygon';
import { type Vec2, vec } from '../geom/vec';
import { foldedPolygon } from '../model/face';
import type { PaperState } from '../model/types';

/** 一般影印紙 80 g/m²。 */
export const PAPER_GSM = 80;

export interface MassProps {
  /** 公克 */
  readonly mass: number;
  /** 重心（摺好後的俯視座標，mm） */
  readonly cg: Vec2;
}

/**
 * 紙的重量與重心。紙的密度均勻、不計厚度：
 * 每一面的重量 ∝ 面積，重疊的地方每一層各算一次，所以層數會自然加進去，和層序無關。
 */
export function paperMass(state: PaperState, gsm = PAPER_GSM): MassProps {
  let total = 0;
  let mx = 0;
  let my = 0;
  for (const f of state.faces.values()) {
    const a = area(f.cp);
    const c = centroid(foldedPolygon(f));
    total += a;
    mx += a * c.x;
    my += a * c.y;
  }
  return { mass: total * 1e-6 * gsm, cg: vec(mx / total, my / total) };
}
