import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type DisplayPiece, PAPER_THICKNESS, type Paperclip, type Vec3 } from '../../core';

// 和 2D 編輯區一致的顏色（render.ts）。
const FRONT = 0xfdfbf5;
const BACK = 0xf6c667;
const EDGE = 0x6b5b45;

/** 本專案座標（x 翼展、y 前後機頭 +y、z 上下）→ Three（Y 朝上）。 */
const m = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);

export interface Preview3DProps {
  /** 已依真實飛機擺好、依層序錯開的紙片（見 core/physics/display.ts）。 */
  readonly pieces: readonly DisplayPiece[];
  readonly cg: Vec3;
  readonly cp: Vec3;
  readonly clips: readonly Paperclip[];
}

export function Preview3D(props: Preview3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const renderer = useRef<THREE.WebGLRenderer | undefined>(undefined);
  const scene = useRef<THREE.Scene | undefined>(undefined);
  const camera = useRef<THREE.PerspectiveCamera | undefined>(undefined);
  const controls = useRef<OrbitControls | undefined>(undefined);
  const content = useRef<THREE.Group | undefined>(undefined);

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

    return () => {
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
        mesh.userData.faceId = piece.faceId; // 之後用來點選最外層的翼片
        grp.add(mesh);
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

    // 相機對準中心，從斜前上方看
    const center = box.getCenter(new THREE.Vector3());
    ctl.target.copy(center);
    cam.position.set(center.x + size * 0.7, center.y + size * 0.55, center.z + size * 1.1);
    // near 不要太小：疊在一起的紙只差零點幾 mm，深度緩衝要夠精細才分得出上下層。
    cam.near = size / 30;
    cam.far = size * 30;
    ctl.minDistance = size / 6;
    ctl.maxDistance = size * 8;
    cam.updateProjectionMatrix();
    ctl.update();
    r.render(s, cam);
  }, [props.pieces, props.cg, props.cp, props.clips]);

  return <div class="preview3d" ref={mount} />;
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

