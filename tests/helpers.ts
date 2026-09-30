import { expect } from 'vitest';
import { type Line, type PaperState, type Result, type Vec2, lineThrough, validate } from '../src/core';

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unexpected error: ${r.error}`);
  return r.value;
}

export function line(ax: number, ay: number, bx: number, by: number): Line {
  const l = lineThrough({ x: ax, y: ay }, { x: bx, y: by });
  if (!l) throw new Error('degenerate line');
  return l;
}

export const pt = (x: number, y: number): Vec2 => ({ x, y });

export function expectValid(s: PaperState): void {
  expect(validate(s)).toEqual([]);
}

/** 可重現的亂數（mulberry32）。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
