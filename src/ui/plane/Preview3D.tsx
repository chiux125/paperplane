import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Assembly, Paperclip, Vec3 } from '../../core';

// 和 2D 編輯區一致的顏色（render.ts）。
const FRONT = 0xfdfbf5;
const BACK = 0xf6c667;
const EDGE = 0x6b5b45;

/** 本專案座標（x 翼展、y 前後機頭 +y、z 上下）→ Three（Y 朝上）。 */
const m = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);

export interface Preview3DProps {
  readonly assembly: Assembly;
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
    // 每一條邊：記下用到它的每一片的法向量，用來判斷相接的兩片是不是同一平面。
    const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 }[]>();

    for (const piece of props.assembly.pieces) {
      const verts = piece.poly.map(m);
      verts.forEach((v) => box.expandByPoint(v));
      // 扇形三角化（面都是凸的）
      const pos: number[] = [];
      for (let i = 1; i < verts.length - 1; i++) {
        pos.push(verts[0].x, verts[0].y, verts[0].z);
        pos.push(verts[i].x, verts[i].y, verts[i].z);
        pos.push(verts[i + 1].x, verts[i + 1].y, verts[i + 1].z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({
        color: piece.frontUp ? FRONT : BACK,
        side: THREE.DoubleSide,
      });
      grp.add(new THREE.Mesh(geo, mat));

      const n = faceNormal(verts);
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        const key = edgeKey(a, b);
        (edgeMap.get(key) ?? edgeMap.set(key, []).get(key)!).push({ a, b, n });
      }
    }

    // 只畫「每一層的外緣／層與層交界」＝被單獨一片用到的邊，以及「真正的彎折」＝兩片不同平面相接。
    // 兩片在同一平面相接的邊（攤平的摺痕或對摺回來的邊）都隱藏。
    const COPLANAR = Math.cos((15 * Math.PI) / 180);
    const linePos: number[] = [];
    for (const recs of edgeMap.values()) {
      let hide = false;
      for (let i = 0; i < recs.length && !hide; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          if (Math.abs(recs[i].n.dot(recs[j].n)) > COPLANAR) { hide = true; break; }
        }
      }
      if (hide) continue;
      const { a, b } = recs[0];
      linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
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
    cam.near = size / 100;
    cam.far = size * 100;
    cam.updateProjectionMatrix();
    ctl.update();
    r.render(s, cam);
  }, [props.assembly, props.cg, props.cp, props.clips]);

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

