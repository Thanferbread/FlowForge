/**
 * 引擎生命周期测试 S17。
 *
 * 断言校验拒绝、不可变性、状态转换、reset 一致性。
 */
import { describe, it, expect } from 'vitest';
import { createEngine } from '../engine';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { Scene } from '../../domain/types';
import { SCHEMA_VERSION } from '../../domain/types';
import type { ExogenousDemand } from '../types';
import { stableStringify } from '../hash';

describe('S17a: 非法场景被拒绝', () => {
  it('readyForSimulation===false 被拒绝', () => {
    const invalidScene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      width: 10,
      height: 10,
      obstacles: [],
      entrances: [],
      exits: [],
      booths: [],
    };
    const result = createEngine(invalidScene, { seed: 42, H: 10, demandCount: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('场景');
    }
  });
});

describe('S17b: 非法配置被拒绝', () => {
  const scene = createCampusFairScene();

  it('seed 非 uint32 被拒绝', () => {
    expect(createEngine(scene, { seed: -1, H: 10, demandCount: 5 }).ok).toBe(false);
    expect(createEngine(scene, { seed: 1.5, H: 10, demandCount: 5 }).ok).toBe(false);
    expect(createEngine(scene, { seed: 4294967296, H: 10, demandCount: 5 }).ok).toBe(false);
  });

  it('H 超限被拒绝', () => {
    expect(createEngine(scene, { seed: 42, H: 0, demandCount: 5 }).ok).toBe(false);
    expect(createEngine(scene, { seed: 42, H: 1801, demandCount: 5 }).ok).toBe(false);
    expect(createEngine(scene, { seed: 42, H: 1.5, demandCount: 5 }).ok).toBe(false);
  });

  it('demandCount 超限被拒绝', () => {
    expect(createEngine(scene, { seed: 42, H: 10, demandCount: -1 }).ok).toBe(false);
    expect(createEngine(scene, { seed: 42, H: 10, demandCount: 501 }).ok).toBe(false);
  });

  it('H × demandCount 超预算被拒绝', () => {
    expect(createEngine(scene, { seed: 42, H: 1800, demandCount: 500 }).ok).toBe(false);
  });
});

describe('S17c: 注入需求校验', () => {
  const scene = createCampusFairScene();
  const baseConfig = { seed: 42, H: 50, demandCount: 2 };

  it('重复 ID 被拒绝', () => {
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: scene.entrances[0].id, boothId: scene.booths[0].id, serviceTicks: 4 },
      { id: 'a1', scheduledTick: 1, entranceId: scene.entrances[0].id, boothId: scene.booths[0].id, serviceTicks: 4 },
    ];
    const result = createEngine(scene, baseConfig, demands);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('重复');
    }
  });

  it('无效入口引用被拒绝', () => {
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: 'nonexistent', boothId: scene.booths[0].id, serviceTicks: 4 },
    ];
    expect(createEngine(scene, baseConfig, demands).ok).toBe(false);
  });

  it('无效展位引用被拒绝', () => {
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: scene.entrances[0].id, boothId: 'nonexistent', serviceTicks: 4 },
    ];
    expect(createEngine(scene, baseConfig, demands).ok).toBe(false);
  });
});

describe('S17d: 调用方修改原 scene 不影响引擎', () => {
  it('修改原 scene 对象不改变引擎轨迹', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 20, demandCount: 5 };

    const result = createEngine(scene, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(20);

    scene.width = 5;
    scene.booths = [];

    const result2 = createEngine(scene, config);
    expect(result2.ok).toBe(false);
  });
});

describe('S17e: 修改快照不影响引擎内部状态', () => {
  it('修改 getSnapshot 返回的快照不改变引擎', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 30, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);

    const snap1 = engine.getSnapshot();
    const originalTick = snap1.tick;
    snap1.tick = 999;
    if (snap1.agents.length > 0) {
      snap1.agents[0].state = 'exited';
    }

    const snap2 = engine.getSnapshot();
    expect(snap2.tick).toBe(originalTick);
  });
});

describe('S17f: 时域外需求不激活', () => {
  it('scheduledTick=H 和 H+1 的注入记录不进入 D', () => {
    const scene = createCampusFairScene();
    const H = 20;
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: scene.entrances[0].id, boothId: scene.booths[0].id, serviceTicks: 4 },
      { id: 'a2', scheduledTick: H, entranceId: scene.entrances[0].id, boothId: scene.booths[0].id, serviceTicks: 4 },
      { id: 'a3', scheduledTick: H + 1, entranceId: scene.entrances[0].id, boothId: scene.booths[0].id, serviceTicks: 4 },
    ];
    const result = createEngine(scene, { seed: 42, H, demandCount: 3 }, demands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(H);
    const metrics = engine.getMetrics();

    expect(metrics.demandCount).toBe(1);
  });
});

describe('S17g: 终态拒绝 step', () => {
  it('complete 后 step 返回错误', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 5, demandCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(5);
    expect(engine.isComplete).toBe(true);

    const stepResult = engine.step();
    expect(stepResult.ok).toBe(false);
  });

  it('cancel 后 step 返回错误', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    engine.cancel();
    expect(engine.isTerminal).toBe(true);

    const stepResult = engine.step();
    expect(stepResult.ok).toBe(false);
  });
});

describe('S17h: runTo 非法目标', () => {
  it('非法目标不改状态', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const tickBefore = engine.executedTicks;

    const r = engine.runTo(5);
    expect(r.ok).toBe(false);
    expect(engine.executedTicks).toBe(tickBefore);
  });

  it('有效目标最多执行 targetTick - 当前 tick 次', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    expect(engine.executedTicks).toBe(10);

    engine.runTo(25);
    expect(engine.executedTicks).toBe(25);
  });
});

describe('S17i: reset 后重跑等于首次', () => {
  it('reset 后同输入重跑结果一致', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 30, demandCount: 5 };

    const result = createEngine(scene, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(30);
    const report1 = engine.getReport();

    engine.reset();
    engine.runTo(30);
    const report2 = engine.getReport();

    expect(stableStringify(report1)).toBe(stableStringify(report2));
  });
});

describe('S17j: 引擎基本属性', () => {
  it('初始状态为 initialized', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 10, demandCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.engine.runState).toBe('initialized');
    expect(result.engine.executedTicks).toBe(0);
    expect(result.engine.isComplete).toBe(false);
    expect(result.engine.isTerminal).toBe(false);
  });

  it('start/pause 控制状态转换', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 20, demandCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    expect(engine.start().ok).toBe(true);
    expect(engine.runState).toBe('running');
    expect(engine.pause().ok).toBe(true);
    expect(engine.runState).toBe('paused');
  });
});

describe('确定性验证', () => {
  it('同种子两次运行轨迹完全一致', () => {
    const scene = createCampusFairScene();
    const config = { seed: 123, H: 50, demandCount: 10 };

    const r1 = createEngine(scene, config);
    const r2 = createEngine(scene, config);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    r1.engine.runTo(50);
    r2.engine.runTo(50);

    const report1 = r1.engine.getReport();
    const report2 = r2.engine.getReport();

    expect(stableStringify(report1)).toBe(stableStringify(report2));
  });

  it('不同种子产生不同需求', () => {
    const scene = createCampusFairScene();
    const config = { H: 50, demandCount: 10 };

    const r1 = createEngine(scene, { ...config, seed: 1 });
    const r2 = createEngine(scene, { ...config, seed: 2 });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    const demands1 = r1.engine.getReport().demands;
    const demands2 = r2.engine.getReport().demands;

    expect(stableStringify(demands1)).not.toBe(stableStringify(demands2));
  });
});
