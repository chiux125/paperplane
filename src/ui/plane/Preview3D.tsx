import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type DisplayPiece, type FaceId, PAPER_THICKNESS, type Paperclip, type Vec3 } from '../../core';

// 和 2D 編輯區一致的顏色（render.ts）。
const FRONT = 0xfdfbf5;
const BACK = 0xf6c667;
const EDGE = 0x6b5b45;
// 翼片點選：滑鼠指著變綠、已選變藍（直接換顏色；白紙已經很亮，用發光看不出來）。
// 用綠色是為了和紙的白色正面、橘色背面都分得開。
const HOVER_TINT = new THREE.Color(0x22b45a);
const SELECTED_TINT = new THREE.Color(0x3b82e0);
/** 按下到放開移動不超過這麼多 px 才算「點一下」，超過就是在轉飛機。 */
const CLICK_PX = 5;

/** 本專案座標（x 翼展、y 前後機頭 +y、z 上下）→ Three（Y 朝上）。 */
const m = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);

export interface Preview3DProps {
  /** 已依真實飛機擺好、依層序錯開的紙片（見 core/physics/display.ts）。 */
  readonly pieces: readonly DisplayPiece[];
  readonly cg: Vec3;
  readonly cp: Vec3;
  readonly clips: readonly Paperclip[];
  /** 滑鼠指著時要發亮的面（通常是可以翹的翼片和它對稱的那片）。 */
  readonly hovered?: ReadonlySet<FaceId>;
  /** 已選中的面。 */
  readonly selected?: ReadonlySet<FaceId>;
  /** 滑鼠指到的最外層紙片換了（沒指到任何紙片是 null）。 */
  readonly onHover?: (id: FaceId | null) => void;
  /** 點了一下（不是拖曳轉動）：點到的最外層紙片，點到空白處是 null。 */
  readonly onPick?: (id: FaceId | null) => void;
  /** 指到這些面時，滑鼠游標變成手指。 */
  readonly clickable?: ReadonlySet<FaceId>;
}

