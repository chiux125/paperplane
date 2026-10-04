import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type FoldError,
  type FoldOutcome,
  type FoldSpec,
  type Line,
  type PaperState,
  type Result,
  type Seg,
  type UserOp,
  type Vec2,
  add,
  applyOpOutcome,
  closestOnSeg,
  dist,
  edgeToEdge,
  freeLineFold,
  lineThrough,
  midpoint,
  nearestSegment,
  ok,
  paperMass,
  perp,
  pointToPoint,
  scale,
  signedDist,
  snapPoint,
  snapSources,
} from '../../core';
import { type Folding, render } from './render';
import { type View, fitView, toScreen, toWorld } from './view';

export type Tool = 'line' | 'point' | 'edge';

/** 一個算好、等孩子確認的摺法。 */
export interface Proposal {
  readonly op: UserOp;
  readonly outcome: FoldOutcome;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'drawing'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'side'; readonly a: Vec2; readonly b: Vec2; readonly left: Result<Proposal>; readonly right: Result<Proposal> }
  | { readonly kind: 'pointA'; readonly a: Vec2 }
  | { readonly kind: 'edgeFrom'; readonly from: Seg; readonly grab: Vec2 };

export type PhaseKind = Phase['kind'];

// 吸附半徑（px）
const SNAP_PX = 14;
const EDGE_PX = 12;

export interface EditorProps {
  readonly state: PaperState;
  readonly tool: Tool;
  /** 等待確認中的摺法（鎖定預覽）。 */
  readonly pending: Proposal | null;
  /** 播放摺疊動畫中。 */
  readonly animation: { readonly proposal: Proposal; readonly theta: number } | null;
  /** 改變這個值會清除進行到一半的操作。 */
  readonly resetKey: number;
  /** 反摺模式：開啟時，三種畫法摺出來的那一摺改成「列出反摺選項讓孩子挑」。 */
  readonly reverseMode?: boolean;
  /** 定好摺線與要反摺的那一側後呼叫（由 App 算出合法選項）。 */
  readonly onReverse?: (line: Line, pick: Vec2) => void;
  /** 鎖住畫布（例如正在挑反摺選項時）。 */
  readonly locked?: boolean;
  readonly onPropose: (p: Proposal) => void;
  readonly onError: (e: FoldError) => void;
  readonly onPhase: (p: PhaseKind) => void;
}

function propose(state: PaperState, spec: Result<FoldSpec>): Result<Proposal> {
  if (!spec.ok) return spec;
  // 鏡像模式預設開啟
  const op: UserOp = { kind: 'fold', line: spec.value.line, pick: spec.value.pick, place: 'top', mirror: true };
  const outcome = applyOpOutcome(state, op);
  return outcome.ok ? ok({ op, outcome: outcome.value }) : outcome;
}

