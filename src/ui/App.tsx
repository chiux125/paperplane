import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type FoldError,
  type Line,
  type ReverseOption,
  type UserOp,
  type Vec2,
  CENTER_LINE,
  applyOp,
  applyOpOutcome,
  canRedo,
  reverseFold,
  reverseFoldOptions,
  canUndo,
  createHistory,
  createSheet,
  current,
  doneOps,
  flipOutcome,
  isHalved,
  paperMass,
  pushApplied,
  redo,
  replay,
  undo,
  vec,
} from '../core';
import { Editor, type PhaseKind, type Proposal, type Tool } from './editor/Editor';
import { ReversePicker } from './editor/ReversePicker';
import { type Design, DEFAULT_DESIGN } from './design';
import { FlightLog } from './log/FlightLog';
import type { LogRecord } from './log/store';
import { PlaneLab } from './plane/PlaneLab';
import { WindTunnel } from './windtunnel/WindTunnel';
import { ERROR_TEXT, HINT, TOOL_LABEL } from './text';

type Mode = 'fold' | 'plane' | 'tunnel' | 'log';

const FOLD_MS = 700;
const CREASE_MS = 900;
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
  const [mode, setMode] = useState<Mode>('fold');
  const [design, setDesign] = useState<Design>(DEFAULT_DESIGN);
  const [reverseMode, setReverseMode] = useState(false);
  const [reverseOpts, setReverseOpts] = useState<{ options: ReverseOption[]; line: Line; pick: Vec2 } | null>(null);
  const messageTimer = useRef<number | undefined>(undefined);
  const state = current(history);
  const busy = animation !== null;
  const halved = isHalved(state);
  // 還沒對摺就不能看飛機／風洞；若狀態退回到沒對摺，自動當作摺紙模式。
  const activeMode: Mode = (mode === 'plane' || mode === 'tunnel' || mode === 'log') && halved ? mode : 'fold';

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

  /** 摺痕：沿同一條線摺一下再攤開，留下摺痕與交點（動畫會摺起來再回來）。 */
  const makeCrease = (proposal: Proposal) => {
    if (proposal.op.kind !== 'fold') return;
    const op: UserOp = { kind: 'crease', line: proposal.op.line };
    const r = applyOp(state, op);
    if (!r.ok) return onError(r.error);
    const creased = r.value;
    setPending(null);
    setMessage(null);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / CREASE_MS);
      if (t < 1) {
        // 0 → π → 0：摺起來再攤平
        const phase = t < 0.5 ? ease(t * 2) : ease((1 - t) * 2);
        setAnimation({ proposal, theta: Math.PI * phase });
        requestAnimationFrame(tick);
      } else {
        setHistory((h) => pushApplied(h, op, creased));
        setAnimation(null);
      }
    };
    requestAnimationFrame(tick);
  };

  const halfFold = () => {
    if (isHalved(state)) return say('已經對摺好了喔');
    const op: UserOp = { kind: 'fold', line: CENTER_LINE, pick: vec(-1, state.sheet.height / 2), place: 'top', mirror: true };
    const r = applyOpOutcome(state, op);
    if (r.ok) play({ op, outcome: r.value });
    else onError(r.error);
  };

  const flipOver = () => play({ op: { kind: 'flip' }, outcome: flipOutcome(state) });

  /** 載入一筆紀錄的設計：從白紙重播摺紙步驟，並套回機翼／迴紋針設定。 */
  const loadRecord = (rec: LogRecord) => {
    const r = replay(createSheet(), rec.ops);
    if (!r.ok) return say('這個紀錄載入失敗了');
    setPending(null);
    setReverseOpts(null);
    setHistory(r.value);
    setDesign(rec.design);
    setMode('plane');
  };

  /** 反摺：畫線並點了一側後，算出合法選項讓孩子挑。 */
  const onReverse = (line: Line, pick: Vec2) => {
    const options = reverseFoldOptions(state, line, pick);
    if (options.length === 0) return say('這裡沒辦法反摺，換個地方試試');
    setPending(null);
    setReverseOpts({ options, line, pick });
  };
  const pickReverse = (o: ReverseOption) => {
    if (!reverseOpts) return;
    const op: UserOp = { kind: 'reverse', line: reverseOpts.line, pick: reverseOpts.pick, style: o.style };
    setReverseOpts(null);
    play({ op, outcome: o.outcome });
  };
  const cancelReverse = () => {
    setReverseOpts(null);
    setResetKey((k) => k + 1);
  };

  // 一般摺法：如果「只摺最上面那片」可行且和整疊摺不同，就多給一個選項（不多出操作步驟）。
  const topOnly = useMemo(() => {
    if (!pending || pending.op.kind !== 'fold') return null;
    const r = reverseFold(state, pending.op.line, pending.op.pick, 'top-over');
    return r.ok ? r.value : null;
  }, [pending, state]);
  const applyTopOnly = () => {
    if (!pending || pending.op.kind !== 'fold' || !topOnly) return;
    const op: UserOp = { kind: 'reverse', line: pending.op.line, pick: pending.op.pick, style: 'top-over' };
    play({ op, outcome: topOnly });
  };

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
  const hint = pending
    ? '這樣摺可以嗎？'
    : busy
      ? '摺摺摺…'
      : reverseMode
        ? '反摺模式：' + (HINT[tool][phase] ?? '定好要反摺的地方')
        : (HINT[tool][phase] ?? '');

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

      <nav class="modes">
        <button
          class={`mode ${activeMode === 'fold' ? 'selected' : ''}`}
          disabled={busy}
          onClick={() => setMode('fold')}
        >
          📐 摺紙
        </button>
        <button
          class={`mode ${activeMode === 'plane' ? 'selected' : ''}`}
          disabled={busy || !halved}
          title={halved ? '' : '先按「對摺」才能看飛機喔'}
          onClick={() => (halved ? setMode('plane') : say('先按「對摺」，再來看飛機 ✈️'))}
        >
          ✈️ 看飛機{halved ? '' : '（先對摺）'}
        </button>
        <button
          class={`mode ${activeMode === 'tunnel' ? 'selected' : ''}`}
          disabled={busy || !halved}
          title={halved ? '' : '先按「對摺」才能吹風洞喔'}
          onClick={() => (halved ? setMode('tunnel') : say('先按「對摺」，再來吹風洞 💨'))}
        >
          💨 風洞{halved ? '' : '（先對摺）'}
        </button>
        <button
          class={`mode ${activeMode === 'log' ? 'selected' : ''}`}
          disabled={busy || !halved}
          title={halved ? '' : '先摺好飛機才能記錄喔'}
          onClick={() => (halved ? setMode('log') : say('先摺好飛機，再來記錄 📏'))}
        >
          📏 射射看{halved ? '' : '（先對摺）'}
        </button>
      </nav>

      {activeMode === 'plane' ? (
        <PlaneLab state={state} design={design} onChange={setDesign} />
      ) : activeMode === 'tunnel' ? (
        <WindTunnel state={state} design={design} />
      ) : activeMode === 'log' ? (
        <FlightLog state={state} design={design} ops={doneOps(history)} onLoad={loadRecord} />
      ) : (
      <div class="workspace">
        <nav class="tools">
          {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
            <button
              key={t}
              class={`tool ${tool === t ? 'selected' : ''}`}
              disabled={busy || reverseOpts !== null}
              onClick={() => {
                setPending(null);
                setReverseOpts(null);
                setTool(t);
              }}
            >
              <span class="icon">{TOOL_LABEL[t].icon}</span>
              <span>{TOOL_LABEL[t].text}</span>
            </button>
          ))}
          <button
            class={`revmode ${reverseMode ? 'on' : ''}`}
            disabled={busy || reverseOpts !== null}
            title="開啟後，摺出來的那一摺會列出「塞進去／包起來…」等反摺選項讓你挑"
            onClick={() => {
              setPending(null);
              setReverseOpts(null);
              setReverseMode((v) => !v);
            }}
          >
            🔀 反摺{reverseMode ? '：開' : ''}
          </button>
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
            reverseMode={reverseMode}
            onReverse={onReverse}
            locked={reverseOpts !== null}
            onPropose={setPending}
            onError={onError}
            onPhase={setPhase}
          />
          <div class="hintbar">
            {reverseOpts ? (
              <ReversePicker options={reverseOpts.options} onPick={pickReverse} onCancel={cancelReverse} />
            ) : confirmNew ? (
              <>
                <span class="hint">要換一張新的白紙嗎？</span>
                <button
                  class="yes"
                  onClick={() => {
                    setConfirmNew(false);
                    setPending(null);
                    setHistory(createHistory(createSheet()));
                    setDesign((d) => ({ ...d, clips: [] }));
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
                    {topOnly && (
                      <button class="toponly" title="只把最上面那一片翻過去，底下的紙不動" onClick={applyTopOnly}>
                        ☝️ 只摺最上面
                      </button>
                    )}
                    <button class="crease" title="摺一下再攤開，留下摺痕當記號" onClick={() => makeCrease(pending)}>
                      📑 留摺痕
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
      )}

      <footer class="footnote">
        {activeMode === 'plane'
          ? '🔴 重心、🔵 升力中心，都是算出來的示意，最後以實際射出為準'
          : activeMode === 'tunnel'
            ? '💨 煙線是簡化流場的示意，不是真的空氣，最後以實際射出為準'
            : `第 ${state.step} 步 · 紙重約 ${mass.toFixed(1)} 公克 · 🔴 是算出來的重心，這是示意，最後以實際射出為準`}
      </footer>
    </div>
  );
}
