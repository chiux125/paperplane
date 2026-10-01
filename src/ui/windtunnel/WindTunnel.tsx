import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type Assembly,
  type PaperState,
  type Vec2,
  STALL_ANGLE_DEG,
  assemblyMass,
  buildAssembly,
  flowAt,
  inWake,
  isStalled,
  liftCenter,
  plate,
  stability,
  vec,
  wingChord,
} from '../../core';
import { type Design, planeMetrics, wingLineOf } from '../design';

const PLATE_FRAC = 0.3;
const STEP = 0.03;
const SOURCES = 13;
const PER_SOURCE = 18;
const deg2rad = (d: number) => (d * Math.PI) / 180;

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
  chord: number;
  finFrac: number; // 尾鰭深度 / 翼弦
  cgFrac: number; // 重心沿翼弦的位置（前緣 0、後緣 1）
  cpFrac: number; // 升力中心沿翼弦的位置
  top: { chord: number; halfSpan: number; wings: Vec2[][]; fuse: Vec2[][] }; // 俯視投影（u=順流距離, v=翼展）
}

function buildGeom(assembly: Assembly, cgY: number, cpY: number): Geom {
  let yLE = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of assembly.pieces) {
    if (p.region === 'wing') for (const v of p.poly) yLE = Math.max(yLE, v.y);
    if (p.region === 'fuselage') for (const v of p.poly) {
      zMin = Math.min(zMin, v.z);
      zMax = Math.max(zMax, v.z);
    }
  }
  const chord = wingChord(assembly) || 100;
  const finFrac = Number.isFinite(zMax) ? Math.min(0.6, Math.max(0.1, (zMax - zMin) / chord)) : 0.3;
  const frac = (y: number) => (yLE - y) / chord;

  // 俯視投影：u = 離機頭的順流距離、v = 翼展位置
  let halfSpan = 1;
  const proj = (poly: readonly { x: number; y: number }[]) =>
    poly.map((p) => {
      halfSpan = Math.max(halfSpan, Math.abs(p.x));
      return vec(yLE - p.y, p.x);
    });
  const wings: Vec2[][] = [];
  const fuse: Vec2[][] = [];
  for (const p of assembly.pieces) {
    (p.region === 'wing' ? wings : fuse).push(proj(p.poly));
  }
  return {
    incidence: assembly.wingIncidence,
    chord,
    finFrac,
    cgFrac: frac(cgY),
    cpFrac: frac(cpY),
    top: { chord, halfSpan, wings, fuse },
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
    () => buildAssembly(state, wingLineOf(design, halfSpan), deg2rad(design.dihedralDeg)),
    [state, design.wingFrac, design.tiltDeg, design.dihedralDeg],
  );
  const mass = useMemo(() => assemblyMass(assembly, design.clips), [assembly, design.clips]);
  const planform = useMemo(() => liftCenter(assembly), [assembly]);
  const stab = useMemo(() => stability(mass.cg, planform.cp, planform.meanChord), [mass, planform]);
  const geom = useMemo(() => buildGeom(assembly, mass.cg.y, planform.cp.y), [assembly, mass, planform]);

  const incidenceDeg = (geom.incidence * 180) / Math.PI;
  const effDeg = alphaDeg + incidenceDeg; // 風洞看到的實際攻角 = 滑桿 + 機翼內建攻角
  const stalled = isStalled(deg2rad(effDeg));
  const nearStall = !stalled && effDeg >= STALL_ANGLE_DEG - 3;

  // 把會變動的資料放進 ref，讓單一動畫迴圈讀最新值。
  const live = useRef({ effRad: 0, geom, stalled });
  live.current = { effRad: deg2rad(effDeg), geom, stalled };

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
      const { effRad: alpha, geom: g, stalled: st } = live.current;
      const pl = plate(alpha);

      ctx.fillStyle = BG_FADE;
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      for (const p of particles) {
        let v = flowAt(alpha, vec(p.x, p.y));
        const wake = inWake(alpha, vec(p.x, p.y));
        if (wake) {
          const t = performance.now() * 0.004;
          v = vec(v.x + 0.5 * Math.sin(3 * p.x + 2 * p.y + t), v.y + 0.5 * Math.cos(2.4 * p.y - 1.7 * p.x + t * 1.3));
        }
        p.px = p.x;
        p.py = p.y;
        p.x += v.x * STEP;
        p.y += v.y * STEP;
        noPenetrate(p, pl);
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
      drawSidePlane(ctx, pl, g, X, Y, geo.s, st);
      windLabel(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 俯視：看機翼形狀，煙線直直流過；失速時機翼後面變亂流
  useEffect(() => {
    const el = topRef.current!;
    let lines: { sy: number; x: number }[] = [];
    let w = 0;
    let h = 0;
    let fit = { k: 1, ox: 0, oy: 0 };
    const setFit = () => {
      const g = live.current.geom.top;
      const k = Math.min((w * 0.84) / g.chord, (h * 0.84) / (2 * g.halfSpan));
      fit = { k, ox: w * 0.1, oy: h / 2 };
      lines = [];
      const n = 15;
      for (let i = 0; i < n; i++) {
        const sy = (i / (n - 1) - 0.5) * h * 0.92 + h / 2;
        for (let j = 0; j < 14; j++) lines.push({ sy, x: ((w * 1.1) * j) / 14 - w * 0.05 });
      }
    };
    const SX = (u: number) => fit.ox + fit.k * u;
    const SY = (v: number) => fit.oy - fit.k * v;

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
      const g = live.current.geom.top;
      const st = live.current.stalled;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // 機翼平面形狀（先畫，煙線在上面流）
      for (const poly of g.wings) fillPoly(ctx, poly.map((p) => ({ x: SX(p.x), y: SY(p.y) })), st ? '#c2502f' : '#3f7ec0', '#2b4a6b');
      for (const poly of g.fuse) fillPoly(ctx, poly.map((p) => ({ x: SX(p.x), y: SY(p.y) })), 'rgba(230,230,230,0.5)', 'rgba(120,120,120,0.5)');

      const wingLeft = SX(0); // 機翼前緣（機頭側）螢幕 x
      const wingRight = SX(g.chord); // 機翼後緣（機尾側）螢幕 x
      const t = performance.now() * 0.004;
      const TAIL = 22; // 煙線尾巴長度（px）
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      const wobble = (x: number, sy: number) =>
        st && x > wingLeft - 4 ? Math.min(16, (x - wingLeft) * 0.14) * Math.sin(x * 0.07 + sy * 0.1 + t * 3) : 0;
      for (const ln of lines) {
        ln.x += 2.4;
        if (ln.x > w + TAIL) ln.x = -TAIL;
        const head = { x: ln.x, y: ln.sy + wobble(ln.x, ln.sy) };
        const tailX = ln.x - TAIL;
        const over = st && ln.x > wingRight - 6;
        ctx.strokeStyle = over ? 'rgba(240,150,90,0.9)' : 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(tailX, ln.sy + wobble(tailX, ln.sy));
        ctx.lineTo((tailX + ln.x) / 2, ln.sy + wobble((tailX + ln.x) / 2, ln.sy));
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
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

      <div class="tunnel-views">
        <div class="tunnel-wrap">
          <div class="tunnel-label">側面看（↑上 →風）</div>
          <canvas ref={sideRef} class="tunnel-canvas" />
        </div>
        <div class="tunnel-wrap">
          <div class="tunnel-label">上面看（→風，看機翼形狀）</div>
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

type Proj = (f: number) => number;

function drawSidePlane(
  ctx: CanvasRenderingContext2D,
  pl: ReturnType<typeof plate>,
  g: Geom,
  X: Proj,
  Y: Proj,
  s: number,
  _stalled: boolean,
) {
  const S = (p: Vec2) => ({ x: X(p.x), y: Y(p.y) });
  const on = (frac: number, up: number) =>
    vec(pl.le.x + pl.dir.x * frac + pl.nUp.x * up, pl.le.y + pl.dir.y * frac + pl.nUp.y * up);

  // 尾鰭
  const finTop = on(0.5, 0);
  fillPoly(ctx, [S(finTop), S(on(1, -g.finFrac)), S(pl.te)], '#e6c36a', '#6b5b45');
  // 機翼薄板
  fillPoly(ctx, [S(pl.le), S(pl.te), S(on(1, -0.02)), S(on(0, -0.02))], '#fdfbf5', '#6b5b45');
  // 機頭
  const nose = S(pl.le);
  ctx.beginPath();
  ctx.arc(nose.x, nose.y, Math.max(3, s * 0.02), 0, 2 * Math.PI);
  ctx.fillStyle = '#6b5b45';
  ctx.fill();
  // 重心（紅）與升力中心（藍）
  mark(ctx, S(on(g.cpFrac, 0.05)), '#2f6fb3', '升力');
  mark(ctx, S(on(g.cgFrac, -0.05)), '#e5484d', '重心');
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

function windLabel(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('風 →', 12, 18);
  ctx.restore();
}
