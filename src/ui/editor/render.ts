import {
  type FaceId,
  type FoldOutcome,
  type Line,
  type Mover,
  type PaperState,
  type Seg,
  type Snap,
  type Vec2,
  add,
  apply,
  compose,
  det,
  faceList,
  foldedPolygon,
  perp,
  reflection,
  scale,
  signedDist,
  stackOrder,
  sub,
} from '../../core';
import { type View, toScreen } from './view';

const FRONT = '#fdfbf5';
const BACK = '#f6c667';
const EDGE = '#6b5b45';
const MOVE_TINT = 'rgba(74, 144, 217, 0.28)';
const GUIDE = '#e5484d';

/** 摺到一半（或預覽）時的畫法。theta：0 = 還沒翻，π = 翻完。 */
export interface Folding {
  readonly outcome: FoldOutcome;
  readonly theta: number;
  /** 預覽模式：原地標出會翻過去的部分，並畫出半透明的落點。 */
  readonly preview: boolean;
}

export interface Scene {
  readonly state: PaperState;
  readonly view: View;
  readonly folding: Folding | null;
  readonly foldLines: readonly Line[];
  readonly drawingSeg: Seg | null;
  readonly markers: readonly Vec2[];
  readonly edges: readonly { readonly seg: Seg; readonly color: string }[];
  readonly snap: Snap | null;
  readonly cg: Vec2;
  readonly previewCg: Vec2 | null;
}

export function render(canvas: HTMLCanvasElement, scene: Scene): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const v = scene.view;

  drawCenterLine(ctx, v, scene.state);
  drawNose(ctx, v, scene.state);

  if (scene.folding) drawFolding(ctx, v, scene.folding);
  else drawFaces(ctx, v, scene.state);

  for (const e of scene.edges) {
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    strokeSeg(ctx, v, e.seg);
  }
  for (const l of scene.foldLines) drawFoldLine(ctx, v, l, w, h);
  if (scene.drawingSeg) {
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    strokeSeg(ctx, v, scene.drawingSeg);
  }
  scene.markers.forEach((p, i) => drawMarker(ctx, toScreen(v, p), String(i + 1)));
  if (scene.snap) drawSnap(ctx, v, scene.snap);

  if (scene.previewCg) drawCg(ctx, toScreen(v, scene.previewCg), true);
  drawCg(ctx, toScreen(v, scene.cg), false);
}

