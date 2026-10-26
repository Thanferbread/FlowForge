/**
 * 统计指标计算。
 *
 * 从 state.tick 读取执行长度，统计集合 D 为 0≤scheduledTick<H 的需求。
 * 分母为 0 用 null。无 NaN/Infinity。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Scene, GridPos } from '../domain/types';
import { posKey, inBounds } from '../domain/geometry';
import { cellAt } from '../domain/operations';
import type {
  SimState,
  ExogenousDemand,
  Metrics,
  WaitObservation,
  DensitySummary,
  RatioInput,
} from './types';

/** 非.locale 字典序比较 */
function lexCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 判断格子是否物理可走（不含障碍和展位实体） */
function isPhysicallyWalkable(scene: Scene, pos: GridPos): boolean {
  if (!inBounds(pos, scene.width, scene.height)) return false;
  const info = cellAt(scene, pos);
  return info.kind !== 'obstacle' && info.kind !== 'booth-footprint';
}

/** 计算 3×3 邻域人数和可走面积 */
function computeLocalStats(
  scene: Scene,
  center: GridPos,
  occupancy: Map<string, string>,
): { people: number; area: number } {
  let people = 0;
  let area = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const pos: GridPos = { x: center.x + dx, y: center.y + dy };
      if (!inBounds(pos, scene.width, scene.height)) continue;
      if (!isPhysicallyWalkable(scene, pos)) continue;
      area++;
      if (occupancy.has(posKey(pos))) people++;
    }
  }
  return { people, area };
}

/**
 * 计算统计指标。
 * @param state 当前仿真状态
 * @param demands 需求数组
 * @param scene 场景（物理面积及界内邻域）
 * @param H 仿真时长
 */
export function computeMetrics(
  state: SimState,
  demands: ExogenousDemand[],
  scene: Scene,
  H: number,
): Metrics {
  const tick = state.tick;
  const isCompleteRun = tick >= H;

  // 统计集合 D：0 ≤ scheduledTick < H
  const D = demands.filter((d) => d.scheduledTick >= 0 && d.scheduledTick < H);
  const demandCount = D.length;
  const demandIds = new Set(D.map((d) => d.id));
  const agents = [...state.agents.values()].filter((agent) => demandIds.has(agent.id));

  // 各状态计数
  let notYetArrived = 0;
  let pending = 0;
  let walking = 0;
  let queued = 0;
  let serving = 0;
  let exiting = 0;
  let exited = 0;
  let admitted = 0;
  let serviceCompleted = 0;
  let systemCompleted = 0;

  for (const d of D) {
    if (!state.agents.has(d.id)) {
      notYetArrived++;
    }
  }

  for (const agent of agents) {
    switch (agent.state) {
      case 'pending': pending++; break;
      case 'walking': walking++; break;
      case 'queued': queued++; break;
      case 'serving': serving++; break;
      case 'exiting': exiting++; break;
      case 'exited': exited++; break;
    }
    if (agent.admitTick !== null) admitted++;
    if (agent.serviceCompleteTick !== null) {
      serviceCompleted++;
      if (agent.exitTick !== null) systemCompleted++;
    }
  }

  const incomplete = demandCount - exited;

  // 比率计算
  const serviceCompletionRate: number | null =
    demandCount > 0 ? serviceCompleted / demandCount : null;
  const systemCompletionRate: number | null =
    demandCount > 0 ? systemCompleted / demandCount : null;

  // 完整运行吞吐以 H 为分母，零需求仍有定义且为 0。
  const throughput: number | null =
    isCompleteRun ? (serviceCompleted * 60) / H : null;

  // 等待观测
  const waiting: WaitObservation[] = [];
  for (const agent of agents) {
    if (agent.enqueueTick !== null) {
      const hasStartedService = agent.serviceStartTick !== null;
      const elapsedSeconds = hasStartedService
        ? agent.serviceStartTick! - agent.enqueueTick
        : tick - agent.enqueueTick;
      waiting.push({
        agentId: agent.id,
        enqueueTick: agent.enqueueTick,
        serviceStartTick: agent.serviceStartTick,
        elapsedSeconds,
        hasStartedService,
      });
    }
  }
  waiting.sort((a, b) => lexCompare(a.agentId, b.agentId));

  // 等待均值（仅已开始服务者）
  const startedService = waiting.filter((w) => w.hasStartedService);
  const waitSampleCount = startedService.length;
  const waitSum = startedService.reduce((sum, w) => sum + w.elapsedSeconds, 0);
  const waitAverage: number | null =
    waitSampleCount > 0 ? waitSum / waitSampleCount : null;

  // 截尾平均耗时（仅完整运行有效）
  let truncatedAvgDuration: number | null = null;
  let truncatedCount: number | null = null;
  if (isCompleteRun) {
    let durationSum = 0;
    let truncated = 0;
    for (const d of D) {
      const agent = state.agents.get(d.id);
      const exitTime = agent?.exitTick ?? H;
      durationSum += exitTime - d.scheduledTick;
      if (agent?.exitTick == null) {
        truncated++;
      }
    }
    truncatedAvgDuration = demandCount > 0 ? durationSum / demandCount : null;
    truncatedCount = truncated;
  }

  // 密度摘要
  const density = computeDensitySummary(state, scene);

  // 原始比率
  const rawRatios = {
    serviceCompletionRate: {
      numerator: serviceCompleted,
      denominator: demandCount,
    } as RatioInput,
    systemCompletionRate: {
      numerator: systemCompleted,
      denominator: demandCount,
    } as RatioInput,
    throughput: isCompleteRun
      ? ({ numerator: serviceCompleted * 60, denominator: H } as RatioInput)
      : null,
    waitAverage: {
      numerator: waitSum,
      denominator: waitSampleCount,
    } as RatioInput,
    truncatedAvgDuration: isCompleteRun
      ? ({
          numerator: D.reduce((sum, d) => {
            const agent = state.agents.get(d.id);
            return sum + ((agent?.exitTick ?? H) - d.scheduledTick);
          }, 0),
          denominator: demandCount,
        } as RatioInput)
      : null,
  };

  return {
    demandCount,
    notYetArrived,
    admitted,
    pending,
    walking,
    queued,
    serving,
    exiting,
    exited,
    serviceCompleted,
    incomplete,
    serviceCompletionRate,
    systemCompletionRate,
    throughput,
    waitAverage,
    waitSampleCount,
    truncatedAvgDuration,
    truncatedCount,
    congestionExposure: state.congestionExposure,
    isCompleteRun,
    waiting,
    density,
    rawRatios,
  };
}

