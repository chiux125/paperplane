import { useMemo, useState } from 'preact/hooks';
import {
  type FlightBehavior,
  type PaperState,
  type UserOp,
  FLIGHT_BEHAVIORS,
  assemblyMass,
  behaviorFromVerdict,
  buildAssembly,
  liftCenter,
  stability,
} from '../../core';
import { type Design, planeMetrics, wingLineOf } from '../design';
import { BEHAVIOR_LABEL } from '../text';
import { type LogRecord, loadLog, saveLog } from './store';

const deg2rad = (d: number) => (d * Math.PI) / 180;
const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export interface FlightLogProps {
  readonly state: PaperState;
  readonly design: Design;
  readonly ops: readonly UserOp[];
  readonly onLoad: (rec: LogRecord) => void;
}

export function FlightLog(props: FlightLogProps) {
  const { state, design, ops } = props;

  const prediction = useMemo(() => {
    const { halfSpan } = planeMetrics(state);
    const assembly = buildAssembly(state, wingLineOf(design, halfSpan), deg2rad(design.dihedralDeg));
    const mass = assemblyMass(assembly, design.clips);
    const pf = liftCenter(assembly);
    const stab = stability(mass.cg, pf.cp, pf.meanChord);
    return { behavior: behaviorFromVerdict(stab.verdict), marginPct: stab.margin * 100, massG: mass.mass };
  }, [state, design]);

  const [records, setRecords] = useState<LogRecord[]>(() => loadLog());
  const [distance, setDistance] = useState('');
  const [behavior, setBehavior] = useState<FlightBehavior>('glide');

  const dist = Number(distance);
  const canSave = distance !== '' && Number.isFinite(dist) && dist >= 0;

  const save = () => {
    if (!canSave) return;
    const rec: LogRecord = {
      id: newId(),
      time: Date.now(),
      ops: [...ops],
      design,
      prediction,
      measured: { distanceCm: dist, behavior },
    };
    const next = [rec, ...records];
    setRecords(next);
    saveLog(next);
    setDistance('');
  };
  const del = (id: string) => {
    const next = records.filter((r) => r.id !== id);
    setRecords(next);
    saveLog(next);
  };

  const pb = BEHAVIOR_LABEL[prediction.behavior];

  return (
    <div class="flightlog">
      <div class="log-top">
        <div class="predict-card">
          <div class="predict-title">工具猜它會…</div>
          <div class="predict-behavior">
            <span class="big-emoji">{pb.icon}</span>
            <span>{pb.text}</span>
          </div>
          <div class="predict-nums">
            穩定裕度約 {prediction.marginPct.toFixed(0)}% · 重約 {prediction.massG.toFixed(1)} 公克
          </div>
          <div class="predict-note">這是示意，最後以實際射出為準</div>
        </div>

        <div class="log-form">
          <div class="form-hint">🚀 射射看！每次都用一樣的方式發射，比起來才準</div>
          <label class="form-row">
            這次飛多遠？
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={distance}
              placeholder="公分"
              onInput={(e) => setDistance((e.target as HTMLInputElement).value)}
            />
            <span>公分</span>
          </label>
          <div class="form-row behaviors">
            怎麼飛？
            {FLIGHT_BEHAVIORS.map((b) => (
              <button
                key={b}
                class={`chip ${behavior === b ? 'on' : ''}`}
                onClick={() => setBehavior(b)}
              >
                {BEHAVIOR_LABEL[b].icon} {BEHAVIOR_LABEL[b].text}
              </button>
            ))}
          </div>
          <button class="yes save-btn" disabled={!canSave} onClick={save}>
            💾 存起來
          </button>
        </div>
      </div>

      <div class="log-list">
        {records.length === 0 ? (
          <div class="log-empty">還沒有紀錄。摺好、射出去，把結果存下來，就能慢慢看出什麼設計飛得好 👀</div>
        ) : (
          records.map((r) => {
            const mb = BEHAVIOR_LABEL[r.measured.behavior];
            const rp = BEHAVIOR_LABEL[r.prediction.behavior];
            const match = r.prediction.behavior === r.measured.behavior;
            return (
              <div class="log-row" key={r.id}>
                <div class="row-dist">{r.measured.distanceCm}<span>cm</span></div>
                <div class="row-mid">
                  <div class="row-behaviors">
                    <span title="實際">{mb.icon} {mb.text}</span>
                    <span class="row-vs">預測 {rp.icon}{match ? ' ✅' : ''}</span>
                  </div>
                  <div class="row-design">
                    上反角 {r.design.dihedralDeg}° · 斜度 {r.design.tiltDeg}° · 迴紋針 {r.design.clips.length} · 裕度 {r.prediction.marginPct.toFixed(0)}%
                  </div>
                </div>
                <div class="row-actions">
                  <button class="chip" title="把這個設計重新摺出來" onClick={() => props.onLoad(r)}>
                    📂 載入
                  </button>
                  <button class="chip" onClick={() => del(r.id)}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
