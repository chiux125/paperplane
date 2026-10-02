import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type Assembly,
  type PaperState,
  type SideFlap,
  type TopFlapWake,
  type Vec2,
  STALL_ANGLE_DEG,
  assemblyMass,
  buildAssembly,
  circulationMag,
  flapFlowAt,
  flowAt,
  inWake,
  rotateSideFlaps,
  sideFlaps,
  topFlapWakeAt,
  topFlapWakes,
  wakeSpeedFactor,
  isStalled,
  liftCenter,
  pitchAccel,
  plate,
  stability,
  tipVortexAxisV,
  topFlowAt,
  topWing,
  vec,
  vec3,
  wingChord,
} from '../../core';
import { type Design, bendsOf, flapKey, planeMetrics, wingLineOf } from '../design';

const PLATE_FRAC = 0.3;
const STEP = 0.03;
const STEP_TOP = 0.014; // 俯視粒子每幀前進（正規化翼根弦）
const SOURCES = 13;
const PER_SOURCE = 18;
const deg2rad = (d: number) => (d * Math.PI) / 180;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  y0: number;
}

/** 從立體飛機算出畫風洞要用的幾何（都隨設計改變）。 */
interface Geom {
  incidence: number; // 機翼內建攻角（弧度）
  /** 側面投影（世界座標：x=前後 y、y=上下 z）：真正的飛機側影，隨機翼位置／斜度／上反角改變。 */
  side: {
    chord: number; // 機翼翼弦（前後長，mm）
    center: Vec2; // 機翼形心（y, z）
    wings: Vec2[][];
    fuse: Vec2[][];
    cg: Vec2; // 重心（y, z）
    cp: Vec2; // 升力中心（y, z）
  };
  /** 俯視投影（u=離機頭的順流距離, v=翼展）。 */
  top: { chord: number; halfSpan: number; wings: Vec2[][]; fuse: Vec2[][] };
  /** 翹起的翼片：側視的小傾斜板（未依攻角旋轉）、俯視的尾流帶。沒翹就是空的。 */
  flaps: { side: SideFlap[]; top: TopFlapWake[] };
}

function buildGeom(assembly: Assembly, cg: { y: number; z: number }, cp: { y: number; z: number }): Geom {
  let yLE = -Infinity;
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const p of assembly.pieces) {
    if (p.region !== 'wing') continue;
    for (const v of p.poly) {
      yLE = Math.max(yLE, v.y);
      cx += v.y;
      cz += v.z;
      n++;
    }
  }
  const chord = wingChord(assembly) || 100;
  const center = n > 0 ? vec(cx / n, cz / n) : vec(0, 0);

  // 側面投影：直接取立體飛機每一面的 (y, z)
  const sideWings: Vec2[][] = [];
  const sideFuse: Vec2[][] = [];
  for (const p of assembly.pieces) {
    const poly = p.poly.map((v) => vec(v.y, v.z));
    (p.region === 'wing' ? sideWings : sideFuse).push(poly);
  }

  // 俯視投影：u = 離機頭的順流距離、v = 翼展位置
  let halfSpan = 1;
  const projTop = (poly: readonly { x: number; y: number }[]) =>
    poly.map((p) => {
      halfSpan = Math.max(halfSpan, Math.abs(p.x));
      return vec(yLE - p.y, p.x);
    });
  const topWings: Vec2[][] = [];
  const topFuse: Vec2[][] = [];
  for (const p of assembly.pieces) (p.region === 'wing' ? topWings : topFuse).push(projTop(p.poly));

  return {
    incidence: assembly.wingIncidence,
    side: { chord, center, wings: sideWings, fuse: sideFuse, cg: vec(cg.y, cg.z), cp: vec(cp.y, cp.z) },
    top: { chord, halfSpan, wings: topWings, fuse: topFuse },
    flaps: { side: sideFlaps(assembly, center, chord), top: topFlapWakes(assembly, topWing(assembly).rootChord) },
  };
}

export interface WindTunnelProps {
  readonly state: PaperState;
  readonly design: Design;
}

