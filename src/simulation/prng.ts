/**
 * xorshift32-v1 确定性伪随机生成器。
 *
 * - 零种子映射到 0x9E3779B9（黄金分割常量）。
 * - 状态按 uint32 保存，next() 依次执行左移 13、无符号右移 17、左移 5 的异或变换。
 * - 输出转 >>>0 返回 0–4294967295 整数。
 * - 不调用 Math.random。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Rng } from './types';
import { GENERATOR_VERSION } from './constants';

/** 黄金分割常量，用于零种子映射 */
const GOLDEN_GAMMA = 0x9e3779b9 >>> 0;

/**
 * 创建 xorshift32-v1 PRNG。
 * @param seed uint32 种子；0 映射到 0x9E3779B9
 */
export function createRng(seed: number): Rng {
  const originalSeed = seed >>> 0;
  let state = originalSeed === 0 ? GOLDEN_GAMMA : originalSeed;

  return {
    seed: originalSeed,
    version: GENERATOR_VERSION,
    next(): number {
      let x = state;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      state = x >>> 0;
      return state;
    },
  };
}
