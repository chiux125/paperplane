import { useMemo, useState } from 'preact/hooks';
import {
  type FaceId,
  type PaperState,
  assemblyMass,
  bendableFaces,
  buildAssembly,
  displayPieces,
  flapAnchor,
  flapIndexOf,
  flapFacesOf,
  flapPartners,
  liftCenter,
  stability,
} from '../../core';
import { type Design, bendsOf, flapKey, planeMetrics, wingLineOf } from '../design';
import { STABILITY_TEXT } from '../text';
import { Preview3D } from './Preview3D';

const deg2rad = (d: number) => (d * Math.PI) / 180;

export interface PlaneLabProps {
  readonly state: PaperState;
  readonly design: Design;
  readonly onChange: (next: Design) => void;
}

export function PlaneLab(props: PlaneLabProps) {
  const { state, design, onChange } = props;

  const { halfSpan } = useMemo(() => planeMetrics(state), [state]);
  const wingLine = wingLineOf(design, halfSpan);
  const clips = design.clips;

  const assembly = useMemo(
    () => buildAssembly(state, wingLine, deg2rad(design.dihedralDeg), bendsOf(state, design)),
    [state, design.wingFrac, design.tiltDeg, design.dihedralDeg, flapKey(design)],
  );

  // ── 點選翼片 ──
  const flaps = design.flaps ?? [];
  const bendable = useMemo(() => new Set(bendableFaces(state)), [state]);
  const [hoverId, setHoverId] = useState<FaceId | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sel = selectedIdx !== null && selectedIdx < flaps.length ? selectedIdx : null;
  // 滑鼠指著的那片翼片（連同左右對稱的那片）一起發亮
  const hovered = useMemo(
    () => new Set(hoverId !== null ? flapPartners(state, hoverId) : []),
    [hoverId, state],
  );
  const selected = useMemo(
    () => new Set(sel === null ? [] : flapFacesOf(state, flaps[sel])),
    [sel, flapKey(design), state],
  );
  const say = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((t) => (t === text ? null : t)), 2500);
  };
  const onPick = (id: FaceId | null) => {
    if (id === null) return setSelectedIdx(null);
    if (!bendable.has(id)) {
      setSelectedIdx(null);
      return say('這片被扣住了，翹不起來喔 🔒　試試會發亮的那些 ✨');
    }
    const idx = flapIndexOf(state, flaps, id);
    if (idx >= 0) return setSelectedIdx(idx);
    // 新選一片：先翹 30°，馬上看得到效果。改用逐片設定後，舊版「全部一起翹」歸零。
    patch({ flaps: [...flaps, { at: flapAnchor(state, id), deg: 30 }], flapBendDeg: 0 });
    setSelectedIdx(flaps.length);
  };
  const setFlapDeg = (deg: number) => {
    if (sel === null) return;
    patch({ flaps: flaps.map((f, i) => (i === sel ? { ...f, deg } : f)) });
  };
  const dropFlap = () => {
    if (sel === null) return;
    patch({ flaps: flaps.filter((_, i) => i !== sel) });
    setSelectedIdx(null);
  };
  const shown = useMemo(() => displayPieces(state, assembly), [state, assembly]);
  const mass = useMemo(() => assemblyMass(assembly, clips), [assembly, clips]);
  const planform = useMemo(() => liftCenter(assembly), [assembly]);
  const stab = useMemo(() => stability(mass.cg, planform.cp, planform.meanChord), [mass, planform]);

  const verdict = STABILITY_TEXT[stab.verdict];
  const patch = (p: Partial<Design>) => onChange({ ...design, ...p });

  return (
    <div class="planelab">
      <div class="preview-wrap">
        <div class={`verdict-badge ${stab.verdict}`}>
          <span class="verdict-emoji">{verdict.emoji}</span>
          <span>{verdict.text}</span>
        </div>
        <div class="panel-label">
          {note ?? '拖一拖轉轉看 ✈️　點會發亮的翼片把它翹起 👆'}
        </div>
        <Preview3D
          pieces={shown}
          cg={mass.cg}
          cp={planform.cp}
          clips={clips}
          hovered={hovered}
          selected={selected}
          clickable={bendable}
          onHover={setHoverId}
          onPick={onPick}
        />
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
        <div class="control">
          {sel !== null ? (
            <>
              <label>
                選到的翼片翹起 {flaps[sel].deg}°
                <button class="chip flap-drop" onClick={dropFlap}>
                  ↩️ 放下
                </button>
              </label>
              <input
                type="range"
                min={0}
                max={80}
                value={flaps[sel].deg}
                onInput={(e) => setFlapDeg(Number((e.target as HTMLInputElement).value))}
              />
            </>
          ) : (
            <>
              <label>翼片翹起{flaps.length > 0 ? `（已翹起 ${flaps.length} 組）` : ''}</label>
              <div class="flap-hint">👆 在左邊的飛機上點一片翼片</div>
            </>
          )}
        </div>
      </div>

      <div class="planelab-foot">
        飛機重約 {mass.mass.toFixed(1)} 公克 · 穩定裕度約 {(stab.margin * 100).toFixed(0)}%
        · 機翼內建攻角約 {((assembly.wingIncidence * 180) / Math.PI).toFixed(0)}°
        {planform.dragIndex > 0.02 && (
          <b>　· 翼片翹起：會飛得比較慢（阻力），升力中心往前（容易仰頭）</b>
        )}
      </div>
    </div>
  );
}
