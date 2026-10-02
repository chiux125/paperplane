import { type Vec2, add, scale, sub, vec } from '../geom/vec';
import { type Vec3, cross3, length3, sub3 } from '../geom/vec3';
import type { Assembly, AssemblyPiece } from './assembly';

/**
 * 階段 6（補強）：翹起的翼片對風洞煙線的影響（示意，不是 CFD）。
 *
 * 孩子的實體實驗：翼片翹起 → 飛得明顯比較慢、機頭有時會自己抬起。所以這裡做兩件事：
 * - 阻力：翹起的紙片後面拖著一段慢速、亂流的尾流，翹得越高、越大片，尾流越強越寬。
 * - 前翼升力：翹起的紙片像一片小機翼，底面迎風產生向上的力（一個小渦漩：前方的空氣被往上帶）。
 * 強度和「看飛機」的計算（planform 的前翼升力 ∝ 面積·sinτ·cosτ、阻力 ∝ 面積·sin²τ）用同一套比例，兩邊結論一致。
 * 沒有翹起任何翼片時，這裡完全不影響煙線。
 * 「延後失速」沒有做：孩子的實驗沒有看到這個效果，不放進畫面裡。
 */

/** 前翼渦漩強度比例。 */
const FLAP_GAMMA = 2.2;
/** 尾流長度（側視，翼弦比例）。 */
const SIDE_WAKE_LEN = 1.2;
/** 尾流往下游變厚的斜率（側視）。 */
const SIDE_WAKE_GROW = 0.35;
/** 尾流長度（俯視，翼根弦比例）。 */
const TOP_WAKE_LEN = 1.4;
/** 尾流往下游變寬的比例（俯視）。 */
const TOP_WAKE_GROW = 0.6;
/** 尾流裡速度最多慢到剩多少。 */
const WAKE_SLOWDOWN = 0.75;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 一片翹起的紙片在側視裡的樣子：一小段傾斜的板（根部 → 自由端）。 */
export interface SideFlap {
  readonly base: Vec2;
  readonly tip: Vec2;
  /** 前翼升力的相對大小（∝ 面積比 × sinτ·cosτ）。 */
  readonly lift: number;
  /** 阻力的相對大小（∝ 面積比 × sin²τ），決定尾流有多強。 */
  readonly drag: number;
}

/** 一片翹起的紙片在俯視裡拖出的尾流帶。 */
export interface TopFlapWake {
  /** 尾流起點（紙片最下游那一邊）的順流位置。 */
  readonly u0: number;
  /** 尾流中心的翼展位置。 */
  readonly vC: number;
  /** 起點處的半寬。 */
  readonly halfW: number;
  /** 0~1。 */
  readonly strength: number;
}

function tiltOf(p: AssemblyPiece): number {
  // 片面法向量（Newell）離垂直有多遠：0 = 水平平躺、π/2 = 豎直
  let n: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < p.poly.length; i++) {
    const a = p.poly[i];
    const b = p.poly[(i + 1) % p.poly.length];
    const c = cross3(sub3(a, p.centroid), sub3(b, p.centroid));
    n = { x: n.x + c.x, y: n.y + c.y, z: n.z + c.z };
  }
  const l = length3(n);
  return l === 0 ? 0 : Math.acos(Math.min(1, Math.abs(n.z) / l));
}

/** 單邊機翼（不含翹起的紙片）的面積，當作翼片大小的比較基準。 */
function wingArea(assembly: Assembly): number {
  let a = 0;
  for (const p of assembly.pieces) if (p.region === 'wing' && !p.mirrored && !p.bent) a += p.area;
  return a || 1;
}

/** 由阻力大小換算尾流強度（只要有翹起，尾流就看得到）。 */
const wakeStrength = (drag: number) => clamp01(0.35 + 4 * drag);

/**
 * 側視：翹起的紙片。座標是「還沒依攻角旋轉」的正規化側視座標：
 *   x = 往下游（機頭 → 機尾），y = 往上，原點在機翼側影的中心 center（世界的 y、z），單位是翼弦 chord。
 * 左右兩邊的紙片在側視裡重疊，只取一邊。
 */
export function sideFlaps(assembly: Assembly, center: Vec2, chord: number): SideFlap[] {
  const base = wingArea(assembly);
  const ch = chord || 1;
  const out: SideFlap[] = [];
  for (const p of assembly.pieces) {
    if (!p.bent || p.mirrored) continue;
    const pts = p.poly.map((v) => vec((center.x - v.y) / ch, (v.z - center.y) / ch));
    let lo = pts[0];
    let hi = pts[0];
    for (const q of pts) {
      if (q.y < lo.y) lo = q;
      if (q.y > hi.y) hi = q;
    }
    if (hi.y - lo.y < 1e-6) continue;
    const t = tiltOf(p);
    const share = p.area / base;
    out.push({ base: lo, tip: hi, lift: share * Math.sin(t) * Math.cos(t), drag: share * Math.sin(t) ** 2 });
  }
  return out;
}

