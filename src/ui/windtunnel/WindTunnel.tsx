import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type PaperState,
  type Vec2,
  STALL_ANGLE_DEG,
  flowAt,
  foldedPolygon,
  inWake,
  isStalled,
  plate,
  vec,
} from '../../core';

/** 標準座標（翼弦 1）佔畫布寬度的比例。 */
const PLATE_FRAC = 0.32;
/** 每一幀粒子前進多少（標準座標單位）。 */
const STEP = 0.03;
/** 煙線的發射高度數量，以及每條線的粒子數。 */
const SOURCES = 15;
const PER_SOURCE = 20;

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  y0: number;
}

export interface WindTunnelProps {
  readonly state: PaperState;
}

export function WindTunnel(props: WindTunnelProps) {
  const { state } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [alphaDeg, setAlphaDeg] = useState(8);
  const alphaRef = useRef(8);
  alphaRef.current = alphaDeg;

  // 飛機長度（機頭到機尾，mm）— 反映孩子的設計，決定側面輪廓比例。
  const chord = useMemo(() => {
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const f of state.faces.values()) {
      for (const p of foldedPolygon(f)) {
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
      }
    }
    return yMax > yMin ? yMax - yMin : 100;
  }, [state]);
  const finDepth = 0.33; // 相對翼弦

  const stalled = isStalled((alphaDeg * Math.PI) / 180);
  const nearStall = !stalled && alphaDeg >= STALL_ANGLE_DEG - 2;

  useEffect(() => {
    const el = canvas.current!;
    const particles: Particle[] = [];
    let size = { w: 0, h: 0 };
    let raf = 0;

    const setup = (w: number, h: number) => {
      const s = PLATE_FRAC * w;
      const cx = w * 0.42;
      const cy = h / 2;
      const xL = -cx / s;
      const xR = (w - cx) / s;
      const halfH = cy / s;
      return { s, cx, cy, xL, xR, halfH };
    };
    let geo = setup(1, 1);
    const toScreenX = (fx: number) => geo.cx + geo.s * fx;
    const toScreenY = (fy: number) => geo.cy - geo.s * fy;

    const spawn = (p: Particle, startX: number) => {
      p.x = startX;
      p.y = p.y0 + (Math.random() - 0.5) * 0.04;
      p.px = p.x;
      p.py = p.y;
    };
    const initParticles = () => {
      particles.length = 0;
      for (let i = 0; i < SOURCES; i++) {
        const y0 = (i / (SOURCES - 1) - 0.5) * 1.7 * geo.halfH;
        for (let j = 0; j < PER_SOURCE; j++) {
          const p: Particle = { x: 0, y: 0, px: 0, py: 0, y0 };
          spawn(p, geo.xL + ((geo.xR - geo.xL) * j) / PER_SOURCE);
          particles.push(p);
        }
      }
    };

    const frame = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
        size = { w, h };
        geo = setup(w, h);
        const ctx0 = el.getContext('2d')!;
        ctx0.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx0.fillStyle = BG;
        ctx0.fillRect(0, 0, w, h);
        initParticles();
      }
      const ctx = el.getContext('2d')!;
      const alpha = (alphaRef.current * Math.PI) / 180;
      const pl = plate(alpha);

      // 殘影淡出（煙霧感）
      ctx.fillStyle = BG_FADE;
      ctx.fillRect(0, 0, size.w, size.h);

      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      for (const p of particles) {
        let v = flowAt(alpha, vec(p.x, p.y));
        const wake = inWake(alpha, vec(p.x, p.y));
        if (wake) {
          const t = performance.now() * 0.004;
          v = vec(
            v.x + 0.5 * Math.sin(3 * p.x + 2 * p.y + t),
            v.y + 0.5 * Math.cos(2.4 * p.y - 1.7 * p.x + t * 1.3),
          );
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
        const speed = Math.hypot(v.x, v.y);
        const bright = Math.min(1, 0.35 + speed * 0.5);
        ctx.strokeStyle = wake
          ? `rgba(240, 150, 90, ${0.8 * bright})`
          : `rgba(255, 255, 255, ${0.85 * bright})`;
        ctx.beginPath();
        ctx.moveTo(toScreenX(p.px), toScreenY(p.py));
        ctx.lineTo(toScreenX(p.x), toScreenY(p.y));
        ctx.stroke();
      }

      drawPlane(ctx, pl, finDepth, toScreenX, toScreenY, geo.s);
      drawWind(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div class="windtunnel">
      <div class={`flow-status ${stalled ? 'stall' : nearStall ? 'warn' : 'ok'}`}>
        <span class="flow-emoji">{stalled ? '😵' : nearStall ? '⚠️' : '✈️'}</span>
        <span>
          {stalled
            ? '失速了！機翼上面的空氣亂掉，飛機會往下掉'
            : nearStall
              ? '快要失速了…小心一點'
              : '空氣順順地貼著機翼流過，飛得穩'}
        </span>
        <span class="flow-note">這是示意，最後以實際射出為準</span>
      </div>

      <div class="tunnel-wrap">
        <canvas ref={canvas} class="tunnel-canvas" />
      </div>

      <div class="tunnel-controls">
        <label>
          攻角（機頭抬起）<b>{alphaDeg}°</b>
        </label>
        <input
          type="range"
          min={0}
          max={25}
          value={alphaDeg}
          onInput={(e) => setAlphaDeg(Number((e.target as HTMLInputElement).value))}
        />
      </div>
      <div class="tunnel-foot">
        把攻角慢慢調大，看空氣什麼時候會「亂掉」（失速門檻約 {STALL_ANGLE_DEG}°）· 飛機長約 {chord.toFixed(0)} mm
      </div>
    </div>
  );
}

const BG = '#20303d';
const BG_FADE = 'rgba(32, 48, 61, 0.22)';

/** 不讓粒子穿過薄平板：若這一步跨過翼弦段，就推回原來那一側貼著表面。 */
function noPenetrate(p: Particle, pl: ReturnType<typeof plate>) {
  const along = (p.x - pl.le.x) * pl.dir.x + (p.y - pl.le.y) * pl.dir.y;
  if (along < 0 || along > 1) return;
  const above = (p.x - pl.le.x) * pl.nUp.x + (p.y - pl.le.y) * pl.nUp.y;
  const prevAbove = (p.px - pl.le.x) * pl.nUp.x + (p.py - pl.le.y) * pl.nUp.y;
  const eps = 0.012;
  if (Math.abs(above) < eps || above * prevAbove < 0) {
    const side = prevAbove >= 0 ? 1 : -1;
    const foot = along; // 沿翼弦的位置
    p.x = pl.le.x + pl.dir.x * foot + pl.nUp.x * side * eps;
    p.y = pl.le.y + pl.dir.y * foot + pl.nUp.y * side * eps;
  }
}

type Proj = (f: number) => number;

function drawPlane(
  ctx: CanvasRenderingContext2D,
  pl: ReturnType<typeof plate>,
  finDepth: number,
  X: Proj,
  Y: Proj,
  s: number,
) {
  const S = (p: Vec2) => ({ x: X(p.x), y: Y(p.y) });
  const addv = (a: Vec2, b: Vec2, k: number) => vec(a.x + b.x * k, a.y + b.y * k);

  // 機身尾鰭（從後半往下掛的三角形）
  const finTop = addv(pl.le, pl.dir, 0.5);
  const fin = [S(finTop), S(addv(pl.te, pl.nUp, -finDepth)), S(pl.te)];
  poly(ctx, fin, '#e6c36a', '#6b5b45');

  // 機翼薄板（前緣到後緣）
  const t = 0.02;
  const wing = [
    S(pl.le),
    S(pl.te),
    S(addv(pl.te, pl.nUp, -t)),
    S(addv(pl.le, pl.nUp, -t)),
  ];
  poly(ctx, wing, '#fdfbf5', '#6b5b45');

  // 機頭小圓點
  const nose = S(pl.le);
  ctx.beginPath();
  ctx.arc(nose.x, nose.y, Math.max(3, s * 0.02), 0, 2 * Math.PI);
  ctx.fillStyle = '#6b5b45';
  ctx.fill();
}

function poly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], fill: string, stroke: string) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawWind(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('風 →', 12, 20);
  ctx.restore();
}
