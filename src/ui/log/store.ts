import { type FlightRecord, parseLog, serializeLog } from '../../core';
import type { Design } from '../design';

/** 存在瀏覽器本機的實測紀錄（自訂欄位用 paperplane: 前綴）。 */
const KEY = 'paperplane:flightLog';

export type LogRecord = FlightRecord<Design>;

export function loadLog(): LogRecord[] {
  try {
    return parseLog<Design>(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveLog(records: readonly LogRecord[]): void {
  try {
    localStorage.setItem(KEY, serializeLog(records));
  } catch {
    // 容量滿或隱私模式等：忽略，至少不要讓畫面壞掉。
  }
}
