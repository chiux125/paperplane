import type { UserOp } from '../history';
import type { StabilityVerdict } from '../physics/stability';

/**
 * 階段 5：實測紀錄。核心只負責「資料模型＋序列化」（純函式），不碰 localStorage。
 *
 * 一筆紀錄存下：摺紙步驟（可完整重建）＋設計參數＋當時的「預測」＋孩子射出後的「實測」。
 * 現在的「預測」先用穩定度判斷得到的行為類型；之後階段 7 的飛行模擬可以用累積的實測回頭校正。
 */

/** 飛行行為類型（孩子看得懂的分類）。 */
export type FlightBehavior = 'glide' | 'wave' | 'pitch-up' | 'nose-dive' | 'turn' | 'other';

/** 預測用的行為（目前只由穩定度推得，所以是其中三種）。 */
export type PredictedBehavior = 'glide' | 'pitch-up' | 'nose-dive';

export const FLIGHT_BEHAVIORS: readonly FlightBehavior[] = [
  'glide',
  'wave',
  'pitch-up',
  'nose-dive',
  'turn',
  'other',
];

/** 由穩定度判斷對應到預測的飛行行為。 */
export function behaviorFromVerdict(verdict: StabilityVerdict): PredictedBehavior {
  return verdict === 'stable' ? 'glide' : verdict;
}

export interface FlightPrediction {
  readonly behavior: PredictedBehavior;
  /** 穩定裕度（百分比，以平均翼弦正規化）。 */
  readonly marginPct: number;
  /** 飛機重量（公克）。 */
  readonly massG: number;
}

export interface FlightMeasure {
  /** 飛了多遠（公分）。 */
  readonly distanceCm: number;
  /** 實際怎麼飛。 */
  readonly behavior: FlightBehavior;
}

/** 一筆實測紀錄。design 用泛型，核心不需要知道它的細節（UI 用 Design）。 */
export interface FlightRecord<D = unknown> {
  readonly id: string;
  readonly time: number; // Date.now()
  readonly ops: readonly UserOp[]; // 摺紙步驟，用來重建這架飛機
  readonly design: D; // 機翼位置／上反角／迴紋針…（3D 組裝參數）
  readonly prediction: FlightPrediction;
  readonly measured: FlightMeasure;
}

const VERSION = 1;

/** 把整份紀錄序列化成字串（給 localStorage 存）。 */
export function serializeLog<D>(records: readonly FlightRecord<D>[]): string {
  return JSON.stringify({ v: VERSION, records });
}

/** 從字串還原紀錄；壞掉或格式不對一律回傳空陣列，絕不丟例外。 */
export function parseLog<D = unknown>(raw: string | null): FlightRecord<D>[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : data?.records;
    if (!Array.isArray(list)) return [];
    return list.filter(isRecord) as FlightRecord<D>[];
  } catch {
    return [];
  }
}

function isRecord(r: unknown): r is FlightRecord {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.time === 'number' &&
    Array.isArray(x.ops) &&
    typeof x.prediction === 'object' &&
    x.prediction !== null &&
    typeof x.measured === 'object' &&
    x.measured !== null &&
    typeof (x.measured as Record<string, unknown>).distanceCm === 'number'
  );
}
