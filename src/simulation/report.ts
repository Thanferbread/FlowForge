/**
 * JSON 运行报告生成。
 *
 * 组装完整或部分报告。全部 Map 投影为 JSON 数组/对象，
 * 矩阵按 y/x，事件按 tick/固定类型顺序/ID。
 * 核心字段排除 nonCoreMetadata 后经 stableStringify 字节可比。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Scene, GridPos } from '../domain/types';
import type {
  SimulationConfig,
  ExogenousDemand,
  SimState,
  RunState,
  RunReport,
  DemandSource,
  ExportMetadata,
  EventRecord,
  EventType,
} from './types';
import { hashScene, hashDemands } from './hash';
import { computeMetrics } from './metrics';
import { copyEvent, copySnapshot } from './queryCopies';
import {
  MODEL_VERSION,
  GENERATOR_VERSION,
  HASH_VERSION,
  SERIALIZATION_VERSION,
  MIN_H,
  MAX_H,
  MAX_DEMAND_COUNT,
  MAX_INPUT_RECORDS,
  MAX_H_TIMES_DEMANDS,
} from './constants';

/** 事件类型固定顺序 */
const EVENT_TYPE_ORDER: EventType[] = [
  'ADMIT',
  'ENQUEUE',
  'SERVICE_START',
  'SERVICE_COMPLETE',
  'REACH_EXIT',
  'EXIT',
];

function eventTypeRank(type: EventType): number {
  return EVENT_TYPE_ORDER.indexOf(type);
}

/** 非.locale 字典序比较 */
function lexCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 深复制场景 */
function deepCopyScene(scene: Scene): Scene {
  return {
    schemaVersion: scene.schemaVersion,
    width: scene.width,
    height: scene.height,
    obstacles: scene.obstacles.map((o) => ({ ...o })),
    entrances: scene.entrances.map((e) => ({ id: e.id, pos: { ...e.pos } })),
    exits: scene.exits.map((e) => ({ id: e.id, pos: { ...e.pos } })),
    booths: scene.booths.map((b) => ({
      id: b.id,
      footprint: { ...b.footprint },
      serviceCell: { ...b.serviceCell },
      queueCells: b.queueCells.map((q) => ({ ...q })),
      serviceTicksMin: b.serviceTicksMin,
      serviceTicksMax: b.serviceTicksMax,
    })),
  };
}

/** 深复制需求 */
function deepCopyDemands(demands: ExogenousDemand[]): ExogenousDemand[] {
  return demands.map((d) => ({ ...d }));
}

/**
 * 组装 JSON 运行报告。
 * @param scene 场景
 * @param config 配置
 * @param demands 需求数组
 * @param state 仿真状态
 * @param runState 运行状态
 * @param demandSource 需求来源
 * @param metadata 导出元数据（由 UI/headless 提供）
 */
export function buildReport(
  scene: Scene,
  config: SimulationConfig,
  demands: ExogenousDemand[],
  state: SimState,
  runState: RunState,
  demandSource: DemandSource,
  metadata?: ExportMetadata,
): RunReport {
  const sceneSnapshot = deepCopyScene(scene);
  const sceneHash = hashScene(scene);
  const demandHash = hashDemands(demands);

  // 统计集合 D
  const D = demands.filter((d) => d.scheduledTick >= 0 && d.scheduledTick < config.H);
  const actualDemandCount = D.length;

  // 事件排序：按 (tick, 固定类型顺序, agentId)
  const sortedEvents = state.events.map(copyEvent).sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const typeDiff = eventTypeRank(a.type) - eventTypeRank(b.type);
    if (typeDiff !== 0) return typeDiff;
    return lexCompare(a.agentId, b.agentId);
  });

  // 占用矩阵按 y/x 行序
  const occupancyMatrix: { pos: GridPos; count: number }[] = [];
  for (const [k, count] of state.occupancyMatrix) {
    const [x, y] = k.split(',').map(Number);
    occupancyMatrix.push({ pos: { x, y }, count });
  }
  occupancyMatrix.sort((a, b) => {
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    return a.pos.x - b.pos.x;
  });

  // 计算指标
  const metrics = computeMetrics(state, demands, scene, config.H);

  // 停滞诊断排序
  const sortedStagnation = state.stagnationDiagnostics.map(diag => ({ ...diag })).sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return lexCompare(a.agentId, b.agentId);
  });

  return {
    modelVersion: MODEL_VERSION,
    generatorVersion: GENERATOR_VERSION,
    hashVersion: HASH_VERSION,
    serializationVersion: SERIALIZATION_VERSION,
    limits: {
      minH: MIN_H,
      maxH: MAX_H,
      maxDemandCount: MAX_DEMAND_COUNT,
      maxInputRecords: MAX_INPUT_RECORDS,
      maxHInputProduct: MAX_H_TIMES_DEMANDS,
    },
    sceneSnapshot,
    sceneHash,
    config: { ...config },
    demandSource,
    configDemandCount: config.demandCount,
    totalInputRecords: demands.length,
    actualDemandCount,
    demands: deepCopyDemands(demands),
    demandHash,
    H: config.H,
    executedTicks: state.tick,
    isComplete: state.tick >= config.H,
    failureDiagnostic: state.failureDiagnostic ? { ...state.failureDiagnostic } : null,
    trace: state.trace.map(copySnapshot),
    events: sortedEvents as EventRecord[],
    metrics,
    occupancyMatrix,
    sampleCount: state.sampleCount,
    congestionExposure: state.congestionExposure,
    stagnationDiagnostics: sortedStagnation,
    nonCoreMetadata: {
      runState,
      speed: metadata?.speed ?? null,
      exportTimestamp: metadata?.exportTimestamp ?? null,
    },
  };
}
