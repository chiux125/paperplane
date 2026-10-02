import { describe, expect, it } from 'vitest';
import {
  type FlightRecord,
  type UserOp,
  behaviorFromVerdict,
  parseLog,
  serializeLog,
} from '../src/core';
import { line } from './helpers';

const rec = (id: string, dist: number): FlightRecord => ({
  id,
  time: 1000,
  ops: [{ kind: 'fold', line: line(-1, 0, 1, 0), pick: { x: 0, y: 10 }, place: 'top', mirror: true } as UserOp],
  design: { wingFrac: 0.45, tiltDeg: 0, dihedralDeg: 8, clips: [] },
  prediction: { behavior: 'glide', marginPct: 12, massG: 5 },
  measured: { distanceCm: dist, behavior: 'glide' },
});

describe('實測紀錄', () => {
  it('穩定度對應到預測行為', () => {
    expect(behaviorFromVerdict('stable')).toBe('glide');
    expect(behaviorFromVerdict('pitch-up')).toBe('pitch-up');
    expect(behaviorFromVerdict('nose-dive')).toBe('nose-dive');
  });

  it('序列化後再還原，內容一致', () => {
    const records = [rec('a', 320), rec('b', 450)];
    const back = parseLog(serializeLog(records));
    expect(back).toEqual(records);
  });

  it('壞掉的字串／null 一律回傳空陣列，不丟例外', () => {
    expect(parseLog(null)).toEqual([]);
    expect(parseLog('')).toEqual([]);
    expect(parseLog('{ not json')).toEqual([]);
    expect(parseLog('{"v":1,"records":"nope"}')).toEqual([]);
    expect(parseLog(JSON.stringify({ v: 1, records: [{ id: 1 }] }))).toEqual([]); // 缺欄位→濾掉
  });

  it('也能吃「直接是陣列」的舊格式', () => {
    const records = [rec('a', 100)];
    expect(parseLog(JSON.stringify(records))).toEqual(records);
  });
});
