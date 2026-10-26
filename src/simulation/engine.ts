/**
 * 引擎主入口。
 *
 * createEngine 深复制并冻结 scene/config/demands → 校验 → 生成或校验需求 → 初始化状态。
 * Engine 暴露 start/pause/cancel/step/runTo/reset/getSnapshot/getMetrics/getReport。
 * step 仅在 initialized/paused/running 且 tick<H 时推进，到 H 则 complete，终态拒绝推进。
 *
 * 确定性同步句柄，不依赖 React/Canvas/DOM/Math.random/实时时钟。
 */
import type { Scene } from '../domain/types';
import { validateScene } from '../domain/validation';
import type {
  SimulationConfig,
  ExogenousDemand,
  Engine,
  RunState,
  SimState,
  SimSnapshot,
  Metrics,
  RunReport,
  ExportMetadata,
  AdvanceResult,
  ControlResult,
} from './types';
import { createRng } from './prng';
import { generateDemands, validateInjectedDemands } from './demand';
import { step, createInitialSimState } from './step';
import { computeMetrics } from './metrics';
import { buildReport } from './report';
import { copySnapshot } from './queryCopies';
import { createStepContext } from './runtime';
import {
  MIN_H,
  MAX_H,
  MIN_DEMAND_COUNT,
  MAX_DEMAND_COUNT,
  MAX_H_TIMES_DEMANDS,
  DEFAULT_SEED,
  DEFAULT_H,
  DEFAULT_DEMAND_COUNT,
} from './constants';

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
  return demands.map(d => ({
    id: d.id, scheduledTick: d.scheduledTick, entranceId: d.entranceId,
    boothId: d.boothId, serviceTicks: d.serviceTicks,
  }));
}

/** 校验配置 */
function validateConfig(config: SimulationConfig): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 4294967295) {
    return { ok: false, error: '种子必须是 0–4294967295 的整数' };
  }
  if (!Number.isInteger(config.H) || config.H < MIN_H || config.H > MAX_H) {
    return { ok: false, error: `H 必须是 ${MIN_H}–${MAX_H} 的整数` };
  }
  if (!Number.isInteger(config.demandCount) || config.demandCount < MIN_DEMAND_COUNT || config.demandCount > MAX_DEMAND_COUNT) {
    return { ok: false, error: `需求人数必须是 ${MIN_DEMAND_COUNT}–${MAX_DEMAND_COUNT} 的整数` };
  }
  return { ok: true };
}

/** 创建 tick 0 的初始快照 */
function createInitialSnapshot(
  demands: ExogenousDemand[],
  H: number,
): SimSnapshot {
  const notYetArrivedIds = demands
    .filter((d) => d.scheduledTick >= 0 && d.scheduledTick < H)
    .map((d) => d.id)
    .sort(lexCompare);

  return {
    tick: 0,
    notYetArrivedIds,
    agents: [],
    occupancy: [],
    moveFailures: [],
    congestionCenters: [],
  };
}

/** 从 state 创建当前快照 */
function snapshotFromState(
  state: SimState,
  demands: ExogenousDemand[],
  H: number,
): SimSnapshot {
  if (state.trace.length > 0) {
    return copySnapshot(state.trace[state.trace.length - 1]);
  }
  return createInitialSnapshot(demands, H);
}

/**
 * 创建仿真引擎。
 * @param scene 场景
 * @param config 配置
 * @param demands 注入需求（省略则自动生成）
 * @returns 成功返回引擎，失败返回错误
 */