/** 把側視翼片轉到風洞的標準座標系（和機翼一起依攻角旋轉；aM = 攻角 − 機翼內建攻角）。 */
export function rotateSideFlaps(flaps: readonly SideFlap[], aM: number): SideFlap[] {
  const c = Math.cos(aM);
  const s = Math.sin(aM);
  const rot = (p: Vec2) => vec(c * p.x + s * p.y, -s * p.x + c * p.y);
  return flaps.map((f) => ({ ...f, base: rot(f.base), tip: rot(f.tip) }));
}

/** Lamb–Oseen 渦漩在 p 處的誘導速度（gamma < 0 時產生向上的升力）。 */
function vortex(gamma: number, center: Vec2, core: number, p: Vec2): Vec2 {
  const d = sub(p, center);
  const r2 = d.x * d.x + d.y * d.y;
  if (r2 < 1e-12) return vec(0, 0);
  const k = (gamma / (2 * Math.PI)) * ((1 - Math.exp(-r2 / (core * core))) / r2);
  return vec(-d.y * k, d.x * k);
}

/**
 * 在原本的流速 v 上，加上翹起翼片的影響（標準座標系：翼弦 1、來流沿 +x）。
 * 回傳新的流速，以及這一點在翼片尾流裡的強度（0 = 不在尾流裡，UI 用來加亂流、上顏色）。
 */
export function flapFlowAt(flaps: readonly SideFlap[], v: Vec2, p: Vec2): { v: Vec2; wake: number } {
  let out = v;
  let wake = 0;
  for (const f of flaps) {
    const len = Math.hypot(f.tip.x - f.base.x, f.tip.y - f.base.y);
    // 前翼升力：渦漩放在板子中間（負號 = 升力朝上，和主翼一致）
    const mid = scale(add(f.base, f.tip), 0.5);
    out = add(out, vortex(-FLAP_GAMMA * f.lift, mid, Math.max(0.05, len / 2), p));
    // 尾流：從板子最下游那一側開始往後拖，高度在板子根部和自由端之間，往下游慢慢變厚
    const x0 = Math.max(f.base.x, f.tip.x);
    const dx = p.x - x0;
    if (dx < 0 || dx > SIDE_WAKE_LEN) continue;
    const yLow = Math.min(f.base.y, f.tip.y) - 0.02;
    const yHigh = Math.max(f.base.y, f.tip.y) + SIDE_WAKE_GROW * dx;
    if (p.y < yLow || p.y > yHigh) continue;
    wake = Math.max(wake, wakeStrength(f.drag) * (1 - dx / SIDE_WAKE_LEN));
  }
  if (wake > 0) out = scale(out, 1 - WAKE_SLOWDOWN * wake);
  return { v: out, wake };
}

/**
 * 俯視：每片翹起的紙片拖出的尾流帶。座標和 topflow 一樣：
 *   u = 離機頭的順流距離、v = 翼展，都以翼根弦長 rootChord 正規化；機頭是機翼最前緣。
 */
export function topFlapWakes(assembly: Assembly, rootChord: number): TopFlapWake[] {
  let yLE = -Infinity;
  for (const p of assembly.pieces) if (p.region === 'wing') for (const v of p.poly) yLE = Math.max(yLE, v.y);
  if (!Number.isFinite(yLE)) return [];
  const rc = rootChord || 1;
  const base = wingArea(assembly);
  const out: TopFlapWake[] = [];
  for (const p of assembly.pieces) {
    if (!p.bent) continue;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const q of p.poly) {
      uMax = Math.max(uMax, (yLE - q.y) / rc);
      vMin = Math.min(vMin, q.x / rc);
      vMax = Math.max(vMax, q.x / rc);
    }
    const drag = (p.area / base) * Math.sin(tiltOf(p)) ** 2;
    out.push({ u0: uMax, vC: (vMin + vMax) / 2, halfW: Math.max(0.02, (vMax - vMin) / 2), strength: wakeStrength(drag) });
  }
  return out;
}

/** 俯視這一點在翼片尾流裡的強度（0~1）。 */
export function topFlapWakeAt(wakes: readonly TopFlapWake[], u: number, v: number): number {
  let s = 0;
  for (const w of wakes) {
    const du = u - w.u0;
    if (du < 0 || du > TOP_WAKE_LEN) continue;
    const half = w.halfW * (1 + TOP_WAKE_GROW * du) + 0.03;
    if (Math.abs(v - w.vC) > half) continue;
    s = Math.max(s, w.strength * (1 - du / TOP_WAKE_LEN));
  }
  return s;
}

/** 尾流裡速度要乘的係數（給 UI 的俯視煙線用）。 */
export const wakeSpeedFactor = (strength: number): number => 1 - WAKE_SLOWDOWN * strength;
