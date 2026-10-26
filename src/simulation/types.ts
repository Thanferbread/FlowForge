/**
 * FlowForge 仿真引擎类型定义。
 *
 * 全部强类型，无 any。null 与 undefined 语义区分：
 * - null 表示「无值」（如 pending/exited 无占位）。
 * - undefined 不用于表示业务无值。
 *
 * 依赖 src/domain/types.ts（Scene/Booth/Portal/GridPos），不修改 domain 层。
 */
import type { Scene, GridPos } from '../domain/types';

/** 仿真配置（模型参数，不含播放速度） */
export interface SimulationConfig {
  /** uint32 种子，0–4294967295 */
  seed: number;
  /** 仿真时长（tick），1–1800，默认 300 */
  H: number;
  /** 需求人数，0–500，默认 180 */
  demandCount: number;
}

/** 外生需求（生成或注入） */
export interface ExogenousDemand {
  /** 稳定人员 ID，如 'agent-1' */
  id: string;
  /** 到达 tick，非负安全整数 */
  scheduledTick: number;
  /** 引用场景入口 ID */
  entranceId: string;
  /** 引用场景展位 ID */
  boothId: string;
  /** 服务时长（tick），正整数，在展位闭区间内 */
  serviceTicks: number;
}

/** 人员状态字面量联合 */
export type AgentState = 'pending' | 'walking' | 'queued' | 'serving' | 'exiting' | 'exited';

/** 人员记录（完整，含需求引用） */
export interface AgentRecord {
  id: string;
  demand: ExogenousDemand;
  state: AgentState;
  /** 当前占位；pending/exited 为 null */
  pos: GridPos | null;
  /** 剩余服务 tick；非 serving 为 null */
  remainingService: number | null;
  /** 入场 tick */
  admitTick: number | null;
  /** 入队 tick */
  enqueueTick: number | null;
  /** 开始服务 tick */
  serviceStartTick: number | null;
  /** 服务完成 tick */
  serviceCompleteTick: number | null;
  /** 抵达出口 tick */
  reachExitTick: number | null;
  /** 离场 tick */
  exitTick: number | null;
  /** 选定出口 ID */
  selectedExitId: string | null;
  /** 连续移动失败次数 */
  consecutiveFailures: number;
  /** 重规划次数（全程最多 3） */
  replanCount: number;
  /** 重规划路径（供后续 step 使用） */
  replanPath: GridPos[] | null;
}

/** 人员快照（不含需求引用，深复制值） */
export type AgentSnapshot = Omit<AgentRecord, 'demand'>;

/** 事件类型字面量联合 */
export type EventType =
  | 'ADMIT'
  | 'ENQUEUE'
  | 'SERVICE_START'
  | 'SERVICE_COMPLETE'
  | 'REACH_EXIT'
  | 'EXIT';

/** 事件记录 */
export interface EventRecord {
  type: EventType;
  tick: number;
  agentId: string;
  boothId?: string;
  pos?: GridPos;
}

/** 引擎运行状态 */
export type RunState = 'initialized' | 'running' | 'paused' | 'complete' | 'cancelled' | 'failed';

/** UI 运行状态（idle 表示无有效 engine） */
export type UiRunState = 'idle' | RunState;

/** 需求来源 */
export type DemandSource = 'generated' | 'injected';

/** 移动失败记录 */
export interface MovementFailure {
  agentId: string;
  /** 本 step 结束边界 t+1 */
  sampleTick: number;
  /** 采样时刻位置 */
  pos: GridPos;
  state: 'walking' | 'exiting';
  reason: 'occupied' | 'conflict' | 'no-path';
}

/** 停滞诊断 */
export interface StagnationDiag {
  agentId: string;
  tick: number;
  consecutiveFailures: number;
  replanCount: number;
}

/** 模型失败诊断 */
export interface FailureDiagnostic {
  lastValidTick: number;
  attemptedTick: number;
  stage: string;
  reason: string;
}

/** 仿真边界快照 */
export interface SimSnapshot {
  tick: number;
  /** D 中 scheduledTick >= tick，按 ID 排序 */
  notYetArrivedIds: string[];
  /** 已到达者，按 ID 排序 */
  agents: AgentSnapshot[];
  /** 占位列表，y/x 行序 */
  occupancy: { pos: GridPos; agentId: string }[];
  /** 移动失败，按稳定 ID */
  moveFailures: MovementFailure[];
  /** 拥堵中心，y/x 行序 */
  congestionCenters: GridPos[];
}