export function Preview3D(props: Preview3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const renderer = useRef<THREE.WebGLRenderer | undefined>(undefined);
  const scene = useRef<THREE.Scene | undefined>(undefined);
  const camera = useRef<THREE.PerspectiveCamera | undefined>(undefined);
  const controls = useRef<OrbitControls | undefined>(undefined);
  const content = useRef<THREE.Group | undefined>(undefined);
  /** 每一面對應的網格（正、反兩面各一個），用來換發光顏色。 */
  const meshes = useRef(new Map<FaceId, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[]>());
  /** 上次對準鏡頭時飛機的大小；大小沒怎麼變就不重設鏡頭（拉滑桿時畫面不會跳走）。 */
  const framedSize = useRef<number | null>(null);
  // 事件處理器要讀最新的 props
  const latest = useRef(props);
  latest.current = props;

  // 建立一次場景、相機、控制器。
  useEffect(() => {
    const el = mount.current!;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(window.devicePixelRatio);
    el.appendChild(r.domElement);
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    r.domElement.style.display = 'block';
    r.domElement.style.touchAction = 'none';

    const s = new THREE.Scene();
    s.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(0.4, 1, 0.6);
    s.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir2.position.set(-0.5, -0.3, -0.5);
    s.add(dir2);

    const cam = new THREE.PerspectiveCamera(45, 1, 1, 100000);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.enableDamping = true;
    ctl.addEventListener('change', () => r.render(s, cam));

    const grp = new THREE.Group();
    s.add(grp);

    renderer.current = r;
    scene.current = s;
    camera.current = cam;
    controls.current = ctl;
    content.current = grp;

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (ctl.update()) r.render(s, cam);
    };
    loop();

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      r.render(s, cam);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // 點選：用射線找滑鼠底下「最靠近鏡頭」的紙片，也就是看得到的最外層。
    const ray = new THREE.Raycaster();
    const pickAt = (e: PointerEvent): FaceId | null => {
      const rect = r.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, cam);
      const targets = grp.children.filter((o) => o.userData.faceId !== undefined);
      const hit = ray.intersectObjects(targets, false)[0];
      return hit ? (hit.object.userData.faceId as FaceId) : null;
    };
    let down: { x: number; y: number } | null = null;
    let lastHover: FaceId | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_PX) latest.current.onPick?.(pickAt(e));
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return; // 正在拖曳轉動
      const id = pickAt(e);
      r.domElement.style.cursor = id !== null && latest.current.clickable?.has(id) ? 'pointer' : 'grab';
      if (id !== lastHover) {
        lastHover = id;
        latest.current.onHover?.(id);
      }
    };
    const onLeave = () => {
      if (lastHover !== null) {
        lastHover = null;
        latest.current.onHover?.(null);
      }
    };
    r.domElement.addEventListener('pointerdown', onDown);
    r.domElement.addEventListener('pointerup', onUp);
    r.domElement.addEventListener('pointermove', onMove);
    r.domElement.addEventListener('pointerleave', onLeave);

    return () => {
      r.domElement.removeEventListener('pointerdown', onDown);
      r.domElement.removeEventListener('pointerup', onUp);
      r.domElement.removeEventListener('pointermove', onMove);
      r.domElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctl.dispose();
      r.dispose();
      el.removeChild(r.domElement);
    };
  }, []);

  // 資料改變就重建飛機內容。
  useEffect(() => {
    const grp = content.current;
    const cam = camera.current;
    const ctl = controls.current;
    const r = renderer.current;
    const s = scene.current;
    if (!grp || !cam || !ctl || !r || !s) return;

    // 清掉舊的
    for (const obj of [...grp.children]) {
      grp.remove(obj);
      obj.traverse((o) => {
        const anyO = o as THREE.Mesh;
        anyO.geometry?.dispose?.();
        const mat = anyO.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }

    meshes.current.clear();
    const box = new THREE.Box3();
    // 每一條邊（用錯開前的位置對齊）：記下用到它的每一片，用來找出「同一層裡並排的兩片」之間的摺痕。
    const edgeMap = new Map<string, { piece: number; side: number }[]>();
    const pieces = props.pieces;

    pieces.forEach((piece, idx) => {
      const verts = piece.poly.map(m);
      verts.forEach((v) => box.expandByPoint(v));
      const up = m(piece.up);
      // 扇形三角化（面都是凸的），三角形的正面一律朝「摺紙畫面的朝上」那側，
      // 這樣正面材質畫那一側的顏色、背面材質畫另一側的顏色，一張紙兩面顏色才對。
      const flip = faceNormal(verts).dot(up) < 0;
      const pos: number[] = [];
      for (let i = 1; i < verts.length - 1; i++) {
        const [b, c] = flip ? [verts[i + 1], verts[i]] : [verts[i], verts[i + 1]];
        pos.push(verts[0].x, verts[0].y, verts[0].z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const upColor = piece.frontUp ? FRONT : BACK;
      const downColor = piece.frontUp ? BACK : FRONT;
      for (const [side, color] of [
        [THREE.FrontSide, upColor],
        [THREE.BackSide, downColor],
      ] as const) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side }));
        mesh.userData.faceId = piece.faceId; // 點選最外層的翼片用
        mesh.userData.baseColor = color;
        grp.add(mesh);
        const list = meshes.current.get(piece.faceId) ?? [];
        list.push(mesh);
        meshes.current.set(piece.faceId, list);
      }

      const base = piece.base.map(m);
      const c = base.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(base.length);
      for (let i = 0; i < base.length; i++) {
        const a = base[i];
        const b = base[(i + 1) % base.length];
        // 這一片在這條邊的哪一側（並排的兩片會在不同側，摺過來疊住的兩片在同一側）
        const side = Math.sign(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(up));
        const key = edgeKey(a, b);
        (edgeMap.get(key) ?? edgeMap.set(key, []).get(key)!).push({ piece: idx, side });
      }
    });

    // 畫每一片的外緣，但跳過「同一平面、同一朝向、並排在兩側」的邊——那是攤平的摺痕，不是層與層的交界。
    // 邊線沿法線往兩側各挪一點點：從哪一面看都畫得出來，又不會穿過蓋在上面的那層紙。
    const SAME_PLANE = Math.cos((15 * Math.PI) / 180);
    const NUDGE = PAPER_THICKNESS * 0.3;
    const linePos: number[] = [];
    pieces.forEach((piece, idx) => {
      const verts = piece.poly.map(m);
      const base = piece.base.map(m);
      const up = m(piece.up);
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        const recs = edgeMap.get(edgeKey(base[i], base[j]))!;
        const mine = recs.find((r) => r.piece === idx)!;
        const seam = recs.some(
          (r) => r.piece !== idx && r.side === -mine.side && m(pieces[r.piece].up).dot(up) > SAME_PLANE,
        );
        if (seam) continue;
        for (const k of [NUDGE, -NUDGE]) {
          const off = up.clone().multiplyScalar(k);
          const a = verts[i].clone().add(off);
          const b = verts[j].clone().add(off);
          linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    });
    const outline = new THREE.BufferGeometry();
    outline.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    grp.add(new THREE.LineSegments(outline, new THREE.LineBasicMaterial({ color: EDGE })));

    const size = box.getSize(new THREE.Vector3()).length() || 100;
    const markR = size * 0.025;

    // 重心（紅）、升力中心（藍）
    grp.add(sphere(m(props.cg), markR * 1.4, 0xe5484d));
    grp.add(sphere(m(props.cp), markR * 1.4, 0x2f6fb3));
    // 迴紋針（灰）
    for (const c of props.clips) grp.add(sphere(m(c.pos), markR * (c.size === 'large' ? 1.3 : 1), 0x808a94));

    // 相機對準中心，從斜前上方看。只在第一次、或飛機大小明顯改變時重設，
    // 拉滑桿（翼片翹起、上反角…）時保留孩子轉好的角度。
    const prev = framedSize.current;
    if (prev === null || Math.abs(size - prev) > 0.25 * prev) {
      const center = box.getCenter(new THREE.Vector3());
      ctl.target.copy(center);
      cam.position.set(center.x + size * 0.7, center.y + size * 0.55, center.z + size * 1.1);
      framedSize.current = size;
    }
    applyGlow(meshes.current, props.hovered, props.selected, props.clickable);
    // near 不要太小：疊在一起的紙只差零點幾 mm，深度緩衝要夠精細才分得出上下層。
    cam.near = size / 30;
    cam.far = size * 30;
    ctl.minDistance = size / 6;
    ctl.maxDistance = size * 8;
    cam.updateProjectionMatrix();
    ctl.update();
    r.render(s, cam);
  }, [props.pieces, props.cg, props.cp, props.clips]);

  // 只換發光顏色，不用重建整架飛機。
  useEffect(() => {
    applyGlow(meshes.current, props.hovered, props.selected, props.clickable);
    const r = renderer.current;
    if (r && scene.current && camera.current) r.render(scene.current, camera.current);
  }, [props.hovered, props.selected, props.clickable]);

  // 放大鏡：讓相機沿視線靠近／遠離目標（夾在 OrbitControls 的遠近範圍內）。
  const zoom = (factor: number) => {
    const cam = camera.current;
    const ctl = controls.current;
    const r = renderer.current;
    const s = scene.current;
    if (!cam || !ctl || !r || !s) return;
    const dir = cam.position.clone().sub(ctl.target);
    const dist = Math.max(ctl.minDistance, Math.min(ctl.maxDistance, dir.length() * factor));
    cam.position.copy(ctl.target).add(dir.normalize().multiplyScalar(dist));
    ctl.update();
    r.render(s, cam);
  };

  return (
    <div class="preview3d">
      <div class="preview3d-canvas" ref={mount} />
      <div class="preview3d-zoom">
        <button type="button" title="放大" onClick={() => zoom(1 / 1.3)}>
          🔍➕
        </button>
        <button type="button" title="縮小" onClick={() => zoom(1.3)}>
          🔍➖
        </button>
      </div>
    </div>
  );
}

