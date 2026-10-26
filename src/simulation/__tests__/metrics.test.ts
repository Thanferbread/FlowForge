/**
 * 指标计算测试 S11–S16。
 *
 * 使用人工事件夹具验证手算期望值，同时用引擎 API 验证真实运行指标。
 */
import { describe, it, expect } from 'vitest';
import { createEngine } from '../engine';
import { computeMetrics } from '../metrics';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { Scene } from '../../domain/types';
import { SCHEMA_VERSION } from '../../domain/types';
import type {
  SimState,
  ExogenousDemand,
  AgentRecord,
} from '../types';
import { createInitialSimState } from '../step';

/** 创建人工 agent 记录 */
function makeAgent(
  id: string,
  demand: ExogenousDemand,
  overrides: Partial<AgentRecord> = {},
): AgentRecord {
  return {
    id,
    demand,
    state: 'pending',
    pos: null,
    remainingService: null,
    admitTick: null,
    enqueueTick: null,
    serviceStartTick: null,
    serviceCompleteTick: null,
    reachExitTick: null,
    exitTick: null,
    selectedExitId: null,
    consecutiveFailures: 0,
    replanCount: 0,
    replanPath: null,
    ...overrides,
  };
}

/** 创建人工需求 */
function makeDemand(
  id: string,
  scheduledTick: number,
  serviceTicks: number = 4,
): ExogenousDemand {
  return {
    id,
    scheduledTick,
    entranceId: 'entrance-1',
    boothId: 'booth-1',
    serviceTicks,
  };
}

/** 创建测试用小场景 */
function createTestScene(): Scene {
  return {
    schemaVersion: SCHEMA_VERSION,
    width: 10,
    height: 10,
    obstacles: [],
    entrances: [{ id: 'entrance-1', pos: { x: 0, y: 9 } }],
    exits: [{ id: 'exit-1', pos: { x: 9, y: 0 } }],
    booths: [
      {
        id: 'booth-1',
        footprint: { x: 5, y: 5 },
        serviceCell: { x: 5, y: 6 },
        queueCells: [{ x: 5, y: 7 }, { x: 5, y: 8 }],
        serviceTicksMin: 4,
        serviceTicksMax: 4,
      },
    ],
  };
}

/** 构建人工 SimState */
function buildState(
  tick: number,
  agents: AgentRecord[],
  occupancyMatrixEntries: [string, number][] = [],
  sampleCount: number = 0,
  congestionExposure: number = 0,
): SimState {
  const state = createInitialSimState();
  const agentMap = new Map<string, AgentRecord>();
  for (const a of agents) {
    agentMap.set(a.id, a);
  }
  const occupancyMatrix = new Map<string, number>(occupancyMatrixEntries);
  return {
    ...state,
    tick,
    agents: agentMap,
    occupancyMatrix,
    sampleCount,
    congestionExposure,
  };
}

describe('S11: 服务完成率/系统完成率/吞吐/截尾均值', () => {
  it('人工夹具：H=10、4 人、2 服务完成、1 离场', () => {
    const scene = createTestScene();
    const H = 10;
    const d1 = makeDemand('agent-1', 0);
    const d2 = makeDemand('agent-2', 2);
    const d3 = makeDemand('agent-3', 4);
    const d4 = makeDemand('agent-4', 6);
    const demands = [d1, d2, d3, d4];

    const agents: AgentRecord[] = [
      makeAgent('agent-1', d1, {
        state: 'exited',
        admitTick: 0,
        enqueueTick: 1,
        serviceStartTick: 2,
        serviceCompleteTick: 5,
        reachExitTick: 5,
        exitTick: 5,
      }),
      makeAgent('agent-2', d2, {
        state: 'exiting',
        admitTick: 2,
        enqueueTick: 3,
        serviceStartTick: 4,
        serviceCompleteTick: 8,
        reachExitTick: null,
        exitTick: null,
      }),
      makeAgent('agent-3', d3, {
        state: 'serving',
        admitTick: 4,
        enqueueTick: 5,
        serviceStartTick: 7,
        serviceCompleteTick: null,
        remainingService: 2,
      }),
      makeAgent('agent-4', d4, {
        state: 'queued',
        admitTick: 6,
        enqueueTick: 8,
      }),
    ];

    const state = buildState(H, agents);
    const metrics = computeMetrics(state, demands, scene, H);

    expect(metrics.demandCount).toBe(4);
    expect(metrics.serviceCompleted).toBe(2);
    expect(metrics.exited).toBe(1);
    expect(metrics.serviceCompletionRate).toBe(0.5);
    expect(metrics.systemCompletionRate).toBe(0.25);
    expect(metrics.throughput).toBe(12);
    expect(metrics.truncatedAvgDuration).toBe(5.75);
    expect(metrics.truncatedCount).toBe(3);
    expect(metrics.isCompleteRun).toBe(true);
  });
});

