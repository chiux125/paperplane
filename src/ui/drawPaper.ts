import { type PaperState, faceList, foldedBBox, foldedPolygon, isFaceUp, stackOrder } from '../core';

const FRONT = '#fdfbf5';
const BACK = '#f6c667';
const EDGE = '#6b5b45';

/** 把目前的紙由下往上畫出來（俯視圖，y 軸朝上）。 */
export function drawPaper(canvas: HTMLCanvasElement, state: PaperState): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // 視野：原紙範圍與目前摺好後範圍的聯集，避免畫面跳來跳去
  const { width, height } = state.sheet;
  let minX = -width / 2;
  let maxX = width / 2;
  let minY = 0;
  let maxY = height;
  for (const f of state.faces.values()) {
    const b = foldedBBox(f);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  const pad = 16;
  const k = Math.min((cssW - 2 * pad) / (maxX - minX), (cssH - 2 * pad) / (maxY - minY));
  const ox = (cssW - k * (maxX - minX)) / 2 - k * minX;
  const oy = (cssH + k * (maxY - minY)) / 2 + k * minY;
  ctx.setTransform(dpr * k, 0, 0, -dpr * k, dpr * ox, dpr * oy);

  const order = stackOrder(state) ?? faceList(state).map((f) => f.id);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.2 / k;
  for (const id of order) {
    const f = state.faces.get(id)!;
    const poly = foldedPolygon(f);
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = isFaceUp(f) ? FRONT : BACK;
    ctx.fill();
    ctx.strokeStyle = EDGE;
    ctx.stroke();
  }
}
