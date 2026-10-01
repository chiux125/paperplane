import { type Vec3, vec3 } from '../geom/vec3';
import type { Assembly } from './assembly';

/**
 * 升力中心（CP，近似）與機翼平面尺寸，用「25% 翼弦條帶法」：
 * - 取機翼在水平面（俯視，x–y）的投影輪廓；機身是垂直的，投影面積約 0，不算。
 * - 沿翼展方向（x）切成很多細條，每條找出被機翼蓋到的前後緣（y 的範圍，機頭在 +y）。
 * - 每條在「前緣往後 25% 翼弦」的位置代表它的升力作用點，再依翼弦長加權平均。
 * - 重疊的層只算一次：每條直接取所有機翼片的 y 範圍聯集。
 *
 * 這是示意用的近似，不是真正的氣動力計算。
 */

export interface Planform {
  /** 升力中心（3D，mm）。對稱時 x = 0。 */
  readonly cp: Vec3;
  /** 翼展（mm，左右翼尖的總寬）。 */
  readonly span: number;
  /** 機翼俯視投影面積（mm²，左右合計）。 */
  readonly area: number;
  /** 平均翼弦長（mm）= 投影面積 / 翼展。穩定裕度用它正規化。 */
  readonly meanChord: number;
}

const STRIPS = 240;

/** 凸多邊形在 x = xc 的垂直切片涵蓋的 y 範圍；沒切到回傳 null。 */
function sliceY(poly: readonly { x: number; y: number }[], xc: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  let hit = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const inRange = (a.x <= xc && b.x >= xc) || (b.x <= xc && a.x >= xc);
    if (!inRange) continue;
    if (a.x === b.x) {
      lo = Math.min(lo, a.y, b.y);
      hi = Math.max(hi, a.y, b.y);
    } else {
      const t = (xc - a.x) / (b.x - a.x);
      const y = a.y + t * (b.y - a.y);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    hit = true;
  }
  return hit ? [lo, hi] : null;
}

export function liftCenter(assembly: Assembly): Planform {
  const wings = assembly.pieces.filter((p) => p.region === 'wing');
  const empty: Planform = { cp: vec3(0, 0, 0), span: 0, area: 0, meanChord: 0 };
  if (wings.length === 0) return empty;

  let minX = Infinity;
  let maxX = -Infinity;
  let zSum = 0;
  let zW = 0;
  for (const w of wings) {
    for (const v of w.poly) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
    }
    zSum += w.centroid.z * w.area;
    zW += w.area;
  }
  if (maxX - minX < 1e-6) return empty;

  const dx = (maxX - minX) / STRIPS;
  let chordSum = 0; // Σ chord（加權分母）
  let yqSum = 0; //    Σ (25%弦位置 · chord)
  let xSum = 0; //     Σ (x · chord)
  let areaSum = 0; //  Σ chord · dx（投影面積）
  let coveredMin = Infinity;
  let coveredMax = -Infinity;

  for (let i = 0; i < STRIPS; i++) {
    const xc = minX + (i + 0.5) * dx;
    let lo = Infinity;
    let hi = -Infinity;
    for (const w of wings) {
      const s = sliceY(w.poly, xc);
      if (!s) continue;
      lo = Math.min(lo, s[0]);
      hi = Math.max(hi, s[1]);
    }
    const chord = hi - lo;
    if (!(chord > 1e-9)) continue;
    const quarter = hi - 0.25 * chord; // 前緣在 +y（機頭）側，往後 25%
    chordSum += chord;
    yqSum += quarter * chord;
    xSum += xc * chord;
    areaSum += chord * dx;
    coveredMin = Math.min(coveredMin, xc);
    coveredMax = Math.max(coveredMax, xc);
  }

  if (chordSum === 0) return empty;
  const span = coveredMax - coveredMin + dx;
  const cp = vec3(xSum / chordSum, yqSum / chordSum, zW > 0 ? zSum / zW : 0);
  return { cp, span, area: areaSum, meanChord: areaSum / span };
}