/** 计算密度摘要 */
function computeDensitySummary(state: SimState, scene: Scene): DensitySummary {
  let walkableArea = 0;
  const cells: DensitySummary['cells'] = [];
  const local: DensitySummary['local'] = [];

  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const pos: GridPos = { x, y };
      const applicable = isPhysicallyWalkable(scene, pos);
      if (applicable) walkableArea++;

      const occupiedSamples = state.occupancyMatrix.get(posKey(pos)) ?? 0;
      const cellSampleCount = state.sampleCount;
      const density =
        applicable && cellSampleCount > 0
          ? occupiedSamples / cellSampleCount
          : null;

      cells.push({
        pos: { ...pos },
        applicable,
        occupiedSamples,
        sampleCount: cellSampleCount,
        area: 1,
        density,
      });
    }
  }

  // 局部密度（3×3 邻域）
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const center: GridPos = { x, y };
      const stats = computeLocalStats(scene, center, state.occupancy);
      local.push({
        center: { ...center },
        people: state.sampleCount > 0 ? stats.people : 0,
        area: stats.area,
        density: state.sampleCount > 0 && stats.area > 0 ? stats.people / stats.area : null,
      });
    }
  }

  // 排序 cells 和 local 按 y/x 行序
  cells.sort((a, b) => {
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    return a.pos.x - b.pos.x;
  });
  local.sort((a, b) => {
    if (a.center.y !== b.center.y) return a.center.y - b.center.y;
    return a.center.x - b.center.x;
  });

  const totalOccupancySamples = Array.from(state.occupancyMatrix.values()).reduce(
    (sum, count) => sum + count,
    0,
  );

  const meanDensity =
    state.sampleCount > 0 && walkableArea > 0
      ? totalOccupancySamples / (state.sampleCount * walkableArea)
      : null;

  return {
    walkableArea,
    sampleCount: state.sampleCount,
    totalOccupancySamples,
    meanDensity,
    cells,
    local,
  };
}
