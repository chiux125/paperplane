// 所有長度單位都是 mm。

/** 長度容忍誤差：距離小於此值視為同一點／在線上。 */
export const EPS = 1e-6;

/** 比對「應該重合」的點時用的較寬容忍值（經過多次變換累積的誤差）。 */
export const MATCH_EPS = 1e-5;

/** 面積容忍誤差（mm²）：重疊面積小於此值視為沒有重疊（只是邊碰邊）。 */
export const AREA_EPS = 1e-6;

/** 切割後若出現小於此面積的碎片（mm²），這一摺視為不合法。 */
export const MIN_PIECE_AREA = 1e-2;
