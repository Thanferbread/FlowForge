/**
 * FlowForge 仿真引擎资源约束常量。
 *
 * 全部 export const，编译期常量。不依赖 domain/constants.ts。
 */

/** 仿真时长下限（tick） */
export const MIN_H = 1;
/** 仿真时长上限（tick） */
export const MAX_H = 1800;
/** 需求人数下限 */
export const MIN_DEMAND_COUNT = 0;
/** 需求人数上限 */
export const MAX_DEMAND_COUNT = 500;
/** 注入需求记录数上限 */
export const MAX_INPUT_RECORDS = 500;
/** H × 记录数预算上限 */
export const MAX_H_TIMES_DEMANDS = 300000;

/** 重规划触发阈值（连续失败次数） */
export const REPLAN_THRESHOLDS: readonly number[] = [10, 20, 30];
/** 每人最多重规划次数 */
export const MAX_REPLANS_PER_AGENT = 3;
/** 拥堵局部密度阈值（人/m²） */
export const CONGESTION_DENSITY_THRESHOLD = 0.6;
/** 拥堵连续达标 tick 数 */
export const CONGESTION_CONSECUTIVE_TICKS = 5;
/** 停滞诊断连续失败阈值 */
export const STAGNATION_TICKS = 30;

/** 播放速度选项 */
export const SPEED_OPTIONS: readonly number[] = [1, 4, 16];

/** 模型版本 */
export const MODEL_VERSION = 'sim-v1';
/** PRNG 版本 */
export const GENERATOR_VERSION = 'xorshift32-v1';
/** 哈希版本 */
export const HASH_VERSION = 'fnv1a32-utf8-v1';
/** 序列化版本 */
export const SERIALIZATION_VERSION = 'canonical-json-v1';

/** 默认种子 */
export const DEFAULT_SEED = 42;
/** 默认仿真时长 */
export const DEFAULT_H = 300;
/** 默认需求人数 */
export const DEFAULT_DEMAND_COUNT = 180;
/** 默认播放速度 */
export const DEFAULT_SPEED = 1;
