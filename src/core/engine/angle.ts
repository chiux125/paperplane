import { MATCH_EPS } from '../geom/eps';
import { apply, det } from '../geom/iso';
import { near } from '../geom/vec';
import { getFace } from '../model/face';
import { getOrder } from '../model/orders';
import type { Hinge, PaperState } from '../model/types';

/**
 * 從目前狀態推導鉸鏈摺了幾度：
 *   0    = 攤平沒摺
 *   180  = 從正面看是谷摺（兩面的正面貼在一起）
 *   -180 = 從正面看是山摺（兩面的背面貼在一起）
 *   null = 撕裂了（兩面的摺痕不在同一個位置）或缺少層序
 */
export function hingeAngle(state: PaperState, h: Hinge): 0 | 180 | -180 | null {
  const f = getFace(state, h.faces[0]);
  const g = getFace(state, h.faces[1]);
  const [a, b] = h.cpSeg;
  if (!near(apply(f.xf, a), apply(g.xf, a), MATCH_EPS) || !near(apply(f.xf, b), apply(g.xf, b), MATCH_EPS)) {
    return null;
  }
  // 兩個等距變換在兩個不同點上一致：方向相同 → 完全相同；方向相反 → 互為鏡射（摺平了）
  if (det(f.xf) * det(g.xf) > 0) return 0;
  const o = getOrder(state.orders, f.id, g.id);
  if (o === 0) return null;
  const lower = o === 1 ? g : f;
  // 下面那面正面朝上 → 上面那面的正面朝下 → 正面貼正面 → 谷摺
  return det(lower.xf) > 0 ? 180 : -180;
}
