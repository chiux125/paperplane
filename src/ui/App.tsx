import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type FoldError,
  type UserOp,
  CENTER_LINE,
  applyOpOutcome,
  canRedo,
  canUndo,
  createHistory,
  createSheet,
  current,
  flipOutcome,
  isHalved,
  paperMass,
  pushApplied,
  redo,
  undo,
  vec,
} from '../core';
import { Editor, type PhaseKind, type Proposal, type Tool } from './editor/Editor';
import { ERROR_TEXT, HINT, TOOL_LABEL } from './text';

const FOLD_MS = 700;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function App() {
  const [history, setHistory] = useState(() => createHistory(createSheet()));
  const [tool, setTool] = useState<Tool>('line');
  const [pending, setPending] = useState<Proposal | null>(null);
  const [animation, setAnimation] = useState<{ proposal: Proposal; theta: number } | null>(null);
  const [phase, setPhase] = useState<PhaseKind>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const messageTimer = useRef<number | undefined>(undefined);
  const state = current(history);
  const busy = animation !== null;

  const say = (text: string) => {
    setMessage(text);
    clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 3000);
  };
  const onError = (e: FoldError) => say(ERROR_TEXT[e]);

  const cancel = () => {
    setPending(null);
    setResetKey((k) => k + 1);
  };

  /** 播放摺疊動畫，播完才真的存進歷史。 */
  const play = (proposal: Proposal) => {
    setPending(null);
    setMessage(null);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / FOLD_MS);
      if (t < 1) {
        setAnimation({ proposal, theta: Math.PI * ease(t) });
        requestAnimationFrame(tick);
      } else {
        setHistory((h) => pushApplied(h, proposal.op, proposal.outcome.state));
        setAnimation(null);
      }
    };
    requestAnimationFrame(tick);
  };

  const confirm = () => pending && play(pending);

  const halfFold = () => {
    if (isHalved(state)) return say('已經對摺好了喔');
    const op: UserOp = { kind: 'fold', line: CENTER_LINE, pick: vec(-1, state.sheet.height / 2), place: 'top', mirror: true };
    const r = applyOpOutcome(state, op);
    if (r.ok) play({ op, outcome: r.value });
    else onError(r.error);
  };

  const flipOver = () => play({ op: { kind: 'flip' }, outcome: flipOutcome(state) });

  const doUndo = () => {
    setPending(null);
    setHistory(undo);
  };
  const doRedo = () => {
    setPending(null);
    setHistory(redo);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === 'Enter' && pending) play(pending);
      else if (e.key === 'Escape') cancel();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') doUndo();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') doRedo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const mass = paperMass(state).mass;
  const hint = pending ? '這樣摺可以嗎？' : busy ? '摺摺摺…' : (HINT[tool][phase] ?? '');

  return (
    <div class="app">
      <header class="topbar">
        <h1>✈️ 紙飛機實驗室</h1>
        <div class="actions">
          <button class="action" disabled={busy || !canUndo(history)} onClick={doUndo} title="復原（Ctrl+Z）">
            ↩️<span>復原</span>
          </button>
          <button class="action" disabled={busy || !canRedo(history)} onClick={doRedo} title="重做（Ctrl+Y）">
            ↪️<span>重做</span>
          </button>
          <button class="action" disabled={busy} onClick={flipOver}>
            🔄<span>翻面</span>
          </button>
          <button class="action" disabled={busy} onClick={halfFold}>
            📖<span>對摺</span>
          </button>
          <button class="action" disabled={busy} onClick={() => setConfirmNew(true)}>
            📄<span>新的紙</span>
          </button>
        </div>
      </header>

      <div class="workspace">
        <nav class="tools">
          {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
            <button
              key={t}
              class={`tool ${tool === t ? 'selected' : ''}`}
              disabled={busy}
              onClick={() => {
                setPending(null);
                setTool(t);
              }}
            >
              <span class="icon">{TOOL_LABEL[t].icon}</span>
              <span>{TOOL_LABEL[t].text}</span>
            </button>
          ))}
          <div class="mirror-badge" title="摺一邊，另一邊會自動一起摺">
            ↔️ 左右一起摺
          </div>
        </nav>

        <div class="stage">
          <Editor
            state={state}
            tool={tool}
            pending={pending}
            animation={animation}
            resetKey={resetKey}
            onPropose={setPending}
            onError={onError}
            onPhase={setPhase}
          />
          <div class="hintbar">
            {confirmNew ? (
              <>
                <span class="hint">要換一張新的白紙嗎？</span>
                <button
                  class="yes"
                  onClick={() => {
                    setConfirmNew(false);
                    setPending(null);
                    setHistory(createHistory(createSheet()));
                  }}
                >
                  ✅ 好
                </button>
                <button class="no" onClick={() => setConfirmNew(false)}>
                  ✖ 不要
                </button>
              </>
            ) : message ? (
              <span class="hint warn">🙈 {message}</span>
            ) : (
              <>
                <span class="hint">{hint}</span>
                {pending && (
                  <>
                    <button class="yes" onClick={confirm}>
                      ✅ 摺！
                    </button>
                    <button class="no" onClick={cancel}>
                      ✖ 不要
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <footer class="footnote">
        第 {state.step} 步 · 紙重約 {mass.toFixed(1)} 公克 · 🔴 是算出來的重心，這是示意，最後以實際射出為準
      </footer>
    </div>
  );
}
