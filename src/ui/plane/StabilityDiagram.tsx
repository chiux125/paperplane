import { useEffect, useRef } from 'preact/hooks';
import { type Assembly, type Paperclip, type Vec3, vec3 } from '../../core';

const FRONT = 'rgba(210, 196, 150, 0.5)';
const WING = 'rgba(74, 144, 217, 0.28)';
const EDGE = 'rgba(107, 91, 69, 0.5)';

export interface StabilityDiagramProps {
  readonly assembly: Assembly;
  readonly cg: Vec3;
  readonly cp: Vec3;
  readonly clips: readonly Paperclip[];
  /** 在側視圖拖動迴紋針時呼叫（x 固定為 0）。 */
  readonly onMoveClip?: (id: number, pos: Vec3) => void;
}

interface Fit {
  readonly k: number;
  readonly ox: number;
  readonly oy: number;
}

/** 世界 (u, v)（v 朝上）→ 螢幕。 */
const sx = (f: Fit, u: number) => f.ox + f.k * u;
const sy = (f: Fit, v: number) => f.oy - f.k * v;

export function StabilityDiagram(props: StabilityDiagramProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sideFit = useRef<Fit | null>(null);
  const dragId = useRef<number | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    draw();
    return () => ro.disconnect();
  });

  const draw = () => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const gap = 10;
    const titleH = 24;
    const panelW = (w - gap) / 2;
    const rect = (x: number) => ({ x, y: titleH, w: panelW, h: h - titleH });

    // 側視圖：u = y（機頭朝右），v = z（上）
    const side = rect(0);
    const sf = fit(side, bounds(props, (p) => [p.y, p.z]));
    sideFit.current = sf;
    panelTitle(ctx, side, '側面看（↑上 →機頭）');
    drawPieces(ctx, sf, props.assembly, (p) => [p.y, p.z]);
    drawMarkers(ctx, sf, props, (p) => [p.y, p.z]);

    // 俯視圖：u = x（翼展），v = y（機頭朝上）
    const top = rect(panelW + gap);
    const tf = fit(top, bounds(props, (p) => [p.x, p.y]));
    panelTitle(ctx, top, '上面看（↑機頭）');
    drawPieces(ctx, tf, props.assembly, (p) => [p.x, p.y]);
    drawMarkers(ctx, tf, props, (p) => [p.x, p.y]);
  };

  // 在側視圖拖動迴紋針
  const pick = (e: PointerEvent): { id: number } | null => {
    const f = sideFit.current;
    if (!f) return null;
    const r = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: number | null = null;
    let bd = 24;
    for (const c of props.clips) {
      const d = Math.hypot(mx - sx(f, c.pos.y), my - sy(f, c.pos.z));
      if (d < bd) {
        bd = d;
        best = c.id;
      }
    }
    return best === null ? null : { id: best };
  };

  const toWorld = (e: PointerEvent): Vec3 => {
    const f = sideFit.current!;
    const r = canvas.current!.getBoundingClientRect();
    return vec3(0, (e.clientX - r.left - f.ox) / f.k, (f.oy - (e.clientY - r.top)) / f.k);
  };

  return (
    <canvas
      ref={canvas}
      class="stability-canvas"
      onPointerDown={(e) => {
        if (!props.onMoveClip) return;
        const p = pick(e);
        if (p) {
          dragId.current = p.id;
          canvas.current!.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        if (dragId.current !== null && props.onMoveClip) props.onMoveClip(dragId.current, toWorld(e));
      }}
      onPointerUp={() => {
        dragId.current = null;
      }}
    />
  );
}

type Project = (p: Vec3) => [number, number];

function bounds(props: StabilityDiagramProps, proj: Project): [number, number, number, number] {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const add = (p: Vec3) => {
    const [u, v] = proj(p);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  };
  for (const piece of props.assembly.pieces) for (const v of piece.poly) add(v);
  add(props.cg);
  add(props.cp);
  for (const c of props.clips) add(c.pos);
  return [minU, minV, maxU, maxV];
}

function fit(rect: { x: number; y: number; w: number; h: number }, [minU, minV, maxU, maxV]: [number, number, number, number]): Fit {
  const du = Math.max(maxU - minU, 1);
  const dv = Math.max(maxV - minV, 1);
  const pad = 0.12;
  const k = Math.min((rect.w * (1 - pad)) / du, (rect.h * (1 - pad)) / dv);
  const ox = rect.x + rect.w / 2 - k * (minU + maxU) / 2;
  const oy = rect.y + rect.h / 2 + k * (minV + maxV) / 2;
  return { k, ox, oy };
}

function panelTitle(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number }, text: string) {
  ctx.fillStyle = '#5b7c99';
  ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, rect.x + rect.w / 2, rect.y - 4);
}

function drawPieces(ctx: CanvasRenderingContext2D, f: Fit, asm: Assembly, proj: Project) {
  for (const piece of asm.pieces) {
    ctx.beginPath();
    piece.poly.forEach((p, i) => {
      const [u, v] = proj(p);
      const x = sx(f, u);
      const y = sy(f, v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = piece.region === 'wing' ? WING : FRONT;
    ctx.fill();
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawMarkers(ctx: CanvasRenderingContext2D, f: Fit, props: StabilityDiagramProps, proj: Project) {
  for (const c of props.clips) {
    const [u, v] = proj(c.pos);
    dot(ctx, sx(f, u), sy(f, v), c.size === 'large' ? 7 : 5, '#808a94', '📎');
  }
  const [cpu, cpv] = proj(props.cp);
  dot(ctx, sx(f, cpu), sy(f, cpv), 7, '#2f6fb3', '升力');
  const [cgu, cgv] = proj(props.cg);
  dot(ctx, sx(f, cgu), sy(f, cgv), 7, '#e5484d', '重心');
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, label: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (label.length <= 2 && /[一-鿿]/.test(label)) {
    ctx.fillStyle = color;
    ctx.font = 'bold 13px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + r + 3, y);
  }
}