/** 仿真内部状态 */
export interface SimState {
  /** 当前边界 T */
  tick: number;
  /** 仅已到达 D 的需求激活 */
  agents: Map<string, AgentRecord>;
  /** 占位快照 posKey → agentId */
  occupancy: Map<string, string>;
  /** 累积事件 */
  events: EventRecord[];
  /** 逐 tick 采样（不可变历史） */
  trace: SimSnapshot[];
  /** 占用累计次数 posKey → count */
  occupancyMatrix: Map<string, number>;
  /** 采样次数 */
  sampleCount: number;
  /** 拥堵暴露累计（人·秒） */
  congestionExposure: number;
  /** 每邻域中心连续达标次数 posKey → streak */
  congestionStreaks: Map<string, number>;
  /** 最近成功提交 step 的失败记录 */
  lastMoveFailures: MovementFailure[];
  /** 停滞诊断列表 */
  stagnationDiagnostics: StagnationDiag[];
  /** 模型失败诊断 */
  failureDiagnostic: FailureDiagnostic | null;
}

/** 距离场 */
export interface DistanceField {
  readonly target: GridPos;
  readonly distances: Map<string, number>;
  distance(pos: GridPos): number;
}

/** PRNG 接口 */
export interface Rng {
  next(): number;
  readonly seed: number;
  readonly version: string;
}

/** 控制结果 */
export type ControlResult = { ok: true } | { ok: false; error: string };

/** 推进结果 */
export type AdvanceResult =
  | { ok: true; snapshot: SimSnapshot }
  | { ok: false; snapshot: SimSnapshot; error: string };

/** 导出元数据（由 UI/headless 提供，引擎不读时钟） */
export interface ExportMetadata {
  speed?: 1 | 4 | 16;
  exportTimestamp?: string;
}

/** 比率原始输入 */
export interface RatioInput {
  numerator: number;
  denominator: number;
}

/** 等待观测 */
export interface WaitObservation {
  agentId: string;
  enqueueTick: number;
  serviceStartTick: number | null;
  /** 已开始：start-enqueue；否则 T-enqueue */
  elapsedSeconds: number;
  hasStartedService: boolean;
}

/** 密度摘要 */
export interface DensitySummary {
  /** 物理可走面积（m²），含 q0/队列 */
  walkableArea: number;
  sampleCount: number;
  totalOccupancySamples: number;
  meanDensity: number | null;
  cells: {
    pos: GridPos;
    applicable: boolean;
    occupiedSamples: number;
    sampleCount: number;
    area: number;
    density: number | null;
  }[];
  /** 当前采样的界内 3×3 邻域 */
  local: { center: GridPos; people: number; area: number; density: number | null }[];
}

/** 统计指标 */
export interface Metrics {
  demandCount: number;
  notYetArrived: number;
  admitted: number;
  pending: number;
  walking: number;
  queued: number;
  serving: number;
  exiting: number;
  exited: number;
  serviceCompleted: number;
  incomplete: number;
  serviceCompletionRate: number | null;
  systemCompletionRate: number | null;
  throughput: number | null;
  waitAverage: number | null;
  waitSampleCount: number;
  truncatedAvgDuration: number | null;
  truncatedCount: number | null;
  congestionExposure: number;
  isCompleteRun: boolean;
  waiting: WaitObservation[];
  density: DensitySummary;
  rawRatios: {
    serviceCompletionRate: RatioInput;
    systemCompletionRate: RatioInput;
    throughput: RatioInput | null;
    waitAverage: RatioInput;
    truncatedAvgDuration: RatioInput | null;
  };
}

/** 运行报告 */
export interface RunReport {
  modelVersion: string;
  generatorVersion: string;
  hashVersion: string;
  serializationVersion: string;
  limits: {
    minH: number;
    maxH: number;
    maxDemandCount: number;
    maxInputRecords: number;
    maxHInputProduct: number;
  };
  sceneSnapshot: Scene;
  sceneHash: string;
  config: SimulationConfig;
  demandSource: DemandSource;
  configDemandCount: number;
  totalInputRecords: number;
  actualDemandCount: number;
  demands: ExogenousDemand[];
  demandHash: string;
  H: number;
  executedTicks: number;
  isComplete: boolean;
  failureDiagnostic: FailureDiagnostic | null;
  trace: SimSnapshot[];
  events: EventRecord[];
  metrics: Metrics;
  occupancyMatrix: { pos: GridPos; count: number }[];
  sampleCount: number;
  congestionExposure: number;
  stagnationDiagnostics: StagnationDiag[];
  nonCoreMetadata: {
    runState: RunState;
    speed: 1 | 4 | 16 | null;
    exportTimestamp: string | null;
  };
}

/** UI 人员投影 */
export interface AgentView {
  id: string;
  pos: GridPos;
  state: 'walking' | 'queued' | 'serving' | 'exiting';
  remainingService: number | null;
}

/** 引擎句柄接口 */
export interface Engine {
  start(): ControlResult;
  pause(): ControlResult;
  cancel(): void;
  step(): AdvanceResult;
  runTo(targetTick: number): AdvanceResult;
  reset(): void;
  getSnapshot(): SimSnapshot;
  getMetrics(): Metrics;
  getReport(metadata?: ExportMetadata): RunReport;
  readonly executedTicks: number;
  readonly runState: RunState;
  readonly isComplete: boolean;
  readonly isTerminal: boolean;
}