export function createEngine(
  scene: Scene,
  config: SimulationConfig,
  demands?: ExogenousDemand[],
): { ok: true; engine: Engine } | { ok: false; error: string } {
  try {
    return createValidatedEngine(scene, config, demands);
  } catch (error) {
    return { ok: false, error: `仿真初始化失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

function createValidatedEngine(
  scene: Scene,
  config: SimulationConfig,
  demands?: ExogenousDemand[],
): { ok: true; engine: Engine } | { ok: false; error: string } {
  // 深复制场景
  const frozenScene = deepCopyScene(scene);

  // 校验场景
  const validation = validateScene(frozenScene);
  if (!validation.readyForSimulation) {
    return { ok: false, error: `场景不可用于仿真：${validation.issues.map((i) => i.message).join('; ')}` };
  }

  // 校验配置
  const configResult = validateConfig(config);
  if (!configResult.ok) {
    return { ok: false, error: configResult.error };
  }

  const frozenConfig: SimulationConfig = {
    seed: config.seed, H: config.H, demandCount: config.demandCount,
  };

  // 生成或校验需求
  let frozenDemands: ExogenousDemand[];
  let demandSource: 'generated' | 'injected';

  if (demands !== undefined) {
    const demandResult = validateInjectedDemands(demands, frozenScene, frozenConfig);
    if (!demandResult.ok) {
      return { ok: false, error: demandResult.error };
    }
    frozenDemands = deepCopyDemands(demands).sort((a, b) => {
      if (a.scheduledTick !== b.scheduledTick) return a.scheduledTick - b.scheduledTick;
      return lexCompare(a.id, b.id);
    });
    demandSource = 'injected';
  } else {
    if (frozenConfig.H * frozenConfig.demandCount > MAX_H_TIMES_DEMANDS) {
      return { ok: false, error: `H × 需求人数 ${frozenConfig.H * frozenConfig.demandCount} 超过预算 ${MAX_H_TIMES_DEMANDS}` };
    }
    const rng = createRng(frozenConfig.seed);
    frozenDemands = generateDemands(frozenScene, frozenConfig, rng);
    demandSource = 'generated';
  }

  // 初始化状态
  let state = createInitialSimState();
  let runState: RunState = 'initialized';
  const context = createStepContext(frozenScene);
  const snapshot = () => snapshotFromState(state, frozenDemands, frozenConfig.H);

  const engine: Engine = {
    get executedTicks() { return state.tick; },
    get runState() { return runState; },
    get isComplete() { return runState === 'complete'; },
    get isTerminal() { return runState === 'complete' || runState === 'cancelled' || runState === 'failed'; },

    start(): ControlResult {
      if (runState === 'initialized' || runState === 'paused') {
        runState = 'running';
        return { ok: true };
      }
      return { ok: false, error: `当前状态 ${runState} 不允许 start` };
    },

    pause(): ControlResult {
      if (runState === 'running') {
        runState = 'paused';
        return { ok: true };
      }
      return { ok: false, error: `当前状态 ${runState} 不允许 pause` };
    },

    cancel(): void {
      if (runState !== 'complete' && runState !== 'cancelled' && runState !== 'failed') {
        runState = 'cancelled';
      }
    },

    step(): AdvanceResult {
      if (runState === 'complete' || runState === 'cancelled' || runState === 'failed') {
        return {
          ok: false,
          snapshot: snapshot(),
          error: `终态 ${runState} 不允许 step`,
        };
      }
      if (state.tick >= frozenConfig.H) {
        runState = 'complete';
        return {
          ok: true,
          snapshot: snapshot(),
        };
      }

      try {
        const newState = step(state, frozenScene, frozenDemands, frozenConfig, context);
        state = newState;

        if (state.tick >= frozenConfig.H) {
          runState = 'complete';
        } else if (runState === 'initialized') {
          runState = 'paused';
        }

        return {
          ok: true,
          snapshot: snapshot(),
        };
      } catch (e) {
        runState = 'failed';
        state = {
          ...state,
          failureDiagnostic: {
            lastValidTick: state.tick,
            attemptedTick: state.tick + 1,
            stage: 'step',
            reason: e instanceof Error ? e.message : String(e),
          },
        };
        return {
          ok: false,
          snapshot: snapshot(),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },

    runTo(targetTick: number): AdvanceResult {
      if (engine.isTerminal) {
        return { ok: false, snapshot: snapshot(), error: `终态 ${runState} 不允许 runTo` };
      }
      if (!Number.isInteger(targetTick) || targetTick < state.tick || targetTick > frozenConfig.H) {
        return {
          ok: false,
          snapshot: snapshot(),
          error: `目标 tick ${targetTick} 不在有效范围 [${state.tick}, ${frozenConfig.H}]`,
        };
      }

      let result: AdvanceResult = {
        ok: true,
        snapshot: snapshot(),
      };

      while (state.tick < targetTick && !engine.isTerminal) {
        result = engine.step();
        if (!result.ok) break;
      }

      // 部分目标结束后暂停
      if (result.ok && state.tick < frozenConfig.H && state.tick > 0) {
        runState = 'paused';
      }

      return result;
    },

    reset(): void {
      state = createInitialSimState();
      runState = 'initialized';
    },

    getSnapshot(): SimSnapshot {
      return snapshot();
    },

    getMetrics(): Metrics {
      return computeMetrics(state, frozenDemands, frozenScene, frozenConfig.H);
    },

    getReport(metadata?: ExportMetadata): RunReport {
      return buildReport(
        frozenScene,
        frozenConfig,
        frozenDemands,
        state,
        runState,
        demandSource,
        metadata,
      );
    },
  };

  return { ok: true, engine };
}

export { DEFAULT_SEED, DEFAULT_H, DEFAULT_DEMAND_COUNT };
