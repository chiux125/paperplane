import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type UserOp,
  A4,
  canRedo,
  canUndo,
  createSheet,
  current,
  hingeAngle,
  lineThrough,
  push,
  redo,
  replay,
  undo,
  validate,
  vec,
} from '../core';
import { drawPaper } from './drawPaper';

// 階段 0 的除錯檢視：用標準飛鏢的前三步示範資料結構。階段 1 會換成真正的摺紙編輯器。
const { width: W, height: H } = A4;
const DEMO: UserOp[] = [
  { kind: 'fold', line: lineThrough(vec(0, H), vec(-1, H - 1))!, pick: vec(-W / 2 + 1, H - 1), place: 'top' },
  { kind: 'fold', line: lineThrough(vec(0, H), vec(1, H - 1))!, pick: vec(W / 2 - 1, H - 1), place: 'top' },
  { kind: 'fold', line: lineThrough(vec(0, 0), vec(0, 1))!, pick: vec(-50, 50), place: 'top' },
];

function demoHistory() {
  const r = replay(createSheet(), DEMO);
  if (!r.ok) throw new Error(r.error);
  let h = r.value;
  while (canUndo(h)) h = undo(h);
  return h;
}

export function App() {
  const [history, setHistory] = useState(demoHistory);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = current(history);
  const issues = validate(state);
  const valleys = state.hinges.filter((h) => hingeAngle(state, h) === 180).length;
  const mountains = state.hinges.filter((h) => hingeAngle(state, h) === -180).length;

  useEffect(() => {
    const draw = () => canvas.current && drawPaper(canvas.current, state);
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [state]);

  const doFlip = () => {
    const r = push(history, { kind: 'flip' });
    if (r.ok) setHistory(r.value);
  };

  return (
    <main>
      <header>
        <h1>紙飛機實驗室</h1>
        <p class="note">階段 0：資料結構檢視（除錯用）</p>
      </header>
      <canvas ref={canvas} class="paper" />
      <nav>
        <button disabled={!canUndo(history)} onClick={() => setHistory(undo(history))}>
          ◀ 上一步
        </button>
        <button onClick={doFlip}>🔄 翻面</button>
        <button disabled={!canRedo(history)} onClick={() => setHistory(redo(history))}>
          下一步 ▶
        </button>
      </nav>
      <dl class="stats">
        <dt>第幾步</dt>
        <dd>{state.step}</dd>
        <dt>面</dt>
        <dd>{state.faces.size}</dd>
        <dt>鉸鏈（谷／山）</dt>
        <dd>
          {state.hinges.length}（{valleys}／{mountains}）
        </dd>
        <dt>層序記錄</dt>
        <dd>{state.orders.size}</dd>
        <dt>合法性</dt>
        <dd>{issues.length === 0 ? '✅ 合法' : `⚠️ ${issues.map((i) => i.kind).join(', ')}`}</dd>
      </dl>
    </main>
  );
}
