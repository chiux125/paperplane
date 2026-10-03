import { useEffect, useRef } from 'preact/hooks';
import type { FlightPath } from '../../core';

/**
 * 階段 7a：把縱向飛行模擬「演」出來（側視動畫）。
 * 只在孩子記錄完這次射出後才播放（先猜、再射、對答案）。距離不強調，所以不畫刻度數字。
 */

export interface FlightReplayProps {
  readonly path: FlightPath;
}

const SKY = '#eaf3fb';
const GROUND = '#cfe3c6';
const TRAIL = '#9bb8d6';
const PLANE = '#f08a3c';

export function FlightReplay(props: FlightReplayProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pathRef = useRef(props.path);
  pathRef.current = props.path;

  useEffect(() => {
    const cv = ref.current!;
    let raf = 0;
    let t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const path = pathRef.current;
      const samples = path.samples;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h || samples.length < 2) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 範圍（含地面 h=0 與出手點）。
      let maxX = 0;
      let maxH = 0;
      for (const s of samples) {
        maxX = Math.max(maxX, s.x);
        maxH = Math.max(maxH, s.h);
      }
      const pad = 16;
      const groundPad = 14;
      const kx = (w - 2 * pad) / Math.max(0.5, maxX);
      const ky = (h - 2 * pad - groundPad) / Math.max(0.5, maxH);
      const k = Math.min(kx, ky);
      const ox = pad;
      const oy = h - pad - groundPad;
      const X = (x: number) => ox + k * x;
      const Y = (hh: number) => oy - k * hh;

      // 背景：天空 + 地面
      ctx.fillStyle = SKY;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = GROUND;
      ctx.fillRect(0, Y(0), w, h - Y(0));
      ctx.strokeStyle = '#a7c79b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, Y(0));
      ctx.lineTo(w, Y(0));
      ctx.stroke();

      // 動畫時間：真實秒數 ×1.2，播完停一下再重來。
      const dur = samples[samples.length - 1].t;
      const cycle = dur / 1.2 + 0.9; // 播放 + 結尾停頓
      let tt = ((now - t0) / 1000) % cycle;
      let playT = Math.min(dur, tt * 1.2);

      // 已飛過的軌跡
      ctx.strokeStyle = TRAIL;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(X(0), Y(samples[0].h));
      let cur = samples[0];
      for (const s of samples) {
        if (s.t > playT) break;
        ctx.lineTo(X(s.x), Y(s.h));
        cur = s;
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // 飛機（小三角，依姿態角轉）
      drawPlane(ctx, X(cur.x), Y(cur.h), cur.theta);

      // 出手點
      ctx.fillStyle = '#7a93ad';
      ctx.beginPath();
      ctx.arc(X(0), Y(samples[0].h), 3, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} class="flight-replay-canvas" />;
}

function drawPlane(ctx: CanvasRenderingContext2D, px: number, py: number, theta: number) {
  // 機頭朝 +x、依姿態角上揚（螢幕 y 往下，所以用 -theta）。
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-theta);
  ctx.fillStyle = PLANE;
  ctx.strokeStyle = '#b5631f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-8, 6);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
