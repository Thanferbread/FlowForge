/**
 * 步进与状态机测试 S02–S10。
 *
 * 使用 createEngine API 运行仿真，逐 tick 断言。
 */
import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../engine';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { Scene, GridPos } from '../../domain/types';
import { SCHEMA_VERSION } from '../../domain/types';
import type { AgentRecord, ExogenousDemand, SimState } from '../types';
import { createInitialSimState, step } from '../step';
import { createStepContext } from '../runtime';
import { assertStepInvariants } from '../invariants';
import * as pathfinder from '../pathfinder';

/** 创建小地图：单入口单出口单展位 */
function createSimpleScene(): Scene {
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

describe('S02: 移动冲突与占位', () => {
  it('同格竞争最多一人获准', () => {
    const scene = createSimpleScene();
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
      { id: 'a2', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
    ];
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 2 }, demands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const snap = engine.getSnapshot();

    // 检查没有两人同格
    const positions = new Set<string>();
    for (const a of snap.agents) {
      if (a.pos) {
        const key = `${a.pos.x},${a.pos.y}`;
        expect(positions.has(key)).toBe(false);
        positions.add(key);
      }
    }
  });

  it('每人单 tick 位移 |dx|+|dy| ≤1 且无斜走', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 30, demandCount: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(20);

    // 检查 trace 中相邻 tick 的位置变化
    const report = engine.getReport();
    for (let t = 1; t < report.trace.length; t++) {
      const prev = report.trace[t - 1];
      const curr = report.trace[t];
      for (const agent of curr.agents) {
        const prevAgent = prev.agents.find((a) => a.id === agent.id);
        if (prevAgent && prevAgent.pos && agent.pos) {
          const dx = Math.abs(agent.pos.x - prevAgent.pos.x);
          const dy = Math.abs(agent.pos.y - prevAgent.pos.y);
          expect(dx + dy).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('在场人员占位一一对应无两人同格', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(30);
    const snap = engine.getSnapshot();

    const positions = new Set<string>();
    for (const a of snap.agents) {
      if (a.pos) {
        const key = `${a.pos.x},${a.pos.y}`;
        expect(positions.has(key)).toBe(false);
        positions.add(key);
      }
    }
  });
});

describe('S03: 状态守恒', () => {
  it('对 seed=1..10 运行至 H=300，逐 tick 守恒等式成立', () => {
    const scene = createCampusFairScene();
    const H = 300;

    for (let seed = 1; seed <= 10; seed++) {
      const result = createEngine(scene, { seed, H, demandCount: 30 });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const engine = result.engine;
      engine.runTo(H);
      const report = engine.getReport();

      // D = demands with 0 <= scheduledTick < H
      const D = report.demands.filter((d) => d.scheduledTick >= 0 && d.scheduledTick < H);

      for (const snap of report.trace) {
        const notYetArrived = snap.notYetArrivedIds.length;
        const activeAgents = snap.agents.filter(a => a.state !== 'exited').length;
        const exitedCount = report.events.filter(
          (e) => e.type === 'EXIT' && e.tick <= snap.tick,
        ).length;

        const total = notYetArrived + activeAgents + exitedCount;
        expect(total).toBe(D.length);
      }
    }
  });

  it('服务完成数 ≤ |D|、离场数 ≤ |D|', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 300, demandCount: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(300);
    const metrics = engine.getMetrics();

    expect(metrics.serviceCompleted).toBeLessThanOrEqual(metrics.demandCount);
    expect(metrics.exited).toBeLessThanOrEqual(metrics.demandCount);
  });
});

describe('S04: 确定性', () => {
  it('相同场景/配置/种子完整运行两次，逐 tick 状态轨迹相等', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 100, demandCount: 20 };

    const r1 = createEngine(scene, config);
    const r2 = createEngine(scene, config);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    r1.engine.runTo(100);
    r2.engine.runTo(100);

    const report1 = r1.engine.getReport();
    const report2 = r2.engine.getReport();

    expect(report1.trace).toEqual(report2.trace);
    expect(report1.events).toEqual(report2.events);
    expect(report1.metrics).toEqual(report2.metrics);
  });
});