function path(ctx: CanvasRenderingContext2D, v: View, poly: readonly Vec2[]) {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

function strokeSeg(ctx: CanvasRenderingContext2D, v: View, [a, b]: Seg) {
  const sa = toScreen(v, a);
  const sb = toScreen(v, b);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
}

function fillFace(ctx: CanvasRenderingContext2D, v: View, poly: readonly Vec2[], frontUp: boolean, shade = 0) {
  path(ctx, v, poly);
  ctx.fillStyle = frontUp ? FRONT : BACK;
  ctx.fill();
  if (shade > 0) {
    ctx.fillStyle = `rgba(60, 40, 20, ${shade})`;
    ctx.fill();
  }
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

const drawOrder = (s: PaperState): FaceId[] => stackOrder(s) ?? faceList(s).map((f) => f.id);

function drawFaces(ctx: CanvasRenderingContext2D, v: View, s: PaperState) {
  for (const id of drawOrder(s)) {
    const f = s.faces.get(id)!;
    fillFace(ctx, v, foldedPolygon(f), det(f.xf) > 0);
  }
}

/** 面繞摺線轉 theta 後，從正上方看到的樣子（在紙面上的投影）。 */
function rotated(s: PaperState, id: FaceId, m: Mover, theta: number) {
  const f = s.faces.get(id)!;
  const before = compose(reflection(m.line), f.xf);
  const n = perp(m.line.d);
  const c = Math.cos(theta);
  const poly = f.cp.map((p) => {
    const q = apply(before, p);
    const d = signedDist(m.line, q);
    return add(sub(q, scale(n, d)), scale(n, d * c));
  });
  // 面的法向量 z 分量 = 原本朝上或朝下 × cos(theta)
  return { poly, frontUp: det(before) > 0 === c >= 0 };
}

function drawFolding(ctx: CanvasRenderingContext2D, v: View, { outcome, theta, preview }: Folding) {
  const s = outcome.state;
  const moverOf = new Map<FaceId, Mover>();
  for (const m of outcome.movers) for (const id of m.faces) moverOf.set(id, m);

  const order = drawOrder(s);
  const staying = order.filter((id) => !moverOf.has(id));
  const moving = order.filter((id) => moverOf.has(id));
  // 翻到一半之前，翻過去的那疊上下順序還沒顛倒
  if (theta < Math.PI / 2) moving.reverse();
  const movingFirst = outcome.movers.every((m) => m.place === 'bottom') && theta > 0;
  const shade = 0.25 * Math.abs(Math.sin(theta));

  const drawStaying = () => {
    for (const id of staying) {
      const f = s.faces.get(id)!;
      fillFace(ctx, v, foldedPolygon(f), det(f.xf) > 0);
    }
  };
  const drawMoving = (t: number, tint: boolean) => {
    for (const id of moving) {
      const r = rotated(s, id, moverOf.get(id)!, t);
      fillFace(ctx, v, r.poly, r.frontUp, shade);
      if (tint) {
        path(ctx, v, r.poly);
        ctx.fillStyle = MOVE_TINT;
        ctx.fill();
      }
    }
  };

  if (movingFirst) drawMoving(theta, preview);
  drawStaying();
  if (!movingFirst) drawMoving(theta, preview);

  if (preview) {
    // 半透明的落點
    ctx.save();
    ctx.globalAlpha = 0.55;
    const landed = [...moving].reverse();
    for (const id of landed) {
      const f = s.faces.get(id)!;
      fillFace(ctx, v, foldedPolygon(f), det(f.xf) > 0);
    }
    ctx.restore();
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#2f6fb3';
    ctx.lineWidth = 2;
    for (const id of landed) {
      path(ctx, v, foldedPolygon(s.faces.get(id)!));
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFoldLine(ctx: CanvasRenderingContext2D, v: View, l: Line, w: number, h: number) {
  const far = (w + h) / v.k;
  ctx.save();
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = GUIDE;
  ctx.lineWidth = 2.5;
  strokeSeg(ctx, v, [sub(l.p, scale(l.d, far)), add(l.p, scale(l.d, far))]);
  ctx.restore();
}

function drawCenterLine(ctx: CanvasRenderingContext2D, v: View, s: PaperState) {
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = '#9bb3c7';
  ctx.lineWidth = 1.5;
  strokeSeg(ctx, v, [
    { x: 0, y: -0.03 * s.sheet.height },
    { x: 0, y: 1.08 * s.sheet.height },
  ]);
  ctx.restore();
}

function drawNose(ctx: CanvasRenderingContext2D, v: View, s: PaperState) {
  const p = toScreen(v, { x: 0, y: 1.1 * s.sheet.height });
  ctx.save();
  ctx.fillStyle = '#5b7c99';
  ctx.font = 'bold 16px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('▲ 機頭', p.x, p.y);
  ctx.restore();
}

function drawMarker(ctx: CanvasRenderingContext2D, p: Vec2, label: string) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 11, 0, 2 * Math.PI);
  ctx.fillStyle = GUIDE;
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x, p.y + 1);
}

function drawSnap(ctx: CanvasRenderingContext2D, v: View, snap: Snap) {
  const p = toScreen(v, snap.point);
  ctx.save();
  ctx.strokeStyle = '#2f6fb3';
  ctx.fillStyle = 'rgba(47, 111, 179, 0.25)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (snap.kind === 'vertex') ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
  else if (snap.kind === 'midpoint') {
    ctx.moveTo(p.x, p.y - 10);
    ctx.lineTo(p.x + 10, p.y);
    ctx.lineTo(p.x, p.y + 10);
    ctx.lineTo(p.x - 10, p.y);
    ctx.closePath();
  } else if (snap.kind === 'line') ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
  else ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCg(ctx: CanvasRenderingContext2D, p: Vec2, hollow: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
  if (hollow) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = '#e5484d';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // 十字
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y);
    ctx.lineTo(p.x + 5, p.y);
    ctx.moveTo(p.x, p.y - 5);
    ctx.lineTo(p.x, p.y + 5);
    ctx.stroke();
    ctx.fillStyle = '#c0392b';
    ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('重心', p.x + 13, p.y);
  }
  ctx.restore();
}
