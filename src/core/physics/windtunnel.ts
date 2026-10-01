import { type Vec2, add, dot, scale, sub, vec } from '../geom/vec';
import type { Assembly } from './assembly';

/**
 * 階段 3：側面 2D 風洞的「簡化流場」（示意，不是真的流體模擬）。
 *
 * 一切都在一個標準座標系裡算（翼弦長 = 1、來流速度 = 1、沿 +x 從左往右吹）：
 * - 機翼當成一片薄平板，依攻角 α 傾斜（α > 0 = 機頭抬起，平板前緣較高）。
 * - 升力用「1/4 翼弦處的一個渦漩」表示：前方上洗、後方下洗、上面流得比下面快，
 *   環量大小 ∝ sin α（薄翼理論），渦心用 Lamb–Oseen 核去除奇異點。
 * - 失速（α 超過門檻）：環量塌掉（升力變小），機翼上面從「分離點」開始氣流剝離，
 *   分離點隨攻角加深往前緣移動；剝離區（尾流）速度很慢，UI 會在這裡加亂流。
 *
 * 核心只給「平均流場」與失速判斷（純函式、可測試）；會隨時間變動的亂流由 UI 疊上去。
 */

/** 失速攻角（度）。平板機翼很早就失速，這裡取 15°，可調。 */
export const STALL_ANGLE_DEG = 15;
/** 失速後環量塌陷與分離點前移的過渡區間（度）。 */
const STALL_SOFT_DEG = 8;
/** 渦心半徑（翼弦比例），避免靠近渦心時速度爆掉。 */
const VORTEX_CORE = 0.12;
/** 剝離尾流裡的殘餘順流速度（來流的比例）。 */
const WAKE_SPEED = 0.15;
/** 尾流厚度：起始厚度與往下游增厚的斜率。 */
const WAKE_THICK0 = 0.1;
const WAKE_SLOPE = 0.45;
/** 失速後環量塌到的比例。 */
const STALL_RESIDUAL = 0.35;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export const STALL_ANGLE = (STALL_ANGLE_DEG * Math.PI) / 180;

export const isStalled = (alpha: number): boolean => alpha > STALL_ANGLE;

/** 失速後環量塌陷係數：1（未失速）→ STALL_RESIDUAL（深度失速）。 */
function stallFactor(alpha: number): number {
  const soft = (STALL_SOFT_DEG * Math.PI) / 180;
  const t = smoothstep(STALL_ANGLE, STALL_ANGLE + soft, alpha);
  return 1 - (1 - STALL_RESIDUAL) * t;
}

/**
 * 升力環量大小（薄翼理論 ∝ sin α），失速後乘上塌陷係數。
 * 回傳正值；方向（讓升力朝上）在 vortexInduced 裡用負號處理。
 */
export function circulationMag(alpha: number): number {
  return Math.PI * Math.sin(alpha) * stallFactor(alpha);
}

/** 平板（機翼）前後緣：中心在原點、翼弦長 1、依攻角傾斜。 */
export function plate(alpha: number): { le: Vec2; te: Vec2; dir: Vec2; nUp: Vec2 } {
  const dir = vec(Math.cos(alpha), -Math.sin(alpha)); // 前緣→後緣（往下游 +x、α>0 時往下）
  const le = scale(dir, -0.5);
  const te = scale(dir, 0.5);
  const nUp = vec(Math.sin(alpha), Math.cos(alpha)); // 平板法線，指向上方（+y）
  return { le, te, dir, nUp };
}

const quarterChord = (alpha: number): Vec2 => {
  const { le, dir } = plate(alpha);
  return add(le, scale(dir, 0.25));
};

/** 2D 位渦在 p 處造成的誘導速度（含 Lamb–Oseen 渦心）。 */
function vortexInduced(gamma: number, center: Vec2, p: Vec2): Vec2 {
  const d = sub(p, center);
  const r2 = d.x * d.x + d.y * d.y;
  if (r2 < 1e-12) return vec(0, 0);
  const core = 1 - Math.exp(-r2 / (VORTEX_CORE * VORTEX_CORE));
  const k = (gamma / (2 * Math.PI)) * (core / r2);
  return vec(-d.y * k, d.x * k);
}

/** p 落在「分離尾流」裡嗎？（失速、在機翼上面、分離點下游、尾流厚度內） */
export function inWake(alpha: number, p: Vec2): boolean {
  if (!isStalled(alpha)) return false;
  const { le, dir, nUp } = plate(alpha);
  const rel = sub(p, le);
  const along = dot(rel, dir); // 沿翼弦（前緣 = 0、後緣 = 1）
  const above = dot(rel, nUp); // 平板上方為正
  if (above <= 0) return false;
  const sep = separationAlong(alpha);
  if (along < sep || along > 2.5) return false;
  const thick = WAKE_THICK0 + WAKE_SLOPE * (along - sep);
  return above < thick;
}

/** 分離點沿翼弦的位置（前緣 0、後緣 1）；未失速時在後緣（1），失速越深越靠前緣。 */
export function separationAlong(alpha: number): number {
  if (!isStalled(alpha)) return 1;
  const soft = (STALL_SOFT_DEG * Math.PI) / 180;
  const t = smoothstep(STALL_ANGLE, STALL_ANGLE + soft, alpha);
  return clamp(1 - 0.9 * t, 0.1, 1);
}

/** 標準座標系（翼弦 1、來流 1、沿 +x）裡，p 點的平均流速。 */
export function flowAt(alpha: number, p: Vec2): Vec2 {
  const gamma = -circulationMag(alpha); // 負號：讓升力朝上（後方下洗）
  let v = add(vec(1, 0), vortexInduced(gamma, quarterChord(alpha), p));
  if (inWake(alpha, p)) v = vec(WAKE_SPEED, v.y * 0.3);
  return v;
}

/**
 * 從立體飛機的側面投影取機翼翼弦長（前後向長度，mm）與參考高度，給 UI 畫圖與縮放用。
 * 側面看：沿機頭方向 y 的範圍就是翼弦；機頭在 +y。
 */
export function wingChord(assembly: Assembly): number {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const piece of assembly.pieces) {
    if (piece.region !== 'wing') continue;
    for (const v of piece.poly) {
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
    }
  }
  return Number.isFinite(yMax) && yMax > yMin ? yMax - yMin : 0;
}