export function WindTunnel(props: WindTunnelProps) {
  const { state, design } = props;
  const sideRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const [alphaDeg, setAlphaDeg] = useState(5);

  const { halfSpan } = useMemo(() => planeMetrics(state), [state]);
  const assembly = useMemo(
    () => buildAssembly(state, wingLineOf(design, halfSpan), deg2rad(design.dihedralDeg), bendsOf(state, design)),
    [state, design.wingFrac, design.tiltDeg, design.dihedralDeg, flapKey(design)],
  );
  const mass = useMemo(() => assemblyMass(assembly, design.clips), [assembly, design.clips]);
  const planform = useMemo(() => liftCenter(assembly), [assembly]);
  const stab = useMemo(() => stability(mass.cg, planform.cp, planform.meanChord), [mass, planform]);
  const geom = useMemo(() => buildGeom(assembly, mass.cg, planform.cp), [assembly, mass, planform]);
  const tw = useMemo(() => topWing(assembly), [assembly]);

  const incidenceDeg = (geom.incidence * 180) / Math.PI;
  const effDeg = alphaDeg + incidenceDeg; // 風洞看到的實際攻角 = 滑桿 + 機翼內建攻角
  const stalled = isStalled(deg2rad(effDeg));
  const nearStall = !stalled && effDeg >= STALL_ANGLE_DEG - 3;

  // 「推一下」測試：推歪後看會不會自己回正。
  const [pushMsg, setPushMsg] = useState<{ ok: 'returns' | 'diverges' | 'neutral'; text: string } | null>(null);
  const push = useRef({ active: false, theta: 0, omega: 0, last: 0 });
  const doPush = () => {
    push.current = { active: true, theta: (12 * Math.PI) / 180, omega: 0, last: performance.now() };
    setPushMsg(null);
  };

  // 把會變動的資料放進 ref，讓單一動畫迴圈讀最新值。
  const live = useRef({ effRad: 0, geom, stalled, tw, margin: 0 });
  live.current = { effRad: deg2rad(effDeg), geom, stalled, tw, margin: stab.margin };

  // 側視：煙線流過機翼剖面
  useEffect(() => {
    const el = sideRef.current!;
    const particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let geo = { s: 1, cx: 0, cy: 0, xL: 0, xR: 1, halfH: 1 };
    const setGeo = () => {
      const s = PLATE_FRAC * w;
      const cx = w * 0.42;
      const cy = h / 2;
      geo = { s, cx, cy, xL: -cx / s, xR: (w - cx) / s, halfH: cy / s };
    };
    const spawn = (p: Particle, startX: number) => {
      p.x = startX;
      p.y = p.y0 + (Math.random() - 0.5) * 0.04;
      p.px = p.x;
      p.py = p.y;
    };
    const init = () => {
      particles.length = 0;
      for (let i = 0; i < SOURCES; i++) {
        const y0 = (i / (SOURCES - 1) - 0.5) * 1.7 * geo.halfH;
        for (let j = 0; j < PER_SOURCE; j++) {
          const p = { x: 0, y: 0, px: 0, py: 0, y0 };
          spawn(p, geo.xL + ((geo.xR - geo.xL) * j) / PER_SOURCE);
          particles.push(p);
        }
      }
    };
    const X = (fx: number) => geo.cx + geo.s * fx;
    const Y = (fy: number) => geo.cy - geo.s * fy;

    let raf = 0;
    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const ctx = el.getContext('2d')!;
      if (el.width !== Math.round(cw * dpr) || el.height !== Math.round(ch * dpr)) {
        el.width = Math.round(cw * dpr);
        el.height = Math.round(ch * dpr);
        w = cw;
        h = ch;
        setGeo();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, w, h);
        init();
      }
      // 「推一下」：用簡單彈簧模型推進被推歪的角度，加到攻角上。
      const ps = push.current;
      if (ps.active) {
        const now = performance.now();
        const dt = Math.min(0.05, (now - ps.last) / 1000);
        ps.last = now;
        const acc = pitchAccel(live.current.margin, ps.theta, ps.omega);
        ps.omega += acc * dt;
        ps.theta += ps.omega * dt;
        if (Math.abs(ps.theta) > (70 * Math.PI) / 180) {
          ps.active = false;
          setPushMsg({ ok: 'diverges', text: '越歪越多，會翻過去 😵' });
        } else if (Math.abs(ps.theta) < 0.01 && Math.abs(ps.omega) < 0.05) {
          ps.active = false;
          ps.theta = 0;
          setPushMsg({ ok: 'returns', text: '自己轉回來了，穩！👍' });
        }
      }
      const { effRad, geom: g } = live.current;
      const alpha = effRad + ps.theta;
      const pl = plate(alpha);

      ctx.fillStyle = BG_FADE;
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      // 翹起的翼片跟著機翼一起依攻角轉
      const flaps = rotateSideFlaps(g.flaps.side, alpha - g.incidence);
      for (const p of particles) {
        const here = vec(p.x, p.y);
        const fl = flapFlowAt(flaps, flowAt(alpha, here), here);
        let v = fl.v;
        const stallWake = inWake(alpha, here);
        const turb = Math.max(stallWake ? 1 : 0, fl.wake);
        if (turb > 0) {
          const t = performance.now() * 0.004;
          const k = 0.5 * turb;
          v = vec(v.x + k * Math.sin(3 * p.x + 2 * p.y + t), v.y + k * Math.cos(2.4 * p.y - 1.7 * p.x + t * 1.3));
        }
        const wake = stallWake || fl.wake > 0.15;
        p.px = p.x;
        p.py = p.y;
        p.x += v.x * STEP;
        p.y += v.y * STEP;
        noPenetrate(p, pl);
        for (const f of flaps) noPenetrateSegment(p, f.base, f.tip);
        if (p.x > geo.xR + 0.15 || Math.abs(p.y) > geo.halfH + 0.3 || p.x < geo.xL - 0.3) {
          spawn(p, geo.xL - Math.random() * 0.1);
          continue;
        }
        const bright = Math.min(1, 0.35 + Math.hypot(v.x, v.y) * 0.5);
        ctx.strokeStyle = wake ? `rgba(240,150,90,${0.8 * bright})` : `rgba(255,255,255,${0.85 * bright})`;
        ctx.beginPath();
        ctx.moveTo(X(p.px), Y(p.py));
        ctx.lineTo(X(p.x), Y(p.y));
        ctx.stroke();
      }
      drawSidePlane(ctx, g, alpha, X, Y, geo.s);
      if (ps.active) {
        // 機頭附近畫一個箭頭：綠色＝正在把飛機轉回正，紅色＝越推越歪。
        const noseX = X(pl.le.x);
        const noseY = Y(pl.le.y);
        const moment = -live.current.margin * ps.theta; // >0：機頭往上（攻角變大）
        drawPushArrow(ctx, noseX, noseY, moment > 0 ? -1 : 1, live.current.margin > 0);
      }
      windLabel(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 俯視：翼尖渦流——煙線受機翼與攻角影響，翼尖後方捲成螺旋
  useEffect(() => {
    const el = topRef.current!;
    interface TP { u: number; v: number; z: number; v0: number; trail: { u: number; v: number; z: number }[] }
    let particles: TP[] = [];
    let w = 0;
    let h = 0;
    let fit = { k: 1, ox: 0, oy: 0 };
    let uStart = -0.3;
    let uEnd = 2.3;
    const TRAIL = 12;

    const setFit = () => {
      const g = live.current.geom.top;
      const rc = live.current.tw.rootChord || 1;
      const uSpanMm = 2.4 * g.chord; // 顯示到機尾下游約 2.4 弦長，看得到翼尖螺旋
      const k = Math.min((w * 0.92) / uSpanMm, (h * 0.9) / (2 * g.halfSpan * 1.7));
      fit = { k, ox: w * 0.05, oy: h / 2 };
      uStart = (0 - fit.ox) / (k * rc) - 0.2;
      uEnd = (w - fit.ox) / (k * rc) + 0.2;
      const vMax = (h * 0.5) / (k * rc);
      particles = [];
      const n = 17;
      for (let i = 0; i < n; i++) {
        const v0 = (i / (n - 1) - 0.5) * 2 * vMax;
        for (let j = 0; j < 10; j++) {
          const u = uStart + ((uEnd - uStart) * j) / 10;
          particles.push({ u, v: v0, z: 0, v0, trail: [{ u, v: v0, z: 0 }] });
        }
      }
    };
    const SX = (umm: number) => fit.ox + fit.k * umm;
    const SY = (vmm: number) => fit.oy - fit.k * vmm;

    let raf = 0;
    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const ctx = el.getContext('2d')!;
      if (el.width !== Math.round(cw * dpr) || el.height !== Math.round(ch * dpr) || w !== cw) {
        el.width = Math.round(cw * dpr);
        el.height = Math.round(ch * dpr);
        w = cw;
        h = ch;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        setFit();
      }
      const g2 = live.current.geom;
      const g = g2.top;
      const wingT = live.current.tw;
      const alpha = live.current.effRad;
      const st = live.current.stalled;
      const rc = wingT.rootChord || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // 機翼平面形狀（先畫，煙線在上面流）
      for (const poly of g.wings) fillPoly(ctx, poly.map((p) => ({ x: SX(p.x), y: SY(p.y) })), st ? '#c2502f' : '#3f7ec0', '#2b4a6b');
      for (const poly of g.fuse) fillPoly(ctx, poly.map((p) => ({ x: SX(p.x), y: SY(p.y) })), 'rgba(230,230,230,0.5)', 'rgba(120,120,120,0.5)');

      const t = performance.now() * 0.001;
      const teU = wingT.tipU;
      const halfSpanN = wingT.halfSpan;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';

      for (const p of particles) {
        const vel = topFlowAt(wingT, alpha, vec3(p.u, p.v, p.z));
        let du = vel.x;
        let dv = vel.y;
        let dz = vel.z;
        // 失速：機翼正後方（翼展內）保留亂流
        const stallWake = st && p.u > teU * 0.6 && p.u < teU + 1.3 && Math.abs(p.v) < halfSpanN;
        // 翹起的翼片：後面拖著一條變慢、變亂的尾流
        const flapWake = topFlapWakeAt(g2.flaps.top, p.u, p.v);
        const turb = Math.max(stallWake ? 1 : 0, flapWake);
        if (turb > 0) {
          dv += 0.7 * turb * Math.sin(5 * p.u + 3 * p.v + t * 6);
          dz += 0.7 * turb * Math.cos(4 * p.v - 3 * p.u + t * 5);
        }
        if (flapWake > 0) du *= wakeSpeedFactor(flapWake);
        const inWakeTop = stallWake || flapWake > 0.15;
        p.u += du * STEP_TOP;
        p.v += dv * STEP_TOP;
        p.z += dz * STEP_TOP;
        if (p.u > uEnd + 0.1) {
          p.u = uStart;
          p.v = p.v0;
          p.z = 0;
          p.trail = [{ u: p.u, v: p.v, z: 0 }];
          continue;
        }
        p.trail.push({ u: p.u, v: p.v, z: p.z });
        if (p.trail.length > TRAIL) p.trail.shift();

        // 畫拖尾；z < 0（渦流下方）畫暗一點，表現立體
        for (let i = 1; i < p.trail.length; i++) {
          const a = p.trail[i - 1];
          const b = p.trail[i];
          const depth = clamp01(0.5 + 0.7 * b.z);
          const alphaLine = (inWakeTop ? 0.85 : 0.7) * (0.35 + 0.65 * depth) * (i / p.trail.length);
          ctx.strokeStyle = inWakeTop
            ? `rgba(240,150,90,${alphaLine})`
            : `rgba(255,255,255,${alphaLine})`;
          ctx.beginPath();
          ctx.moveTo(SX(a.u * rc), SY(a.v * rc));
          ctx.lineTo(SX(b.u * rc), SY(b.v * rc));
          ctx.stroke();
        }
      }

      // 翼尖渦流圖示（↻ / ↺），越強越明顯
      const strength = clamp01(circulationMag(alpha) / (Math.PI * Math.sin((STALL_ANGLE_DEG * Math.PI) / 180)));
      if (strength > 0.05) {
        const axisV = tipVortexAxisV(wingT);
        const iconU = teU + 0.55;
        const rpx = 8 + 13 * strength;
        drawVortexIcon(ctx, SX(iconU * rc), SY(axisV * rc), rpx, true, strength);
        drawVortexIcon(ctx, SX(iconU * rc), SY(-axisV * rc), rpx, false, strength);
      }

      windLabel(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 提示文字：先看失速，再看穩定度
  const status = stalled
    ? { cls: 'stall', emoji: '😵', text: '失速了！機翼上面的空氣亂掉，飛機會往下掉' }
    : nearStall
      ? { cls: 'warn', emoji: '⚠️', text: '快要失速了…小心一點' }
      : stab.verdict === 'pitch-up'
        ? { cls: 'warn', emoji: '🙃', text: '重心偏後面，稍微一抬頭就容易失速' }
        : stab.verdict === 'nose-dive'
          ? { cls: 'warn', emoji: '😟', text: '機頭太重，空氣貼著流過但飛機會往下衝' }
          : { cls: 'ok', emoji: '✈️', text: '空氣順順地貼著機翼流過，飛得穩' };

  return (
    <div class="windtunnel">
      <div class={`flow-status ${status.cls}`}>
        <span class="flow-emoji">{status.emoji}</span>
        <span>{status.text}</span>
        <span class="flow-note">這是示意，最後以實際射出為準</span>
      </div>
      {geom.flaps.side.length > 0 && (
        <div class="flap-flow-note">🍃 翼片翹起來了：後面的空氣變亂、變慢（橘色的煙）→ 會飛得比較慢，機頭也比較容易自己抬起來</div>
      )}

      <div class="tunnel-views">
        <div class="tunnel-wrap">
          <div class="tunnel-label">側面看（↑上 →風）</div>
          <canvas ref={sideRef} class="tunnel-canvas" />
        </div>
        <div class="tunnel-wrap">
          <div class="tunnel-label">上面看（→風）· 翼尖渦流 ↻↺</div>
          <canvas ref={topRef} class="tunnel-canvas" />
        </div>
      </div>

      <div class="tunnel-controls">
        <label>
          攻角（機頭抬起）<b>{alphaDeg}°</b>
          {Math.abs(incidenceDeg) >= 1 && (
            <span class="eff"> ＋ 機翼內建 {incidenceDeg.toFixed(0)}° ＝ 實際 {effDeg.toFixed(0)}°</span>
          )}
        </label>
        <input type="range" min={0} max={25} value={alphaDeg} onInput={(e) => setAlphaDeg(Number((e.target as HTMLInputElement).value))} />
        <div class="push-row">
          <button class="chip push-btn" onClick={doPush}>
            👆 推一下
          </button>
          {pushMsg && (
            <span class={`push-msg ${pushMsg.ok}`}>{pushMsg.text}</span>
          )}
          <span class="push-hint">把機頭推高一點，看它會不會自己回正</span>
        </div>
      </div>
      <div class="tunnel-foot">
        把攻角慢慢調大看什麼時候「亂掉」（失速約 {STALL_ANGLE_DEG}°）· 🔴重心 🔵升力中心 · 到「看飛機」改機翼位置／斜度／迴紋針，這裡會跟著變
      </div>
    </div>
  );
}

const BG = '#20303d';
const BG_FADE = 'rgba(32, 48, 61, 0.22)';

function noPenetrate(p: Particle, pl: ReturnType<typeof plate>) {
  const along = (p.x - pl.le.x) * pl.dir.x + (p.y - pl.le.y) * pl.dir.y;
  if (along < 0 || along > 1) return;
  const above = (p.x - pl.le.x) * pl.nUp.x + (p.y - pl.le.y) * pl.nUp.y;
  const prevAbove = (p.px - pl.le.x) * pl.nUp.x + (p.py - pl.le.y) * pl.nUp.y;
  const eps = 0.012;
  if (Math.abs(above) < eps || above * prevAbove < 0) {
    const side = prevAbove >= 0 ? 1 : -1;
    p.x = pl.le.x + pl.dir.x * along + pl.nUp.x * side * eps;
    p.y = pl.le.y + pl.dir.y * along + pl.nUp.y * side * eps;
  }
}

/** 煙不能穿過翹起的翼片：碰到就停在板子迎風的那一面，讓它從上面繞過去。 */
function noPenetrateSegment(p: Particle, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const tx = dx / len;
  const ty = dy / len;
  const along = ((p.x - a.x) * tx + (p.y - a.y) * ty) / len;
  if (along < 0 || along > 1) return;
  const side = (p.x - a.x) * -ty + (p.y - a.y) * tx;
  const prevSide = (p.px - a.x) * -ty + (p.py - a.y) * tx;
  const eps = 0.012;
  if (Math.abs(side) < eps || side * prevSide < 0) {
    const s = prevSide >= 0 ? 1 : -1;
    p.x = a.x + dx * along - ty * s * eps;
    p.y = a.y + dy * along + tx * s * eps;
  }
}

type Proj = (f: number) => number;

/**
 * 畫真正的飛機側影：把立體飛機的側面投影（y, z）對齊到風洞裡的機翼剖面。
 * 轉換 M 把機翼形心放到原點、翼弦縮成 1、依「滑桿攻角」轉（機翼內建攻角已經在幾何裡），
 * 並做一次鏡射（機頭朝左）；因此機翼實際落在「滑桿 + 內建攻角」＝實際攻角，和煙線的流場一致。
 */
function drawSidePlane(ctx: CanvasRenderingContext2D, g: Geom, alpha: number, X: Proj, Y: Proj, s: number) {
  const aM = alpha - g.incidence; // 幾何已含內建攻角，這裡只多轉滑桿的部分
  const c = Math.cos(aM);
  const sn = Math.sin(aM);
  const { center: C, chord } = g.side;
  const ch = chord || 1;
  const T = (p: Vec2) => {
    const dx = p.x - C.x;
    const dz = p.y - C.y;
    return { x: X((-c * dx + sn * dz) / ch), y: Y((sn * dx + c * dz) / ch) };
  };

  for (const poly of g.side.fuse) fillPoly(ctx, poly.map(T), '#e6c36a', '#6b5b45');
  for (const poly of g.side.wings) fillPoly(ctx, poly.map(T), '#fdfbf5', '#6b5b45');

  // 機頭小圓點（側影裡最靠機頭、也就是世界 y 最大的那個機翼頂點）
  let nose: Vec2 | null = null;
  let best = -Infinity;
  for (const poly of g.side.wings) for (const p of poly) if (p.x > best) { best = p.x; nose = p; }
  if (nose) {
    const n = T(nose);
    ctx.beginPath();
    ctx.arc(n.x, n.y, Math.max(3, s * 0.02), 0, 2 * Math.PI);
    ctx.fillStyle = '#6b5b45';
    ctx.fill();
  }

  mark(ctx, T(g.side.cp), '#2f6fb3', '升力');
  mark(ctx, T(g.side.cg), '#e5484d', '重心');
}

function mark(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, color: string, label: string) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 12px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, p.x, p.y - 7);
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], fill: string, stroke: string) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** 翼尖渦流圖示：一個捲起的箭頭（cw = 從上方看順時針）。 */
function drawVortexIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cw: boolean, strength: number) {
  ctx.save();
  ctx.strokeStyle = `rgba(130,205,255,${0.35 + 0.5 * strength})`;
  ctx.lineWidth = 2 + 2 * strength;
  ctx.lineCap = 'round';
  const a0 = -Math.PI / 2;
  const sweep = Math.PI * 1.6 * (cw ? 1 : -1);
  const a1 = a0 + sweep;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1, !cw);
  ctx.stroke();
  // 箭頭
  const ex = cx + r * Math.cos(a1);
  const ey = cy + r * Math.sin(a1);
  const tang = a1 + (cw ? 1 : -1) * (Math.PI / 2);
  const ah = 5 + 3 * strength;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ah * Math.cos(tang - 0.5), ey - ah * Math.sin(tang - 0.5));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ah * Math.cos(tang + 0.5), ey - ah * Math.sin(tang + 0.5));
  ctx.stroke();
  ctx.restore();
}

/** 「推一下」時機頭旁邊的箭頭：dir = 螢幕方向（-1 向上、+1 向下）；restoring 決定顏色。 */
function drawPushArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, restoring: boolean) {
  const len = 34;
  const x0 = x - 22;
  const y0 = y - dir * 6;
  const y1 = y0 + dir * len;
  ctx.save();
  ctx.strokeStyle = restoring ? '#37c06a' : '#ff5a5a';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0, y1 + dir * 2);
  ctx.lineTo(x0 - 6, y1 - dir * 8);
  ctx.lineTo(x0 + 6, y1 - dir * 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function windLabel(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('風 →', 12, 18);
  ctx.restore();
}