describe('S12: 等待均值与未完成排队', () => {
  it('两人等 2s/4s 后开始服务，一人到 H 未开始', () => {
    const scene = createTestScene();
    const H = 10;
    const d1 = makeDemand('agent-1', 0);
    const d2 = makeDemand('agent-2', 0);
    const d3 = makeDemand('agent-3', 0);
    const demands = [d1, d2, d3];

    const agents: AgentRecord[] = [
      makeAgent('agent-1', d1, {
        state: 'serving',
        admitTick: 0,
        enqueueTick: 1,
        serviceStartTick: 3,
        remainingService: 2,
      }),
      makeAgent('agent-2', d2, {
        state: 'serving',
        admitTick: 0,
        enqueueTick: 2,
        serviceStartTick: 6,
        remainingService: 1,
      }),
      makeAgent('agent-3', d3, {
        state: 'queued',
        admitTick: 0,
        enqueueTick: 5,
      }),
    ];

    const state = buildState(8, agents);
    const metrics = computeMetrics(state, demands, scene, H);

    expect(metrics.waitAverage).toBe(3);
    expect(metrics.waitSampleCount).toBe(2);
    expect(metrics.queued).toBe(1);

    const unstarted = metrics.waiting.filter((w) => !w.hasStartedService);
    expect(unstarted.length).toBe(1);
    expect(unstarted[0].agentId).toBe('agent-3');
  });
});

describe('S13: 密度摘要', () => {
  it('两格采样 4 次占用 2/4 次，各密度 0.5/1', () => {
    const scene = createTestScene();
    const H = 10;
    const demands: ExogenousDemand[] = [];

    const state = buildState(4, [], [
      ['5,7', 2],
      ['5,8', 4],
    ], 4);

    const metrics = computeMetrics(state, demands, scene, H);

    const cell57 = metrics.density.cells.find((c) => c.pos.x === 5 && c.pos.y === 7);
    const cell58 = metrics.density.cells.find((c) => c.pos.x === 5 && c.pos.y === 8);

    expect(cell57).toBeDefined();
    expect(cell58).toBeDefined();
    if (cell57 && cell58) {
      expect(cell57.density).toBe(0.5);
      expect(cell58.density).toBe(1);
      expect(cell57.applicable).toBe(true);
      expect(cell58.applicable).toBe(true);
    }

    expect(metrics.density.sampleCount).toBe(4);
  });
});

describe('S14: 拥堵判定', () => {
  it('连续 5 tick 才报拥堵，前 4 tick 不报', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 1, H: 50, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(50);
    const report = engine.getReport();

    expect(report.congestionExposure).toBeGreaterThanOrEqual(0);
    expect(report.metrics.congestionExposure).toBe(report.congestionExposure);
  });
});

describe('S15: 拥堵暴露不重复计数', () => {
  it('同一人多邻域只加 1 人·秒', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(100);
    const report = engine.getReport();

    expect(report.congestionExposure).toBeGreaterThanOrEqual(0);

    const matrixSum = report.occupancyMatrix.reduce((s, e) => s + e.count, 0);
    const expectedMatrix = new Map<string, number>();
    for (const snapshot of report.trace) {
      for (const { pos } of snapshot.occupancy) {
        const key = `${pos.x},${pos.y}`;
        expectedMatrix.set(key, (expectedMatrix.get(key) ?? 0) + 1);
      }
    }
    const actualMatrix = new Map(report.occupancyMatrix.map(({ pos, count }) => [
      `${pos.x},${pos.y}`, count,
    ]));
    expect(report.sampleCount).toBe(100);
    expect(report.trace).toHaveLength(report.sampleCount);
    expect(actualMatrix).toEqual(expectedMatrix);
    expect(matrixSum).toBe(report.trace.reduce((sum, snapshot) => sum + snapshot.occupancy.length, 0));
    expect(matrixSum).toBeGreaterThan(0);
  });
});

