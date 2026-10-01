import { useMemo, useState } from 'preact/hooks';
import {
  type Line,
  type PaperState,
  type Paperclip,
  type PaperclipSize,
  type Vec3,
  assemblyMass,
  buildAssembly,
  foldedPolygon,
  liftCenter,
  stability,
  vec3,
} from '../../core';
import { STABILITY_TEXT } from '../text';
import { Preview3D } from './Preview3D';
import { StabilityDiagram } from './StabilityDiagram';

const MAX_CLIPS = 3;
const deg2rad = (d: number) => (d * Math.PI) / 180;

export interface PlaneLabProps {
  readonly state: PaperState;
}

export function PlaneLab(props: PlaneLabProps) {
  const { state } = props;

  // 半邊紙的尺寸：決定機翼線範圍與迴紋針預設位置。
  const { halfSpan, noseY } = useMemo(() => {
    let maxX = 1;
    let maxY = 1;
    for (const f of state.faces.values()) {
      for (const p of foldedPolygon(f)) {
        maxX = Math.max(maxX, Math.abs(p.x));
        maxY = Math.max(maxY, p.y);
      }
    }
    return { halfSpan: maxX, noseY: maxY };
  }, [state]);

  const [wingW, setWingW] = useState(() => halfSpan * 0.45);
  const [dihedralDeg, setDihedralDeg] = useState(8);
  const [clips, setClips] = useState<readonly Paperclip[]>([]);
  const [clipSize, setClipSize] = useState<PaperclipSize>('small');

  const wingLine: Line = { p: { x: wingW, y: 0 }, d: { x: 0, y: 1 } };

  const assembly = useMemo(
    () => buildAssembly(state, wingLine, deg2rad(dihedralDeg)),
    [state, wingW, dihedralDeg],
  );
  const mass = useMemo(() => assemblyMass(assembly, clips), [assembly, clips]);
  const planform = useMemo(() => liftCenter(assembly), [assembly]);
  const stab = useMemo(
    () => stability(mass.cg, planform.cp, planform.meanChord),
    [mass, planform],
  );

  const verdict = STABILITY_TEXT[stab.verdict];

  const addClip = () => {
    if (clips.length >= MAX_CLIPS) return;
    const id = (clips.reduce((mx, c) => Math.max(mx, c.id), 0) || 0) + 1;
    const pos: Vec3 = vec3(0, noseY * 0.9, wingW * 0.5);
    setClips([...clips, { id, pos, size: clipSize }]);
  };
  const removeClip = () => setClips(clips.slice(0, -1));
  const moveClip = (id: number, pos: Vec3) =>
    setClips(clips.map((c) => (c.id === id ? { ...c, pos } : c)));

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
            min={Math.round(halfSpan * 0.1)}
            max={Math.round(halfSpan * 0.9)}
            value={wingW}
            onInput={(e) => setWingW(Number((e.target as HTMLInputElement).value))}
          />
        </div>
        <div class="control">
          <label>機翼翹起（上反角）{dihedralDeg}°</label>
          <input
            type="range"
            min={-10}
            max={30}
            value={dihedralDeg}
            onInput={(e) => setDihedralDeg(Number((e.target as HTMLInputElement).value))}
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
        （在側面圖上把 📎 往機頭拖，看看重心怎麼變）
      </div>
    </div>
  );
}
