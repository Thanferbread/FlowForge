/**
 * PRNG 确定性测试。
 *
 * 用独立推导的 xorshift32-v1 预期序列断言，不把同一实现调用两次互相比较。
 */
import { describe, it, expect } from 'vitest';
import { createRng } from '../prng';

/** 独立实现的 xorshift32-v1，用于计算预期值 */
function independentXorshift32(seed: number): number[] {
  const GOLDEN = 0x9e3779b9 >>> 0;
  let state = seed === 0 ? GOLDEN : seed >>> 0;
  const result: number[] = [];
  for (let i = 0; i < 20; i++) {
    let x = state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state = x >>> 0;
    result.push(state);
  }
  return result;
}

describe('PRNG xorshift32-v1', () => {
  it('seed=1 首值为独立计算的 270369', () => {
    const rng = createRng(1);
    expect(rng.next()).toBe(270369);
  });

  it('seed=1 前 20 次序列与独立实现一致', () => {
    const rng = createRng(1);
    const expected = independentXorshift32(1);
    const actual: number[] = [];
    for (let i = 0; i < 20; i++) actual.push(rng.next());
    expect(actual).toEqual(expected);
  });

  it('零种子映射到非零常量后正常生成', () => {
    const rng = createRng(0);
    const first = rng.next();
    expect(first).not.toBe(0);
    expect(first).toBe(independentXorshift32(0)[0]);
  });

  it('零种子前 20 次序列与独立实现一致', () => {
    const rng = createRng(0);
    const expected = independentXorshift32(0);
    const actual: number[] = [];
    for (let i = 0; i < 20; i++) actual.push(rng.next());
    expect(actual).toEqual(expected);
  });

  it('version 字段为 xorshift32-v1', () => {
    const rng = createRng(42);
    expect(rng.version).toBe('xorshift32-v1');
  });

  it('seed 字段保存原输入 seed', () => {
    expect(createRng(42).seed).toBe(42);
    expect(createRng(0).seed).toBe(0);
  });

  it('next() 返回值在 0–4294967295 范围内', () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4294967295);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('不同 seed 产生不同首值（seed=1 vs seed=2）', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('相同 seed 产生相同序列', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 20; i++) {
      seqA.push(a.next());
      seqB.push(b.next());
    }
    expect(seqA).toEqual(seqB);
  });
});