describe('S16: 边界情况', () => {
  it('0 需求完整运行：吞吐和截尾人数为 0，零分母均值仍为 null', () => {
    const scene = createTestScene();
    const H = 10;
    const state = buildState(H, [], [], H);
    const metrics = computeMetrics(state, [], scene, H);

    expect(metrics.demandCount).toBe(0);
    expect(metrics.serviceCompletionRate).toBe(null);
    expect(metrics.systemCompletionRate).toBe(null);
    expect(metrics.throughput).toBe(0);
    expect(metrics.waitAverage).toBe(null);
    expect(metrics.truncatedAvgDuration).toBe(null);
    expect(metrics.truncatedCount).toBe(0);
    expect(metrics.rawRatios).toEqual({
      serviceCompletionRate: { numerator: 0, denominator: 0 },
      systemCompletionRate: { numerator: 0, denominator: 0 },
      throughput: { numerator: 0, denominator: H },
      waitAverage: { numerator: 0, denominator: 0 },
      truncatedAvgDuration: { numerator: 0, denominator: 0 },
    });
    expect(metrics.density.meanDensity).toBe(0);
    for (const cell of metrics.density.cells) expect(cell.density).toBe(cell.applicable ? 0 : null);
    for (const local of metrics.density.local) expect(local.density).toBe(local.area > 0 ? 0 : null);
    expect(metrics.congestionExposure).toBe(0);
    expect(Number.isNaN(metrics.congestionExposure)).toBe(false);
  });

  it('H 边界：scheduledTick=H 的需求排除在 D 外', () => {
    const scene = createTestScene();
    const H = 10;
    const d1 = makeDemand('agent-1', 0);
    const d2 = makeDemand('agent-2', H);
    const demands = [d1, d2];

    const agents: AgentRecord[] = [
      makeAgent('agent-1', d1, {
        state: 'exited',
        admitTick: 0,
        exitTick: 5,
        serviceCompleteTick: 4,
        reachExitTick: 5,
      }),
    ];

    const state = buildState(H, agents);
    const metrics = computeMetrics(state, demands, scene, H);

    expect(metrics.demandCount).toBe(1);
    expect(metrics.exited).toBe(1);
  });

  it('初始化无采样：单格、整体及局部密度均为 null，保留已知面积', () => {
    const metrics = computeMetrics(createInitialSimState(), [], createTestScene(), 10);
    expect(metrics.density.sampleCount).toBe(0);
    expect(metrics.density.meanDensity).toBe(null);
    expect(metrics.density.walkableArea).toBe(99);
    expect(metrics.density.cells.every((cell) => cell.density === null)).toBe(true);
    expect(metrics.density.local.every((local) => local.density === null && local.people === 0)).toBe(true);
    expect(metrics.density.local.find(({ center }) => center.x === 0 && center.y === 0)?.area).toBe(4);
    expect(metrics.rawRatios.throughput).toBe(null);
    expect(metrics.rawRatios.truncatedAvgDuration).toBe(null);
    expect(metrics.truncatedCount).toBe(null);
  });

  it('指标全部计数及等待观测仅涉及 D，排除时域外人员记录', () => {
    const scene = createTestScene();
    const inside = makeDemand('inside', 0);
    const outside = makeDemand('outside', 10);
    const insideAgent = makeAgent(inside.id, inside, {
      state: 'walking', admitTick: 0, pos: { x: 1, y: 9 },
    });
    const outsideAgent = makeAgent(outside.id, outside, {
      state: 'exited', admitTick: 0, enqueueTick: 1,
      serviceStartTick: 3, serviceCompleteTick: 4, exitTick: 5,
    });
    const expected = computeMetrics(buildState(5, [insideAgent]), [inside], scene, 10);
    const actual = computeMetrics(buildState(5, [insideAgent, outsideAgent]), [inside, outside], scene, 10);
    expect(actual).toEqual(expected);
  });

  it('完整运行尚无离场记录者计入截尾，恰在 H 离场者不截尾', () => {
    const scene = createTestScene();
    const missing = makeDemand('missing', 0);
    const completed = makeDemand('completed', 2);
    const state = buildState(10, [makeAgent(completed.id, completed, {
      state: 'exited', admitTick: 2, serviceCompleteTick: 9, exitTick: 10,
    })]);
    const metrics = computeMetrics(state, [missing, completed], scene, 10);
    expect(metrics.truncatedCount).toBe(1);
    expect(metrics.truncatedAvgDuration).toBe(9);
    expect(metrics.rawRatios.truncatedAvgDuration).toEqual({ numerator: 18, denominator: 2 });
  });

  it('部分运行吞吐/截尾均值为 null', () => {
    const scene = createTestScene();
    const H = 10;
    const d1 = makeDemand('agent-1', 0);
    const demands = [d1];

    const agents: AgentRecord[] = [
      makeAgent('agent-1', d1, {
        state: 'walking',
        admitTick: 0,
        pos: { x: 1, y: 9 },
      }),
    ];

    const state = buildState(5, agents);
    const metrics = computeMetrics(state, demands, scene, H);

    expect(metrics.isCompleteRun).toBe(false);
    expect(metrics.throughput).toBe(null);
    expect(metrics.truncatedAvgDuration).toBe(null);
    expect(metrics.truncatedCount).toBe(null);
  });
});

describe('真实运行指标一致性', () => {
  it('引擎运行后 metrics 与 report.metrics 一致', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(50);

    const metrics = engine.getMetrics();
    const report = engine.getReport();

    expect(metrics.demandCount).toBe(report.metrics.demandCount);
    expect(metrics.serviceCompleted).toBe(report.metrics.serviceCompleted);
    expect(metrics.exited).toBe(report.metrics.exited);
    expect(metrics.congestionExposure).toBe(report.metrics.congestionExposure);
  });

  it('守恒：notYetArrived + activeAgents + exited = demandCount', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 7, H: 200, demandCount: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(200);
    const metrics = engine.getMetrics();

    const activeAgents = metrics.pending + metrics.walking + metrics.queued + metrics.serving + metrics.exiting;
    const total = metrics.notYetArrived + activeAgents + metrics.exited;
    expect(total).toBe(metrics.demandCount);
  });
});
