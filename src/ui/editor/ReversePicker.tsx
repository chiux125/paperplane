import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  type PaperState,
  type ReverseOption,
  det,
  faceList,
  foldedPolygon,
  stackOrder,
} from '../../core';
import { REVERSE_LABEL } from '../text';
import { fitView, toScreen } from './view';

const FRONT = '#fdfbf5';
const BACK = '#f6c667';
const EDGE = '#6b5b45';

/** 把一個摺好的狀態畫成小縮圖，給孩子預覽選項。 */
function Thumbnail({ state }: { state: PaperState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const view = fitView(state, w, h);
    const order = stackOrder(state) ?? faceList(state).map((f) => f.id);
    for (const id of order) {
      const f = state.faces.get(id)!;
      ctx.beginPath();
      foldedPolygon(f).forEach((p, i) => {
        const s = toScreen(view, p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = det(f.xf) > 0 ? FRONT : BACK;
      ctx.fill();
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  });
  return <canvas ref={ref} class="thumb" />;
}

export interface ReversePickerProps {
  readonly options: readonly ReverseOption[];
  readonly onPick: (o: ReverseOption) => void;
  readonly onCancel: () => void;
}

export function ReversePicker(props: ReversePickerProps) {
  return (
    <div class="reverse-picker">
      <span class="hint">要哪一種摺法？</span>
      <div class="picker-opts">
        {props.options.map((o) => (
          <button key={o.style} class="picker-opt" onClick={() => props.onPick(o)}>
            <Thumbnail state={o.outcome.state} />
            <span>
              {REVERSE_LABEL[o.style].icon} {REVERSE_LABEL[o.style].text}
            </span>
          </button>
        ))}
      </div>
      <button class="no" onClick={props.onCancel}>
        ✖ 不要
      </button>
    </div>
  );
}
