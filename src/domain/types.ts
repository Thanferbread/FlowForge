/**
 * FlowForge 场景领域类型定义
 *
 * 坐标系：x 向右递增，y 向下递增，原点 (0,0) 在左上角。
 * 每格边长 1 米，四邻接（上下左右），无斜向移动。
 */

/** 当前场景模型版本号，用于 JSON 序列化兼容性判断 */
export const SCHEMA_VERSION = 1;

/** 网格坐标，x/y 均为整数 */
export interface GridPos {
  x: number;
  y: number;
}

/** 入口或出口标记 */
export interface Portal {
  /** 稳定唯一 ID */
  id: string;
  /** 所在格子，必须位于地图边界 */
  pos: GridPos;
}

/**
 * 展位包：由实体占格、服务格和连续队列格组成的固定形状单元。
 *
 * - footprint：实体占格，不可通行。
 * - serviceCell（q0）：服务格，与 footprint 正交相邻，专属通行。
 * - queueCells（q1…qK）：队列格，沿 serviceCell 起的同一直线连续相邻，
 *   q1 与 serviceCell 相邻，排队方向朝向 q0。
 * - 新客从普通地面进入 qK，沿 qK→…→q0 逐格前进；服务后从 q0 离开至普通地面。
 */
export interface Booth {
  /** 稳定唯一 ID */
  id: string;
  /** 实体占格（不可通行） */
  footprint: GridPos;
  /** 服务格 q0（专属通行） */
  serviceCell: GridPos;
  /** 队列格 q1…qK，按 q1→qK 顺序排列，连续相邻且共线 */
  queueCells: GridPos[];
  /** 服务时长下限（秒），1–120 */
  serviceTicksMin: number;
  /** 服务时长上限（秒），1–120，且 >= serviceTicksMin */
  serviceTicksMax: number;
}

/** 完整场景模型 */
export interface Scene {
  /** 模型版本，必须等于 SCHEMA_VERSION */
  schemaVersion: number;
  /** 地图宽度（格），3–80 */
  width: number;
  /** 地图高度（格），3–60 */
  height: number;
  /** 障碍格（墙），不可通行 */
  obstacles: GridPos[];
  /** 入口列表 */
  entrances: Portal[];
  /** 出口列表 */
  exits: Portal[];
  /** 展位列表 */
  booths: Booth[];
}

/** 校验问题严重级别 */
export type IssueSeverity = 'error' | 'warning';

/** 单条校验问题 */
export interface ValidationIssue {
  severity: IssueSeverity;
  /** 机器可读的错误代码 */
  code: string;
  /** 人类可读的中文描述 */
  message: string;
  /** 相关格子（可选） */
  pos?: GridPos;
  /** 可达性错误附带的阻断边界格集合（可选） */
  region?: GridPos[];
}

/** 场景状态：结构错误 / 草稿 / 可用于仿真 */
export type SceneStatus = 'ready' | 'draft' | 'structural_error';

/** 场景真实计数统计 */
export interface SceneCounts {
  /** 展位数量 */
  boothCount: number;
  /** 障碍数量 */
  obstacleCount: number;
  /** 入口数量 */
  entranceCount: number;
  /** 出口数量 */
  exitCount: number;
  /** 总格数 = width * height */
  totalCells: number;
  /** 可通行普通地面格数 */
  walkableCells: number;
}

/** 校验结果 */
export interface ValidationResult {
  /** 结构是否合法（无 error 级别问题） */
  ok: boolean;
  /** 是否完整可用于仿真（结构合法且业务校验全通过） */
  readyForSimulation: boolean;
  /** 全部问题列表 */
  issues: ValidationIssue[];
  /** 派生状态：structural_error / draft / ready */
  status: SceneStatus;
  /** 场景真实计数统计 */
  counts: SceneCounts;
}
