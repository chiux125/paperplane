import type { Vec3 } from '../geom/vec3';

/**
 * 靜態穩定度（示意）。
 *
 * 用「穩定裕度」判斷：重心（CG）應該落在升力中心（CP）的前面一點點。
 *   裕度 margin = (CG.y − CP.y) / 平均翼弦長
 * 機頭在 +y，所以 margin > 0 代表重心在升力中心前面（往機頭方向）。
 *
 * 門檻（以平均翼弦長正規化；可調，待使用者確認）：
 *   margin < 0.05            → 重心太後面，升力中心幾乎和重心重合或在它前面 → 容易仰頭失速。
 *   0.05 ≤ margin ≤ 0.30     → 穩穩的。
 *   margin > 0.30            → 重心太前面（機頭太重）→ 容易往下衝。
 *
 * 理由：真飛機的靜態裕度大約 5%～15% 翼弦；自由飛行的滑翔機／紙飛機可以更大一些，
 * 而且孩子加迴紋針時變化很大，所以把「穩」的範圍放寬到 5%～30%，讓結果直覺好懂。
 */

export const STABLE_MIN = 0.05;
export const STABLE_MAX = 0.3;

export type StabilityVerdict = 'pitch-up' | 'stable' | 'nose-dive';

export interface Stability {
  /** 穩定裕度（無單位，以平均翼弦長正規化）。 */
  readonly margin: number;
  /** 重心在升力中心前面多少 mm（>0 在前面）。 */
  readonly marginMm: number;
  readonly verdict: StabilityVerdict;
  readonly thresholds: { readonly min: number; readonly max: number };
}

export function stability(cg: Vec3, cp: Vec3, meanChord: number): Stability {
  const marginMm = cg.y - cp.y;
  const margin = meanChord > 1e-9 ? marginMm / meanChord : 0;
  const verdict: StabilityVerdict =
    margin < STABLE_MIN ? 'pitch-up' : margin > STABLE_MAX ? 'nose-dive' : 'stable';
  return { margin, marginMm, verdict, thresholds: { min: STABLE_MIN, max: STABLE_MAX } };
}

/** 「推一下」會怎樣：升力中心在重心後面（裕度 > 0）→ 自己回正；在前面（裕度 < 0）→ 越歪越多。 */
export type PushResult = 'returns' | 'diverges' | 'neutral';

export function pushTest(margin: number): PushResult {
  if (margin > 0.02) return 'returns';
  if (margin < -0.02) return 'diverges';
  return 'neutral';
}

/**
 * 被推歪 theta（弧度）後的恢復角加速度（示意用的簡單彈簧模型）。
 * 和 (−裕度 × theta) 成正比：裕度 > 0 時方向和 theta 相反 → 把飛機轉回去；裕度 < 0 → 越推越歪。
 */
export function pitchAccel(margin: number, theta: number, omega: number, spring = 40, damp = 2): number {
  return -spring * margin * theta - damp * omega;
}