export function Editor(props: EditorProps) {
  const { state, tool, pending, animation } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [hover, setHover] = useState<Vec2 | null>(null);
  // 使用者自己放大縮小／平移（疊在自動對齊的基準視圖上）。null = 完全自動對齊。
  const [zoomView, setZoomView] = useState<{ zoom: number; panX: number; panY: number } | null>(null);
  // 「手掌」移動紙張模式；拖曳時記住起點。
  const [panMode, setPanMode] = useState(false);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useLayoutEffect(() => {
    const el = canvas.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setPhase({ kind: 'idle' }), [state, tool, props.resetKey]);
  // 選了摺紙工具就退出「移動紙張」模式。
  useEffect(() => setPanMode(false), [tool]);
  useEffect(() => props.onPhase(phase.kind), [phase.kind]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPhase({ kind: 'idle' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const base = useMemo(() => fitView(state, size.w || 1, size.h || 1), [state, size]);
  // 把使用者的放大倍率與平移套在基準視圖上（以畫布中心為縮放基準）。
  const view: View = useMemo(() => {
    if (!zoomView) return base;
    const cx = (size.w || 1) / 2;
    const cy = (size.h || 1) / 2;
    return {
      k: base.k * zoomView.zoom,
      ox: cx + (base.ox - cx) * zoomView.zoom + zoomView.panX,
      oy: cy + (base.oy - cy) * zoomView.zoom + zoomView.panY,
    };
  }, [base, zoomView, size]);
  const sources = useMemo(() => snapSources(state), [state]);
  const cg = useMemo(() => paperMass(state).cg, [state]);
  const busy = pending !== null || animation !== null || props.locked === true;

  // 以畫面上的 (mx, my) 為中心放大／縮小：讓那個點底下的紙保持在原位。
  const ZOOM_MIN = 0.6;
  const ZOOM_MAX = 8;
  const zoomAt = (factor: number, mx: number, my: number) => {
    const cw = size.w || 1;
    const ch = size.h || 1;
    const cx = cw / 2;
    const cy = ch / 2;
    const cur = zoomView ?? { zoom: 1, panX: 0, panY: 0 };
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cur.zoom * factor));
    if (z === cur.zoom) return;
    const v0: View = {
      k: base.k * cur.zoom,
      ox: cx + (base.ox - cx) * cur.zoom + cur.panX,
      oy: cy + (base.oy - cy) * cur.zoom + cur.panY,
    };
    const wp = toWorld(v0, mx, my);
    const noPan: View = { k: base.k * z, ox: cx + (base.ox - cx) * z, oy: cy + (base.oy - cy) * z };
    const s = toScreen(noPan, wp);
    setZoomView({ zoom: z, panX: mx - s.x, panY: my - s.y });
  };
  // 給滾輪事件讀最新的 zoomAt（避免每次都重掛監聽器）。
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;

  // 滾輪縮放（以游標為中心）。用原生監聽器才擋得掉頁面捲動。
  useEffect(() => {
    const el = canvas.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAtRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 視窗大小變了就回到自動對齊（存的平移是 px，會跟著失準）。
  useEffect(() => setZoomView(null), [size.w, size.h]);

  const snap = hover && !busy && tool !== 'edge' && phase.kind !== 'side' ? snapPoint(sources, hover, SNAP_PX / view.k) : null;
  const hoverEdge = hover && !busy && tool === 'edge' ? nearestSegment(sources.segments, hover, EDGE_PX / view.k) : null;
  const snapped = (w: Vec2) => snapPoint(sources, w, SNAP_PX / view.k).point;

  // 滑鼠停著的時候就先預覽
  const hoverKey = snap ? `${snap.point.x},${snap.point.y}` : hoverEdge ? `${hoverEdge[0].x},${hoverEdge[0].y},${hoverEdge[1].x},${hoverEdge[1].y}` : '';
  const hoverSide = phase.kind === 'side' && hover ? (sideOf(phase, hover) > 0 ? 'left' : 'right') : null;
  const hoverProposal = useMemo((): Result<Proposal> | null => {
    if (busy || props.reverseMode) return null; // 反摺模式不預覽一般摺，等孩子從選項挑
    if (phase.kind === 'side' && hoverSide) return phase[hoverSide];
    if (phase.kind === 'pointA' && snap && dist(snap.point, phase.a) > 1e-6) return propose(state, pointToPoint(phase.a, snap.point));
    if (phase.kind === 'edgeFrom' && hoverEdge) return propose(state, edgeToEdge(phase.from, phase.grab, hoverEdge));
    return null;
  }, [phase, hoverKey, hoverSide, busy, state, props.reverseMode]);

  useEffect(() => {
    if (!canvas.current || size.w === 0) return;
    let folding: Folding | null = null;
    if (animation) folding = { outcome: animation.proposal.outcome, theta: animation.theta, preview: false };
    else if (pending) folding = { outcome: pending.outcome, theta: 0, preview: true };
    else if (hoverProposal?.ok) folding = { outcome: hoverProposal.value.outcome, theta: 0, preview: true };

    const foldLines: Line[] = folding && !animation ? folding.outcome.movers.map((m) => m.line) : [];
    const edges: { seg: Seg; color: string }[] = [];
    if (phase.kind === 'edgeFrom' && !animation) edges.push({ seg: phase.from, color: '#f08c00' });
    if (hoverEdge) edges.push({ seg: hoverEdge, color: phase.kind === 'edgeFrom' ? '#2b9a66' : '#2f6fb3' });

    render(canvas.current, {
      state,
      view,
      folding,
      foldLines,
      drawingSeg: phase.kind === 'drawing' || (phase.kind === 'side' && !folding) ? [phase.a, phase.b] : null,
      markers: phase.kind === 'pointA' && !animation ? [phase.a] : [],
      edges,
      snap,
      cg,
      previewCg: folding?.preview ? paperMass(folding.outcome.state).cg : null,
    });
  });

  const world = (e: PointerEvent): Vec2 => {
    const r = canvas.current!.getBoundingClientRect();
    return toWorld(view, e.clientX - r.left, e.clientY - r.top);
  };

  const submit = (r: Result<Proposal>) => {
    if (r.ok) props.onPropose(r.value);
    else props.onError(r.error);
  };

  // 反摺模式：定好摺線＋要反摺的那一側，交給 App 列選項；否則照常提出摺法。
  const finish = (spec: Result<FoldSpec>) => {
    if (props.reverseMode) {
      if (spec.ok) props.onReverse?.(spec.value.line, spec.value.pick);
      else props.onError(spec.error);
    } else {
      submit(propose(state, spec));
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (panMode) {
      if (e.button !== 0) return;
      canvas.current!.setPointerCapture(e.pointerId);
      const cur = zoomView ?? { zoom: 1, panX: 0, panY: 0 };
      panStart.current = { x: e.clientX, y: e.clientY, panX: cur.panX, panY: cur.panY };
      return;
    }
    if (busy || e.button !== 0) return;
    const w = world(e);
    if (tool === 'line') {
      if (phase.kind === 'side') {
        if (props.reverseMode) {
          const l = lineThrough(phase.a, phase.b);
          if (l) props.onReverse?.(l, w);
        } else {
          submit(sideOf(phase, w) > 0 ? phase.left : phase.right);
        }
      } else {
        const a = snapped(w);
        canvas.current!.setPointerCapture(e.pointerId);
        setPhase({ kind: 'drawing', a, b: a });
      }
    } else if (tool === 'point') {
      const p = snapped(w);
      if (phase.kind === 'pointA') finish(pointToPoint(phase.a, p));
      else setPhase({ kind: 'pointA', a: p });
    } else {
      const seg = nearestSegment(sources.segments, w, EDGE_PX / view.k);
      if (!seg) return;
      if (phase.kind === 'edgeFrom') finish(edgeToEdge(phase.from, phase.grab, seg));
      else setPhase({ kind: 'edgeFrom', from: seg, grab: closestOnSeg(w, seg[0], seg[1]) });
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (panMode) {
      if (panStart.current) {
        const ps = panStart.current;
        const cur = zoomView ?? { zoom: 1, panX: 0, panY: 0 };
        setZoomView({ zoom: cur.zoom, panX: ps.panX + (e.clientX - ps.x), panY: ps.panY + (e.clientY - ps.y) });
      }
      return;
    }
    const w = world(e);
    setHover(w);
    // 按住 Shift：依孩子拉的方向，把線校正成完美水平或垂直
    if (phase.kind === 'drawing') setPhase({ ...phase, b: e.shiftKey ? axisAlign(phase.a, w) : snapped(w) });
  };

  const onPointerUp = () => {
    if (panStart.current) {
      panStart.current = null;
      return;
    }
    if (phase.kind !== 'drawing') return;
    const { a, b } = phase;
    if (dist(a, b) * view.k < 8) {
      setPhase({ kind: 'idle' });
      return;
    }
    // 兩邊各算一次，孩子移動滑鼠時就能馬上看到預覽
    const n = perp(scale({ x: b.x - a.x, y: b.y - a.y }, 1 / dist(a, b)));
    const m = midpoint(a, b);
    const side = (k: number) => propose(state, freeLineFold(a, b, add(m, scale(n, k))));
    setPhase({ kind: 'side', a, b, left: side(1), right: side(-1) });
  };

  const cx = (size.w || 1) / 2;
  const cy = (size.h || 1) / 2;

  return (
    <div class="editor-wrap">
      <canvas
        ref={canvas}
        class={`editor ${panMode ? 'pan' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      />
      <div class="editor-zoom">
        <button type="button" title="放大" onClick={() => zoomAt(1.3, cx, cy)}>
          🔍➕
        </button>
        <button type="button" title="縮小" onClick={() => zoomAt(1 / 1.3, cx, cy)}>
          🔍➖
        </button>
        <button
          type="button"
          class={panMode ? 'on' : ''}
          title="移動紙張：點一下，再拖曳把紙移到想看的位置"
          onClick={() => {
            setPanMode((v) => !v);
            setHover(null);
          }}
        >
          ✋
        </button>
        <button type="button" title="全部看到" onClick={() => setZoomView(null)}>
          ⤢
        </button>
      </div>
    </div>
  );
}

/** 把 b 校正成相對 a 完美水平或垂直（看拉的方向比較偏哪一個）。 */
function axisAlign(a: Vec2, w: Vec2): Vec2 {
  return Math.abs(w.x - a.x) >= Math.abs(w.y - a.y) ? { x: w.x, y: a.y } : { x: a.x, y: w.y };
}

function sideOf(phase: { a: Vec2; b: Vec2 }, w: Vec2): number {
  const d = dist(phase.a, phase.b);
  const line = { p: phase.a, d: { x: (phase.b.x - phase.a.x) / d, y: (phase.b.y - phase.a.y) / d } };
  return signedDist(line, w);
}
