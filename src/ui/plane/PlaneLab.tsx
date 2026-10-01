import { useMemo, useState } from 'preact/hooks';
import {
  type PaperState,
  type Paperclip,
  type PaperclipSize,
  type Vec3,
  assemblyMass,
  buildAssembly,
  liftCenter,
  stability,
  vec3,
} from '../../core';
import { type Design, planeMetrics, wingLineOf } from '../design';
import { STABILITY_TEXT } from '../text';
import { Preview3D } from './Preview3D';
import { StabilityDiagram } from './StabilityDiagram';

const MAX_CLIPS = 3;
const deg2rad = (d: number) => (d * Math.PI) / 180;

export interface PlaneLabProps {
  readonly state: PaperState;
  readonly design: Design;
  readonly onChange: (next: Design) => void;
}

export function PlaneLab(props: PlaneLabProps) {
  const { state, design, onChange } = props;
  const [clipSize, setClipSize] = useState<PaperclipSize>('small');

  const { halfSpan, noseY } = useMemo(() => planeMetrics(state), [state]);
  const wingW = design.wingFrac * halfSpan;
  const wingLine = wingLineOf(design, halfSpan);
  const clips = design.clips;

  const assembly = useMemo(
    () => buildAssembly(state, wingLine, deg2rad(design.dihedralDeg)),
    [state, design.wingFrac, design.tiltDeg, design.dihedralDeg],
  );
  const mass = useMemo(() => assemblyMass(assembly, clips), [assembly, clips]);
  const planform = useMemo(() => liftCenter(assembly), [assembly]);
  const stab = useMemo(() => stability(mass.cg, planform.cp, planform.meanChord), [mass, planform]);

  const verdict = STABILITY_TEXT[stab.verdict];
  const patch = (p: Partial<Design>) => onChange({ ...design, ...p });

  const addClip = () => {
    if (clips.length >= MAX_CLIPS) return;
    const id = (clips.reduce((mx, c) => Math.max(mx, c.id), 0) || 0) + 1;
    const pos: Vec3 = vec3(0, noseY * 0.9, wingW * 0.5);
    patch({ clips: [...clips, { id, pos, size: clipSize }] });
  };
  const removeClip = () => patch({ clips: clips.slice(0, -1) });
  const moveClip = (id: number, pos: Vec3) =>
    patch({ clips: clips.map((c: Paperclip) => (c.id === id ? { ...c, pos } : c)) });

  return (
    <div class="planelab">
      <div class={`verdict ${stab.verdict}`}>
        <span class="verdict-emoji">{verdict.emoji}</span>
        <span>{verdict.text}</span>
        <span class="verdict-note">這是示意，最後以實際射出為準</span>
      </div>

      <div class="planelab-main">
        <div class="preview-wrap">
          <div class="panel-label">用滑鼠拖一拖，轉轉看飛機 ✈️</div>
          <Preview3D assembly={assembly} cg={mass.cg} cp={planform.cp} clips={clips} />
        </div>
        <div class="diagram-wrap">
          <StabilityDiagram
            assembly={assembly}
            cg={mass.cg}
            cp={planform.cp}
            clips={clips}
            onMoveClip={moveClip}
          />
        </div>
      </div>

      <div class="planelab-controls">
        <div class="control">
          <label>機翼位置</label>
          <input
            type="range"
            min={10}
            max={90}
            value={Math.round(design.wingFrac * 100)}
            onInput={(e) => patch({ wingFrac: Number((e.target as HTMLInputElement).value) / 100 })}
          />
        </div>
        <div class="control">
          <label>機翼摺線斜度 {design.tiltDeg}°</label>
          <input
            type="range"
            min={-15}
            max={15}
            value={design.tiltDeg}
            onInput={(e) => patch({ tiltDeg: Number((e.target as HTMLInputElement).value) })}
          />
        </div>
        <div class="control">
          <label>機翼翹起（上反角）{design.dihedralDeg}°</label>
          <input
            type="range"
            min={-10}
            max={30}
            value={design.dihedralDeg}
            onInput={(e) => patch({ dihedralDeg: Number((e.target as HTMLInputElement).value) })}
          />
        </div>
        <div class="control clip-control">
          <label>迴紋針（{clips.length}／{MAX_CLIPS}）</label>
          <div class="clip-buttons">
            <button class="chip" onClick={removeClip} disabled={clips.length === 0}>
              ➖
            </button>
            <button class="chip" onClick={addClip} disabled={clips.length >= MAX_CLIPS}>
              ➕ 📎
            </button>
            <button
              class={`chip size ${clipSize === 'small' ? 'on' : ''}`}
              onClick={() => setClipSize('small')}
            >
              小📎
            </button>
            <button
              class={`chip size ${clipSize === 'large' ? 'on' : ''}`}
              onClick={() => setClipSize('large')}
            >
              大📎
            </button>
          </div>
        </div>
      </div>

      <div class="planelab-foot">
        飛機重約 {mass.mass.toFixed(1)} 公克 · 穩定裕度約 {(stab.margin * 100).toFixed(0)}%
        · 機翼內建攻角約 {((assembly.wingIncidence * 180) / Math.PI).toFixed(0)}°
        （在側面圖上把 📎 往機頭拖，看看重心怎麼變）
      </div>
    </div>
  );
}
