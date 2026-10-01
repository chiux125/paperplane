import { type Vec3, vec3 } from '../geom/vec3';
import type { Assembly } from './assembly';
import { circulationMag } from './windtunnel';

/**
 * 階段 3（補強）：風洞「上面看」的翼尖渦流（示意，不是 CFD）。
 *
 * 升力造成的上下偏轉從正上方看不到，所以俯視中間大致是直的——這是對的。
 * 從上面真正看得到的是「翼尖渦流」：機翼下方壓力高、上方壓力低，空氣從翼尖繞上來，
 * 在兩個翼尖後方各拖出一條沿氣流方向旋轉的渦流。升力越大渦流越強；失速後升力塌陷，渦流變弱。
 *
 * 一切都在「以翼根弦長正規化」的座標系裡算（翼根弦 = 1、來流速度 = 1、沿 +u 從機頭往機尾）：
 *   u = 順流方向（機頭 = 0），v = 翼展方向，z = 上下（+z 在上）。
 * 渦流環量直接沿用側視圖的 circulationMag(有效攻角)，兩張圖的強度與失速自動一致。
 */

/** 渦心往內捲到 ±TIP_FRAC·翼半展 的位置。 */
const TIP_FRAC = 0.85;
/** 渦心半徑（翼根弦比例），用 Lamb–Oseen 核避免奇異點。 */
const TOP_CORE = 0.16;
/** 渦流強度相對來流的比例（角速度 ∝ 環量）。 */
const SWIRL_K = 1.2;
/** 渦流從翼弦這個位置開始形成（正規化 u），到翼尖後緣達到最強。 */
const RAMP_START = 0.25;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
function smoothstep(a: number, b: number, x: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 機翼俯視的描述，座標以翼根弦長正規化（機頭 u = 0）。 */
export interface TopWing {
  /** 翼半展 s（正規化）。 */
  readonly halfSpan: number;
  /** 翼尖後緣的順流位置（正規化）——渦流從這裡開始捲起。 */
  readonly tipU: number;
  /** 翼根弦長（mm），UI 用來把正規化座標換回實際長度。 */
  readonly rootChord: number;
}

/** 從立體飛機的機翼俯視投影（u = 離機頭的順流距離、v = 翼展）取出渦流幾何。 */
export function topWing(assembly: Assembly): TopWing {
  let yLE = -Infinity;
  for (const p of assembly.pieces) {
    if (p.region === 'wing') for (const v of p.poly) yLE = Math.max(yLE, v.y);
  }
  if (!Number.isFinite(yLE)) return { halfSpan: 0.3, tipU: 1, rootChord: 100 };

  let s = 0;
  let uMin = Infinity;
  let uMax = -Infinity;
  const pts: { u: number; v: number }[] = [];
  for (const p of assembly.pieces) {
    if (p.region !== 'wing') continue;
    for (const vtx of p.poly) {
      const u = yLE - vtx.y;
      const v = vtx.x;
      pts.push({ u, v });
      s = Math.max(s, Math.abs(v));
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
    }
  }
  if (s <= 0) return { halfSpan: 0.3, tipU: 1, rootChord: 100 };

  // 翼尖後緣：最外側一帶裡最下游的 u
  let tipU = -Infinity;
  for (const p of pts) if (Math.abs(p.v) >= 0.8 * s) tipU = Math.max(tipU, p.u);
  if (!Number.isFinite(tipU)) tipU = uMax;

  // 翼根弦：最內側一帶的 u 範圍；退而用整片機翼的 u 範圍
  let rMin = Infinity;
  let rMax = -Infinity;
  for (const p of pts) {
    if (Math.abs(p.v) <= 0.25 * s) {
      rMin = Math.min(rMin, p.u);
      rMax = Math.max(rMax, p.u);
    }
  }
  const rootChord = rMax > rMin ? rMax - rMin : uMax - uMin || 100;

  return { halfSpan: s / rootChord, tipU: tipU / rootChord, rootChord };
}

/** 單側翼尖渦流軸的翼展位置（正規化，+側；另一側取負）。 */
export const tipVortexAxisV = (w: TopWing): number => TIP_FRAC * w.halfSpan;

/** 渦流強度（直接沿用側視的升力環量，已含失速塌陷）。 */
export const tipVortexStrength = (alpha: number): number => circulationMag(alpha);

/**
 * 正規化座標系裡，p =（u, v, z）處的平均流速（u, v, z 三個分量）。
 * 來流為 (1, 0, 0)；兩個翼尖渦流在 (v = ±TIP_FRAC·s, z = 0) 沿 +u 延伸，隨 u 捲起。
 */
export function topFlowAt(w: TopWing, alpha: number, p: Vec3): Vec3 {
  const gamma0 = SWIRL_K * circulationMag(alpha);
  let dv = 0;
  let dz = 0;
  if (gamma0 !== 0) {
    const ramp = smoothstep(RAMP_START, Math.max(w.tipU, RAMP_START + 0.2), p.x);
    const axisV = TIP_FRAC * w.halfSpan;
    for (const sigma of [1, -1] as const) {
      const rv = p.y - sigma * axisV;
      const rz = p.z;
      const r2 = rv * rv + rz * rz;
      if (r2 < 1e-9) continue;
      const core = 1 - Math.exp(-r2 / (TOP_CORE * TOP_CORE));
      // 右翼尖（sigma +1）渦流：機翼上方往內（−v）；左翼尖相反。
      const k = (sigma * gamma0) / (2 * Math.PI) * (core / r2) * ramp;
      dv += -rz * k;
      dz += rv * k;
    }
  }
  return vec3(1, dv, dz);
}
