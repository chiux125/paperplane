import type { Iso2 } from '../geom/iso';
import type { Polygon } from '../geom/polygon';
import type { Vec2 } from '../geom/vec';

export type FaceId = number;

/**
 * 紙張大小與「原紙座標」（cp 座標）的定義：
 *   x ∈ [-width/2, width/2]，x = 0 是機身中線
 *   y ∈ [0, height]，y = height 那一端是機頭
 */
export interface Sheet {
  readonly width: number;
  readonly height: number;
}

/**
 * 面：紙上的一塊凸多邊形。
 * - cp：這塊在「原本那張紙」上的位置，代表它是紙的哪一部分；建立後不會再變。
 * - xf：把 cp 座標搬到「摺好後」位置的等距變換。det(xf) < 0 表示背面朝上。
 * - parent：被切開之前的那一面，用來追溯來源（步驟圖）。
 */
export interface Face {
  readonly id: FaceId;
  readonly cp: Polygon;
  readonly xf: Iso2;
  readonly parent: FaceId | null;
}

/**
 * 鉸鏈：兩面沿著一段摺痕相連。cpSeg 是摺痕在原紙上的位置（兩面在 cp 座標中共用這條邊）。
 * 摺了幾度不另外存，一律由兩面的 xf 與層序推導（見 engine/angle.ts），避免資料不一致。
 */
export interface Hinge {
  readonly faces: readonly [FaceId, FaceId];
  readonly cpSeg: readonly [Vec2, Vec2];
  /** 在第幾步產生（1 起算）。 */
  readonly step: number;
}

/**
 * 層序：只記錄摺好後「有重疊」的兩面誰在上。
 * key 是 "小id:大id"，值 +1 表示小 id 的面在上、-1 表示在下（同 FOLD 的 faceOrders）。
 * 因為每一面都是凸的，兩面的重疊區只有一塊，所以每一對只需要一個值。
 */
export type Orders = ReadonlyMap<string, 1 | -1>;

/** 整張紙在某一步的完整狀態。不可變：每次操作都產生新的物件。 */
export interface PaperState {
  readonly sheet: Sheet;
  readonly faces: ReadonlyMap<FaceId, Face>;
  readonly hinges: readonly Hinge[];
  readonly orders: Orders;
  readonly nextId: FaceId;
  /** 已經做了幾步。 */
  readonly step: number;
}
