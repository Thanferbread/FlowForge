/**
 * FlowForge 场景资源约束常量。
 * 这些是首版输入上限，属于资源约束，不代表已测得的承载性能。
 */

export const MIN_WIDTH = 3;
export const MAX_WIDTH = 80;
export const MIN_HEIGHT = 3;
export const MAX_HEIGHT = 60;

/** 队列长度 K 的取值范围 */
export const MIN_QUEUE_K = 1;
export const MAX_QUEUE_K = 8;

/** 服务时长范围（秒） */
export const MIN_SERVICE_TICKS = 1;
export const MAX_SERVICE_TICKS = 120;

/** JSON 导入最大字节数 */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

/** 默认队列长度 */
export const DEFAULT_QUEUE_K = 3;

/** 默认服务时长范围 */
export const DEFAULT_SERVICE_TICKS_MIN = 4;
export const DEFAULT_SERVICE_TICKS_MAX = 8;