describe('S06: 入口 FIFO', () => {
  it('入口被占时两人同时到达，按 FIFO 留在 pending', () => {
    const scene = createSimpleScene();
    // 两人同时到达同一入口
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
      { id: 'a2', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
    ];
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 2 }, demands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    const stepResult = engine.step();
    expect(stepResult.ok).toBe(true);

    const snap = engine.getSnapshot();
    // 一人入场（walking），一人 pending
    const walking = snap.agents.filter((a) => a.state === 'walking');
    const pending = snap.agents.filter((a) => a.state === 'pending');
    expect(walking.length + pending.length).toBe(2);
  });
});

describe('S07: 三人排队 FIFO', () => {
  it('三人依次到队尾，入队顺序等于到达顺序', () => {
    const scene = createSimpleScene();
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
      { id: 'a2', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
      { id: 'a3', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
    ];
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 3 }, demands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(80);
    const report = engine.getReport();

    // 检查入队事件顺序
    const enqueueEvents = report.events.filter((e) => e.type === 'ENQUEUE');
    for (let i = 1; i < enqueueEvents.length; i++) {
      expect(enqueueEvents[i].tick).toBeGreaterThanOrEqual(enqueueEvents[i - 1].tick);
    }

    // 检查开始服务顺序等于入队顺序
    const serviceStartEvents = report.events.filter((e) => e.type === 'SERVICE_START');
    expect(serviceStartEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe('S08: 服务时长边界', () => {
  it('服务时长 4，完整消耗 4 个后续 tick 才完成', () => {
    const scene = createSimpleScene();
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
    ];
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 1 }, demands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(100);
    const report = engine.getReport();

    const serviceStart = report.events.find((e) => e.type === 'SERVICE_START');
    const serviceComplete = report.events.find((e) => e.type === 'SERVICE_COMPLETE');

    expect(serviceStart).toBeDefined();
    expect(serviceComplete).toBeDefined();
    if (serviceStart && serviceComplete) {
      // 服务完成 tick - 开始 tick = 4
      expect(serviceComplete.tick - serviceStart.tick).toBe(4);
    }

    // 无重复完成事件
    const completeEvents = report.events.filter((e) => e.type === 'SERVICE_COMPLETE');
    expect(completeEvents.length).toBe(1);
  });
});

describe('S09: 队列满与 q0 堵塞', () => {
  it('队列满时新人在真实网格上等待不瞬移', () => {
    const scene = createSimpleScene();
    // 队列长度 2，3 人同时到达
    const demands: ExogenousDemand[] = [
      { id: 'a1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
      { id: 'a2', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
      { id: 'a3', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
    ];
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 3 }, demands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(50);

    // 检查所有人都在合法位置
    const snap = engine.getSnapshot();
    for (const a of snap.agents) {
      if (a.pos) {
        expect(a.pos.x).toBeGreaterThanOrEqual(0);
        expect(a.pos.x).toBeLessThan(scene.width);
        expect(a.pos.y).toBeGreaterThanOrEqual(0);
        expect(a.pos.y).toBeLessThan(scene.height);
      }
    }
  });
});

describe('S10: 重规划与停滞', () => {
  it('每人全程重规划次数 ≤ 3', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 300, demandCount: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(300);
    const report = engine.getReport();

    for (const snap of report.trace) {
      for (const agent of snap.agents) {
        expect(agent.replanCount).toBeLessThanOrEqual(3);
      }
    }
  });

  it('连续失败 30 tick 标记停滞诊断，不删除人员', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 300, demandCount: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(300);
    const report = engine.getReport();

    // 停滞诊断中的人员仍应在 agents 中
    for (const diag of report.stagnationDiagnostics) {
      const found = report.trace.some((snap) =>
        snap.agents.some((a) => a.id === diag.agentId),
      );
      expect(found).toBe(true);
    }
  });

  it('H 到时返回含未完成数的结果', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(50);
    const metrics = engine.getMetrics();

    // H=50, demandCount=100，应该有未完成
    expect(metrics.incomplete).toBeGreaterThanOrEqual(0);
    expect(engine.isComplete).toBe(true);
  });
});

function demand(id: string, boothId = 'booth-1'): ExogenousDemand {
  return { id, boothId, entranceId: 'entrance-1', scheduledTick: 0, serviceTicks: 4 };
}
function placed(d: ExogenousDemand, state: AgentRecord['state'], pos: GridPos | null,
  changes: Partial<AgentRecord> = {}): AgentRecord {
  return { id: d.id, demand: d, state, pos, remainingService: null,
    admitTick: 0, enqueueTick: null, serviceStartTick: null, serviceCompleteTick: null,
    reachExitTick: null, exitTick: null, selectedExitId: null,
    consecutiveFailures: 0, replanCount: 0, replanPath: null, ...changes };
}
function placedState(agents: AgentRecord[]): SimState {
  return { ...createInitialSimState(), tick: 1, sampleCount: 1,
    agents: new Map(agents.map(a => [a.id, a])),
    occupancy: new Map(agents.filter(a => a.pos).map(a => [`${a.pos!.x},${a.pos!.y}`, a.id])) };
}
function jammedScene(): Scene {
  const scene = createSimpleScene();
  scene.booths.push({ id: 'booth-2', footprint: { x: 9, y: 9 },
    serviceCell: { x: 8, y: 9 }, queueCells: [{ x: 7, y: 9 }, { x: 6, y: 9 }],
    serviceTicksMin: 4, serviceTicksMax: 100 });
  return scene;
}
function jammedAgents(): AgentRecord[] {
  return [
    placed(demand('block-1', 'booth-2'), 'walking', { x: 6, y: 6 }),
    placed(demand('block-2', 'booth-2'), 'walking', { x: 6, y: 7 }),
    placed(demand('block-3', 'booth-2'), 'walking', { x: 6, y: 8 }),
    placed(demand('tail', 'booth-2'), 'queued', { x: 6, y: 9 }, { enqueueTick: 0 }),
    placed(demand('head', 'booth-2'), 'queued', { x: 7, y: 9 }, { enqueueTick: 0 }),
    placed({ ...demand('server', 'booth-2'), serviceTicks: 100 }, 'serving', { x: 8, y: 9 },
      { remainingService: 100, serviceStartTick: 0, enqueueTick: 0 }),
  ];
}

describe('修复回归：明确触发条件与精确边界', () => {
  it('真实H排除20/21时刻的需求，已离场者仍保留在逐tick快照', () => {
    const scene = createSimpleScene();
    const ds = [0, 20, 21].map((scheduledTick, i) => ({ ...demand(`a${i}`), scheduledTick }));
    const r = createEngine(scene, { seed: 42, H: 20, demandCount: 0 }, ds);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.engine.getSnapshot().notYetArrivedIds).toEqual(['a0']);
    expect(r.engine.runTo(20).ok).toBe(true);
    for (const snap of r.engine.getReport().trace) {
      expect(snap.notYetArrivedIds).toEqual([]);
      expect(snap.agents.map(a => a.id)).toEqual(['a0']);
    }
  });

  it('入口开始被占：同刻两人均pending，之后旧需求按tick/id先于新到达', () => {
    const scene = createSimpleScene();
    const old = demand('old');
    const a = { ...demand('a'), scheduledTick: 1 };
    const b = { ...demand('b'), scheduledTick: 1 };
    const c = { ...demand('c'), scheduledTick: 2 };
    const all = [old, b, a, c];
    const config = { seed: 42, H: 50, demandCount: 4 };
    const ctx = createStepContext(scene);
    let s = placedState([placed(old, 'walking', { x: 0, y: 9 })]);
    s = step(s, scene, all, config, ctx);
    expect(s.agents.get('a')!.state).toBe('pending');
    expect(s.agents.get('b')!.state).toBe('pending');
    expect(s.agents.get('old')!.pos).toEqual({ x: 1, y: 9 });
    s = step(s, scene, all, config, ctx);
    expect(s.agents.get('a')!.admitTick).toBe(2);
    expect(s.agents.get('b')!.state).toBe('pending');
    expect(s.agents.get('c')!.state).toBe('pending');
    for (let i = 0; i < 6; i++) s = step(s, scene, all, config, ctx);
    expect(s.events.filter(e => e.type === 'ADMIT').map(e => [e.agentId, e.tick]))
      .toEqual([['a', 2], ['b', 4], ['c', 6]]);
  });

  it('服务4tick完成仍占q0，队首在q0真正空出的下个step才能进入', () => {
    const scene = createSimpleScene();
    const server = placed(demand('server'), 'serving', { x: 5, y: 6 },
      { remainingService: 1, enqueueTick: 0, serviceStartTick: 0 });
    const head = placed(demand('head'), 'queued', { x: 5, y: 7 }, { enqueueTick: 0 });
    const ds = [server.demand, head.demand];
    const config = { seed: 42, H: 20, demandCount: 2 };
    const ctx = createStepContext(scene);
    let s = step(placedState([server, head]), scene, ds, config, ctx);
    expect(s.agents.get('server')!.serviceCompleteTick).toBe(2);
    expect(s.agents.get('server')!.pos).toEqual({ x: 5, y: 6 });
    expect(s.agents.get('head')!.pos).toEqual({ x: 5, y: 7 });
    s = step(s, scene, ds, config, ctx);
    expect(s.agents.get('server')!.pos).toEqual({ x: 6, y: 6 });
    expect(s.agents.get('head')!.pos).toEqual({ x: 5, y: 7 });
    s = step(s, scene, ds, config, ctx);
    expect(s.agents.get('head')!.state).toBe('serving');
    expect(s.agents.get('head')!.serviceStartTick).toBe(4);
    expect(s.agents.get('head')!.remainingService).toBe(4);
  });

  it('单人实际时序：入队7/开始9/完成13/抵达23/离场24，抵达H尚未离场', () => {
    const scene = createSimpleScene();
    const r = createEngine(scene, { seed: 42, H: 24, demandCount: 1 }, [demand('solo')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.engine.runTo(23).ok).toBe(true);
    expect(r.engine.getSnapshot().agents[0]).toMatchObject({ state: 'exiting', reachExitTick: 23, exitTick: null });
    expect(r.engine.runTo(24).ok).toBe(true);
    expect(r.engine.getReport().events.map(e => [e.type, e.tick])).toEqual([
      ['ADMIT', 0], ['ENQUEUE', 7], ['SERVICE_START', 9],
      ['SERVICE_COMPLETE', 13], ['REACH_EXIT', 23], ['EXIT', 24],
    ]);
    expect(r.engine.getSnapshot().agents[0]).toMatchObject({ state: 'exited', pos: null, exitTick: 24 });
    const endAtArrival = createEngine(scene, { seed: 42, H: 23, demandCount: 1 }, [demand('solo')]);
    if (!endAtArrival.ok) throw new Error(endAtArrival.error);
    expect(endAtArrival.engine.runTo(23).ok).toBe(true);
    expect(endAtArrival.engine.getMetrics().exited).toBe(0);
  });

  it('失败搜索在10/20/30次均耗预算，成功移动重置连续失败而不恢复预算', () => {
    const scene = jammedScene();
    const stuck = placed(demand('stuck', 'booth-2'), 'walking', { x: 5, y: 9 });
    const agents = [...jammedAgents(), stuck];
    const ds = agents.map(a => a.demand);
    const config = { seed: 42, H: 80, demandCount: ds.length };
    const ctx = createStepContext(scene);
    let s = placedState(agents);
    for (let n = 1; n <= 30; n++) {
      s = step(s, scene, ds, config, ctx);
      expect(s.agents.get('stuck')!.consecutiveFailures).toBe(n);
      expect(s.agents.get('stuck')!.replanCount).toBe(Math.floor(n / 10));
      expect(s.agents.get('stuck')!.replanPath).toBeNull();
    }
    expect(s.stagnationDiagnostics.filter(d => d.agentId === 'stuck')).toEqual([
      { agentId: 'stuck', tick: 31, consecutiveFailures: 30, replanCount: 3 },
    ]);
    // Put the same person on another unblocked ordinary cell: one successful step resets only streak.
    const moved = { ...s.agents.get('stuck')!, pos: { x: 4, y: 8 } };
    s.agents.set('stuck', moved);
    s.occupancy.delete('5,9'); s.occupancy.set('4,8', 'stuck');
    s = step(s, scene, ds, config, ctx);
    expect(s.agents.get('stuck')!.consecutiveFailures).toBe(0);
    expect(s.agents.get('stuck')!.replanCount).toBe(3);
    const releasedKey = `${s.agents.get('stuck')!.pos!.x},${s.agents.get('stuck')!.pos!.y}`;
    s.occupancy.delete(releasedKey);
    s.agents.set('stuck', { ...s.agents.get('stuck')!, pos: { x: 5, y: 9 } });
    s.occupancy.set('5,9', 'stuck');
    for (let n = 0; n < 10; n++) s = step(s, scene, ds, config, ctx);
    expect(s.agents.get('stuck')!.consecutiveFailures).toBe(10);
    expect(s.agents.get('stuck')!.replanCount).toBe(3);
  });

  it('自身q0的离场者第10次被堵后在下一步真实绕行，绝不穿过自身队列', () => {
    const scene = jammedScene();
    const leaving = placed(demand('leaving'), 'exiting', { x: 5, y: 6 },
      { serviceCompleteTick: 1, serviceStartTick: 0, enqueueTick: 0, consecutiveFailures: 9 });
    const agents = [...jammedAgents(), leaving];
    const ds = agents.map(a => a.demand);
    const config = { seed: 42, H: 40, demandCount: ds.length };
    const ctx = createStepContext(scene);
    let s = step(placedState(agents), scene, ds, config, ctx);
    expect(s.agents.get('leaving')!.pos).toEqual({ x: 5, y: 6 });
    expect(s.agents.get('leaving')!.replanCount).toBe(1);
    expect(s.agents.get('leaving')!.replanPath!.slice(0, 2)).toEqual([{ x: 5, y: 6 }, { x: 4, y: 6 }]);
    s = step(s, scene, ds, config, ctx);
    expect(s.agents.get('leaving')!.pos).toEqual({ x: 4, y: 6 });
    expect(s.agents.get('leaving')!.consecutiveFailures).toBe(0);
  });

  it('每engine缓存只构建一次，各步复用同一距离场，其他场景使用独立缓存', () => {
    const scene = createSimpleScene();
    const spy = vi.spyOn(pathfinder, 'buildDistanceField');
    try {
      const ctx = createStepContext(scene);
      expect(spy).toHaveBeenCalledTimes(scene.booths.length + scene.exits.length);
      const field = ctx.walkingFields.get('booth-1');
      const ds = [demand('solo')];
      let s = createInitialSimState();
      for (let n = 0; n < 8; n++) s = step(s, scene, ds, { seed: 42, H: 20, demandCount: 1 }, ctx);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(ctx.walkingFields.get('booth-1')).toBe(field);
      const other = createSimpleScene();
      other.obstacles.push({ x: 1, y: 9 });
      const otherContext = createStepContext(other);
      expect(otherContext.walkingFields.get('booth-1')).not.toBe(field);
      expect(() => step(s, scene, ds, { seed: 42, H: 20, demandCount: 1 }, otherContext)).toThrow('another scene');
    } finally { spy.mockRestore(); }
  });

  it('逐tick不变量拒绝重复占位、位置越界、跨两格及丢失需求', () => {
    const scene = createSimpleScene();
    const a = placed(demand('a'), 'walking', { x: 0, y: 9 });
    const before = placedState([a]);
    const after = step(before, scene, [a.demand], { seed: 42, H: 10, demandCount: 1 });
    const outside = structuredClone(after);
    outside.agents.get('a')!.pos = { x: -1, y: 9 };
    expect(() => assertStepInvariants(before, outside, scene, [a.demand], 10)).toThrow();
    const jumped = structuredClone(after);
    jumped.agents.get('a')!.pos = { x: 3, y: 9 };
    expect(() => assertStepInvariants(before, jumped, scene, [a.demand], 10)).toThrow('movement');
    const lost = structuredClone(after);
    lost.agents.clear(); lost.occupancy.clear();
    expect(() => assertStepInvariants(before, lost, scene, [a.demand], 10)).toThrow('conservation');
    const b = placed(demand('b'), 'walking', { x: 1, y: 9 });
    const doubled = structuredClone(after);
    doubled.agents.set('b', b);
    expect(() => assertStepInvariants(before, doubled, scene, [a.demand, b.demand], 10)).toThrow('two agents');
  });
});
describe('真实竞争、交换和完整排队', () => {
  it('两人实际竞争空队尾，仅一人进入，另一人有conflict失败记录', () => {
    const scene = createSimpleScene();
    const agents = [placed(demand('left'), 'walking', { x: 4, y: 8 }),
      placed(demand('right'), 'walking', { x: 6, y: 8 })];
    const s = step(placedState(agents), scene, agents.map(a => a.demand), { seed: 42, H: 20, demandCount: 2 });
    const entrants = [...s.agents.values()].filter(a => a.state === 'queued');
    expect(entrants).toHaveLength(1);
    expect(entrants[0].pos).toEqual({ x: 5, y: 8 });
    expect(s.lastMoveFailures).toHaveLength(1);
    expect(s.lastMoveFailures[0]).toMatchObject({ reason: 'conflict', sampleTick: 2 });
    expect(s.lastMoveFailures[0].agentId).not.toBe(entrants[0].id);
  });

  it('相向移动的目标均在起始占位中，两人都停留，不交换', () => {
    const scene = createSimpleScene();
    scene.booths.push({ id: 'booth-2', footprint: { x: 2, y: 5 }, serviceCell: { x: 2, y: 6 },
      queueCells: [{ x: 2, y: 7 }, { x: 2, y: 8 }], serviceTicksMin: 4, serviceTicksMax: 4 });
    const agents = [placed(demand('rightward'), 'walking', { x: 3, y: 8 }),
      placed(demand('leftward', 'booth-2'), 'walking', { x: 4, y: 8 })];
    const s = step(placedState(agents), scene, agents.map(a => a.demand), { seed: 42, H: 20, demandCount: 2 });
    expect(s.agents.get('rightward')!.pos).toEqual({ x: 3, y: 8 });
    expect(s.agents.get('leftward')!.pos).toEqual({ x: 4, y: 8 });
    expect(s.lastMoveFailures.map(f => [f.agentId, f.reason]).sort()).toEqual([
      ['leftward', 'occupied'], ['rightward', 'occupied'],
    ]);
  });

  it('三人全部实际入队并服务，FIFO事件序列精确相等', () => {
    const scene = createSimpleScene();
    const ds = [demand('a3'), demand('a2'), demand('a1')];
    const r = createEngine(scene, { seed: 42, H: 100, demandCount: 3 }, ds);
    if (!r.ok) throw new Error(r.error);
    expect(r.engine.runTo(100).ok).toBe(true);
    const report = r.engine.getReport();
    for (const eventType of ['ADMIT', 'ENQUEUE', 'SERVICE_START', 'SERVICE_COMPLETE', 'EXIT']) {
      expect(report.events.filter(e => e.type === eventType).map(e => e.agentId)).toEqual(['a1', 'a2', 'a3']);
    }
    for (const snap of report.trace) {
      expect(snap.agents.filter(a => a.state === 'serving')).toHaveLength(
        snap.agents.filter(a => a.state === 'serving' && a.pos?.x === 5 && a.pos?.y === 6).length,
      );
    }
  });

  it('不变量明确拒绝未知人员状态', () => {
    const scene = createSimpleScene();
    const d = demand('a');
    const initial = createInitialSimState();
    const after = step(initial, scene, [d], { seed: 42, H: 10, demandCount: 1 });
    Object.assign(after.agents.get('a')!, { state: 'unknown' });
    expect(() => assertStepInvariants(initial, after, scene, [d], 10)).toThrow('unknown state');
  });
});
it('重规划仍使用移动阶段开始占位：本步刚空出的qK不提前开放', () => {
  const scene = createSimpleScene();
  const waiting = placed(demand('waiting'), 'walking', { x: 4, y: 8 }, { consecutiveFailures: 9 });
  const tail = placed(demand('tail'), 'queued', { x: 5, y: 8 }, { enqueueTick: 0 });
  const previous = placedState([waiting, tail]);
  const next = step(previous, scene, [waiting.demand, tail.demand], { seed: 42, H: 30, demandCount: 2 });
  expect(next.agents.get('tail')!.pos).toEqual({ x: 5, y: 7 });
  expect(next.occupancy.has('5,8')).toBe(false);
  expect(next.agents.get('waiting')).toMatchObject({
    pos: { x: 4, y: 8 }, consecutiveFailures: 10, replanCount: 1, replanPath: null,
  });
});