function applyGlow(
  byFace: Map<FaceId, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[]>,
  hovered: ReadonlySet<FaceId> | undefined,
  selected: ReadonlySet<FaceId> | undefined,
  clickable: ReadonlySet<FaceId> | undefined,
) {
  for (const [id, list] of byFace) {
    for (const mesh of list) {
      const base = new THREE.Color(mesh.userData.baseColor as number);
      if (selected?.has(id)) mesh.material.color.lerpColors(base, SELECTED_TINT, 0.6);
      else if (hovered?.has(id)) mesh.material.color.lerpColors(base, HOVER_TINT, 0.55);
      else if (clickable?.has(id)) mesh.material.color.lerpColors(base, HOVER_TINT, 0.18); // 平常就淡淡發亮，讓孩子知道可以點
      else mesh.material.color.copy(base);
    }
  }
}

function sphere(p: THREE.Vector3, radius: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 16),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.copy(p);
  return mesh;
}

/** 平面多邊形的法向量（Newell 法，對任何朝向都穩定）。 */
function faceNormal(verts: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < verts.length; i++) {
    const c = verts[i];
    const d = verts[(i + 1) % verts.length];
    n.x += (c.y - d.y) * (c.z + d.z);
    n.y += (c.z - d.z) * (c.x + d.x);
    n.z += (c.x - d.x) * (c.y + d.y);
  }
  return n.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : n.normalize();
}

/** 把一條邊量化成 key（端點取 0.2mm 精度、排序），讓重合的邊歸成同一條。 */
function edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
  const q = (v: THREE.Vector3) => `${Math.round(v.x * 5)},${Math.round(v.y * 5)},${Math.round(v.z * 5)}`;
  const ka = q(a);
  const kb = q(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

