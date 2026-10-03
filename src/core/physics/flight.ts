import type { PredictedBehavior } from '../log/flightLog';
import type { MassProps3D } from './assembly';
import type { Planform } from './planform';
import type { Stability } from './stability';

/**
 * 階段 7a：側面（縱向）3 自由度飛行模擬（示意，不是真的氣動力）。
 *
 * 只模擬鉛直面裡的運動：往前、上下、俯仰。用簡單的平板升力／阻力 + 彈簧式俯仰，
 * 目的是把現有的穩定度判斷「演」出來，讓孩子先猜行為、射完再對答案（見 ROADMAP 階段 7）。
 *
 * 關鍵想法：給機翼一點點「反翹」的trim力矩 Cm0（紙飛機的後緣常常微微上翹），
 * 這樣光靠穩定裕度 margin 就能重現三種結果，和 stability.ts 的判斷一致：
 *   - 裕度小（重心偏後）→ trim攻角很大 → 一下就到失速 → 仰頭失速。
 *   - 裕度大（機頭太重）→ trim攻角很小 → 升力不夠 → 一直往下衝（栽頭）。
 *   - 裕度剛好 → 平穩滑翔。
 *   - 裕度 ≤ 0 → 俯仰發散 → 仰頭失速。
 * 翹起翼片的阻力（dragIndex）會讓飛機變慢、飛程變短，呼應階段 6 的實體實驗。
 *
 * 所有量都用 SI（公斤、公尺、秒）。距離只是示意，介面上不強調數字。
 */

const RHO = 1.2; // 空氣密度 kg/m³
const G = 9.81; // 重力加速度 m/s²

/** 機翼的「反翹」trim力矩係數：決定平穩滑翔時的攻角大小。
 * 調到讓裕度剛好（約 0.15）時 trim升力接近重量、不會一出手就暴衝爬升失速。 */
export const CM0 = 0.017;
/** 失速攻角（弧度，約 15°）。 */
export const ALPHA_STALL = (15 * Math.PI) / 180;
/** 寄生阻力係數（平板，粗估）。 */
const CD0 = 0.04;
/** 奧斯瓦德效率因子（誘導阻力用）。 */
const OSWALD = 0.9;
/** 翹起翼片阻力指標換成阻力係數的倍率。 */
const FLAP_DRAG_K = 0.5;
/** 俯仰阻尼（讓俯仰振盪會慢慢收斂；1/s 等級）。 */
const PITCH_DAMP = 1.3;
/** 俯仰轉動慣量 = 質量 ×（這個倍率 × 平均翼弦）²。示意用，調出合理的振盪週期。 */
const INERTIA_K = 1.4;
/** 失速後額外的阻力。 */
const STALL_DRAG = 0.6;

export interface FlightAero {
  /** 公斤。 */
  readonly massKg: number;
  /** 機翼俯視投影面積（m²，左右合計）。 */
  readonly areaM2: number;
  /** 平均翼弦（m）。 */
  readonly chordM: number;
  /** 展弦比。 */
  readonly aspect: number;
  /** 靜態穩定裕度（以平均翼弦正規化，可為負）。 */
  readonly margin: number;
  /** 機翼內建攻角（弧度）。 */
  readonly incidenceRad: number;
  /** 翹起翼片的阻力指標（0 = 沒翹）。 */
  readonly dragIndex: number;
}

export interface LaunchParams {
  /** 出手速度（m/s）。 */
  readonly speed: number;
  /** 出手時的航跡角（機頭上揚為 +，弧度）。 */
  readonly angleRad: number;
  /** 出手高度（m）。 */
  readonly heightM: number;
}

// 出手高度故意抓高一點（示意）：真的從手的高度射，飛太短還看不出趨勢就落地了；
// 抓高一點讓「滑翔／仰頭／栽頭」的差別看得清楚。距離本來就不強調。
export const DEFAULT_LAUNCH: LaunchParams = { speed: 6, angleRad: (6 * Math.PI) / 180, heightM: 2.5 };

export interface FlightSample {
  readonly t: number;
  /** 往前的水平距離（m）。 */
  readonly x: number;
  /** 高度（m）。 */
  readonly h: number;
  /** 機身俯仰姿態角（弧度，機頭上揚為 +）。 */
  readonly theta: number;
  /** 航跡角（弧度）。 */
  readonly gamma: number;
  /** 攻角（弧度）。 */
  readonly alpha: number;
  /** 速度大小（m/s）。 */
  readonly speed: number;
  readonly stalled: boolean;
}

export interface FlightPath {
  readonly samples: readonly FlightSample[];
  /** 模擬預測的行為（和穩定度判斷同一組三選一；波浪飛／轉彎是孩子實際觀察到的，不由這裡輸出）。 */
  readonly behavior: PredictedBehavior;
  /** 落地時的水平飛程（m）。示意。 */
  readonly rangeM: number;
  readonly durationS: number;
  /** 相對出手高度最多爬升了多少（m）。 */
  readonly maxClimbM: number;
  /** 有沒有失速過。 */
  readonly stalled: boolean;
}

/** 升力係數斜率（每弧度），低展弦比平板的粗估。 */
export function liftSlope(aspect: number): number {
  const ar = Math.max(0.5, aspect);
  return (2 * Math.PI * ar) / (ar + 2);
}

/** 升力係數（含失速後下降）。回傳 [CL, 是否失速]。 */
function liftCoeff(alpha: number, clSlope: number): [number, boolean] {
  if (Math.abs(alpha) <= ALPHA_STALL) return [clSlope * alpha, false];
  const peak = clSlope * ALPHA_STALL * Math.sign(alpha);
  // 失速後升力掉下來：超過失速角越多掉越多（最多掉到約一半）。
  const over = Math.min(1, (Math.abs(alpha) - ALPHA_STALL) / ALPHA_STALL);
  return [peak * (1 - 0.5 * over), true];
}

