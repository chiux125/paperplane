import { hingeAngle } from '../engine/angle';
import { A4 } from '../model/sheet';
import { pairKey, parseKey } from '../model/orders';
import type { FaceId, PaperState, Sheet } from '../model/types';
import { faceList } from '../model/face';
import type { UserOp } from '../history';
import type { Vec2 } from '../geom/vec';

/**
 * FOLD 存檔格式（https://github.com/edemaine/fold）。
 * 匯出的是「摺痕圖」：攤平的紙＋所有摺痕（山/谷/攤平/邊界）＋各面的層序。
 * 另外用 `paperplane:` 前綴存下摺紙步驟與設計，讓本工具可以無損重新開啟。
 */
export interface Fold {
  readonly file_spec: number;
  readonly file_creator: string;
  readonly file_classes: string[];
  readonly frame_classes: string[];
  readonly frame_attributes: string[];
  readonly vertices_coords: number[][];
  readonly edges_vertices: [number, number][];
  readonly edges_assignment: string[];
  readonly edges_foldAngle: number[];
  readonly faces_vertices: number[][];
  readonly faceOrders: [number, number, number][];
  readonly [key: string]: unknown; // paperplane:* 自訂欄位
}

export interface FoldExtra {
  readonly ops?: readonly UserOp[];
  readonly design?: unknown;
}

const vkey = (p: Vec2) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;

/** 把目前狀態轉成 FOLD 物件。 */
export function toFold(state: PaperState, extra?: FoldExtra): Fold {
  const faces = faceList(state);

  // 頂點（原紙座標，重合的合成同一個）
  const index = new Map<string, number>();
  const vertices_coords: number[][] = [];
  const vindex = (p: Vec2): number => {
    const k = vkey(p);
    let i = index.get(k);
    if (i === undefined) {
      i = vertices_coords.length;
      vertices_coords.push([p.x, p.y]);
      index.set(k, i);
    }
    return i;
  };

  const faces_vertices = faces.map((f) => f.cp.map(vindex));
  const faceIndex = new Map<FaceId, number>(faces.map((f, i) => [f.id, i]));

  // 每一對相鄰面的摺痕角度（0 攤平 / 180 谷 / −180 山）
  const angleByPair = new Map<string, number>();
  for (const h of state.hinges) {
    const a = hingeAngle(state, h);
    if (a !== null) angleByPair.set(pairKey(h.faces[0], h.faces[1]), a);
  }

  // 邊：無向、去重，記錄被哪些面用到
  const edges = new Map<string, { v: [number, number]; faces: FaceId[] }>();
  faces.forEach((f, fi) => {
    const vs = faces_vertices[fi];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const rec = edges.get(k) ?? { v: [Math.min(a, b), Math.max(a, b)] as [number, number], faces: [] };
      rec.faces.push(f.id);
      edges.set(k, rec);
    }
  });

  const edges_vertices: [number, number][] = [];
  const edges_assignment: string[] = [];
  const edges_foldAngle: number[] = [];
  for (const rec of edges.values()) {
    edges_vertices.push(rec.v);
    if (rec.faces.length < 2) {
      edges_assignment.push('B'); // 紙的邊界
      edges_foldAngle.push(0);
    } else {
      const ang = angleByPair.get(pairKey(rec.faces[0], rec.faces[1])) ?? 0;
      edges_assignment.push(ang === 0 ? 'F' : ang > 0 ? 'V' : 'M');
      edges_foldAngle.push(ang);
    }
  }

  // 層序：faceOrders [f1, f2, s]，s = +1 表示 f1 疊在 f2 上面
  const faceOrders: [number, number, number][] = [];
  for (const [k, v] of state.orders) {
    const [a, b] = parseKey(k);
    const ia = faceIndex.get(a);
    const ib = faceIndex.get(b);
    if (ia === undefined || ib === undefined) continue;
    faceOrders.push([ia, ib, v === 1 ? 1 : -1]);
  }

  const fold: Fold = {
    file_spec: 1.1,
    file_creator: '紙飛機實驗室 paperplane',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
    vertices_coords,
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
    faces_vertices,
    faceOrders,
    'paperplane:version': 1,
    'paperplane:sheet': state.sheet,
  };
  if (extra?.ops) (fold as Record<string, unknown>)['paperplane:ops'] = extra.ops;
  if (extra?.design !== undefined) (fold as Record<string, unknown>)['paperplane:design'] = extra.design;
  return fold;
}

/** 把 FOLD 物件轉成要下載的檔案字串。 */
export const foldToJson = (fold: Fold): string => JSON.stringify(fold);

/** 從 FOLD 字串讀回本工具的摺紙步驟與設計（只有本工具存的才讀得到）。 */
export function readPaperplane(json: string): { ops: UserOp[]; design: unknown; sheet: Sheet } | null {
  try {
    const f = JSON.parse(json);
    const ops = f?.['paperplane:ops'];
    if (!Array.isArray(ops)) return null;
    const sheet = f['paperplane:sheet'];
    return {
      ops: ops as UserOp[],
      design: f['paperplane:design'],
      sheet: sheet && typeof sheet.width === 'number' && typeof sheet.height === 'number' ? sheet : A4,
    };
  } catch {
    return null;
  }
}