/** 由現有的重量／機翼平面／穩定度，組出飛行模擬需要的氣動參數。 */
export function flightAero(mass: MassProps3D, planform: Planform, stability: Stability): FlightAero {
  const areaM2 = Math.max(1e-6, planform.area) * 1e-6; // mm² → m²
  const chordM = Math.max(1e-3, planform.meanChord) * 1e-3;
  const aspect = planform.area > 0 ? (planform.span * planform.span) / planform.area : 1;
  return {
    massKg: mass.mass * 1e-3,
    areaM2,
    chordM,
    aspect: Math.max(0.5, aspect),
    margin: stability.margin,
    incidenceRad: 0, // 由呼叫端補（assembly.wingIncidence）；預設 0
    dragIndex: planform.dragIndex,
  };
}

/**
 * 跑一次縱向飛行模擬。用半隱式 Euler 小步積分，每隔幾步取樣一次。
 */
export function simulateFlight(aero: FlightAero, launch: LaunchParams = DEFAULT_LAUNCH): FlightPath {
  const { massKg: m, areaM2: S, chordM: c, aspect, margin, incidenceRad, dragIndex } = aero;
  const clSlope = liftSlope(aspect);
  const iyy = m * (INERTIA_K * c) ** 2;
  const kInduced = 1 / (Math.PI * Math.max(0.5, aspect) * OSWALD);

  const dt = 0.002;
  const maxT = 8;
  const sampleEvery = 10; // 每 0.02s 取一個樣

  let x = 0;
  let h = launch.heightM;
  let vx = launch.speed * Math.cos(launch.angleRad);
  let vh = launch.speed * Math.sin(launch.angleRad);
  let theta = launch.angleRad; // 出手時機身對齊速度方向
  let q = 0; // 俯仰角速度

  const samples: FlightSample[] = [];
  let everStalled = false;
  let maxClimb = 0;
  let t = 0;
  let step = 0;

  const push = (alpha: number, gamma: number, speed: number, stalled: boolean) => {
    samples.push({ t, x, h, theta, gamma, alpha, speed, stalled });
  };

  for (; t <= maxT; t += dt, step++) {
    const speed = Math.hypot(vx, vh);
    const gamma = speed > 1e-6 ? Math.atan2(vh, vx) : theta;
    const alpha = theta - gamma + incidenceRad;
    const [cl, stalled] = liftCoeff(alpha, clSlope);
    if (stalled) everStalled = true;
    maxClimb = Math.max(maxClimb, h - launch.heightM);

    if (step % sampleEvery === 0) push(alpha, gamma, speed, stalled);

    // 停止條件：落到地面（出手高度以下）、或飛太久／太遠。
    if (h <= 0 || x > 60) {
      push(alpha, gamma, speed, stalled);
      break;
    }

    const qdyn = 0.5 * RHO * speed * speed;
    const cd = CD0 + kInduced * cl * cl + FLAP_DRAG_K * dragIndex + (stalled ? STALL_DRAG : 0);
    const lift = qdyn * S * cl;
    const drag = qdyn * S * cd;

    // 速度方向的單位向量與其左法線（升力朝「飛行方向左轉 90°」＝水平前飛時朝上）。
    const ux = speed > 1e-6 ? vx / speed : Math.cos(theta);
    const uh = speed > 1e-6 ? vh / speed : Math.sin(theta);
    const ax = (lift * -uh + drag * -ux) / m;
    const ah = (lift * ux + drag * -uh) / m - G;

    // 俯仰：Cm = Cm0 − margin·CL（標準靜穩定關係）。margin>0 → 回正；<0 → 發散。
    const cm = CM0 - margin * cl;
    const qdot = (qdyn * S * c * cm) / iyy - PITCH_DAMP * q;

    // 半隱式 Euler
    vx += ax * dt;
    vh += ah * dt;
    x += vx * dt;
    h += vh * dt;
    q += qdot * dt;
    theta += q * dt;
  }

  const last = samples[samples.length - 1];
  return {
    samples,
    behavior: classifyFlight(samples, everStalled, launch),
    rangeM: last ? last.x : 0,
    durationS: last ? last.t : 0,
    maxClimbM: maxClimb,
    stalled: everStalled,
  };
}

/**
 * 從軌跡判斷模擬的行為類型（三選一，和穩定度判斷一致）。
 * 「波浪飛」「往一邊轉」是孩子實際射出後才觀察得到的，不由縱向模擬輸出。
 */
export function classifyFlight(
  samples: readonly FlightSample[],
  stalled: boolean,
  launch: LaunchParams,
): PredictedBehavior {
  if (samples.length < 3) return 'glide';
  const h0 = launch.heightM;
  let maxClimb = 0;
  for (const s of samples) maxClimb = Math.max(maxClimb, s.h - h0);

  // 明顯爬升後失速掉下來（或俯仰發散爬升）→ 仰頭失速。
  if (maxClimb > 0.25 && stalled) return 'pitch-up';

  // 栽頭看的是「安定下來後」的下降有多陡，不是出手那一下的瞬間抖動。
  // 取後 40% 樣本的平均航跡角當作穩定下降角。
  const start = Math.floor(samples.length * 0.6);
  let gSum = 0;
  let n = 0;
  for (let i = start; i < samples.length; i++) {
    gSum += samples[i].gamma;
    n++;
  }
  const steadyGamma = n > 0 ? gSum / n : 0;
  if (maxClimb < 0.1 && steadyGamma < -(40 * Math.PI) / 180) return 'nose-dive';
  // 其餘：平穩滑翔。
  return 'glide';
}
